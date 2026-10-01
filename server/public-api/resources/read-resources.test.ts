/**
 * Public API read resources against the local lane database. The registry middleware (lane 1) is
 * replaced by two tiny fakes: an auth shim that puts the key from a test header on `req.apiKey`,
 * and a meter that writes `res.locals.apiUnits` into account_api_usage on response finish — so
 * tenant isolation, agency-workspace visibility, pagination, error shape and the metering hint
 * are all exercised over real HTTP routing.
 *
 * Fixtures: A (Agency plan, owns two locations, one under agency client C1), B (Pro plan, one
 * location, must never see A's rows), M (no plan; manager in A's workspace limited to C1).
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { pool } from "../../db";
import { ensureGbpSchema } from "../../gbp/schema";
import { ensureSocialSchema } from "../../social/schema";
import { ensureSiteScanSchema } from "../../sitescan/schema";
import { ensureAgencySchema } from "../../agency/schema";
import { registerReadResources } from "./index";

const TAG = "ACCT-l6-" + randomUUID().slice(0, 8);
let server: Server, base: string;
let A: number, B: number, M: number;
let locA1: number, locA2: number, locB: number, clientC1: number;
let reviewA1: number, reviewB: number, campA1: number, campA2: number, campB: number;
let postA1: number, postB: number;
let socialA1: string, socialA0: string, socialB: string;
let scanA1: string, scanA0: string, scanB: string;
const keyOf = (user: number) => `key_${TAG}_${user}`;
/** Unique per key (lane 1 indexes account_api_keys.prefix UNIQUE); the run tag keeps parallel runs apart. */
const prefixOf = (user: number) => `${TAG.slice(-8)}${user}`;
const meterWrites: Promise<unknown>[] = [];

