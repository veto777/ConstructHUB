/**
 * Divisions — the owner's two-arm company (WA HQ + FL).
 *
 * Two behaviours pinned here:
 *   1. Branding resolution (pure): a document on a division carries the
 *      DIVISION's name/address/license, with per-field fallback to the org.
 *      The original bug was Florida estimates going out under the WA HQ
 *      address — the merged letterhead must never mix them.
 *   2. List scoping (against the running dev server): a member pinned to a
 *      division who is not the owner never sees another division's projects,
 *      estimates, jobs or invoices in list endpoints. Owners and
 *      division-less members see everything; unassigned rows are commons.
 *
 * The server-side part uses the same trick as e2e: it temporarily re-roles
 * the dev-bypass user's membership via SQL, exercises the API, and restores
 * it in a finally block. Local throwaway dev DB only.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

let companyBranding: any, divisionScopeOf: any, divisionVisible: any, docDivisionFromMaps: any;

beforeAll(async () => {
  ({ companyBranding, divisionScopeOf, divisionVisible, docDivisionFromMaps } = await import("./divisions"));
});

// ── Pure: branding resolution ───────────────────────────────────────────────

const org = {
  name: "Aspire Interiors",
  legalEntityName: "Aspire Interiors LLC",
  email: "office@aspireinteriors.co",
  phone: "(941) 555-0107",
  website: "https://aspireinteriors.example.com",
  logoUrl: null,
  addressLine1: "1847 Main Street",
  addressLine2: null,
  city: "Sarasota",
  state: "FL",
  postalCode: "34236",
  licenseNumber: "CBC1264418",
  licenseState: "FL",
};

const waDivision = {
  name: "Aspire Interiors — Washington",
  code: "WA",
  email: "hq@aspireinteriors.co",
  phone: "(360) 555-0142",
  addressLine1: "2211 Meridian St",
  addressLine2: null,
  city: "Bellingham",
  state: "WA",
  postalCode: "98225",
  licenseNumber: "ASPIRII881JD",
  licenseState: "WA",
};

describe("companyBranding", () => {
  it("no division → the org's letterhead, verbatim", () => {
    const b = companyBranding(org, null);
    expect(b.name).toBe("Aspire Interiors");
    expect(b.addressLine1).toBe("1847 Main Street");
    expect(b.city).toBe("Sarasota");
    expect(b.licenseNumber).toBe("CBC1264418");
    expect(b.divisionCode).toBeNull();
  });

  it("a division overrides name, address and license", () => {
    const b = companyBranding(org, waDivision);
    expect(b.name).toBe("Aspire Interiors — Washington");
    expect(b.addressLine1).toBe("2211 Meridian St");
    expect(b.city).toBe("Bellingham");
    expect(b.state).toBe("WA");
    expect(b.postalCode).toBe("98225");
    expect(b.licenseNumber).toBe("ASPIRII881JD");
    expect(b.licenseState).toBe("WA");
    expect(b.divisionCode).toBe("WA");
  });

  it("null division fields fall back to the org per field", () => {
    const sparse = { ...waDivision, email: null, phone: null, licenseNumber: null, licenseState: null };
    const b = companyBranding(org, sparse);
    expect(b.email).toBe(org.email);
    expect(b.phone).toBe(org.phone);
    expect(b.licenseNumber).toBe("CBC1264418"); // org license, not a blank
    // …but the division address still wins where it exists
    expect(b.city).toBe("Bellingham");
  });

  it("a division with NO address inherits the org's whole address block", () => {
    const noAddr = { ...waDivision, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null };
    const b = companyBranding(org, noAddr);
    expect(b.addressLine1).toBe("1847 Main Street");
    expect(b.city).toBe("Sarasota");
    expect(b.state).toBe("FL");
  });

  it("never mixes a division street with the org's city", () => {
    const partial = { ...waDivision, city: null, state: null, postalCode: null };
    const b = companyBranding(org, partial);
    expect(b.addressLine1).toBe("2211 Meridian St");
    expect(b.city).toBeNull(); // not "Sarasota" — a Franken-address
    expect(b.state).toBeNull();
  });
});

// ── Pure: scoping predicates ────────────────────────────────────────────────

describe("divisionScopeOf / divisionVisible", () => {
  it("the owner is never scoped, even with a division set", () => {
    expect(divisionScopeOf({ role: "owner", divisionId: "d-wa" })).toBeNull();
  });
  it("a non-owner with a division is scoped to it; without one, unscoped", () => {
    expect(divisionScopeOf({ role: "admin", divisionId: "d-wa" })).toBe("d-wa");
    expect(divisionScopeOf({ role: "admin", divisionId: null })).toBeNull();
    expect(divisionScopeOf({ role: "field", divisionId: "d-fl" })).toBe("d-fl");
  });
  it("a scoped member sees their division and the unassigned commons — never another division", () => {
    expect(divisionVisible("d-wa", "d-wa")).toBe(true);
    expect(divisionVisible("d-wa", null)).toBe(true);
    expect(divisionVisible("d-wa", "d-fl")).toBe(false);
    expect(divisionVisible(null, "d-fl")).toBe(true); // unscoped sees all
  });
  it("docDivisionFromMaps resolves project → estimate → customer", () => {
    const maps = {
      byProject: new Map([["p1", "d-fl"], ["p2", null]]),
      byCustomer: new Map([["c1", "d-fl"]]),
      byEstimate: new Map([["e1", "d-fl"]]),
    };
    expect(docDivisionFromMaps(maps, { projectId: "p1" })).toBe("d-fl");
    expect(docDivisionFromMaps(maps, { estimateId: "e1", customerId: "c9" })).toBe("d-fl");
    expect(docDivisionFromMaps(maps, { customerId: "c1" })).toBe("d-fl");
    expect(docDivisionFromMaps(maps, { projectId: "p2", customerId: "c1" })).toBeNull();
    expect(docDivisionFromMaps(maps, { customerId: "c-unknown" })).toBeNull();
  });
});

// ── Server: list scoping end to end ─────────────────────────────────────────

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

describe("division list scoping (dev server)", () => {
  it("a WA-scoped admin never sees FL projects/estimates/jobs/invoices; owner does", async () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    const run = Date.now().toString(36);
    let cookie: string | undefined;
    try {
      const me = await api("/api/crm/me");
      if (me.status !== 200) throw new Error(`dev server not reachable at ${BASE}`);
      cookie = me.cookie;
      const orgId = me.body.org.id;

      // Two divisions + one project per division (+ the estimate/job/invoice
      // that hang off them), all created through the real API.
      const mkDiv = async (code: string, state: string) => {
        const r = await api("/api/crm/divisions", {
          method: "POST",
          body: JSON.stringify({ name: `Vitest ${code} ${run}`, code, city: state === "WA" ? "Bellingham" : "Sarasota", state }),
        }, cookie);
        expect(r.status).toBe(201);
        return r.body.id as string;
      };
      const waId = await mkDiv(`VTW${run}`.slice(0, 20), "WA");
      const flId = await mkDiv(`VTF${run}`.slice(0, 20), "FL");

      const mkDocSet = async (divisionId: string, tag: string) => {
        const cust = await api("/api/crm/customers", {
          method: "POST", body: JSON.stringify({ displayName: `Vitest ${tag} ${run}`, email: `vitest.${tag}.${run}@example.com` }),
        }, cookie);
        const proj = await api("/api/crm/projects", {
          method: "POST", body: JSON.stringify({ customerId: cust.body.id, name: `Vitest ${tag} proj ${run}`, divisionId }),
        }, cookie);
        expect(proj.status).toBe(201);
        const est = await api("/api/crm/estimates", {
          method: "POST",
          body: JSON.stringify({
            customerId: cust.body.id, projectId: proj.body.id,
            items: [{ kind: "labor", name: "L", quantityMilli: 1000, unitPriceCents: 1000 }],
          }),
        }, cookie);
        const job = await api("/api/crm/jobs", {
          method: "POST", body: JSON.stringify({ projectId: proj.body.id, name: `Vitest ${tag} job` }),
        }, cookie);
        const inv = await api("/api/crm/invoices", {
          method: "POST",
          body: JSON.stringify({
            customerId: cust.body.id, projectId: proj.body.id,
            items: [{ kind: "labor", name: "L", quantityMilli: 1000, unitPriceCents: 1000 }],
          }),
        }, cookie);
        return { projectId: proj.body.id as string, estimateId: est.body.id as string, jobId: job.body.id as string, invoiceId: inv.body.id as string };
      };
      const wa = await mkDocSet(waId, "wa");
      const fl = await mkDocSet(flId, "fl");

      // Branding: the FL estimate's public page must carry the FL division,
      // the WA one the WA division — never crossed. (The public route is
      // email-gated: open it with a client session for the doc's customer.)
      const flRow = (await pool.query(
        `select public_token, customer_id from crm_estimates where id = $1`, [fl.estimateId])).rows[0];
      const flToken = flRow.public_token;
      const raw = randomBytes(32).toString("hex");
      await pool.query(
        `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
         values ($1, $2::jsonb, now() + interval '30 days', now())`,
        [createHash("sha256").update(raw).digest("hex"), JSON.stringify([flRow.customer_id])],
      );
      const pub = await api(`/api/public/estimates/${flToken}`, {}, `crm_client=${raw}`);
      expect(pub.status).toBe(200);
      expect(pub.body.company.divisionCode).toContain("VTF");
      expect(pub.body.company.state).toBe("FL");

      // Flip the dev user's membership to a WA-scoped admin.
      await pool.query(
        `update crm_members set role = 'admin', division_id = $1 where org_id = $2 and user_id = 1`,
        [waId, orgId],
      );

      const projects = await api("/api/crm/projects", {}, cookie);
      const projIds = projects.body.projects.map((p: any) => p.id);
      expect(projIds).toContain(wa.projectId);
      expect(projIds).not.toContain(fl.projectId);

      const estimates = await api("/api/crm/estimates", {}, cookie);
      const estIds = estimates.body.map((e: any) => e.id);
      expect(estIds).toContain(wa.estimateId);
      expect(estIds).not.toContain(fl.estimateId);

      const jobs = await api("/api/crm/jobs", {}, cookie);
      const jobIds = jobs.body.jobs.map((j: any) => j.id);
      expect(jobIds).toContain(wa.jobId);
      expect(jobIds).not.toContain(fl.jobId);

      const invoices = await api("/api/crm/invoices", {}, cookie);
      const invIds = invoices.body.map((i: any) => i.id);
      expect(invIds).toContain(wa.invoiceId);
      expect(invIds).not.toContain(fl.invoiceId);
    } finally {
      // ALWAYS restore the dev user's owner membership — every other suite
      // depends on it.
      await pool.query(
        `update crm_members set role = 'owner', division_id = null where user_id = 1`,
      );
      await pool.end();
    }
  });
});
