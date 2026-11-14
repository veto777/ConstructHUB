/**
 * Permit alerts poller — the scheduler tick (server/seo/jobs.ts pattern: one
 * tick, one instance across processes by advisory lock, failures to
 * recordFailure).
 *
 * Nothing is polled without a watch. Every hour, each jurisdiction (a
 * permit_databases row) that an active watch names is asked, through the adapter
 * registry, for the permits listed since its last successful poll; new rows are
 * upserted into `permits`, matched against the watches on that jurisdiction, and
 * one digest per watch goes out on the watch's channels. A portal whose adapter
 * cannot list by date is marked "not supported" and left alone for a day.
 *
 * Politeness: jurisdictions run one after another (never in parallel), adapters
 * get politeness.minDelayMs = 1000 and an honest UA; a 403/429/CAPTCHA answer
 * backs the jurisdiction off for six hours, any other failure for the normal hour.
 *
 * `permitAlertDeps` is swapped by server/permits/poller.test.ts (a fake adapter).
 */
import { pool, db } from "../db";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { permitDatabases, permitWatches, permits, permitWatchHits, type Permit, type PermitWatch } from "@shared/schema";
import { recordFailure } from "../ops/issues";
import { getAdapter } from "../scrapers/registry";
import type { AdapterCtx, PermitRecord, PortalAdapter } from "../scrapers/types";
import { newBrowserContext } from "../scraper";
import { geocodeAddress } from "./geocode";
import { deliverDigest, type DeliveryResults } from "./deliver";
import { contentHash, digestUndelivered, matchWatch, normalizeAddress } from "./matching";
import { getEntitlements, moduleEnabled } from "../entitlements";
import type { WatchKind, WatchParams } from "@shared/permit-alerts";
import { workerInterval } from "../workers";

export const PERMIT_POLL_INTERVAL_MS = 60 * 60 * 1000;
export const PERMIT_POLL_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const PERMIT_UNSUPPORTED_RETRY_MS = 24 * 60 * 60 * 1000;
/** First poll of a jurisdiction: how far back it asks. */
export const FIRST_POLL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Portals report dates, not times: ask again from a day before the last success so nothing on the boundary is missed. */
const SINCE_OVERLAP_MS = 24 * 60 * 60 * 1000;
const LISTING_TIMEOUT_MS = 5 * 60 * 1000;
const GEOCODES_PER_POLL = 40;
const TICK_MS = 5 * 60 * 1000;
const JURISDICTIONS_PER_TICK = 10;
const LOCK_KEY = 7193;
/** How long a digest that reached nobody is sent again with later polls. */
const UNSENT_RETRY_MS = 24 * 60 * 60 * 1000;

export const permitAlertDeps = {
  getAdapter: (platform: string | null | undefined): PortalAdapter | null => getAdapter(platform),
  browser: () => newBrowserContext(),
  geocode: (address: string, hint?: string | null) => geocodeAddress(address, hint),
  deliver: (watch: PermitWatch, found: Permit[]): Promise<DeliveryResults> => deliverDigest(watch, found),
  now: () => new Date(),
  /** Whether the account's plan includes Permit Alerts right now: the same test as the routes' requireModule gate. */
  entitled: async (userId: number): Promise<boolean> => moduleEnabled(await getEntitlements(userId), "permitAlerts"),
};

/** The accounts among `userIds` whose plan includes Permit Alerts (one lookup per account). */
async function entitledUsers(userIds: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  for (const id of new Set(userIds)) if (await permitAlertDeps.entitled(id)) out.add(id);
  return out;
}

export type PollOutcome =
  | { status: "polled"; databaseId: number; found: number; newOrChanged: number; hits: number }
  | { status: "unsupported" | "missing" | "failed"; databaseId: number; error?: string };