type Call = { status: number; body: any; headers: Headers };
async function api(path: string, user?: number, scopes = "read"): Promise<Call> {
  const headers: Record<string, string> = {};
  if (user) { headers["x-test-user"] = String(user); headers["x-test-scopes"] = scopes; }
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
const ids = (c: Call) => c.body.data.map((x: any) => x.id);

beforeAll(async () => {
  const dbUrl = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(dbUrl.pathname)) {
    throw new Error("Local lane development database required");
  }
  await ensureGbpSchema();
  await ensureSocialSchema();
  await ensureSiteScanSchema();
  await ensureAgencySchema();
  const { rows: [{ jobs }] } = await pool.query("SELECT to_regclass('public.gbp_content_jobs') AS jobs");
  if (!jobs) throw new Error("gbp_content_jobs is missing: boot the dev server once against this database");
  // Lane 1's tables, in the contract's shape (idempotent). The prefix is unique per key, as in
  // lane 1's DDL (server/account/schema.ts account_api_keys_prefix_idx), so every fixture key gets its own.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_api_keys(id text PRIMARY KEY, user_id int, name text, prefix text, suffix text, secret_hash text,
      scopes text[], monthly_unit_limit int, expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz);
    CREATE UNIQUE INDEX IF NOT EXISTS account_api_keys_prefix_idx ON account_api_keys(prefix);
    CREATE TABLE IF NOT EXISTS account_api_usage(key_id text, user_id int, day date, units int, requests int, PRIMARY KEY(key_id, day));`);

  const { rows: users } = await pool.query("INSERT INTO users(email, display_name, company_name) VALUES($1,'A','ACCT A Co'),($2,'B','ACCT B Co'),($3,'M',NULL) RETURNING id",
    [`${TAG}-a@example.invalid`, `${TAG}-b@example.invalid`, `${TAG}-m@example.invalid`]);
  [A, B, M] = users.map((u) => u.id);
  await pool.query("INSERT INTO subscriptions(user_id,plan,status,stripe_subscription_id) VALUES($1,'agency','active',$2),($3,'pro','active',$4)",
    [A, `sub_${TAG}_A`, B, `sub_${TAG}_B`]);
  for (const u of [A, B, M]) {
    await pool.query("INSERT INTO account_api_keys(id,user_id,name,prefix,suffix,secret_hash,scopes,monthly_unit_limit,created_at) VALUES($1,$2,'ACCT test',$3,'wxyz','x','{read}',$4,now())",
      [keyOf(u), u, prefixOf(u), u === A ? 500 : null]);
  }

  // A's agency workspace: client C1, member M limited to C1.
  await pool.query("INSERT INTO agency_workspaces(user_id,name) VALUES($1,'ACCT Agency')", [A]);
  ({ rows: [{ id: clientC1 }] } = await pool.query("INSERT INTO agency_clients(user_id,name) VALUES($1,'ACCT Client One') RETURNING id", [A]));
  await pool.query("INSERT INTO agency_members(user_id,member_id,role,all_clients) VALUES($1,$2,'manager',false)", [A, M]);
  await pool.query("INSERT INTO agency_member_clients(user_id,member_id,client_id) VALUES($1,$2,$3)", [A, M, clientC1]);

  const loc = async (user: number, name: string, extra: Record<string, unknown> = {}) => {
    const cols = ["user_id", "business_name", ...Object.keys(extra)];
    const vals = [user, name, ...Object.values(extra)];
    const { rows: [r] } = await pool.query(`INSERT INTO business_locations(${cols.join(",")}) VALUES(${vals.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, vals);
    return r.id as number;
  };
  locA1 = await loc(A, `${TAG} A One`, { agency_client_id: clientC1, gbp_location_name: "locations/111", gbp_account_name: "accounts/1", city: "Denver", state: "CO", website: "https://a-one.example" });
  locA2 = await loc(A, `${TAG} A Two`, { city: "Boulder", state: "CO" });
  locB = await loc(B, `${TAG} B One`, { state: "TX" });

  // Reviews: A1 has a replied 5★ and an unanswered 2★; A2 an unanswered 4★; B one.
  const review = async (user: number, location: number, rating: number, reply: string | null, date: string) => {
    const { rows: [r] } = await pool.query(
      "INSERT INTO google_profile_reviews(user_id,location_id,reviewer_name,rating,comment,review_date,reply_comment,reply_status,reply_draft) VALUES($1,$2,'Reviewer',$3,'text',$4,$5,$6,'AI DRAFT') RETURNING id",
      [user, location, rating, date, reply, reply ? "published" : "draft"]);
    return r.id as number;
  };
  reviewA1 = await review(A, locA1, 5, "Thanks!", "2026-09-10T12:00:00Z");
  await review(A, locA1, 2, null, "2026-09-12T12:00:00Z");
  await review(A, locA2, 4, null, "2026-09-01T12:00:00Z");
  reviewB = await review(B, locB, 3, null, "2026-09-11T12:00:00Z");

  // Daily metrics: A1 three days of two metrics; B one day.
  for (const [d, calls, clicks] of [["2026-09-01", 3, 10], ["2026-09-02", 4, 20], ["2026-09-03", 5, 30]] as const) {
    await pool.query("INSERT INTO gbp_daily_metrics(location_id,date,metric,value) VALUES($1,$2,'CALL_CLICKS',$3),($1,$2,'WEBSITE_CLICKS',$4)", [locA1, d, calls, clicks]);
  }
  await pool.query("INSERT INTO gbp_daily_metrics(location_id,date,metric,value) VALUES($1,'2026-09-01','CALL_CLICKS',99)", [locB]);

  // Google media: A1 one owner and one customer item; B one.
  await pool.query("INSERT INTO gbp_media(location_id,name,source,category,google_url,create_time) VALUES($1,'media/a1-owner','owner','EXTERIOR','https://img/1','2026-09-01T00:00:00Z'),($1,'media/a1-cust','customer',NULL,'https://img/2','2026-09-02T00:00:00Z'),($2,'media/b','owner',NULL,'https://img/3',NULL)", [locA1, locB]);

  // Media library: A one folder with two photos; B one folder, one photo.
  const folder = async (user: number) => (await pool.query("INSERT INTO media_folders(user_id,name) VALUES($1,$2) RETURNING id", [user, `${TAG} folder`])).rows[0].id as number;
  const fA = await folder(A), fB = await folder(B);
  await pool.query("INSERT INTO media_photos(user_id,folder_id,name,url,r2_key,size) VALUES($1,$2,'a1.jpg','https://cdn/a1.jpg','secret/a1',100),($1,$2,'a2.jpg','https://cdn/a2.jpg','secret/a2',200),($3,$4,'b.jpg','https://cdn/b.jpg','secret/b',300)", [A, fA, B, fB]);

  // GBP queue: A1 queued post + published photo; A2 failed post; B one queued post.
  const job = async (user: number, location: number, kind: string, status: string, due: string) => {
    const { rows: [r] } = await pool.query(
      "INSERT INTO gbp_content_jobs(user_id,location_id,request_key,item_index,kind,payload,target,due_at,status,google_name) VALUES($1,$2,$3,0,$4,$5,'{}',$6,$7,$8) RETURNING id",
      [user, location, `${TAG}-${randomUUID().slice(0, 6)}`, kind, JSON.stringify({ kind, summary: `${kind} by ${user}` }), due, status, status === "published" ? "locations/111/media/1" : null]);
    return r.id as number;
  };
  // Queued items are due far in the future so no other lane's publishing worker picks them up.
  postA1 = await job(A, locA1, "post", "queued", "2030-10-01T09:00:00Z");
  await job(A, locA1, "photo", "published", "2026-09-20T09:00:00Z");
  await job(A, locA2, "post", "failed", "2026-09-21T09:00:00Z");
  postB = await job(B, locB, "post", "queued", "2030-10-02T09:00:00Z");

  // Social: A one queued post on A1 and one global draft (no business); B one.
  const social = async (user: number, business: number | null, state: string, text: string) => {
    const id = randomUUID();
    const payload = { post: { accountId: "acc_1", target: { pageId: "pg_1" }, content: { platform: "facebook", text, mediaUrls: ["https://cdn/x.jpg"] } } };
    await pool.query("INSERT INTO social_posts(id,user_id,request_id,destination_key,payload,state,due_at,business_id,source) VALUES($1,$2,$3,'facebook:pg_1',$4,$5,'2030-01-01T00:00:00Z',$6,'api')",
      [id, user, randomUUID(), JSON.stringify(payload), state, business]);
    return id;
  };
  socialA1 = await social(A, locA1, "queued", "A1 post");
  socialA0 = await social(A, null, "draft", "A global draft");
  socialB = await social(B, locB, "queued", "B post");

  // Site scans: A one completed for A1 (with report), one queued with no location; B one completed.
  // The lane database is shared with other dev servers whose scan worker claims any queued job with
  // attempts<5 within milliseconds, so the queued fixture is parked at attempts=5 (never claimed).
  const scan = async (user: number, profile: Record<string, unknown> | null, status: string, report: Record<string, unknown> | null) => {
    const id = randomUUID();
    await pool.query("INSERT INTO sitescan_jobs(id,user_id,url,page_cap,profile,state,status,report,completed_at,share_hash,ai_draft,attempts) VALUES($1,$2,$3,50,$4,$5,$6,$7,$8,$9,'AI DRAFT',5)",
      [id, user, `https://${TAG.toLowerCase()}-${user}.example`, profile ? JSON.stringify(profile) : null, JSON.stringify({ pages: [{}, {}] }), status,
        report ? JSON.stringify(report) : null, report ? new Date() : null, `share-${id}`]);
    return id;
  };
  scanA1 = await scan(A, { id: locA1, business_name: "A One" }, "completed", { scores: { seo: 80 }, findings: [{ id: "f1" }] });
  scanA0 = await scan(A, null, "queued", null);
  scanB = await scan(B, { id: locB }, "completed", { scores: { seo: 50 } });

  // Citations: A campaign on A1 (two citations), A campaign without location (one); B campaign (one).
  const campaign = async (user: number, location: number | null) => (await pool.query(
    "INSERT INTO citation_campaigns(user_id,location_id,campaign_name,business_name) VALUES($1,$2,$3,'Biz') RETURNING id", [user, location, `${TAG} campaign`])).rows[0].id as number;
  campA1 = await campaign(A, locA1);
  campA2 = await campaign(A, null);
  campB = await campaign(B, locB);
  await pool.query("INSERT INTO citations(campaign_id,site_name,is_found,domain_authority) VALUES($1,'Yelp',true,90),($1,'BBB',false,80),($2,'Angi',true,70),($3,'Yelp',true,90)", [campA1, campA2, campB]);

  // The test app: fake auth + fake meter + the read resources mounted the way the registry does.
  const app = express();
  app.use((req, res, next) => {
    const user = Number(req.headers["x-test-user"]);
    if (user) (req as any).apiKey = { id: keyOf(user), userId: user, scopes: String(req.headers["x-test-scopes"] ?? "read").split(",") };
    res.on("finish", () => {
      const key = (req as any).apiKey, units = res.locals.apiUnits;
      if (!key || typeof units !== "number") return;
      meterWrites.push(pool.query(
        "INSERT INTO account_api_usage(key_id,user_id,day,units,requests) VALUES($1,$2,current_date,$3,1) ON CONFLICT(key_id,day) DO UPDATE SET units=account_api_usage.units+EXCLUDED.units, requests=account_api_usage.requests+1",
        [key.id, key.userId, units]));
    });
    next();
  });
  registerReadResources((name, router) => app.use(`/api/v1/${name}`, router));
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

afterAll(async () => {
  await Promise.allSettled(meterWrites);
  server?.close();
  if (A) {
    const users = [A, B, M];
    await pool.query("DELETE FROM citations WHERE campaign_id IN (SELECT id FROM citation_campaigns WHERE user_id=ANY($1))", [users]);
    for (const t of ["citation_campaigns", "google_profile_reviews", "media_photos", "media_folders", "subscriptions", "account_api_usage", "account_api_keys"]) {
      await pool.query(`DELETE FROM ${t} WHERE user_id=ANY($1)`, [users]);
    }
    await pool.query("DELETE FROM business_locations WHERE user_id=ANY($1)", [users]);
    await pool.query("DELETE FROM users WHERE id=ANY($1)", [users]);
  }
  await pool.end();
});

describe("auth and scope", () => {
  it("answers 401 in the API error shape without a verified key", async () => {
    const r = await api("/api/v1/locations");
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: "unauthorized", message: expect.stringContaining("Bearer chub_") } });
  });
  it("refuses a key without the read scope", async () => {
    const r = await api("/api/v1/locations", A, "write");
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("insufficient_scope");
  });
  it("answers unknown paths under a resource as JSON 404s", async () => {
    const r = await api(`/api/v1/locations/${locA1}/nope`, A);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("not_found");
  });
  it("answers bad input as a 400 validation_error with the field", async () => {
    const r = await api("/api/v1/reviews?rating=9", A);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("validation_error");
    expect(r.body.error.issues[0].path).toBe("rating");
    expect((await api("/api/v1/locations?limit=0", A)).status).toBe(400);
    expect((await api("/api/v1/locations?limit=1000", A)).status).toBe(400);
    expect((await api("/api/v1/locations/abc", A)).status).toBe(400);
  });
  it("refuses impossible calendar dates as 400s, never as a database 500", async () => {
    // Postgres rejects '2026-02-30'::date and JS Date throws on 2026-13-45: both must be validation errors.
    for (const path of ["/api/v1/reviews?since=2026-02-30", "/api/v1/reviews?until=2026-13-45", "/api/v1/locations?updatedSince=2026-02-30",
      `/api/v1/insights?locationId=${locA1}&to=2026-13-45`, `/api/v1/insights?locationId=${locA1}&from=2026-02-30`,
      `/api/v1/locations/${locA1}/insights?to=2026-02-30`]) {
      const r = await api(path, A);
      expect(r.status, path).toBe(400);
      expect(r.body.error.code, path).toBe("validation_error");
    }
  });
});

