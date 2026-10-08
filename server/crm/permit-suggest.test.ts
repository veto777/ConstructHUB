/**
 * GET /api/crm/projects/:id/permits/suggest — the CRM Permits tab.
 *
 * Bug: a job in Austin, TX was shown the permit office of Austin County, TX (a different county; the city is in
 * Travis County) because the route matched `jurisdiction ILIKE '%Austin%'`.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true) on the seeded dev directory:
 *   PORT=8131 npx tsx --env-file=.env server/index.ts   →   CRM_TEST_BASE_URL=http://127.0.0.1:8131
 * Fixtures live in a throwaway org and are deleted in afterAll; the directory itself is only read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString: process.env.CRM_TEST_DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...opts, headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

describe("crm permits/suggest (dev server)", () => {
  let cookie: string | undefined;
  let org = "";
  let cust = "";
  const projects = new Map<string, string>();

  const suggest = async (city: string | null, state: string | null) => {
    const key = `${city}|${state}`;
    if (!projects.has(key)) {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_projects (org_id, customer_id, name, status, city, state) values ($1, $2, $3, 'lead', $4, $5) returning id`,
        [org, cust, `Vitest Permit ${key}`, city, state]);
      projects.set(key, id);
    }
    const r = await api(`/api/crm/projects/${projects.get(key)}/permits/suggest`, {}, cookie);
    expect(r.status).toBe(200);
    return r.body as { portals: any[]; appraisers: any[]; jurisdiction?: string; basis?: string; note?: string; counties?: string[]; issuedBy?: string | null; message?: string };
  };

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    [{ id: org }] = await q<{ id: string }>(`insert into crm_orgs (name, owner_user_id) values ($1, 1) returning id`, [`Vitest Permit ${stamp}`]);
    await q(`insert into crm_members (org_id, user_id, email, role, status, display_name) values ($1, 1, $2, 'owner', 'active', 'Permit Owner')`,
      [org, `vitest.permit.${stamp}@example.com`]);
    const sw = await api("/api/crm/org/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId: org }) }, me.cookie);
    expect(sw.status).toBe(200);
    cookie = sw.cookie;
    [{ id: cust }] = await q<{ id: string }>(`insert into crm_customers (org_id, display_name, portal_token) values ($1, $2, $3) returning id`,
      [org, `Vitest Permit Cust ${stamp}`, `ptok-${stamp}-permit`]);
  });

  afterAll(async () => {
    if (org) {
      await q(`delete from crm_projects where org_id = $1`, [org]);
      await q(`delete from crm_customers where org_id = $1`, [org]);
      await q(`delete from crm_team_activity where org_id = $1`, [org]);
      await q(`delete from crm_members where org_id = $1`, [org]);
      await q(`delete from crm_orgs where id = $1`, [org]);
    }
    await pool.end();
  });

  it("the directory still holds the trap: an active Austin County, TX office", async () => {
    const [{ n }] = await q<{ n: number }>(`select count(*)::int n from permit_databases where jurisdiction = 'Austin County, TX' and is_active`);
    expect(n).toBeGreaterThan(0);
  });

  it("Austin, TX → the City of Austin's own office, never Austin County, TX", async () => {
    const r = await suggest("Austin", "TX");
    expect(r.basis).toBe("own");
    expect(r.jurisdiction).toBe("Austin, TX");
    expect(r.portals.length).toBe(1); // one office, though the city has a directory row per county it spans
    expect(r.portals.map((p) => p.jurisdiction)).toEqual(["Austin, TX"]);
    expect(r.portals[0].searchUrl || r.portals[0].portalUrl).toMatch(/^https:\/\/[^/]*austintexas\.gov\//);
    expect(JSON.stringify(r)).not.toMatch(/Austin County/i);
    // Property records: the counties the city is in — not the "Austin County" appraisal district.
    expect(r.counties).toContain("Travis");
    expect(r.counties).not.toContain("Austin");
    for (const a of r.appraisers) expect(r.counties).toContain(a.county);
  });

  it("the state may be typed as a name, and the city in any case", async () => {
    const r = await suggest("  austin ", "Texas");
    expect(r.portals.map((p) => p.jurisdiction)).toEqual(["Austin, TX"]);
  });

  it("a town routed by the verified routing data gets that issuer — Big Horn, WY → Sheridan County, not Big Horn County", async () => {
    const r = await suggest("Big Horn", "WY");
    expect(r.basis).toBe("routed");
    expect(r.issuedBy).toBe("Sheridan County, WY");
    expect(r.portals.map((p) => p.jurisdiction)).toEqual(["Sheridan County, WY"]);
  });

  it("a town with no office or route gets the county it is on record in, said as such — Franklin, GA → Heard County, not Franklin County", async () => {
    const r = await suggest("Franklin", "GA");
    expect(r.basis).toBe("county");
    expect(r.portals.map((p) => p.jurisdiction)).toEqual(["Heard County, GA"]);
    expect(r.note).toMatch(/Heard County/);
    expect(r.note).toMatch(/confirm/);
  });

  it("nothing on record → nothing shown — Oneida, WI (Brown County) is not given Oneida County's office", async () => {
    const r = await suggest("Oneida", "WI");
    expect(r.portals).toEqual([]);
    expect(r.basis).toBe("none");
    expect(r.note).toMatch(/rather than a guess/);
  });

  it("an unknown place, a partial name, or no city at all match nothing (no substring, no state-wide list)", async () => {
    for (const [city, basis] of [["Aust", "unknown-place"], ["Zzyzx Nowhere", "unknown-place"], [null, "no-city"], ["%", "unknown-place"]] as const) {
      const r = await suggest(city, "TX");
      expect(r.portals, String(city)).toEqual([]);
      expect(r.appraisers, String(city)).toEqual([]);
      expect(r.basis).toBe(basis);
    }
  });

  it("no state → the existing 'add a state' message", async () => {
    const r = await suggest("Austin", null);
    expect(r.portals).toEqual([]);
    expect(r.message).toMatch(/Add a state/);
  });
});
