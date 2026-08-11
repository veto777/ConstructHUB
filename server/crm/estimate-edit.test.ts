/**
 * Estimate detail, edit-after-send and delete — the owner's core complaints,
 * pinned against the running dev server (CRM_TEST_BASE_URL).
 *
 *   1. Descriptions/scope text SAVE and RENDER: create → CRM GET → the gated
 *      public view all carry per-line description and introText. The original
 *      bug was client-side (the builders hardcoded description:null and had no
 *      input for it); these tests pin the server contract it broke against.
 *   2. PATCH /api/crm/estimates/:id edits a SENT estimate — title, intro,
 *      items, tax — with totals recomputed server-side (discount math
 *      unchanged), the public page immediately showing the revision, and an
 *      honest "updated" event in the trail.
 *   3. An APPROVED estimate refuses PATCH (409) and DELETE (409) — it's a
 *      signed contract. A merely-sent estimate deletes fine.
 *   4. A declined estimate can be edited and re-sent; the re-send revives it
 *      (status back to sent, decline cleared).
 *   5. The explicit division pick drives the public letterhead — an FL-picked
 *      estimate renders the FL name/address/license, and clearing the pick
 *      falls back to the org.
 *   6. Tenant isolation: PATCH/DELETE of another org's estimate → 404.
 *
 * Throwaway rows only (unique run stamp), safe alongside other lanes.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Mint a client-portal session cookie covering one customer (bypasses email). */
async function clientCookie(customerId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await pool.query(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify([customerId])],
  );
  return `crm_client=${raw}`;
}

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

let cookie: string | undefined;

beforeAll(async () => {
  const me = await api("/api/crm/me");
  if (me.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
  }
  cookie = me.cookie;
});

const line = (name: string, qtyMilli: number, cents: number, extra: Record<string, unknown> = {}) => ({
  kind: "labor", name, quantityMilli: qtyMilli, unitPriceCents: cents, taxable: true, ...extra,
});

/** Throwaway customer; returns its id. */
async function customerFixture(run: string): Promise<string> {
  const cust = await api("/api/crm/customers", {
    method: "POST",
    body: JSON.stringify({ displayName: `Vitest estedit ${run}`, email: `vitest.estedit.${run}@example.com` }),
  }, cookie);
  expect(cust.status).toBe(201);
  return cust.body.id as string;
}

describe("estimate descriptions save and render", () => {
  it("create → CRM GET → public view all carry introText and per-line scope", async () => {
    const run = Date.now().toString(36);
    const customerId = await customerFixture(run);
    const scope = "Tear off existing siding\n• Install weather barrier\n• Install HardiePlank lap siding";
    const intro = "Thanks for having us out — here's the full scope we discussed.";

    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId, title: "Hardie siding", introText: intro,
        items: [line("HardiePlank lap siding", 1500_000, 2000, { description: scope, unit: "sf" })],
      }),
    }, cookie);
    expect(est.status).toBe(201);

    const det = await api(`/api/crm/estimates/${est.body.id}`, {}, cookie);
    expect(det.status).toBe(200);
    expect(det.body.estimate.introText).toBe(intro);
    expect(det.body.items[0].description).toBe(scope);

    // The client-facing view renders exactly what was saved.
    const cc = await clientCookie(customerId);
    const token = (det.body.publicPath as string).split("/e/")[1];
    const pub = await api(`/api/public/estimates/${token}`, {}, cc);
    expect(pub.status).toBe(200);
    expect(pub.body.estimate.introText).toBe(intro);
    expect(pub.body.items[0].description).toBe(scope);
    expect(pub.body.items[0].lineTotalCents).toBe(30000_00);
  });
});