describe("account", () => {
  it("reports the plan, limits, API quota and this key", async () => {
    const r = await api("/api/v1/account", A);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.account).toMatchObject({ id: A, companyName: "ACCT A Co" });
    expect(d.plan).toMatchObject({ key: "agency", name: "Agency", isPlatformAdmin: false });
    expect(d.limits.locations).toBeGreaterThan(0);
    expect(d.modules.agencyWorkspace).toBe(true);
    expect(d.api).toMatchObject({ enabled: true, unitsPerMonth: 250_000, ratePerMinute: 60 });
    expect(d.api.key).toMatchObject({ id: keyOf(A), name: "ACCT test", prefix: prefixOf(A), suffix: "wxyz", scopes: ["read"], monthlyUnitLimit: 500 });
    expect(JSON.stringify(d)).not.toContain("secret_hash");
    expect(d.api.remaining).toBeLessThanOrEqual(500);
    expect(new Date(d.api.resetsAt).getUTCDate()).toBe(1);
    expect(d.usage.locations).toEqual({ used: 2, included: d.limits.locations });
    expect(d.usage.reviews).toEqual({ total: 3, unanswered: 2 });
    expect(d.workspaces).toEqual([]);
  });
  it("shows Pro's quota, and no API for an account without a plan — with its workspaces", async () => {
    const b = await api("/api/v1/account", B);
    expect(b.body.data.plan.key).toBe("pro");
    expect(b.body.data.api).toMatchObject({ enabled: true, unitsPerMonth: 10_000 });
    expect(b.body.data.api.key.monthlyUnitLimit).toBeNull();
    const m = await api("/api/v1/account", M);
    expect(m.body.data.plan.key).toBeNull();
    expect(m.body.data.api).toMatchObject({ enabled: false, unitsPerMonth: 0, remaining: 0 });
    expect(m.body.data.workspaces).toEqual([{ ownerId: A, name: "ACCT Agency", role: "manager", allClients: false }]);
  });
});

