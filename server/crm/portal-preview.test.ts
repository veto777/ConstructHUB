/**
 * "See what the client sees" — the contractor's read-only portal preview.
 *
 * What these pin:
 *   1. A preview grant verifies for ANY customer id, not only a 36-char UUID
 *      (crm_customers.id is a free varchar; the demo workspace's ids are
 *      "demo-client-…"). Before: minted fine, then rejected on redeem.
 *   2. A grant that does not verify lands on ?preview=expired — an error
 *      state with a way back — never on a bare "/" that 401s into the client
 *      sign-in screen.
 *   3. The portal page's view decision (shared/client-portal-state.ts).
 *
 * Unit tests need no server; the route tests use the dev server
 * (CRM_TEST_BASE_URL), like the neighbouring suites.
 */
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";
process.env.SESSION_SECRET ||= "vitest-portal-preview-secret";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { clientPortalView, errorStatusOf } from "@shared/client-portal-state";

let mint: (id: string) => string;
let verify: (grant: string) => string | null;
beforeAll(async () => {
  const m = await import("./client-auth");
  mint = m.mintPortalPreviewGrant;
  verify = m.verifyPortalPreviewGrant;
});

describe("portal-preview grant", () => {
  const ids = [
    "0b0f7c0e-3d0a-4c56-9d0e-6a1f6a2f9b11",   // the usual gen_random_uuid()
    "demo-client-ferrante",                   // the demo workspace
    "demo-client-halvorsen-quist",
    "12345",                                  // an imported numeric id
    "cust.with.dots",                         // dots must not confuse the split
    "id with space;and=cookie,chars",
    "a",
  ];
  it.each(ids)("round-trips for id %j", (id) => {
    expect(verify(mint(id))).toBe(id);
  });

  it("rejects a tampered id, a tampered signature, an expired grant and garbage", () => {
    const g = mint("demo-client-ferrante");
    const [, exp, sig] = /^(?:.*)\.(\d+)\.([0-9a-f]{32})$/.exec(g)!;
    expect(verify(`demo-client-oyelaran.${exp}.${sig}`)).toBeNull();
    expect(verify(`demo-client-ferrante.${exp}.${"0".repeat(32)}`)).toBeNull();
    expect(verify(`demo-client-ferrante.${Number(exp) + 1}.${sig}`)).toBeNull();
    expect(verify(`demo-client-ferrante.1000000000.${sig}`)).toBeNull(); // long past
    for (const junk of ["", "bogus", "..", `.${exp}.${sig}`, `${"x".repeat(129)}.${exp}.${sig}`]) {
      expect(verify(junk)).toBeNull();
    }
  });

  it("an id that merely ends like another grant cannot borrow its signature", () => {
    const g = mint("a");
    const [, exp, sig] = /^a\.(\d+)\.([0-9a-f]{32})$/.exec(g)!;
    expect(verify(`b.a.${exp}.${sig}`)).toBeNull();
    expect(verify(`a.${exp}.${exp}.${sig}`)).toBeNull();
  });
});