describe("PATCH /api/crm/estimates/:id (edit after send)", () => {
  it("edits a sent estimate; totals recompute server-side; public view shows the revision", async () => {
    const run = `${Date.now().toString(36)}b`;
    const customerId = await customerFixture(run);
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId, title: "Original title", taxRateBps: 1000,
        items: [line("Base work", 1000, 100_00)],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    const id = est.body.id as string;

    const send = await api(`/api/crm/estimates/${id}/send`, { method: "POST", body: "{}" }, cookie);
    expect(send.status).toBe(200);
    expect(send.body.estimate.status).toBe("sent");

    // Edit AFTER send: new title/intro, new scope text, a manual discount line.
    const patch = await api(`/api/crm/estimates/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Revised title",
        introText: "Revised scope — we added the north wall.",
        items: [
          line("HardiePlank lap siding", 2000_000, 1500, { description: "Full scope text here", unit: "sf" }),
          line("Repeat-client discount", 1000, 500_00, { kind: "discount", taxable: false }),
        ],
      }),
    }, cookie);
    expect(patch.status).toBe(200);
    // $30,000 subtotal − $500 discount; 10% tax on the discounted taxable base.
    expect(patch.body.title).toBe("Revised title");
    expect(patch.body.subtotalCents).toBe(30000_00);
    expect(patch.body.discountCents).toBe(500_00);
    expect(patch.body.taxCents).toBe(2950_00);
    expect(patch.body.totalCents).toBe(32450_00);
    expect(patch.body.status).toBe("sent"); // editing never un-sends

    // The events trail is honest about the after-send edit.
    const det = await api(`/api/crm/estimates/${id}`, {}, cookie);
    const updated = (det.body.events as any[]).find((ev) => ev.type === "updated");
    expect(updated).toBeTruthy();
    expect(updated.meta.afterSend).toBe(true);

    // The client link shows the revision immediately — no re-send required.
    const cc = await clientCookie(customerId);
    const token = (det.body.publicPath as string).split("/e/")[1];
    const pub = await api(`/api/public/estimates/${token}`, {}, cc);
    expect(pub.status).toBe(200);
    expect(pub.body.estimate.title).toBe("Revised title");
    expect(pub.body.estimate.introText).toBe("Revised scope — we added the north wall.");
    expect(pub.body.items.map((i: any) => i.description)).toContain("Full scope text here");
    expect(pub.body.estimate.totalCents).toBe(32450_00);
  });

  it("client-supplied totals in a PATCH body are ignored", async () => {
    const run = `${Date.now().toString(36)}c`;
    const customerId = await customerFixture(run);
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({ customerId, items: [line("Work", 1000, 100_00)] }),
    }, cookie);
    const patch = await api(`/api/crm/estimates/${est.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ totalCents: 1, subtotalCents: 1 } as any),
    }, cookie);
    expect(patch.status).toBe(200);
    expect(patch.body.totalCents).toBe(100_00);
  });

  it("an approved estimate refuses PATCH (409)", async () => {
    const run = `${Date.now().toString(36)}d`;
    const customerId = await customerFixture(run);
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({ customerId, items: [line("Work", 1000, 100_00)] }),
    }, cookie);
    const id = est.body.id as string;
    await api(`/api/crm/estimates/${id}/send`, { method: "POST", body: "{}" }, cookie);

    const det = await api(`/api/crm/estimates/${id}`, {}, cookie);
    const token = (det.body.publicPath as string).split("/e/")[1];
    const cc = await clientCookie(customerId);
    const approve = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", signatureName: "Vitest Signer" }),
    }, cc);
    expect(approve.status).toBe(200);

    const patch = await api(`/api/crm/estimates/${id}`, {
      method: "PATCH", body: JSON.stringify({ title: "Too late" }),
    }, cookie);
    expect(patch.status).toBe(409);

    const del = await api(`/api/crm/estimates/${id}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(409);
  });

  it("a declined estimate can be edited and re-sent — the re-send revives it", async () => {
    const run = `${Date.now().toString(36)}e`;
    const customerId = await customerFixture(run);
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({ customerId, items: [line("Work", 1000, 100_00)] }),
    }, cookie);
    const id = est.body.id as string;
    await api(`/api/crm/estimates/${id}/send`, { method: "POST", body: "{}" }, cookie);

    const det = await api(`/api/crm/estimates/${id}`, {}, cookie);
    const token = (det.body.publicPath as string).split("/e/")[1];
    const cc = await clientCookie(customerId);
    const decline = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "decline", reason: "Too much" }),
    }, cc);
    expect(decline.status).toBe(200);

    // The owner sharpens the pencil and re-sends.
    const patch = await api(`/api/crm/estimates/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ items: [line("Work — revised", 1000, 90_00)] }),
    }, cookie);
    expect(patch.status).toBe(200);
    const resend = await api(`/api/crm/estimates/${id}/send`, { method: "POST", body: "{}" }, cookie);
    expect(resend.status).toBe(200);
    expect(resend.body.estimate.status).toBe("sent");
    expect(resend.body.estimate.declinedAt).toBeNull();
  });

  it("rejects edits to another org's estimate (404, tenant isolation)", async () => {
    const run = `${Date.now().toString(36)}f`;
    // A foreign org + customer + estimate, inserted directly (no API path can
    // cross orgs, which is the point).
    const foreign = await pool.query(
      `with o as (
         insert into crm_orgs (name, owner_user_id)
         values ($1, (select owner_user_id from crm_orgs limit 1)) returning id
       ), c as (
         insert into crm_customers (org_id, display_name, portal_token)
         select id, $2, $3 from o returning id, org_id
       )
       insert into crm_estimates (org_id, customer_id, public_token, title)
       select org_id, id, $4, 'Foreign' from c returning id`,
      [`Vitest foreign org ${run}`, `Foreign ${run}`, randomBytes(12).toString("hex"), randomBytes(24).toString("hex")],
    );
    const foreignId = foreign.rows[0].id as string;
    try {
      const patch = await api(`/api/crm/estimates/${foreignId}`, {
        method: "PATCH", body: JSON.stringify({ title: "cross-tenant write" }),
      }, cookie);
      expect(patch.status).toBe(404);
      const del = await api(`/api/crm/estimates/${foreignId}`, { method: "DELETE" }, cookie);
      expect(del.status).toBe(404);
      const get = await api(`/api/crm/estimates/${foreignId}`, {}, cookie);
      expect(get.status).toBe(404);
    } finally {
      await pool.query(`delete from crm_estimates where id = $1`, [foreignId]).catch(() => {});
      await pool.query(`delete from crm_customers where display_name = $1`, [`Foreign ${run}`]).catch(() => {});
      await pool.query(`delete from crm_orgs where name = $1`, [`Vitest foreign org ${run}`]).catch(() => {});
    }
  });
});