describe("locations", () => {
  it("lists and filters own locations", async () => {
    const all = await api("/api/v1/locations", A);
    expect(all.status).toBe(200);
    expect(ids(all)).toEqual([locA1, locA2]);
    expect(all.body.pagination).toEqual({ total: 2, limit: 50, offset: 0, hasMore: false });
    expect(all.body.data[0]).toMatchObject({ businessName: `${TAG} A One`, gbpLinked: true, agencyClientId: clientC1, clientName: "ACCT Client One", city: "Denver" });
    expect(all.body.data[0]).not.toHaveProperty("gbpGoogleSubject");
    expect(all.body.data[0]).not.toHaveProperty("notificationEmail");
    expect(ids(await api(`/api/v1/locations?clientId=${clientC1}`, A))).toEqual([locA1]);
    expect(ids(await api("/api/v1/locations?linked=false", A))).toEqual([locA2]);
    expect(ids(await api("/api/v1/locations?q=boulder", A))).toEqual([locA2]);
    expect(ids(await api("/api/v1/locations?state=co", A))).toEqual([locA1, locA2]);
  });
  it("never shows another account's locations", async () => {
    expect(ids(await api("/api/v1/locations", B))).toEqual([locB]);
    const r = await api(`/api/v1/locations/${locA1}`, B);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "not_found", message: "Location not found" } });
    expect((await api(`/api/v1/locations/${locA1}`, A)).body.data.id).toBe(locA1);
  });
});