describe("clientPortalView", () => {
  const cases: [string, Parameters<typeof clientPortalView>[0], ReturnType<typeof clientPortalView>][] = [
    ["loading", { loading: true, errorStatus: null, previewParam: false, wasPreview: false }, "loading"],
    ["signed in", { loading: false, errorStatus: null, previewParam: false, wasPreview: false }, "dashboard"],
    ["a homeowner, signed out", { loading: false, errorStatus: 401, previewParam: false, wasPreview: false }, "sign-in"],
    ["refused grant → 401 (the reported landing)", { loading: false, errorStatus: 401, previewParam: true, wasPreview: false }, "preview-ended"],
    ["refused grant while still loading", { loading: true, errorStatus: null, previewParam: true, wasPreview: false }, "preview-ended"],
    ["refused grant, but another session is valid", { loading: false, errorStatus: null, previewParam: true, wasPreview: false }, "preview-ended"],
    ["the 15-minute preview ran out", { loading: false, errorStatus: 401, previewParam: false, wasPreview: true }, "preview-ended"],
    ["server error", { loading: false, errorStatus: 500, previewParam: false, wasPreview: false }, "error"],
    ["network error (no status)", { loading: false, errorStatus: 0, previewParam: false, wasPreview: true }, "error"],
  ];
  it.each(cases)("%s", (_name, state, view) => { expect(clientPortalView(state)).toBe(view); });

  it("no state is ever nothing-to-render", () => {
    for (const loading of [true, false]) for (const errorStatus of [null, 0, 401, 403, 500])
      for (const previewParam of [true, false]) for (const wasPreview of [true, false]) {
        expect(["loading", "dashboard", "sign-in", "preview-ended", "error"])
          .toContain(clientPortalView({ loading, errorStatus, previewParam, wasPreview }));
      }
  });

  it("errorStatusOf reads the query client's `${status}: …` errors", () => {
    expect(errorStatusOf(null)).toBeNull();
    expect(errorStatusOf(new Error('401: {"message":"Sign in required"}'))).toBe(401);
    expect(errorStatusOf(new Error("503: unavailable"))).toBe(503);
    expect(errorStatusOf(new TypeError("Failed to fetch"))).toBe(0);
  });
});

describe("preview redeem (dev server)", () => {
  const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
  const pool = new pg.Pool({ connectionString: process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  const id = `vitest-preview-${Date.now().toString(36)}`; // deliberately NOT a UUID
  let crm = "";

  beforeAll(async () => {
    const me = await fetch(`${BASE}/api/crm/me`);
    if (me.status !== 200) throw new Error(`CRM dev server not reachable at ${BASE}. Start it first.`);
    crm = me.headers.get("set-cookie")?.split(";")[0] ?? "";
    const { org } = await me.json();
    await pool.query(
      `insert into crm_customers (id, org_id, display_name, email, portal_token)
       values ($1, $2, 'Vitest Preview Non-UUID', $3, md5(random()::text) || md5(random()::text))`,
      [id, org.id, `${id}@example.com`]);
  });
  afterAll(async () => {
    await pool.query(`delete from crm_customers where id = $1`, [id]);
    await pool.end();
  });

  const hop = (url: string, cookie?: string) =>
    fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });

  it("a non-UUID client: mint → redeem → the portal answers as that client, with the way back", async () => {
    const minted = await fetch(`${BASE}/api/crm/customers/${id}/portal-preview`, {
      method: "POST", headers: { "content-type": "application/json", cookie: crm }, body: "{}",
    });
    expect(minted.status).toBe(200);
    const { url } = await minted.json();
    expect(url).toContain("/api/client/auth/preview?grant=");

    const redeem = await hop(url);
    expect(redeem.status).toBe(302);
    expect(redeem.headers.get("location")).not.toContain("preview=expired");
    const cookie = redeem.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^crm_client=prev\./);

    const docs = await hop(`${BASE}/api/client/documents`, cookie);
    expect(docs.status).toBe(200); // was 401 "Sign in required"
    const body = await docs.json();
    expect(body.contractorPreview).toBe(true);
    expect(body.customer.displayName).toBe("Vitest Preview Non-UUID");
    expect(body.previewReturnUrl).toMatch(new RegExp(`/crm/clients/${id}$`));
  });

  it("a grant that does not verify lands on ?preview=expired and sets no cookie", async () => {
    for (const grant of ["bogus", `${id}.9999999999999.${"0".repeat(32)}`, ""]) {
      const r = await hop(`${BASE}/api/client/auth/preview?grant=${encodeURIComponent(grant)}`);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("/?preview=expired");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    // Dev's query-forced client face keeps its flag.
    const dev = await hop(`${BASE}/api/client/auth/preview?grant=bogus&client=1`);
    expect(dev.headers.get("location")).toBe("/?preview=expired&client=1");
  });

  it("the way back is the CRM, from the server — never from the query", async () => {
    const r = await fetch(`${BASE}/api/client/auth/preview-return?crmUrl=https://evil.example`);
    expect(r.status).toBe(200);
    const { crmUrl } = await r.json();
    expect(crmUrl).toMatch(/\/crm\/clients$/);
    expect(crmUrl).not.toContain("evil");
  });
});