function toRecord(p: Permit): PermitRecord {
  return {
    permitNumber: p.permitNumber, jurisdiction: p.jurisdiction, databaseId: p.databaseId,
    address: p.address, parcel: p.parcel, lat: p.lat, lng: p.lng, permitType: p.permitType, workClass: p.workClass,
    description: p.description, status: p.status, issuedAt: p.issuedAt, appliedAt: p.appliedAt, expiresAt: p.expiresAt,
    valuation: p.valuation, contractorName: p.contractorName, contractorLicense: p.contractorLicense,
    applicantName: p.applicantName, ownerName: p.ownerName, sourceUrl: p.sourceUrl, raw: (p.raw as any) ?? null,
  };
}

const isBackoffError = (msg: string) => /\b(403|429)\b|captcha|too many requests|rate limit|forbidden/i.test(msg);

/** Insert or refresh the records; returns the ids of rows that are new or whose content changed. */
export async function upsertPermits(records: PermitRecord[], databaseId: number, jurisdiction: string): Promise<{ ids: number[]; changedIds: number[] }> {
  const ids: number[] = [], changedIds: number[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const num = String(r.permitNumber ?? "").trim();
    if (!num || seen.has(num)) continue;
    seen.add(num);
    const hash = contentHash({ ...r, permitNumber: num });
    const { rows: [row] } = await pool.query<{ id: number; changed: boolean }>(
      `INSERT INTO permits(database_id, permit_number, jurisdiction, address, address_norm, parcel, lat, lng, permit_type, work_class,
         description, status, issued_at, applied_at, expires_at, valuation, contractor_name, contractor_license, applicant_name,
         owner_name, source_url, raw, content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       ON CONFLICT (database_id, permit_number) DO UPDATE SET
         address=COALESCE(EXCLUDED.address, permits.address), address_norm=COALESCE(EXCLUDED.address_norm, permits.address_norm),
         parcel=COALESCE(EXCLUDED.parcel, permits.parcel), lat=COALESCE(permits.lat, EXCLUDED.lat), lng=COALESCE(permits.lng, EXCLUDED.lng),
         permit_type=COALESCE(EXCLUDED.permit_type, permits.permit_type), work_class=COALESCE(EXCLUDED.work_class, permits.work_class),
         description=COALESCE(EXCLUDED.description, permits.description), status=COALESCE(EXCLUDED.status, permits.status),
         issued_at=COALESCE(EXCLUDED.issued_at, permits.issued_at), applied_at=COALESCE(EXCLUDED.applied_at, permits.applied_at),
         expires_at=COALESCE(EXCLUDED.expires_at, permits.expires_at), valuation=COALESCE(EXCLUDED.valuation, permits.valuation),
         contractor_name=COALESCE(EXCLUDED.contractor_name, permits.contractor_name), contractor_license=COALESCE(EXCLUDED.contractor_license, permits.contractor_license),
         applicant_name=COALESCE(EXCLUDED.applicant_name, permits.applicant_name), owner_name=COALESCE(EXCLUDED.owner_name, permits.owner_name),
         source_url=COALESCE(EXCLUDED.source_url, permits.source_url), raw=COALESCE(EXCLUDED.raw, permits.raw),
         updated_at=CASE WHEN permits.content_hash <> EXCLUDED.content_hash THEN now() ELSE permits.updated_at END,
         content_hash=EXCLUDED.content_hash
       RETURNING id, (xmax = 0 OR updated_at = now()) AS changed`,
      [databaseId, num, r.jurisdiction || jurisdiction, r.address ?? null, r.address ? normalizeAddress(r.address) : null, r.parcel ?? null,
        r.lat ?? null, r.lng ?? null, r.permitType ?? null, r.workClass ?? null, r.description ?? null, r.status ?? null,
        r.issuedAt ?? null, r.appliedAt ?? null, r.expiresAt ?? null, r.valuation ?? null, r.contractorName ?? null,
        r.contractorLicense ?? null, r.applicantName ?? null, r.ownerName ?? null, r.sourceUrl ?? null,
        r.raw ? JSON.stringify(r.raw) : null, hash]);
    ids.push(row.id);
    if (row.changed) changedIds.push(row.id);
  }
  return { ids, changedIds };
}