describe("reviews", () => {
  it("lists with filters, hides the AI draft, and nests under the location", async () => {
    const all = await api("/api/v1/reviews", A);
    expect(all.body.pagination.total).toBe(3);
    expect(all.body.data[0].reviewer.name).toBe("Reviewer");
    expect(JSON.stringify(all.body)).not.toContain("AI DRAFT");
    expect(all.body.data.find((r: any) => r.id === reviewA1).reply).toMatchObject({ comment: "Thanks!", status: "published" });
    expect((await api(`/api/v1/reviews?locationId=${locA1}`, A)).body.pagination.total).toBe(2);
    expect((await api("/api/v1/reviews?unanswered=true", A)).body.pagination.total).toBe(2);
    expect((await api("/api/v1/reviews?rating=5", A)).body.pagination.total).toBe(1);
    expect((await api("/api/v1/reviews?minRating=4", A)).body.pagination.total).toBe(2);
    expect((await api("/api/v1/reviews?since=2026-09-11&until=2026-09-12", A)).body.pagination.total).toBe(1);
    expect((await api(`/api/v1/locations/${locA1}/reviews?unanswered=true`, A)).body.data.map((r: any) => r.rating)).toEqual([2]);
  });
  it("keeps tenants apart on list, detail and the nested route", async () => {
    expect(ids(await api("/api/v1/reviews", B))).toEqual([reviewB]);
    expect((await api(`/api/v1/reviews/${reviewA1}`, B)).status).toBe(404);
    expect((await api(`/api/v1/reviews?locationId=${locA1}`, B)).status).toBe(404);
    expect((await api(`/api/v1/locations/${locA1}/reviews`, B)).status).toBe(404);
    expect((await api(`/api/v1/reviews/${reviewA1}`, A)).body.data.id).toBe(reviewA1);
  });
});

describe("insights", () => {
  it("returns one row per day with totals for the range", async () => {
    const r = await api(`/api/v1/locations/${locA1}/insights?from=2026-09-01&to=2026-09-03`, A);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([
      { date: "2026-09-01", metrics: { CALL_CLICKS: 3, WEBSITE_CLICKS: 10 } },
      { date: "2026-09-02", metrics: { CALL_CLICKS: 4, WEBSITE_CLICKS: 20 } },
      { date: "2026-09-03", metrics: { CALL_CLICKS: 5, WEBSITE_CLICKS: 30 } },
    ]);
    expect(r.body.totals).toEqual({ CALL_CLICKS: 12, WEBSITE_CLICKS: 60 });
    expect(r.body.range).toEqual({ from: "2026-09-01", to: "2026-09-03" });
    expect(r.body.pagination.total).toBe(3);
    const one = await api(`/api/v1/insights?locationId=${locA1}&from=2026-09-02&to=2026-09-02&metric=CALL_CLICKS`, A);
    expect(one.body.data).toEqual([{ date: "2026-09-02", metrics: { CALL_CLICKS: 4 } }]);
  });
  it("refuses bad ranges and other tenants' locations", async () => {
    expect((await api(`/api/v1/insights?locationId=${locA1}&from=2026-09-05&to=2026-09-01`, A)).status).toBe(400);
    expect((await api("/api/v1/insights", A)).status).toBe(400);
    expect((await api(`/api/v1/insights?locationId=${locA1}`, B)).status).toBe(404);
    expect((await api(`/api/v1/locations/${locA1}/insights`, B)).status).toBe(404);
  });
});