describe("estimate delete", () => {
  it("a sent estimate deletes cleanly; GET then 404s", async () => {
    const run = `${Date.now().toString(36)}g`;
    const customerId = await customerFixture(run);
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({ customerId, items: [line("Work", 1000, 100_00)] }),
    }, cookie);
    const id = est.body.id as string;
    await api(`/api/crm/estimates/${id}/send`, { method: "POST", body: "{}" }, cookie);

    const del = await api(`/api/crm/estimates/${id}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(200);
    const get = await api(`/api/crm/estimates/${id}`, {}, cookie);
    expect(get.status).toBe(404);
  });
});

describe("division branding on the public estimate", () => {
  it("an explicit division pick drives the letterhead; clearing it falls back to the org", async () => {
    const run = `${Date.now().toString(36)}h`;
    const customerId = await customerFixture(run);

    const div = await api("/api/crm/divisions", {
      method: "POST",
      body: JSON.stringify({
        name: `Vitest Florida ${run}`, code: `FL${run.slice(-4)}`.toUpperCase(),
        email: `fl.${run}@example.com`, phone: "(941) 555-0100",
        addressLine1: "1847 Main Street", city: "Sarasota", state: "FL", postalCode: "34236",
        licenseNumber: "CBC1264418", licenseState: "FL",
      }),
    }, cookie);
    expect(div.status).toBe(201);
    const divisionId = div.body.id as string;

    try {
      const est = await api("/api/crm/estimates", {
        method: "POST",
        body: JSON.stringify({
          customerId, divisionId, title: "FL work",
          items: [line("Hardie siding", 1000, 30000_00, { description: "Scope" })],
        }),
      }, cookie);
      expect(est.status).toBe(201);
      expect(est.body.divisionId).toBe(divisionId);
      const id = est.body.id as string;

      const det = await api(`/api/crm/estimates/${id}`, {}, cookie);
      const token = (det.body.publicPath as string).split("/e/")[1];
      const cc = await clientCookie(customerId);

      const pub = await api(`/api/public/estimates/${token}`, {}, cc);
      expect(pub.status).toBe(200);
      // The FL letterhead — never the WA/org one.
      expect(pub.body.company.name).toBe(`Vitest Florida ${run}`);
      expect(pub.body.company.divisionName).toBe(`Vitest Florida ${run}`);
      expect(pub.body.company.city).toBe("Sarasota");
      expect(pub.body.company.state).toBe("FL");
      expect(pub.body.company.licenseNumber).toBe("CBC1264418");

      // A bogus division id is refused.
      const bad = await api(`/api/crm/estimates/${id}`, {
        method: "PATCH", body: JSON.stringify({ divisionId: "no-such-division" }),
      }, cookie);
      expect(bad.status).toBe(400);

      // Clearing the pick falls back to the org letterhead.
      const cleared = await api(`/api/crm/estimates/${id}`, {
        method: "PATCH", body: JSON.stringify({ divisionId: null }),
      }, cookie);
      expect(cleared.status).toBe(200);
      expect(cleared.body.divisionId).toBeNull();
      const pub2 = await api(`/api/public/estimates/${token}`, {}, cc);
      expect(pub2.body.company.divisionName).toBeNull();
    } finally {
      await pool.query(`delete from crm_divisions where id = $1`, [divisionId]).catch(() => {});
    }
  });
});
