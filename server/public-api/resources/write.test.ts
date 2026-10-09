import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

// Public API write resources against a local express app and the lane DB. The
// key context lane 1's auth middleware would attach is faked from a header;
// everything below it (scope check, the existing GBP/social/Site Scan paths,
// quotas, tenant isolation) is real.
//
// AI is mocked to THROW: if any write route ever reached an AI client or model
// name, the request would answer 500 and these tests would fail.
vi.mock("openai", () => ({ default: class { constructor() { throw new Error("AI reached from the public API"); } } }));
vi.mock("../../ai-config", () => ({
  aiModel: () => { throw new Error("AI model resolved from the public API"); },
  aiVisionModel: () => { throw new Error("AI model resolved from the public API"); },
  aiTimeoutMs: (fallback = 60_000) => fallback,
}));
vi.mock("../../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));

import { pool } from "../../db";
import { ensureGrowthSchema } from "../../growth-schema";
import { ensureGbpSchema } from "../../gbp/schema";
import { ensureGbpContentSchema } from "../../gbp/content";
import { ensureSocialSchema } from "../../social/schema";
import { ensureSiteScanSchema } from "../../sitescan/schema";
import { ensureAccountEventsSchema } from "../../account-events";
import { GoogleError } from "../../gbp/client";
import { reply as realReply } from "../../gbp/service";
import { BlotatoClient } from "../../social/client";
import { connect as connectSocial } from "../../social/service";
import { saveMapping } from "../../social/agency";
import { quotaKey, reserveQuotaFor } from "../../growth-quotas";
import { PUBLIC_API_BASE, WRITE_UNITS, registerWriteResources, rejectApiKeysOutsidePublicApi, writeOpenapiFragment, writeResources } from "./index-write";
import { gbpPostPayload, gbpPostInput } from "./gbp-write";
import { startSiteScan } from "./sitescan-write";

let owner = 0, other = 0, noPlan = 0, location = 0, unlinked = 0, otherLocation = 0, review = 0, otherReview = 0;
let base = "", server: ReturnType<express.Express["listen"]>;
const replyMock = vi.fn(realReply);
const AI_ROUTES = ["/api/gbp/content/1/draft", "/api/gmb/review-response", `/api/sitescan/jobs/${randomUUID()}/plan`, "/api/social/generate", "/api/hub/chat"];

type Key = { user: number; scopes?: string[]; id?: string };
async function call(path: string, key: Key | null, body?: unknown, method = "POST") {
  const r = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      "user-agent": "l7-write-test",
      ...(key ? { "x-fixture-key": `${key.user}:${(key.scopes ?? ["read", "write"]).join(",")}:${key.id ?? "key_fixture"}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, data, units: r.headers.get("x-test-units"), retryAfter: r.headers.get("retry-after") };
}
const month = () => new Date().toISOString().slice(0, 7);
const used = async (key: string) => Number((await pool.query("SELECT used FROM growth_budgets WHERE key=$1 AND period='0'", [key])).rows[0]?.used ?? 0);
/** Windowed budgets (the daily scan cap) keep their count under the current period. */
const usedToday = async (key: string) => Number((await pool.query("SELECT used FROM growth_budgets WHERE key=$1 AND period=$2", [key, String(Math.floor(Date.now() / 86400_000))])).rows[0]?.used ?? 0);

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(url.pathname) || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local development DB required");
  process.env.SOCIAL_ENCRYPTION_KEY = "ab".repeat(32);
  await ensureGrowthSchema(); await ensureGbpSchema(); await ensureGbpContentSchema(); await ensureSocialSchema(); await ensureSiteScanSchema(); await ensureAccountEventsSchema();
  const { rows: users } = await pool.query(
    "INSERT INTO users(email) VALUES('acct-l7-'||gen_random_uuid()||'@example.invalid'),('acct-l7-'||gen_random_uuid()||'@example.invalid'),('acct-l7-'||gen_random_uuid()||'@example.invalid') RETURNING id",
  );
  [owner, other, noPlan] = users.map((u) => u.id);
  await pool.query("INSERT INTO subscriptions(user_id,plan,status,stripe_subscription_id) VALUES($1,'pro','active',$2),($3,'pro','active',$4)", [owner, `sub_l7_${randomUUID()}`, other, `sub_l7_${randomUUID()}`]);
  location = (await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,gbp_google_subject,city,phone) VALUES($1,'ACCT- l7 fixture','accounts/l7','locations/l7','subject-l7','Tampa','555-0100') RETURNING id", [owner])).rows[0].id;
  unlinked = (await pool.query("INSERT INTO business_locations(user_id,business_name) VALUES($1,'ACCT- l7 unlinked') RETURNING id", [owner])).rows[0].id;
  otherLocation = (await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,gbp_google_subject) VALUES($1,'ACCT- l7 other','accounts/l7o','locations/l7o','subject-l7o') RETURNING id", [other])).rows[0].id;
  review = (await pool.query("INSERT INTO google_profile_reviews(user_id,location_id,google_review_id,reviewer_name,rating,comment,review_date) VALUES($1,$2,'accounts/l7/locations/l7/reviews/r1','Fixture reviewer',5,'Great crew',now()) RETURNING id", [owner, location])).rows[0].id;
  otherReview = (await pool.query("INSERT INTO google_profile_reviews(user_id,location_id,google_review_id,reviewer_name,rating,comment,review_date) VALUES($1,$2,'accounts/l7o/locations/l7o/reviews/r1','Other reviewer',4,'Fine',now()) RETURNING id", [other, otherLocation])).rows[0].id;
  // A Blotato connection + a business mapping, through the real social service with the provider HTTP mocked.
  const http = vi.fn(async (input: any) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/accounts")) return new Response(JSON.stringify({ items: [{ id: "l7-twitter", platform: "twitter", fullname: "L7 X" }] }));
    throw new Error(`Unexpected provider call ${path}`);
  });
  await connectSocial(owner, "l7-fixture-key", null, (key) => new BlotatoClient(key, http, async () => {}), location);
  await saveMapping(owner, location, { destinations: [{ accountId: "l7-twitter", platform: "twitter" }] });

  const app = express();
  app.use(express.json());
  app.use(rejectApiKeysOutsidePublicApi);
  // Stands in for lane 1's API-key auth: the verified key row from a fixture header.
  app.use((req: any, res, next) => {
    const h = String(req.headers["x-fixture-key"] || "");
    if (h) { const [user, scopes, id] = h.split(":"); req.apiKey = { id, user_id: Number(user), scopes: scopes.split(",") }; }
    const json = res.json.bind(res);
    res.json = (body: any) => { if (res.locals.apiUnits !== undefined) res.setHeader("x-test-units", String(res.locals.apiUnits)); return json(body); };
    next();
  });
  registerWriteResources((name, router) => app.use(`${PUBLIC_API_BASE}/${name}`, router), { gbp: { reply: replyMock } });
  for (const path of AI_ROUTES) app.post(path, (_req, res) => res.json({ reached: true }));
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  const ids = [owner, other, noPlan];
  await pool.query("DELETE FROM gbp_content_jobs WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM social_posts WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM social_business_config WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM social_connections WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM sitescan_jobs WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM google_profile_reviews WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM account_activity WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM business_locations WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE ANY($1::text[])", [ids.flatMap((u) => [`quota:user:${u}:%`, `sitescan:scan:${u}`, `social-ai:${u}`])]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  await pool.end();
});

const gbpPost = (loc = location) => `${PUBLIC_API_BASE}/locations/${loc}/posts`;
const gbpReply = (id = review) => `${PUBLIC_API_BASE}/reviews/${id}/reply`;
const socialPost = () => `${PUBLIC_API_BASE}/social-posts`;
const scans = `${PUBLIC_API_BASE}/site-scans`;
const socialBody = (extra: Record<string, unknown> = {}) => ({ businessId: location, requestId: randomUUID(), text: "Fixture update from the API", destinations: [{ accountId: "l7-twitter", platform: "twitter" }], ...extra });

describe("scope and metering", () => {
  it("every write needs the write scope (403 insufficient_scope) and a key at all (401)", async () => {
    for (const [path, body] of [[gbpPost(), { text: "x" }], [gbpReply(), { text: "x" }], [socialPost(), socialBody()], [scans, { url: "https://example.com" }]] as const) {
      const readOnly = await call(path, { user: owner, scopes: ["read"] }, body);
      expect(readOnly.status, path).toBe(403);
      expect(readOnly.data).toMatchObject({ error: { code: "insufficient_scope", required: "write" } });
      expect((await call(path, null, body)).status, path).toBe(401);
    }
    // Nothing was written by the refused calls.
    expect((await pool.query("SELECT count(*)::int n FROM gbp_content_jobs WHERE user_id=$1", [owner])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int n FROM sitescan_jobs WHERE user_id=$1", [owner])).rows[0].n).toBe(0);
  });

  it("marks each write as 5 units for the metering middleware and documents it in the OpenAPI fragments", async () => {
    const r = await call(gbpPost(), { user: owner }, { text: "Metered post" });
    expect(r.status).toBe(201);
    expect(r.units).toBe(String(WRITE_UNITS));
    const fragment = writeOpenapiFragment();
    const ops = Object.values(fragment.paths).flatMap((p: any) => Object.values(p)) as any[];
    expect(ops.length).toBe(4);
    for (const op of ops) expect(op).toMatchObject({ "x-scope": "write", "x-units": 5, security: [{ apiKey: ["write"] }] });
    expect(Object.keys(fragment.paths).sort()).toEqual(["/locations/{id}/posts", "/reviews/{id}/reply", "/site-scans", "/social-posts"]);
    expect(writeResources().map((r) => r.name)).toEqual(["locations", "reviews", "social-posts", "site-scans"]);
  });
});

describe("POST locations/:id/posts — schedule a Google update", () => {
  it("stores the caller's text, media and time exactly as supplied with source=api", async () => {
    const requestKey = randomUUID(), scheduledAt = "2030-06-01T14:30:00.000Z";
    const body = { requestKey, text: "  Our crew finished the Hyde Park roof today — call for a free estimate!  ", mediaUrls: ["https://cdn.example.com/roof.jpg"], scheduledAt, callToAction: { actionType: "CALL" } };
    const r = await call(gbpPost(), { user: owner, id: "key_abc" }, body);
    expect(r.status).toBe(201);
    expect(r.data.created).toBe(true);
    expect(r.data.post).toMatchObject({ locationId: location, requestKey, status: "queued", text: body.text.trim(), mediaUrls: body.mediaUrls, topicType: "STANDARD", callToAction: { actionType: "CALL" }, source: "api" });
    expect(new Date(r.data.post.scheduledAt).toISOString()).toBe(scheduledAt);
    const { rows: [job] } = await pool.query("SELECT * FROM gbp_content_jobs WHERE id=$1", [r.data.post.id]);
    expect(job).toMatchObject({ user_id: owner, location_id: location, kind: "post", status: "queued", source: "api", item_index: 0 });
    expect(job.payload).toEqual(gbpPostPayload(gbpPostInput.parse(body)));
    expect(job.payload.summary).toBe(body.text.trim());
    expect(job.payload.media).toEqual([{ mediaFormat: "PHOTO", sourceUrl: "https://cdn.example.com/roof.jpg" }]);
    expect(job.target).toEqual({ account: "accounts/l7", location: "locations/l7", subject: "subject-l7" });
    expect(new Date(job.due_at).toISOString()).toBe(scheduledAt);
    const { rows: [activity] } = await pool.query("SELECT * FROM account_activity WHERE user_id=$1 AND kind='api.gbp.post_scheduled' ORDER BY id DESC LIMIT 1", [owner]);
    expect(activity.detail).toMatchObject({ jobId: r.data.post.id, locationId: location, keyId: "key_abc" });
    expect(activity.user_agent).toBe("l7-write-test");
  });

  it("is idempotent on requestKey and refuses the key for different content", async () => {
    const requestKey = randomUUID();
    const first = await call(gbpPost(), { user: owner }, { requestKey, text: "Same post" });
    const again = await call(gbpPost(), { user: owner }, { requestKey, text: "Same post" });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ created: false, post: { id: first.data.post.id } });
    const changed = await call(gbpPost(), { user: owner }, { requestKey, text: "Different post" });
    expect(changed.status).toBe(409);
    expect(changed.data.error.code).toBe("conflict");
    expect((await pool.query("SELECT count(*)::int n FROM gbp_content_jobs WHERE user_id=$1 AND request_key=$2", [owner, requestKey])).rows[0].n).toBe(1);
  });

  it("validates the body and never accepts non-HTTPS or private media URLs", async () => {
    for (const body of [{}, { text: "   " }, { text: "x".repeat(1501) }, { text: "ok", mediaUrls: ["http://cdn.example.com/a.jpg"] }, { text: "ok", mediaUrls: ["https://10.0.0.1/a.jpg"] },
      { text: "ok", topicType: "EVENT" }, { text: "ok", callToAction: { actionType: "BOOK" } }, { text: "ok", scheduledAt: "tomorrow" }, { text: "ok", unknown: 1 }]) {
      const r = await call(gbpPost(), { user: owner }, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.data.error.code).toBe("validation_error");
      expect(Array.isArray(r.data.error.issues)).toBe(true);
    }
  });

  it("keeps tenants apart: another account's location is 404, an unlinked location is 409", async () => {
    const foreign = await call(gbpPost(otherLocation), { user: owner }, { text: "Not mine" });
    expect(foreign.status).toBe(404);
    expect(foreign.data.error.code).toBe("not_found");
    const notLinked = await call(gbpPost(unlinked), { user: owner }, { text: "No Google listing" });
    expect(notLinked.status).toBe(409);
    expect((await pool.query("SELECT count(*)::int n FROM gbp_content_jobs WHERE location_id=ANY($1::int[])", [[otherLocation, unlinked]])).rows[0].n).toBe(0);
  });
});

describe("POST reviews/:id/reply — reply with the caller's text", () => {
  it("saves a draft through the existing reply path (the AI reply worker then leaves the review alone)", async () => {
    const r = await call(gbpReply(), { user: owner }, { text: "Thank you for trusting us with your roof!", publish: false });
    expect(r.status).toBe(201);
    expect(r.data.reply).toMatchObject({ reviewId: review, status: "draft", draft: "Thank you for trusting us with your roof!", comment: null, published: false, source: "api" });
    expect(replyMock).toHaveBeenLastCalledWith(owner, review, "Thank you for trusting us with your roof!", "draft", undefined, expect.objectContaining({ req: expect.anything() }));
    const { rows: [row] } = await pool.query("SELECT reply_draft,reply_status,reply_comment FROM google_profile_reviews WHERE id=$1", [review]);
    expect(row).toEqual({ reply_draft: "Thank you for trusting us with your roof!", reply_status: "draft", reply_comment: null });
    // What review-automation's processReplies selects: reviews with neither a reply nor a draft. This one is now excluded.
    const { rows: eligible } = await pool.query("SELECT id FROM google_profile_reviews WHERE id=$1 AND reply_comment IS NULL AND reply_draft IS NULL", [review]);
    expect(eligible).toEqual([]);
  });

  it("publishes through the existing path and its Google checks (no usable grant here = 409 google_reconnect_required, never 401)", async () => {
    const r = await call(gbpReply(), { user: owner }, { text: "Published reply" });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe("google_reconnect_required");
    expect(replyMock).toHaveBeenLastCalledWith(owner, review, "Published reply", "publish", undefined, expect.anything());
  });

  it("returns Google's confirmation when the reply path succeeds, and maps the other Google failures", async () => {
    replyMock.mockImplementationOnce(async () => ({ replyStatus: "posted", replyComment: "Published reply" }) as any);
    const ok = await call(gbpReply(), { user: owner }, { text: "Published reply" });
    expect(ok.status).toBe(200);
    expect(ok.data.reply).toMatchObject({ reviewId: review, status: "posted", comment: "Published reply", published: true, source: "api" });
    for (const [kind, status, code] of [["permission", 403, "google_permission"], ["quota", 429, "google_quota"], ["transient", 503, "google_unavailable"]] as const) {
      replyMock.mockImplementationOnce(async () => { throw new GoogleError(kind, "fixture", 418); });
      const r = await call(gbpReply(), { user: owner }, { text: "x" });
      expect(r.status, kind).toBe(status);
      expect(r.data.error.code).toBe(code);
    }
  });

  it("validates and isolates: empty text 400, another account's review 404, unknown review 404", async () => {
    expect((await call(gbpReply(), { user: owner }, { text: "" })).status).toBe(400);
    expect((await call(gbpReply(), { user: owner }, { text: "x", publish: "yes" })).status).toBe(400);
    const foreign = await call(gbpReply(otherReview), { user: owner }, { text: "Not my review", publish: false });
    expect(foreign.status).toBe(404);
    expect((await pool.query("SELECT reply_draft FROM google_profile_reviews WHERE id=$1", [otherReview])).rows[0].reply_draft).toBeNull();
    expect((await call(gbpReply(999999999), { user: owner }, { text: "x", publish: false })).status).toBe(404);
  });
});

describe("POST social-posts — schedule a social post (businessId in the body)", () => {
  it("queues the caller's text to the mapped destinations, stored as supplied with source=api and no AI flags", async () => {
    const body = socialBody({ text: "Fixture update from the API — see our latest install", mediaUrls: ["https://cdn.example.com/install.jpg"], scheduledTime: "2030-01-02T15:00:00.000Z" });
    const r = await call(socialPost(), { user: owner, id: "key_social" }, body);
    expect(r.status).toBe(201);
    expect(r.data.created).toBe(true);
    expect(r.data.posts).toHaveLength(1);
    expect(r.data.posts[0]).toMatchObject({ businessId: location, requestId: body.requestId, state: "queued", platform: "twitter", text: body.text, mediaUrls: body.mediaUrls, source: "api", aiGenerated: false });
    expect(new Date(r.data.posts[0].scheduledAt).toISOString()).toBe(body.scheduledTime);
    expect(r.data.posts[0]).not.toHaveProperty("connection_hash");
    expect(r.data.posts[0]).not.toHaveProperty("request_hash");
    const { rows: [row] } = await pool.query("SELECT * FROM social_posts WHERE id=$1", [r.data.posts[0].id]);
    expect(row).toMatchObject({ user_id: owner, business_id: location, source: "api", ai_generated: false, auto_generated: false, state: "queued" });
    expect(row.payload.post.content).toEqual({ text: body.text, mediaUrls: body.mediaUrls, platform: "twitter" });
    const { rows: [activity] } = await pool.query("SELECT detail FROM account_activity WHERE user_id=$1 AND kind='api.social.post_scheduled' ORDER BY id DESC LIMIT 1", [owner]);
    expect(activity.detail).toMatchObject({ businessId: location, requestId: body.requestId, count: 1, keyId: "key_social" });
  });

  it("replays the same requestId (200) and refuses it for different content (409)", async () => {
    const body = socialBody();
    expect((await call(socialPost(), { user: owner }, body)).status).toBe(201);
    const again = await call(socialPost(), { user: owner }, body);
    expect(again.status).toBe(200);
    expect(again.data.created).toBe(false);
    expect(again.data.posts[0].source).toBe("api");
    const changed = await call(socialPost(), { user: owner }, { ...body, text: "Changed" });
    expect(changed.status).toBe(409);
  });

  it("applies the social rules: unmapped destination 409, past time 400, platform limit 400, foreign business 404", async () => {
    const unmapped = await call(socialPost(), { user: owner }, socialBody({ destinations: [{ accountId: "someone-else", platform: "facebook", pageId: "p1" }] }));
    expect(unmapped.status).toBe(409);
    expect((await call(socialPost(), { user: owner }, socialBody({ scheduledTime: "2020-01-01T00:00:00Z" }))).status).toBe(400);
    expect((await call(socialPost(), { user: owner }, socialBody({ text: "x".repeat(281) }))).status).toBe(400);
    expect((await call(socialPost(), { user: owner }, socialBody({ mediaUrls: ["http://cdn.example.com/a.jpg"] }))).status).toBe(400);
    expect((await call(socialPost(), { user: owner }, { text: "no request id" })).status).toBe(400);
    const foreign = await call(socialPost(), { user: owner }, socialBody({ businessId: otherLocation }));
    expect(foreign.status).toBe(404);
    // The other account has no social connection: 409, and nothing of the owner's is visible to it.
    expect((await call(socialPost(), { user: other }, socialBody())).status).toBe(404);
    expect((await pool.query("SELECT count(*)::int n FROM social_posts WHERE user_id=$1", [other])).rows[0].n).toBe(0);
  });
});

describe("POST site-scans — start a Site Scan", () => {
  it("queues the crawl for the worker and spends one monthly Site Scan", async () => {
    const before = await used(quotaKey(owner, "siteScans"));
    const r = await call(scans, { user: owner, id: "key_scan" }, { url: "https://example.com/", pageCap: 20, psiPages: 0 });
    expect(r.status).toBe(202);
    expect(r.data.scan).toMatchObject({ url: "https://example.com/", status: "queued", pageCap: 20, psiPages: 0, locationId: null });
    const { rows: [job] } = await pool.query("SELECT * FROM sitescan_jobs WHERE id=$1", [r.data.scan.id]);
    expect(job).toMatchObject({ user_id: owner, url: "https://example.com/", page_cap: 20, psi_pages: 0, status: "queued", profile: null, attempts: 0 });
    expect(job.state).toMatchObject({ queue: ["https://example.com/"], pages: [], errors: [] });
    expect(await used(quotaKey(owner, "siteScans"))).toBe(before + 1);
    expect(await usedToday(`sitescan:scan:${owner}`)).toBe(1);
    const { rows: [activity] } = await pool.query("SELECT detail FROM account_activity WHERE user_id=$1 AND kind='api.sitescan.started' ORDER BY id DESC LIMIT 1", [owner]);
    expect(activity.detail).toMatchObject({ id: r.data.scan.id, url: "https://example.com/", keyId: "key_scan" });
  });

  it("refuses without a plan (402 plan_required), when the month is used up (429 quota_exceeded) and over the daily cap (429 rate_limited), refunding what never ran", async () => {
    const none = await call(scans, { user: noPlan }, { url: "https://example.com" });
    expect(none.status).toBe(402);
    expect(none.data.error).toMatchObject({ code: "plan_required", requiredPlan: "starter" });
    expect((await pool.query("SELECT count(*)::int n FROM sitescan_jobs WHERE user_id=$1", [noPlan])).rows[0].n).toBe(0);

    // Pro includes 15 a month.
    await pool.query("INSERT INTO growth_budgets(key,period,used) VALUES($1,'0',15) ON CONFLICT(key,period) DO UPDATE SET used=15", [quotaKey(owner, "siteScans")]);
    const full = await call(scans, { user: owner }, { url: "https://example.com" });
    expect(full.status).toBe(429);
    expect(full.data.error).toMatchObject({ code: "quota_exceeded", scope: "feature", feature: "siteScans", limit: 15, used: 15 });
    expect(Number(full.retryAfter)).toBeGreaterThan(0);
    await pool.query("UPDATE growth_budgets SET used=1 WHERE key=$1 AND period='0'", [quotaKey(owner, "siteScans")]);

    await pool.query("INSERT INTO growth_budgets(key,period,used) VALUES($1,$2,5) ON CONFLICT(key,period) DO UPDATE SET used=5", [`sitescan:scan:${owner}`, String(Math.floor(Date.now() / 86400_000))]);
    const daily = await call(scans, { user: owner }, { url: "https://example.com" });
    expect(daily.status).toBe(429);
    expect(daily.data.error).toMatchObject({ code: "rate_limited", scope: "daily", limit: 5 });
    expect(daily.retryAfter).toBe("86400");
    // The monthly reservation taken before the daily refusal was given back.
    expect(await used(quotaKey(owner, "siteScans"))).toBe(1);
    await pool.query("DELETE FROM growth_budgets WHERE key=$1", [`sitescan:scan:${owner}`]);
  });

  it("validates the target: private or non-http URLs 400, an unsynced location 400, unknown fields 400", async () => {
    for (const body of [{ url: "http://127.0.0.1/" }, { url: "ftp://example.com" }, { url: "https://metadata.google.internal/" }, { url: "not a url" }, {}, { url: "https://example.com", pageCap: 0 }, { url: "https://example.com", extra: 1 }]) {
      const r = await call(scans, { user: owner }, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    const unsynced = await call(scans, { user: owner }, { locationId: location });
    expect(unsynced.status).toBe(400);
    expect(unsynced.data.error).toMatchObject({ code: "validation_error", issues: [{ path: "locationId" }] });
    // Another account's location is never a scan target.
    expect((await call(scans, { user: owner }, { locationId: otherLocation })).status).toBe(400);
    expect(await used(quotaKey(owner, "siteScans"))).toBe(1);
  });

  it("gives the monthly Site Scan back when the queue insert fails (the scan never starts)", async () => {
    const before = await used(quotaKey(owner, "siteScans"));
    const jobsBefore = (await pool.query("SELECT count(*)::int n FROM sitescan_jobs WHERE user_id=$1", [owner])).rows[0].n;
    await expect(
      startSiteScan(
        owner,
        { url: "https://example.com/", pageCap: 20, psiPages: 0 },
        { keyId: "key_scan" },
        {
          reserveQuotaFor,
          enqueue: async () => {
            throw new Error("queue insert fixture");
          },
        },
      ),
    ).rejects.toThrow("queue insert fixture");
    expect(await used(quotaKey(owner, "siteScans"))).toBe(before);
    expect((await pool.query("SELECT count(*)::int n FROM sitescan_jobs WHERE user_id=$1", [owner])).rows[0].n).toBe(jobsBefore);
  });
});

describe("no AI through the API", () => {
  it("none of the writes touched an AI client (the mocks would have thrown) and nothing stored is flagged AI-generated", async () => {
    const { rows: ai } = await pool.query("SELECT id FROM social_posts WHERE user_id=$1 AND (ai_generated OR auto_generated OR source IS DISTINCT FROM 'api')", [owner]);
    expect(ai).toEqual([]);
    const { rows: jobs } = await pool.query("SELECT source FROM gbp_content_jobs WHERE user_id=$1", [owner]);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.source === "api")).toBe(true);
    expect((await pool.query("SELECT ai_draft FROM sitescan_jobs WHERE user_id=$1", [owner])).rows.every((j) => j.ai_draft === null)).toBe(true);
  });

  it("an API key presented outside /api/v1 is refused with 401 before any handler — the AI routes included", async () => {
    for (const path of AI_ROUTES) {
      const r = await fetch(base + path, { method: "POST", headers: { authorization: "Bearer chub_fixture_secret", "content-type": "application/json" }, body: "{}" });
      expect(r.status, path).toBe(401);
      expect(await r.json()).toMatchObject({ error: { code: "unauthorized" } });
    }
    // Without a key the (stubbed) session routes are untouched by the guard, and keys still reach the public API.
    expect((await fetch(base + AI_ROUTES[0], { method: "POST" })).status).toBe(200);
    const viaApi = await fetch(base + scans, { method: "POST", headers: { authorization: "Bearer chub_fixture_secret", "x-fixture-key": `${owner}:read:key_x`, "content-type": "application/json" }, body: "{}" });
    expect(viaApi.status).toBe(403);
  });
});