/** Active watches that name this jurisdiction. */
export async function watchesForDatabase(databaseId: number): Promise<PermitWatch[]> {
  return db.select().from(permitWatches).where(and(eq(permitWatches.active, true), sql`${databaseId} = ANY(${permitWatches.databaseIds})`));
}

/** Match the given permits against the watches, record new hits, deliver one digest per watch. */
export async function matchAndNotify(watches: PermitWatch[], permitIds: number[], now: Date): Promise<number> {
  // An account that no longer has the Permit Alerts module keeps its watches but is not matched or notified: the
  // routes answer 402 for it, so it could not even switch them off (audit 08 #5). They resume with the plan.
  const entitled = await entitledUsers(watches.map((w) => w.userId));
  watches = watches.filter((w) => entitled.has(w.userId));
  if (!watches.length) return 0;
  let hits = 0;
  // Geocode permits once when any watch on this jurisdiction wants a radius; capped per poll (each call is paid).
  const wantsRadius = watches.some((w) => w.kind === "trade_area" && (w.params as WatchParams).radiusMiles && typeof (w.params as WatchParams).lat === "number");
  if (wantsRadius && permitIds.length) {
    const rows = await db.select().from(permits).where(and(inArray(permits.id, permitIds), sql`lat IS NULL AND address IS NOT NULL`)).limit(GEOCODES_PER_POLL);
    for (const p of rows) {
      const g = await permitAlertDeps.geocode(p.address!, p.jurisdiction);
      if (g) await db.update(permits).set({ lat: g.lat, lng: g.lng }).where(eq(permits.id, p.id));
    }
  }
  for (const watch of watches) {
    const candidates = !permitIds.length ? [] : await db.select().from(permits).where(and(
      inArray(permits.id, permitIds),
      sql`NOT EXISTS (SELECT 1 FROM permit_watch_hits h WHERE h.watch_id = ${watch.id} AND h.permit_id = ${permits.id})`,
    ));
    const matched: Array<{ permit: Permit; reason: string }> = [];
    for (const p of candidates) {
      const m = matchWatch({ kind: watch.kind as WatchKind, params: (watch.params ?? {}) as WatchParams }, toRecord(p));
      if (m.matched) matched.push({ permit: p, reason: m.reason });
    }
    await db.update(permitWatches).set({ lastCheckedAt: now }).where(eq(permitWatches.id, watch.id));
    // Hits from the last day whose digest reached nobody (every channel failed, or the process stopped between
    // recording and sending) go out again with this poll: the hit row alone would keep them from ever matching again.
    const unsent = await db.select({ id: permitWatchHits.id, permitId: permitWatchHits.permitId }).from(permitWatchHits).where(and(
      eq(permitWatchHits.watchId, watch.id), isNull(permitWatchHits.notifiedAt),
      gt(permitWatchHits.matchedAt, new Date(now.getTime() - UNSENT_RETRY_MS)),
    ));
    // ON CONFLICT DO NOTHING: another process that got here first owns the digest for those permits.
    const inserted = !matched.length ? [] : await db.insert(permitWatchHits)
      .values(matched.map((m) => ({ watchId: watch.id, permitId: m.permit.id, reason: m.reason, matchedAt: now })))
      .onConflictDoNothing().returning({ id: permitWatchHits.id, permitId: permitWatchHits.permitId });
    hits += inserted.length;
    const pending = [...unsent, ...inserted];
    if (!pending.length) continue;
    const unsentPermits = unsent.length ? await db.select().from(permits).where(inArray(permits.id, unsent.map((h) => h.permitId))) : [];
    const toSend = [...unsentPermits, ...inserted.map((h) => matched.find((m) => m.permit.id === h.permitId)!.permit)];
    let results: DeliveryResults = {};
    try { results = await permitAlertDeps.deliver(watch, toSend); }
    catch (e: any) { results = { email: { ok: false, detail: String(e?.message ?? e).slice(0, 200) } }; }
    // Notified only when the digest went out on a channel; otherwise the hits stay un-notified for the retry above.
    await db.update(permitWatchHits).set({ notifiedAt: digestUndelivered(results) ? null : new Date(), channelResults: results })
      .where(inArray(permitWatchHits.id, pending.map((h) => h.id)));
    if (inserted.length) await db.update(permitWatches).set({ lastMatchedAt: now }).where(eq(permitWatches.id, watch.id));
  }
  return hits;
}

