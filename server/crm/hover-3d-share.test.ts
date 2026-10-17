/**
 * HOVER 3D share links, name matching, project linking, the per-org refresh lock and 429 backoff.
 *
 * Pure units first; then DB-level tests against the local dev database (no dev server needed): a throwaway org
 * with a HOVER connection, and an in-process fake of hover.to passed as fetchFn — nothing ever reaches the network
 * (the fake throws on any URL it doesn't know). Everything created is deleted afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

process.env.DATABASE_URL ??=
  "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
process.env.STRIPE_SECRET_KEY ??= "sk_test_vitest_stub";

import type { HoverShare } from "./hover-share";
// Dynamic: the module graph opens a pg Pool at import time, so DATABASE_URL must be set first (imports hoist).
const {
  parseHoverShareUrl, normalizePersonName, customerNameKeys, pickJobShare, mergeShare, shareIsLive, clientShareView,
  chooseProjectForJob, normalizeHoverAddress, safeHoverMediaUrl,
} = await import("./hover-share");

const DAY = 24 * 3600_000;
const now = new Date("2026-10-17T12:00:00Z");
const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe("share link validation (strict allowlist, nothing fetched)", () => {
  it("accepts only https://hover.to/shared/<token>", () => {
    expect(parseHoverShareUrl("https://hover.to/shared/yfeyLHbGhoHJB2xMf6Do")).toEqual({
      url: "https://hover.to/shared/yfeyLHbGhoHJB2xMf6Do", token: "yfeyLHbGhoHJB2xMf6Do",
    });
    expect(parseHoverShareUrl("  https://hover.to/shared/AcxypzEBrKi1KPu_fWbr/  ")?.token).toBe("AcxypzEBrKi1KPu_fWbr");
    expect(parseHoverShareUrl("https://hover.to/shared/dxAC41tzPsD--8Asxu6a?model_id=123")?.url)
      .toBe("https://hover.to/shared/dxAC41tzPsD--8Asxu6a?model_id=123");
  });
  it("rejects everything else", () => {
    for (const bad of [
      "http://hover.to/shared/yfeyLHbGhoHJB2xMf6Do",            // not https
      "https://evil.com/shared/yfeyLHbGhoHJB2xMf6Do",           // other host
      "https://hover.to.evil.com/shared/yfeyLHbGhoHJB2xMf6Do",  // suffix trick
      "https://evil.hover.to/shared/yfeyLHbGhoHJB2xMf6Do",      // subdomain
      "https://user:pw@hover.to/shared/yfeyLHbGhoHJB2xMf6Do",   // credentials
      "https://hover.to:8443/shared/yfeyLHbGhoHJB2xMf6Do",      // port
      "https://hover.to/3d/123456",                              // the login-only viewer
      "https://hover.to/shared/short",                           // token too short
      "https://hover.to/shared/abc/def",                         // extra path
      "https://hover.to/shared/yfeyLHbGhoHJB2xMf6Do?next=https://evil.com",
      "https://hover.to/shared/yfeyLHbGhoHJB2xMf6Do#x",
      "https://hover.to/shared/yfeyLHbGhoHJB2xMf6Do?model_id=abc",
      "javascript:alert(1)", "", null, 42,
    ]) expect(parseHoverShareUrl(bad as any)).toBeNull();
  });
  it("media URLs must be https on hover.to", () => {
    expect(safeHoverMediaUrl("https://hover.to/api/v1/job_shares/912885/image.png?share_token=x")).toBeTruthy();
    expect(safeHoverMediaUrl("https://evil.com/x.png")).toBeNull();
    expect(safeHoverMediaUrl("http://hover.to/x.png")).toBeNull();
  });
});

describe("picking a HOVER job share", () => {
  const share = (id: number, job: number, token: string, expires: string | null, expired = false) => ({
    id, job_id: job, token, expired, expires_at: expires, url: `https://hover.to/shared/${token}`,
    image_url: `https://hover.to/api/v1/job_shares/${id}/image.png?share_token=${token}`,
  });
  it("matches job_id, skips expired, prefers the latest expiry", () => {
    const list = [
      share(1, 77, "tokenAAAAAAAA", iso(10 * DAY)),
      share(2, 77, "tokenBBBBBBBB", iso(40 * DAY)),
      share(3, 77, "tokenCCCCCCCC", iso(90 * DAY), true),   // flagged expired
      share(4, 77, "tokenDDDDDDDD", iso(-1 * DAY)),         // past date
      share(5, 88, "tokenEEEEEEEE", iso(99 * DAY)),         // other job
    ];
    const s = pickJobShare(list, "77", now)!;
    expect(s.token).toBe("tokenBBBBBBBB");
    expect(s.source).toBe("hover-api");
    expect(s.jobShareId).toBe("2");
    expect(s.imageUrl).toContain("/job_shares/2/image.png");
    expect(pickJobShare(list.filter((x) => x.id >= 3), "77", now)).toBeNull();
  });
  it("a live pasted link wins; a vanished API share is dropped", () => {
    const manual: HoverShare = { url: "https://hover.to/shared/manualAAAAAA", token: "manualAAAAAA", imageUrl: null, videoUrl: null, expiresAt: null, source: "manual", savedAt: iso(0) };
    const api = pickJobShare([share(9, 1, "apiAAAAAAAAA", iso(5 * DAY))], "1", now);
    expect(mergeShare(manual, api, now)).toBe(manual);
    expect(mergeShare({ ...manual, source: "hover-api" }, null, now)).toBeNull();
    expect(mergeShare(null, api, now)).toBe(api);
  });
  it("clients only ever see a live share", () => {
    const live = { share: { url: "https://hover.to/shared/liveAAAAAAAA", expiresAt: iso(2 * DAY), imageUrl: "https://evil.com/x.png" }, model3dUrl: "https://hover.to/3d/1" };
    expect(clientShareView(live, now)).toEqual({ url: "https://hover.to/shared/liveAAAAAAAA", imageUrl: null, expiresAt: iso(2 * DAY) });
    expect(clientShareView({ share: { ...live.share, expiresAt: iso(-1) } }, now)).toBeNull();
    expect(clientShareView({ model3dUrl: "https://hover.to/3d/1" }, now)).toBeNull();
    expect(clientShareView({ share: { url: "https://hover.to/3d/1" } }, now)).toBeNull();
    expect(shareIsLive({ url: "https://hover.to/shared/liveAAAAAAAA", expiresAt: "garbage" }, now)).toBe(false);
  });
});

describe("name keys", () => {
  it("ignore case, accents, punctuation and spacing; need first + last", () => {
    expect(normalizePersonName("  Mary-Jane   O'Neil ")).toBe("mary jane oneil");
    expect(normalizePersonName("MARY JANE ONEIL")).toBe("mary jane oneil");
    expect(normalizePersonName("José Núñez")).toBe("jose nunez");
    expect(normalizePersonName("Cher")).toBeNull();
    expect(normalizePersonName("")).toBeNull();
    expect([...customerNameKeys({ displayName: "The Smiths", firstName: "Ann", lastName: "Smith" })])
      .toEqual(["the smiths", "ann smith"]);
  });
});

describe("choosing the project for a job", () => {
  const p = (id: string, status: string, line1: string | null, zip: string | null, created = 0, archived = false) =>
    ({ id, status, addressLine1: line1, postalCode: zip, archivedAt: archived ? new Date() : null, createdAt: new Date(created) }) as any;
  const cust = { addressLine1: "5 Home Rd", postalCode: "30301" };
  it("address match first (open, then newest), a site-less project inherits the customer's address", () => {
    expect(chooseProjectForJob([p("a", "lead", "9 Other St", "30301"), p("b", "complete", "12 Oak Ave.", "30301-1111")], cust, "12 OAK ave", "30301")).toBe("b");
    expect(chooseProjectForJob([p("a", "complete", "12 Oak Ave", "30301", 2), p("b", "lead", "12 Oak Ave", "30301", 1)], cust, "12 Oak Ave", "30301")).toBe("b");
    expect(chooseProjectForJob([p("a", "lead", null, null), p("b", "lead", "9 Other St", "30301")], cust, "5 Home Rd", "30301")).toBe("a");
  });
  it("else the single open project, else null", () => {
    expect(chooseProjectForJob([p("a", "lead", "9 Other St", "30301"), p("b", "paid", "8 X St", "30301")], cust, "1 Nowhere", "30301")).toBe("a");
    expect(chooseProjectForJob([p("a", "lead", "9 Other St", "30301"), p("b", "approved", "8 X St", "30301")], cust, "1 Nowhere", "30301")).toBeNull();
    expect(chooseProjectForJob([p("a", "lead", "9 Other St", "30301", 0, true)], cust, "1 Nowhere", "30301")).toBeNull();
    expect(chooseProjectForJob([], cust, "5 Home Rd", "30301")).toBeNull();
    expect(normalizeHoverAddress("5 Home Rd", "30301")).toBe("5 home rd|30301");
  });
});

// ── DB-level ─────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);

/** In-process stand-in for hover.to. Rotating refresh tokens: a stale one is a 400, like HOVER. */
function fakeHover() {
  const st = {
    current: "rt-1", n: 1, refreshCalls: 0, refreshDelayMs: 0,
    jobs: new Map<string, any>(), shares: [] as any[], users: [{ id: 501 }, { id: 502 }],
    rateLimitJobs: new Map<string, number>(), // jobId -> how many 429s before it answers
  };
  const json = (code: number, body: any, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json", ...headers } });
  const fetchFn = (async (input: any, init: any) => {
    const u = new URL(String(input));
    if (u.pathname === "/oauth/token") {
      const body = JSON.parse(init?.body || "{}");
      st.refreshCalls++;
      if (st.refreshDelayMs) await new Promise((r) => setTimeout(r, st.refreshDelayMs));
      if (body.refresh_token !== st.current) return json(400, { error: "invalid_grant" });
      st.n++;
      st.current = `rt-${st.n}`;
      return json(200, { access_token: `at-${st.n}`, refresh_token: st.current, expires_in: 7200 });
    }
    const job = /^\/api\/v3\/jobs\/(\d+)$/.exec(u.pathname);
    if (job) {
      const left = st.rateLimitJobs.get(job[1]) ?? 0;
      if (left > 0) { st.rateLimitJobs.set(job[1], left - 1); return json(429, { error: "slow down" }, { "retry-after": "2" }); }
      return st.jobs.has(job[1]) ? json(200, st.jobs.get(job[1])) : json(404, {});
    }
    if (u.pathname === "/api/v2/users") return json(200, { pagination: { total_pages: 1 }, results: st.users });
    if (u.pathname === "/api/v1/job_shares") {
      const uid = Number(u.searchParams.get("current_user_id"));
      return json(200, { job_shares: st.shares.filter((s) => s.user_id === uid), meta: { pagination: { next_page: null } } });
    }
    throw new Error(`fake hover: unexpected ${u.pathname}`);
  }) as typeof fetch;
  return { st, fetchFn };
}

const job = (id: number, contact: any, line1: string, zip: string) => ({
  id, name: `Job ${id}`, contact, address: { location_line_1: line1, city: "Atlanta", region: "GA", postal_code: zip },
});

describe("DB: name matching, project linking, shares, refresh lock, 429", () => {
  let hover: typeof import("./hover");
  let share: typeof import("./hover-share");
  let orgId: string;
  let fake: ReturnType<typeof fakeHover>;

  const connect = async () => {
    hover.clearHoverTokenCache(orgId);
    fake.st.current = "rt-1";
    await q(`update crm_orgs set custom_fields = $2::jsonb where id = $1`, [orgId, JSON.stringify({
      hover: { refreshTokenEnc: hover.encryptHoverSecret("rt-1"), connectedAt: new Date().toISOString() },
    })]);
  };
  const customer = async (display: string, extra: { first?: string; last?: string; email?: string; line1?: string; zip?: string; archived?: boolean } = {}) =>
    (await q<{ id: string }>(
      `insert into crm_customers (org_id, display_name, first_name, last_name, email, address_line1, postal_code, portal_token, archived_at)
       values ($1,$2,$3,$4,$5,$6,$7, md5(random()::text), $8) returning id`,
      [orgId, display, extra.first ?? null, extra.last ?? null, extra.email ?? null, extra.line1 ?? null, extra.zip ?? null, extra.archived ? new Date() : null],
    ))[0].id;
  const project = async (customerId: string, status: string, line1: string | null, zip: string | null) =>
    (await q<{ id: string }>(
      `insert into crm_projects (org_id, customer_id, name, status, address_line1, postal_code) values ($1,$2,'Vitest project',$3,$4,$5) returning id`,
      [orgId, customerId, status, line1, zip],
    ))[0].id;
  const measurement = async (jobId: number) =>
    (await q<any>(`select * from crm_measurements where org_id = $1 and external_id = $2`, [orgId, `hover:${jobId}`]))[0];

  beforeAll(async () => {
    hover = await import("./hover");
    share = await import("./hover-share");
    hover.setHoverBackoffSleep(async () => {});
    orgId = (await q<{ id: string }>(`insert into crm_orgs (name, owner_user_id) values ('HOVER 3D Vitest Org', 1) returning id`))[0].id;
    await q(`insert into crm_members (org_id, email, role, status, display_name, phone) values ($1,'staffer-3d@example.com','field','active','Sam Staffer','(404) 555-0000')`, [orgId]);
    fake = fakeHover();
    await connect();
  }, 30000);

  afterAll(async () => {
    hover?.setHoverBackoffSleep(null);
    if (orgId) {
      for (const t of ["crm_attachments", "crm_measurements", "crm_estimates", "crm_projects", "crm_customers", "crm_members"]) {
        await q(`delete from ${t} where org_id = $1`, [orgId]);
      }
      await q(`delete from crm_orgs where id = $1`, [orgId]);
    }
    await pool.end();
  });

  it("concurrent token requests share ONE refresh (no stale-token 400, no false reconnect flag)", async () => {
    fake.st.refreshDelayMs = 50;
    const before = fake.st.refreshCalls;
    const tokens = await Promise.all(Array.from({ length: 5 }, () => hover.getHoverAccessToken(orgId, fake.fetchFn)));
    fake.st.refreshDelayMs = 0;
    expect(fake.st.refreshCalls - before).toBe(1);
    expect(new Set(tokens).size).toBe(1);
    const [org] = await q(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    expect(org.custom_fields.hover.needsReconnect).toBe(false);
    expect(hover.decryptHoverSecret(org.custom_fields.hover.refreshTokenEnc)).toBe(fake.st.current);
  });

  it("a rotated token is not lost to a concurrent connection-state write (atomic merge)", async () => {
    hover.clearHoverTokenCache(orgId);
    // Refresh (writes refreshTokenEnc) racing a status write from elsewhere.
    await Promise.all([
      hover.getHoverAccessToken(orgId, fake.fetchFn),
      q(`update crm_orgs set custom_fields = jsonb_set(custom_fields, '{hover,lastSyncAttemptAt}', to_jsonb(now()::text)) where id = $1`, [orgId]),
    ]);
    const [org] = await q(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    expect(hover.decryptHoverSecret(org.custom_fields.hover.refreshTokenEnc)).toBe(fake.st.current);
    expect(org.custom_fields.hover.lastSyncAttemptAt).toBeTruthy();
  });

  it("name match: exactly one non-staff customer by full name attaches (matchedVia name)", async () => {
    const c = await customer("Dana  O'Brien", { line1: "1 Elsewhere", zip: "30302" });
    fake.st.jobs.set("7001", job(7001, { name: "dana obrien" }, "77 Peach St", "30303"));
    const r = await hover.ingestHoverJob(orgId, "7001", fake.fetchFn);
    expect(r.matchedVia).toBe("name");
    expect(r.customerId).toBe(c);
    expect((await measurement(7001)).raw_payload.matchedVia).toBe("name");
  });

  it("name ambiguous (two customers) or archived-only or staff name → existing create path", async () => {
    await customer("Lee Twin", { email: "lt1@example.com" });
    await customer("lee twin", { email: "lt2@example.com" });
    fake.st.jobs.set("7002", job(7002, { name: "Lee Twin" }, "2 Twin Way", "30304"));
    const r1 = await hover.ingestHoverJob(orgId, "7002", fake.fetchFn);
    expect(r1.matchedVia).toBeNull();
    expect(r1.customerCreated).toBe(true);

    await customer("Gone Person", { archived: true });
    fake.st.jobs.set("7003", job(7003, { name: "Gone Person" }, "3 Gone Ct", "30305"));
    const r2 = await hover.ingestHoverJob(orgId, "7003", fake.fetchFn);
    expect(r2.matchedVia).toBeNull();
    expect(r2.customerCreated).toBe(true);

    // A customer record that happens to carry the staff member's name never gets a staff-ordered capture.
    await customer("Sam Staffer");
    fake.st.jobs.set("7004", job(7004, { name: "Sam Staffer" }, "4 Staff St", "30306"));
    const r3 = await hover.ingestHoverJob(orgId, "7004", fake.fetchFn);
    expect(r3.matchedVia).toBeNull();
  });

  it("a single word never matches by name", async () => {
    await customer("Prince");
    fake.st.jobs.set("7005", job(7005, { name: "Prince" }, "5 Purple Rd", "30307"));
    expect((await hover.ingestHoverJob(orgId, "7005", fake.fetchFn)).matchedVia).toBeNull();
  });

  it("ingest links the project at the job's address, else creates a lead project there (owner 2026-10-17)", async () => {
    const c = await customer("Pat Project", { email: "pat-3d@example.com", line1: "10 Main St", zip: "30310" });
    const atAddr = await project(c, "lead", "20 Side St", "30310");
    await project(c, "estimating", null, null); // inherits 10 Main St
    fake.st.jobs.set("7010", job(7010, { email: "pat-3d@example.com" }, "20 SIDE st.", "30310-0001"));
    const r = await hover.ingestHoverJob(orgId, "7010", fake.fetchFn);
    expect(r.projectId).toBe(atAddr);
    expect((await measurement(7010)).project_id).toBe(atAddr);

    const c2 = await customer("Solo Open", { email: "solo-3d@example.com", line1: "1 A St", zip: "30311" });
    const only = await project(c2, "approved", "2 B St", "30311");
    await project(c2, "paid", "3 C St", "30311");
    fake.st.jobs.set("7011", job(7011, { email: "solo-3d@example.com" }, "99 Unrelated Rd", "30311"));
    // No project at 99 Unrelated Rd: the capture gets its own lead project instead of joining the open one elsewhere.
    const r11 = await hover.ingestHoverJob(orgId, "7011", fake.fetchFn);
    expect(r11.projectId).toBeTruthy();
    expect(r11.projectId).not.toBe(only);
    const [auto] = await q(`select * from crm_projects where id = $1`, [r11.projectId]);
    expect(auto.status).toBe("lead");
    expect(auto.address_line1).toBe("99 Unrelated Rd");
    expect(auto.custom_fields.hoverJobId).toBe("7011");
  });

  it("a project created later adopts the customer's unlinked HOVER captures at its address; back-fill is idempotent", async () => {
    const c = await customer("Later Proj", { email: "later-3d@example.com", line1: "40 Late Ln", zip: "30320" });
    fake.st.jobs.set("7020", job(7020, { email: "later-3d@example.com" }, "40 Late Ln", "30320"));
    fake.st.jobs.set("7021", job(7021, { email: "later-3d@example.com" }, "41 Other Ln", "30320"));
    await hover.ingestHoverJob(orgId, "7020", fake.fetchFn);
    await hover.ingestHoverJob(orgId, "7021", fake.fetchFn);
    // Each capture got its own lead project at its address; drop them to exercise adoption of unlinked rows.
    const autos = await q(`select id from crm_projects where org_id = $1 and customer_id = $2 and custom_fields ->> 'hoverAutoCreated' = 'true'`, [orgId, c]);
    expect(autos.length).toBe(2);
    await q(`update crm_measurements set project_id = null where org_id = $1 and customer_id = $2`, [orgId, c]);
    await q(`delete from crm_projects where org_id = $1 and customer_id = $2`, [orgId, c]);
    expect((await measurement(7020)).project_id).toBeNull();

    const [p] = await q(`insert into crm_projects (org_id, customer_id, name, status) values ($1,$2,'Late','lead') returning *`, [orgId, c]);
    const adopted = await share.adoptHoverMeasurementsForProject({ id: p.id, orgId, customerId: c, addressLine1: null, postalCode: null });
    expect(adopted).toBe(1);
    expect((await measurement(7020)).project_id).toBe(p.id);
    expect((await measurement(7021)).project_id).toBeNull();

    // Back-fill: the single open project now takes the other capture; a second run changes nothing.
    const first = await share.backfillHoverProjectLinks(orgId);
    expect(first.linked).toBeGreaterThanOrEqual(1);
    expect((await measurement(7021)).project_id).toBe(p.id);
    const again = await share.backfillHoverProjectLinks(orgId);
    expect(again.linked).toBe(0);
  });

  it("shares: ingest stores HOVER's live share; refresh replaces/drops; clients see only live, own-customer shares", async () => {
    hover.clearHoverShareCache(orgId);
    const c = await customer("Share Owner", { email: "share-3d@example.com", line1: "50 Share St", zip: "30330" });
    fake.st.shares = [
      { id: 1, job_id: 7030, user_id: 501, token: "oldTokenAAAA", expired: false, expires_at: iso(5 * DAY + (Date.now() - now.getTime())), url: "https://hover.to/shared/oldTokenAAAA" },
      { id: 2, job_id: 7030, user_id: 502, token: "newTokenBBBB", expired: false, expires_at: new Date(Date.now() + 40 * DAY).toISOString(), url: "https://hover.to/shared/newTokenBBBB", image_url: "https://hover.to/api/v1/job_shares/2/image.png?share_token=newTokenBBBB" },
      { id: 3, job_id: 7030, user_id: 501, token: "expTokenCCCC", expired: true, expires_at: new Date(Date.now() + 90 * DAY).toISOString(), url: "https://hover.to/shared/expTokenCCCC" },
    ];
    fake.st.jobs.set("7030", job(7030, { email: "share-3d@example.com" }, "50 Share St", "30330"));
    await hover.ingestHoverJob(orgId, "7030", fake.fetchFn);
    let m = await measurement(7030);
    expect(m.raw_payload.share.url).toBe("https://hover.to/shared/newTokenBBBB");
    expect(m.raw_payload.share.source).toBe("hover-api");
    expect(m.raw_payload.model3dUrl).toBe("https://hover.to/3d/7030"); // contractor link kept, separately

    // The public-estimate helper: this customer's estimate sees it; another customer's never does.
    const [est] = await q(`insert into crm_estimates (org_id, customer_id, title, public_token) values ($1,$2,'E', md5(random()::text)) returning *`, [orgId, c]);
    const home = await share.clientHome3dForEstimate({ orgId, customerId: c, projectId: est.project_id });
    expect(home?.url).toBe("https://hover.to/shared/newTokenBBBB");
    const other = await customer("Someone Else");
    expect(await share.clientHome3dForEstimate({ orgId, customerId: other, projectId: null })).toBeNull();

    // HOVER deletes the shares → a complete listing with nothing for the job drops the stored API share.
    fake.st.shares = [];
    const r = await hover.refreshHoverShares(orgId, fake.fetchFn);
    expect(r.error).toBeNull();
    m = await measurement(7030);
    expect(m.raw_payload.share).toBeUndefined();
    expect(await share.clientHome3dForEstimate({ orgId, customerId: c, projectId: null })).toBeNull();

    // A pasted (manual) live share survives a refresh that lists nothing.
    await hover.setMeasurementShare(m.id, { url: "https://hover.to/shared/pastedDDDDDD", token: "pastedDDDDDD", imageUrl: null, videoUrl: null, expiresAt: null, source: "manual", savedAt: new Date().toISOString() });
    await hover.refreshHoverShares(orgId, fake.fetchFn);
    expect((await measurement(7030)).raw_payload.share.url).toBe("https://hover.to/shared/pastedDDDDDD");
  });

  it("429: the job fetch backs off and retries; a persistent limit raises HoverRateLimitError (not a generic failure)", async () => {
    fake.st.jobs.set("7040", job(7040, { name: "Rate Limited" }, "60 Slow St", "30340"));
    fake.st.rateLimitJobs.set("7040", 2); // two 429s, then OK — within the in-call retries
    const r = await hover.ingestHoverJob(orgId, "7040", fake.fetchFn);
    expect(r.created).toBe(true);

    fake.st.jobs.set("7041", job(7041, { name: "Very Limited" }, "61 Slow St", "30340"));
    fake.st.rateLimitJobs.set("7041", 99);
    await expect(hover.ingestHoverJob(orgId, "7041", fake.fetchFn)).rejects.toBeInstanceOf(hover.HoverRateLimitError);
    expect(await measurement(7041)).toBeUndefined();
  });

  it("unit: Retry-After parsing", () => {
    expect(hover.hoverRetryAfterMs("5")).toBe(5000);
    expect(hover.hoverRetryAfterMs(null)).toBe(10_000);
    expect(hover.hoverRetryAfterMs("0")).toBe(1000);
    expect(hover.hoverRetryAfterMs("9999")).toBe(120_000);
    const t = Date.parse("2026-10-17T12:00:00Z");
    expect(hover.hoverRetryAfterMs("Sat, 17 Oct 2026 12:00:30 GMT", t)).toBe(30_000);
  });
});
