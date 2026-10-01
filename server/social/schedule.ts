/**
 * The AI-free half of the Social Media service: connection lookup,
 * destination validation and scheduling posts with text the caller wrote.
 * ./service.ts re-exports everything here and adds connect/disconnect, page
 * discovery, post changes, settings, the TruthCoder generators and the
 * worker. server/public-api/* imports THIS module only
 * (server/public-api/no-ai.test.ts walks the graph): nothing below imports
 * openai, ai-config or ai-output.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { postSchema, postPayload, type Destination } from "../../shared/social";
import { BlotatoClient, decryptKey, SocialError } from "./client";

export type ClientFactory = (key: string) => BlotatoClient;
export const clientFactory: ClientFactory = (key) => new BlotatoClient(key);

export async function userLock<T>(
  userId: number,
  fn: (c: PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    const {
      rows: [r],
    } = await c.query("SELECT pg_try_advisory_lock(8159,$1) locked", [userId]);
    if (!r.locked)
      throw new SocialError("Social Media is busy; retry shortly", 409);
    try {
      return await fn(c);
    } finally {
      await c.query("SELECT pg_advisory_unlock(8159,$1)", [userId]);
    }
  } finally {
    c.release();
  }
}
export async function ownedBusiness(userId: number, businessId: number | null) {
  if (businessId === null) return;
  const { rows: [business] } = await pool.query("SELECT * FROM business_locations WHERE user_id=$1 AND id=$2", [userId, businessId]);
  if (!business) throw new SocialError("Business not found", 404);
  return business;
}
export async function connection(userId: number, make = clientFactory, businessId: number | null = null) {
  await ownedBusiness(userId, businessId);
  const {
    rows: [r],
  } = await pool.query(
    "SELECT key_enc,accounts,business_id FROM social_connections WHERE user_id=$1 AND (business_id=$2 OR business_id IS NULL) ORDER BY business_id NULLS LAST LIMIT 1",
    [userId, businessId],
  );
  if (!r) throw new SocialError("Connect Blotato first", 409);
  return {
    client: make(decryptKey(r.key_enc, userId)),
    accounts: r.accounts as any[],
    businessId: r.business_id as number | null,
  };
}
export async function validateDestinations(
  userId: number,
  destinations: Destination[],
  make = clientFactory,
  businessId: number | null = null,
) {
  const { accounts } = await connection(userId, make, businessId);
  if (businessId !== null) {
    const { rows: [config] } = await pool.query("SELECT destinations,connection_hash FROM social_business_config WHERE user_id=$1 AND business_id=$2", [userId, businessId]);
    const { client } = await connection(userId, make, businessId);
    if (!config || config.connection_hash !== client.hash || destinations.some(d => !config.destinations.some((m: Destination) => destinationKey(m) === destinationKey(d))))
      throw new SocialError("Map these accounts/pages to this business first", 409);
  }
  for (const d of destinations) {
    const a = accounts.find(
      (a) => a.id === d.accountId && a.platform === d.platform,
    );
    if (!a)
      throw new SocialError("Account is not connected to this contractor");
    if (d.pageId && !a.pages?.some((p: any) => p.id === d.pageId))
      throw new SocialError("Refresh pages and choose a verified Page");
    if (d.boardId && !a.boards?.some((p: any) => p.id === d.boardId))
      throw new SocialError("Refresh boards and choose a verified board");
  }
}
export function destinationFromPayload(payload: any): Destination {
  return { accountId: payload.post.accountId, platform: payload.post.content.platform,
    pageId: payload.post.target.pageId, boardId: payload.post.target.boardId } as Destination;
}
export function destinationKey(d: Destination) { return [d.platform,d.accountId,d.pageId || "",d.boardId || ""].join(":"); }
export function requestFingerprint(input: ReturnType<typeof postSchema.parse>) {
  // Zod fixes object field order; normalize the free-form tweak keys too.
  const tweaks = Object.fromEntries(Object.keys(input.tweaks).sort().map(key => [key, input.tweaks[key]]));
  return createHash("sha256").update(JSON.stringify({ ...input, tweaks })).digest("hex");
}
export async function insertPosts(
  c: PoolClient,
  userId: number,
  input: ReturnType<typeof postSchema.parse>,
  ai = false,
  automatic = false,
  source?: string,
  businessId: number | null = null,
) {
  const result = [];
  for (const d of input.destinations) {
    const payload = postPayload(
      d,
      input.tweaks[d.platform] ?? input.text,
      input.mediaUrls,
      ai,
    );
    const key = [d.accountId, d.pageId || "", d.boardId || ""].join(":");
    const {
      rows: [row],
    } = await c.query(
      `INSERT INTO social_posts(id,user_id,request_id,destination_key,payload,state,due_at,ai_generated,auto_generated,source,scheduled_at,request_hash,business_id,connection_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(user_id,business_id,request_id,destination_key) DO UPDATE SET request_id=EXCLUDED.request_id RETURNING *`,
      [
        randomUUID(),
        userId,
        input.requestId,
        key,
        JSON.stringify(payload),
        input.draft ? "draft" : "queued",
        input.scheduledTime || new Date(),
        ai,
        automatic,
        source || null,
        input.scheduledTime || null,
        requestFingerprint(input),
        businessId,
        (await connection(userId, clientFactory, businessId)).client.hash,
      ],
    );
    result.push(row);
  }
  return result;
}
export async function createPosts(userId: number, raw: unknown, businessId: number | null = null) {
  const input = postSchema.parse(raw);
  return userLock(userId, async (c) => {
    const { rows: existing } = await c.query(
      "SELECT *, request_hash = $3 AS same_request FROM social_posts WHERE user_id=$1 AND request_id=$2 AND business_id IS NOT DISTINCT FROM $4",
      [userId, input.requestId, requestFingerprint(input), businessId],
    );
    if (existing.length) {
      if (existing.length !== input.destinations.length || existing.some((p) => !p.same_request))
        throw new SocialError("This request ID was already used. Check the queue before composing a new post.", 409);
      return existing.map(({ same_request, ...post }) => post);
    }
    if (input.scheduledTime && Date.parse(input.scheduledTime) < Date.now())
      throw new SocialError("Choose a future schedule time");
    await validateDestinations(userId, input.destinations, clientFactory, businessId);
    for (const d of input.destinations) {
      try {
        postPayload(d, input.tweaks[d.platform] ?? input.text, input.mediaUrls);
      } catch (e) {
        throw new SocialError((e as Error).message);
      }
    }
    await c.query("BEGIN");
    try {
      const rows = await insertPosts(c, userId, input, false, false, undefined, businessId);
      await c.query("COMMIT");
      return rows;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}