async function setState(databaseId: number, patch: { nextPollAt: Date; lastPolledAt?: Date; lastSuccessAt?: Date; lastError: string | null; failing: boolean; lastCount?: number }, now: Date) {
  await pool.query(
    `INSERT INTO permit_poll_state(database_id, next_poll_at, last_polled_at, last_success_at, last_error, failing_since, last_count)
     VALUES($1::int,$2::timestamptz,$3::timestamptz,$4::timestamptz,$5::text,CASE WHEN $6::boolean THEN $3::timestamptz END,COALESCE($7::int,0))
     ON CONFLICT (database_id) DO UPDATE SET
       next_poll_at=EXCLUDED.next_poll_at, last_polled_at=EXCLUDED.last_polled_at,
       last_success_at=COALESCE(EXCLUDED.last_success_at, permit_poll_state.last_success_at),
       last_error=EXCLUDED.last_error,
       failing_since=CASE WHEN $6::boolean THEN COALESCE(permit_poll_state.failing_since, $3::timestamptz) ELSE NULL END,
       last_count=COALESCE($7::int, permit_poll_state.last_count)`,
    [databaseId, patch.nextPollAt, patch.lastPolledAt ?? now, patch.lastSuccessAt ?? null, patch.lastError, patch.failing, patch.lastCount ?? null]);
}

/** Poll one jurisdiction now: list, upsert, match, notify, record the outcome. */
export async function pollJurisdiction(databaseId: number): Promise<PollOutcome> {
  const now = permitAlertDeps.now();
  const [row] = await db.select().from(permitDatabases).where(eq(permitDatabases.id, databaseId)).limit(1);
  if (!row) return { status: "missing", databaseId };
  const adapter = permitAlertDeps.getAdapter(row.platform);
  if (!adapter || !adapter.capabilities.listRecent) {
    const error = adapter ? `Alerts are not supported for ${row.platform} portals yet (no date listing)` : `No adapter for ${row.platform ?? "this portal"}`;
    await setState(databaseId, { nextPollAt: new Date(now.getTime() + PERMIT_UNSUPPORTED_RETRY_MS), lastError: error, failing: false }, now);
    return { status: "unsupported", databaseId, error };
  }
  const { rows: [state] } = await pool.query<{ last_success_at: Date | null }>("SELECT last_success_at FROM permit_poll_state WHERE database_id=$1", [databaseId]);
  const sinceMs = state?.last_success_at ? new Date(state.last_success_at).getTime() - SINCE_OVERLAP_MS : now.getTime() - FIRST_POLL_LOOKBACK_MS;
  const since = new Date(sinceMs).toISOString();
  const searchUrl = row.searchUrl || row.portalUrl;
  if (!searchUrl) {
    const error = "No portal URL on record";
    await setState(databaseId, { nextPollAt: new Date(now.getTime() + PERMIT_UNSUPPORTED_RETRY_MS), lastError: error, failing: false }, now);
    return { status: "unsupported", databaseId, error };
  }
  const opened: Array<Awaited<ReturnType<typeof permitAlertDeps.browser>>> = [];
  const ctx: AdapterCtx = {
    databaseId, databaseName: row.name, jurisdiction: row.jurisdiction, searchUrl, portalUrl: row.portalUrl,
    browser: async () => { const c = await permitAlertDeps.browser(); opened.push(c); return c; },
    log: (m) => console.log(`[permit-alerts] ${row.name}: ${m}`),
    politeness: { minDelayMs: 1000 },
  };
  let records: PermitRecord[];
  try {
    records = await Promise.race([
      adapter.listRecent(ctx, since),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Listing timed out after 5 minutes")), LISTING_TIMEOUT_MS).unref()),
    ]);
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    const backoff = isBackoffError(msg) ? PERMIT_POLL_BACKOFF_MS : PERMIT_POLL_INTERVAL_MS;
    await setState(databaseId, { nextPollAt: new Date(now.getTime() + backoff), lastError: msg, failing: true }, now);
    void recordFailure("job", `Permit poll ${row.name}`, e, { databaseId, platform: row.platform });
    return { status: "failed", databaseId, error: msg };
  } finally {
    for (const c of opened) await c.close().catch(() => {});
  }
  try {
    const { ids, changedIds } = await upsertPermits(records, databaseId, row.jurisdiction);
    const watches = await watchesForDatabase(databaseId);
    const hits = await matchAndNotify(watches, ids, now);
    await setState(databaseId, { nextPollAt: new Date(now.getTime() + PERMIT_POLL_INTERVAL_MS), lastSuccessAt: now, lastError: null, failing: false, lastCount: records.length }, now);
    return { status: "polled", databaseId, found: records.length, newOrChanged: changedIds.length, hits };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    await setState(databaseId, { nextPollAt: new Date(now.getTime() + PERMIT_POLL_INTERVAL_MS), lastError: msg, failing: true }, now);
    void recordFailure("job", `Permit matching ${row.name}`, e, { databaseId });
    return { status: "failed", databaseId, error: msg };
  }
}

