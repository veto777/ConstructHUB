/**
 * Lead capture — token lifecycle, public intake, anti-enumeration.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL; the DB with DATABASE_URL.
 *
 * Fixtures are throwaway website leads created through the real public
 * endpoint and deleted afterwards. The rate-limit test forges a unique
 * X-Forwarded-For per run so it can never trip (or be tripped by) any other
 * suite sharing the dev server's in-memory buckets.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

const RUN = `LC ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const name = (suffix: string) => `${RUN} ${suffix}`;

async function api(path: string, opts: RequestInit = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { "content-type": "application/json", ...headers, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const postLead = (token: string, data: any, headers: Record<string, string> = {}) =>
  api(`/api/public/leads/${token}`, { method: "POST", body: JSON.stringify(data) }, headers);

let ORG_ID = "";

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/crm/me`);
  if (res.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${res.status}). Start it first.`);
  }
  ORG_ID = (await res.json()).org.id;
});

afterAll(async () => {
  await q(`delete from crm_customers where org_id = $1 and display_name like $2`, [ORG_ID, `${RUN} %`]);
  await pool.end();
});

async function getToken(): Promise<string> {
  const res = await api("/api/crm/integrations/lead-capture");
  expect(res.status).toBe(200);
  return res.body.token;
}

describe("manage endpoints (token lifecycle)", () => {
  it("mints the token once — repeated reads return the same one and persist it", async () => {
    const first = await api("/api/crm/integrations/lead-capture");
    expect(first.status).toBe(200);
    expect(first.body.token).toMatch(new RegExp(`^${ORG_ID}\\.[0-9a-f]{48}$`));
    expect(first.body.formUrl).toContain(`/lead-form/${first.body.token}`);
    expect(typeof first.body.leads30d).toBe("number");

    const second = await api("/api/crm/integrations/lead-capture");
    expect(second.body.token).toBe(first.body.token);

    const rows = await q<{ token: string }>(
      `select custom_fields->>'leadCaptureToken' as token from crm_orgs where id = $1`, [ORG_ID]);
    expect(rows[0]?.token).toBe(first.body.token);
  });

  it("rotate replaces the token and the old one dies immediately", async () => {
    const old = await getToken();
    const rotated = await api("/api/crm/integrations/lead-capture/rotate", { method: "POST" });
    expect(rotated.status).toBe(200);
    expect(rotated.body.token).not.toBe(old);

    const stale = await postLead(old, { name: name("stale"), website: "" });
    expect(stale.status).toBe(404);

    const fresh = await postLead(rotated.body.token, { name: name("fresh"), website: "" });
    expect(fresh.status).toBe(201);
    const rows = await q(`select id from crm_customers where org_id = $1 and display_name = $2`,
      [ORG_ID, name("fresh")]);
    expect(rows.length).toBe(1);
  });
});

describe("public intake", () => {
  it("creates a customer owned by the org owner with the Website source and the website-lead tag", async () => {
    const token = await getToken();
    const res = await postLead(token, {
      name: name("valid"),
      email: "lead@example.com",
      phone: "555-0142",
      message: "Roof leak over the garage",
      address: "12 Oak St",
      website: "",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });

    const rows = await q<{
      email: string; phone: string; notes: string; address_line1: string;
      lead_source: string; tags: string[]; owner_member_id: string | null;
    }>(
      `select c.email, c.phone, c.notes, c.address_line1, c.tags, c.owner_member_id,
              ls.name as lead_source
         from crm_customers c left join crm_lead_sources ls on ls.id = c.lead_source_id
        where c.org_id = $1 and c.display_name = $2`,
      [ORG_ID, name("valid")],
    );
    expect(rows.length).toBe(1);
    const lead = rows[0];
    expect(lead.email).toBe("lead@example.com");
    expect(lead.phone).toBe("555-0142");
    expect(lead.notes).toBe("Roof leak over the garage");
    expect(lead.address_line1).toBe("12 Oak St");
    expect(lead.lead_source).toBe("Website");
    expect(lead.tags).toContain("website-lead");

    const owners = await q<{ id: string }>(
      `select m.id from crm_members m join crm_orgs o on o.id = m.org_id
        where m.org_id = $1 and m.status = 'active' and m.user_id = o.owner_user_id limit 1`,
      [ORG_ID]);
    expect(lead.owner_member_id).toBe(owners[0]?.id);
  });

  it("reuses the same Website lead source instead of creating duplicates", async () => {
    const rows = await q<{ n: number }>(
      `select count(*)::int as n from crm_lead_sources where org_id = $1 and lower(name) = 'website'`,
      [ORG_ID]);
    expect(rows[0].n).toBe(1);
  });

  it("a filled honeypot gets the same 201 — and creates nothing", async () => {
    const token = await getToken();
    const res = await postLead(token, { name: name("bot"), website: "http://spam.example" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    const rows = await q(`select id from crm_customers where org_id = $1 and display_name = $2`,
      [ORG_ID, name("bot")]);
    expect(rows.length).toBe(0);
  });

  it("rejects an unknown token with 404 on both the header and the submit", async () => {
    const bogus = `${ORG_ID}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;
    expect((await api(`/api/public/leads/${bogus}`)).status).toBe(404);
    expect((await postLead(bogus, { name: name("ghost") })).status).toBe(404);
    const rows = await q(`select id from crm_customers where org_id = $1 and display_name = $2`,
      [ORG_ID, name("ghost")]);
    expect(rows.length).toBe(0);
  });

  it("a missing name is a 400, never a customer", async () => {
    const token = await getToken();
    const res = await postLead(token, { name: "  ", email: "x@example.com" });
    expect(res.status).toBe(400);
  });

  it("rate limit trips after 10 submissions per IP — same 201, no eleventh lead", async () => {
    const token = await getToken();
    // A forged per-run source IP keeps this test isolated from every other
    // suite sharing the dev server's in-memory buckets.
    const ip = `10.77.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
    const ff = { "x-forwarded-for": ip };

    for (let i = 1; i <= 10; i++) {
      const res = await postLead(token, { name: name(`flood ${i}`) }, ff);
      expect(res.status).toBe(201);
    }
    const eleventh = await postLead(token, { name: name("flood 11") }, ff);
    expect(eleventh.status).toBe(201);
    expect(eleventh.body).toEqual({ ok: true });

    const rows = await q<{ n: number }>(
      `select count(*)::int as n from crm_customers where org_id = $1 and display_name like $2`,
      [ORG_ID, `${RUN} flood %`],
    );
    expect(rows[0].n).toBe(10);
  });
});