describe("photos and media", () => {
  it("lists the library without storage keys, and folders with counts", async () => {
    const r = await api("/api/v1/photos", A);
    expect(r.body.pagination.total).toBe(2);
    expect(r.body.data[0]).toMatchObject({ name: "a2.jpg", url: "https://cdn/a2.jpg", folderName: `${TAG} folder` });
    expect(JSON.stringify(r.body)).not.toContain("secret/");
    const f = await api("/api/v1/photos/folders", A);
    expect(f.body.data).toHaveLength(1);
    expect(f.body.data[0]).toMatchObject({ name: `${TAG} folder`, photoCount: 2 });
    expect((await api(`/api/v1/photos?folderId=${f.body.data[0].id}`, B)).body.pagination.total).toBe(0);
    expect((await api("/api/v1/photos", B)).body.data.map((p: any) => p.name)).toEqual(["b.jpg"]);
  });
  it("lists the Google listing's media per location", async () => {
    const r = await api(`/api/v1/locations/${locA1}/media`, A);
    expect(r.body.data.map((m: any) => m.name)).toEqual(["media/a1-cust", "media/a1-owner"]);
    expect((await api(`/api/v1/locations/${locA1}/media?source=customer`, A)).body.pagination.total).toBe(1);
    expect((await api(`/api/v1/locations/${locA1}/media?category=exterior`, A)).body.pagination.total).toBe(1);
    expect((await api(`/api/v1/locations/${locA1}/media`, B)).status).toBe(404);
  });
});

describe("gbp posts", () => {
  it("lists the queue with filters and nests under the location", async () => {
    const all = await api("/api/v1/gbp-posts", A);
    expect(all.body.pagination.total).toBe(3);
    expect(all.body.data[0]).toMatchObject({ id: postA1, kind: "post", status: "queued", locationId: locA1, payload: { summary: `post by ${A}` } });
    expect((await api("/api/v1/gbp-posts?status=queued", A)).body.pagination.total).toBe(1);
    expect((await api("/api/v1/gbp-posts?kind=photo", A)).body.data[0].googleName).toBe("locations/111/media/1");
    expect((await api(`/api/v1/gbp-posts?locationId=${locA2}`, A)).body.data.map((j: any) => j.status)).toEqual(["failed"]);
    expect((await api(`/api/v1/locations/${locA1}/posts`, A)).body.pagination.total).toBe(2);
    expect((await api(`/api/v1/gbp-posts/${postA1}`, A)).body.data.id).toBe(postA1);
  });
  it("keeps tenants apart", async () => {
    expect(ids(await api("/api/v1/gbp-posts", B))).toEqual([postB]);
    expect((await api(`/api/v1/gbp-posts/${postA1}`, B)).status).toBe(404);
    expect((await api(`/api/v1/gbp-posts?locationId=${locA1}`, B)).status).toBe(404);
  });
});

describe("social posts", () => {
  it("lists posts as stored, with the destination and text", async () => {
    const all = await api("/api/v1/social-posts", A);
    expect(all.body.pagination.total).toBe(2);
    const a1 = all.body.data.find((p: any) => p.id === socialA1);
    expect(a1).toMatchObject({ locationId: locA1, platform: "facebook", text: "A1 post", mediaUrls: ["https://cdn/x.jpg"], state: "queued", source: "api", target: { pageId: "pg_1" } });
    expect((await api(`/api/v1/social-posts?locationId=${locA1}`, A)).body.data.map((p: any) => p.id)).toEqual([socialA1]);
    expect((await api("/api/v1/social-posts?state=draft", A)).body.data.map((p: any) => p.id)).toEqual([socialA0]);
    expect((await api("/api/v1/social-posts?platform=facebook", A)).body.pagination.total).toBe(2);
    expect((await api(`/api/v1/social-posts/${socialA1}`, A)).body.data.text).toBe("A1 post");
    expect((await api("/api/v1/social-posts/not-a-uuid", A)).status).toBe(400);
  });
  it("keeps tenants apart", async () => {
    expect(ids(await api("/api/v1/social-posts", B))).toEqual([socialB]);
    expect((await api(`/api/v1/social-posts/${socialA1}`, B)).status).toBe(404);
  });
});

describe("site scans", () => {
  it("lists scans, serves the report of a completed one and refuses an unfinished one", async () => {
    const all = await api("/api/v1/site-scans", A);
    expect(all.body.pagination.total).toBe(2);
    const done = all.body.data.find((s: any) => s.id === scanA1);
    expect(done).toMatchObject({ status: "completed", locationId: locA1, businessName: "A One", pages: 2, scores: { seo: 80 }, pageCap: 50 });
    expect(JSON.stringify(all.body)).not.toMatch(/share-|AI DRAFT|lease/);
    expect((await api(`/api/v1/site-scans?locationId=${locA1}`, A)).body.data.map((s: any) => s.id)).toEqual([scanA1]);
    expect((await api("/api/v1/site-scans?status=queued", A)).body.data.map((s: any) => s.id)).toEqual([scanA0]);
    expect((await api(`/api/v1/site-scans?url=${A}.example`, A)).body.pagination.total).toBe(2);
    const report = await api(`/api/v1/site-scans/${scanA1}/report`, A);
    expect(report.status).toBe(200);
    expect(report.body.data).toMatchObject({ id: scanA1, status: "completed", report: { scores: { seo: 80 }, findings: [{ id: "f1" }] }, fixDone: {} });
    const pending = await api(`/api/v1/site-scans/${scanA0}/report`, A);
    expect(pending.status).toBe(409);
    expect(pending.body.error).toMatchObject({ code: "scan_not_completed", status: "queued" });
  });
  it("keeps tenants apart", async () => {
    expect(ids(await api("/api/v1/site-scans", B))).toEqual([scanB]);
    expect((await api(`/api/v1/site-scans/${scanA1}`, B)).status).toBe(404);
    expect((await api(`/api/v1/site-scans/${scanA1}/report`, B)).status).toBe(404);
  });
});