/** Jurisdictions an active watch names whose poll is due, oldest first. */
export async function dueJurisdictions(limit = JURISDICTIONS_PER_TICK): Promise<number[]> {
  // Only watches of accounts whose plan still includes Permit Alerts keep a portal on the schedule (audit 08 #5).
  const { rows: owners } = await pool.query<{ user_id: number }>("SELECT DISTINCT user_id FROM permit_watches WHERE active");
  const entitled = [...await entitledUsers(owners.map((o) => o.user_id))];
  if (!entitled.length) return [];
  const { rows } = await pool.query<{ database_id: number }>(
    `SELECT w.database_id FROM (SELECT DISTINCT unnest(database_ids) AS database_id FROM permit_watches WHERE active AND user_id = ANY($2::int[])) w
     LEFT JOIN permit_poll_state s ON s.database_id = w.database_id
     WHERE s.database_id IS NULL OR s.next_poll_at <= now()
     ORDER BY s.next_poll_at NULLS FIRST, w.database_id LIMIT $1`, [limit, entitled]);
  return rows.map((r) => r.database_id);
}

/** Poll the due jurisdictions one after another (politeness: never two portals at once). */
export async function pollDueJurisdictions(limit = JURISDICTIONS_PER_TICK): Promise<PollOutcome[]> {
  const out: PollOutcome[] = [];
  for (const id of await dueJurisdictions(limit)) {
    out.push(await pollJurisdiction(id));
    await new Promise((r) => setTimeout(r, 1000));
  }
  return out;
}

/** Ask for a jurisdiction's next poll to happen on the next tick ("Check now"). */
export async function requestPollSoon(databaseIds: number[]): Promise<void> {
  if (!databaseIds.length) return;
  await pool.query(
    `INSERT INTO permit_poll_state(database_id, next_poll_at) SELECT unnest($1::int[]), now()
     ON CONFLICT (database_id) DO UPDATE SET next_poll_at = now()
       WHERE permit_poll_state.failing_since IS NULL OR permit_poll_state.next_poll_at <= now() + interval '1 hour'`, [databaseIds]);
}

/** One scheduler pass; only one instance at a time across processes. */
export async function permitAlertsTick(): Promise<PollOutcome[]> {
  const client = await pool.connect();
  try {
    const { rows: [{ locked }] } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
    if (!locked) return [];
    try { return await pollDueJurisdictions(); }
    finally { await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {}); }
  } finally {
    client.release();
  }
}

export function startPermitAlertsWorker() {
  if (process.env.PERMIT_ALERTS_DISABLED === "true") return;
  return workerInterval("Permit alerts worker", () => permitAlertsTick().catch((e) => { console.error("[permit-alerts] tick failed", e?.message ?? e); void recordFailure("job", "Permit alerts tick", e); }), TICK_MS).timer;
}