describe("citations", () => {
  it("lists citations and campaigns with filters", async () => {
    const all = await api("/api/v1/citations", A);
    expect(all.body.pagination.total).toBe(3);
    expect(all.body.data[0]).toMatchObject({ siteName: "Yelp", campaignId: campA1, locationId: locA1, isFound: true, domainAuthority: 90 });
    expect((await api(`/api/v1/citations?campaignId=${campA1}`, A)).body.pagination.total).toBe(2);
    expect((await api(`/api/v1/citations?campaignId=${campA1}&found=false`, A)).body.data.map((c: any) => c.siteName)).toEqual(["BBB"]);
    expect((await api(`/api/v1/citations?locationId=${locA1}`, A)).body.pagination.total).toBe(2);
    const camps = await api("/api/v1/citations/campaigns", A);
    expect(ids(camps).sort()).toEqual([campA1, campA2].sort());
    expect((await api(`/api/v1/citations/campaigns?locationId=${locA1}`, A)).body.data.map((c: any) => c.id)).toEqual([campA1]);
    expect((await api(`/api/v1/citations/campaigns/${campA2}`, A)).body.data).toMatchObject({ id: campA2, locationId: null, campaignName: `${TAG} campaign` });
  });
  it("keeps tenants apart", async () => {
    expect((await api("/api/v1/citations", B)).body.data.map((c: any) => c.campaignId)).toEqual([campB]);
    expect((await api(`/api/v1/citations?campaignId=${campA1}`, B)).body.pagination.total).toBe(0);
    expect((await api(`/api/v1/citations/campaigns/${campA1}`, B)).status).toBe(404);
  });
});

describe("pagination", () => {
  it("pages with limit/offset and reports hasMore", async () => {
    const first = await api("/api/v1/reviews?limit=1", A);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.pagination).toEqual({ total: 3, limit: 1, offset: 0, hasMore: true });
    const second = await api("/api/v1/reviews?limit=1&offset=1", A);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    const last = await api("/api/v1/reviews?limit=2&offset=2", A);
    expect(last.body.data).toHaveLength(1);
    expect(last.body.pagination.hasMore).toBe(false);
    expect((await api("/api/v1/reviews?offset=50", A)).body.data).toEqual([]);
  });
});

describe("agency workspace", () => {
  it("lets a limited member read only assigned clients' locations and their rows", async () => {
    const ws = `workspace=${A}`;
    expect(ids(await api(`/api/v1/locations?${ws}`, M))).toEqual([locA1]);
    expect((await api(`/api/v1/locations/${locA2}?${ws}`, M)).status).toBe(404);
    expect((await api(`/api/v1/locations/${locA1}?${ws}`, M)).body.data.clientName).toBe("ACCT Client One");
    expect((await api(`/api/v1/reviews?${ws}`, M)).body.pagination.total).toBe(2);
    expect((await api(`/api/v1/locations/${locA1}/insights?${ws}&from=2026-09-01&to=2026-09-03`, M)).body.pagination.total).toBe(3);
    expect((await api(`/api/v1/locations/${locA1}/media?${ws}`, M)).body.pagination.total).toBe(2);
    expect((await api(`/api/v1/gbp-posts?${ws}`, M)).body.pagination.total).toBe(2);
    expect((await api(`/api/v1/social-posts?${ws}`, M)).body.data.map((p: any) => p.id)).toEqual([socialA1]);
    expect((await api(`/api/v1/site-scans?${ws}`, M)).body.data.map((s: any) => s.id)).toEqual([scanA1]);
    expect((await api(`/api/v1/site-scans/${scanA0}?${ws}`, M)).status).toBe(404);
    expect((await api(`/api/v1/citations?${ws}`, M)).body.pagination.total).toBe(2);
    expect((await api(`/api/v1/citations/campaigns/${campA2}?${ws}`, M)).status).toBe(404);
    // The media library has no client: hidden from a limited role.
    expect((await api(`/api/v1/photos?${ws}`, M)).body.pagination.total).toBe(0);
    expect((await api(`/api/v1/photos/folders?${ws}`, M)).body.pagination.total).toBe(0);
  });
  it("opens everything to an all-clients role", async () => {
    await pool.query("UPDATE agency_members SET all_clients=true WHERE user_id=$1 AND member_id=$2", [A, M]);
    try {
      const ws = `workspace=${A}`;
      expect(ids(await api(`/api/v1/locations?${ws}`, M))).toEqual([locA1, locA2]);
      expect((await api(`/api/v1/photos?${ws}`, M)).body.pagination.total).toBe(2);
      expect((await api(`/api/v1/site-scans?${ws}`, M)).body.pagination.total).toBe(2);
      expect((await api(`/api/v1/social-posts?${ws}`, M)).body.pagination.total).toBe(2);
      expect((await api(`/api/v1/citations/campaigns/${campA2}?${ws}`, M)).status).toBe(200);
    } finally {
      await pool.query("UPDATE agency_members SET all_clients=false WHERE user_id=$1 AND member_id=$2", [A, M]);
    }
  });
  it("is a 404 for a non-member and a 402 when the owner's plan lacks the Agency module", async () => {
    const r = await api(`/api/v1/locations?workspace=${A}`, B);
    expect(r.status).toBe(404);
    expect(r.body.error).toEqual({ code: "not_found", message: "Workspace not found" });
    expect((await api(`/api/v1/locations?workspace=${B}`, M)).status).toBe(404);
    // A reading its own id as a workspace is just A's own data.
    expect(ids(await api(`/api/v1/locations?workspace=${A}`, A))).toEqual([locA1, locA2]);
    await pool.query("UPDATE subscriptions SET plan='pro' WHERE user_id=$1", [A]);
    try {
      const paused = await api(`/api/v1/locations?workspace=${A}`, M);
      expect(paused.status).toBe(402);
      expect(paused.body.error).toMatchObject({ code: "plan_required", requiredPlan: "agency" });
    } finally {
      await pool.query("UPDATE subscriptions SET plan='agency' WHERE user_id=$1", [A]);
    }
  });
  it("never lets a workspace read reach the member's own key account", async () => {
    // M's own data stays M's: no locations, and A's rows are not M's without the workspace parameter.
    expect((await api("/api/v1/locations", M)).body.pagination.total).toBe(0);
    expect((await api(`/api/v1/locations/${locA1}`, M)).status).toBe(404);
  });
});

describe("metering hint", () => {
  it("tells the meter the rows returned so it can charge 1 unit + 1 per 100 rows", async () => {
    const before = (await pool.query("SELECT coalesce(sum(units),0)::int u, coalesce(sum(requests),0)::int r FROM account_api_usage WHERE key_id=$1", [keyOf(B)])).rows[0];
    await api("/api/v1/reviews", B);               // 1 row  -> 1 unit
    await api(`/api/v1/locations/${locB}`, B);     // item   -> 1 unit
    await api("/api/v1/reviews?limit=1&offset=5", B); // empty -> 1 unit
    await Promise.all(meterWrites);
    const after = (await pool.query("SELECT coalesce(sum(units),0)::int u, coalesce(sum(requests),0)::int r FROM account_api_usage WHERE key_id=$1", [keyOf(B)])).rows[0];
    expect(after.u - before.u).toBe(3);
    expect(after.r - before.r).toBe(3);
    const acct = await api("/api/v1/account", B);
    expect(acct.body.data.api.usedThisMonth).toBeGreaterThanOrEqual(3);
    expect(acct.body.data.api.key.unitsThisMonth).toBe(acct.body.data.api.usedThisMonth);
    expect(acct.body.data.api.remaining).toBe(10_000 - acct.body.data.api.usedThisMonth);
  });
  it("counts a page of 100+ rows as extra units", async () => {
    const many = Array.from({ length: 120 }, (_, i) => `(${B},${locB},'Bulk ${i}',4,'2026-08-01T00:00:00Z','x')`).join(",");
    await pool.query(`INSERT INTO google_profile_reviews(user_id,location_id,reviewer_name,rating,review_date,comment) VALUES ${many}`);
    try {
      const before = (await pool.query("SELECT coalesce(sum(units),0)::int u FROM account_api_usage WHERE key_id=$1", [keyOf(B)])).rows[0].u;
      const r = await api("/api/v1/reviews?limit=200", B);
      expect(r.body.data).toHaveLength(121);
      await Promise.all(meterWrites);
      const after = (await pool.query("SELECT coalesce(sum(units),0)::int u FROM account_api_usage WHERE key_id=$1", [keyOf(B)])).rows[0].u;
      expect(after - before).toBe(2);
    } finally {
      await pool.query("DELETE FROM google_profile_reviews WHERE user_id=$1 AND comment='x'", [B]);
    }
  });
});
