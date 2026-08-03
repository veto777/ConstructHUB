/**
 * Client 360 — contractor notes, the unified customer timeline, financing
 * click tracking, and the read-only contractor portal preview.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8139 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL; the DB with DATABASE_URL.
 *
 * Fixtures are throwaway customers/estimates created through the real API and
 * cleaned up afterwards. The permission-gate tests flip the dev member's role
 * to 'field' directly in the DB and restore it — field has manageCustomers
 * off by default.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, createHmac, randomBytes } from "crypto";
import pg from "pg";
import type { TimelineEntry } from "./notes-timeline";

// notes-timeline.ts pulls in tenancy → ../stripe, which throws without a key
// at module scope. A dummy value is enough for import (no queries run here).
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
// Poison the app pool so an imported module can never touch a real DB from a
// unit test; the test's OWN pool below reads CRM_TEST_DATABASE_URL (lane-safe)
// or falls back to the shared dev DB.
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

// Dynamic imports: they must land AFTER the env shims above.
const { canModifyNote, mergeTimeline, formatDurationSecs } = await import("./notes-timeline");
const { mintPortalPreviewGrant, verifyPortalPreviewGrant } = await import("./client-auth");
const { crmNotificationEnabled } = await import("@shared/schema");

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.CRM_TEST_DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

const post = (path: string, data: unknown, cookie?: string) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }, cookie);

/** Insert a client session row as a redeemed magic link would; returns the RAW cookie token. */
async function makeClientSession(customerIds: string[]): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify(customerIds)],
  );
  return raw;
}

describe("client 360 (dev server)", () => {
  let cookie: string | undefined;
  let orgId: string;
  let memberId: string;
  let custA: string;
  let custB: string;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    orgId = me.body.org.id;
    memberId = me.body.member.id;

    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const mk = async (name: string) => {
      const r = await post("/api/crm/customers", {
        displayName: name,
        email: `vitest.c360.${stamp}.${name.endsWith("B") ? "b" : "a"}@example.com`,
      }, cookie);
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    custA = await mk("Vitest C360 A");
    custB = await mk("Vitest C360 B");
  });

  afterAll(async () => {
    await q(`delete from crm_customer_notes where customer_id = any($1)`, [[custA, custB]]);
    await q(`delete from crm_finance_clicks where customer_id = any($1)`, [[custA, custB]]);
    await q(`delete from crm_client_comments where customer_id = any($1)`, [[custA, custB]]);
    await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%' or customer_ids::text like '%' || $2 || '%'`, [custA, custB]);
    await q(`delete from crm_engagement_sessions where org_id = $1 and doc_id in (select id from crm_estimates where customer_id = any($2))`, [orgId, [custA, custB]]);
    await q(`delete from crm_estimate_events where estimate_id in (select id from crm_estimates where customer_id = any($1))`, [[custA, custB]]);
    await q(`delete from crm_estimate_items where estimate_id in (select id from crm_estimates where customer_id = any($1))`, [[custA, custB]]);
    await q(`delete from crm_estimates where customer_id = any($1)`, [[custA, custB]]);
    await q(`update crm_members set role = 'owner' where id = $1`, [memberId]);
    // Defensive: the gate probe flips the Aspire membership and restores it.
    await q(`update crm_members set role = 'owner' where org_id = 'b839980a-ad26-44d4-9e83-df427bd60fe8' and user_id = 1`, []);
    await q(`update crm_orgs set custom_fields = null where id = $1`, [orgId]);
    await q(`delete from crm_customers where id = any($1)`, [[custA, custB]]);
    await pool.end();
  });

  // ── Notes ────────────────────────────────────────────────────────────────

  it("canModifyNote: own note, owner/admin any, never someone else's", () => {
    const own = { authorMemberId: "m1" };
    const orphan = { authorMemberId: null };
    expect(canModifyNote(own, { id: "m1", role: "office" })).toBe(true);
    expect(canModifyNote(own, { id: "m2", role: "office" })).toBe(false);
    expect(canModifyNote(own, { id: "m2", role: "owner" })).toBe(true);
    expect(canModifyNote(own, { id: "m2", role: "admin" })).toBe(true);
    expect(canModifyNote(orphan, { id: "m1", role: "pm" })).toBe(false);
    expect(canModifyNote(orphan, { id: "m1", role: "admin" })).toBe(true);
  });

  it("notes CRUD: create → newest-first with author → edit own → delete own", async () => {
    const n1 = await post(`/api/crm/customers/${custA}/notes`, { body: "First note — gate code 4482" }, cookie);
    expect(n1.status).toBe(201);
    expect(n1.body.authorMemberId).toBe(memberId);

    const n2 = await post(`/api/crm/customers/${custA}/notes`, { body: "Second note — prefers texts" }, cookie);
    expect(n2.status).toBe(201);

    const list = await api(`/api/crm/customers/${custA}/notes`, {}, cookie);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    // Newest first.
    expect(list.body[0].id).toBe(n2.body.id);
    expect(list.body[1].id).toBe(n1.body.id);
    expect(list.body[1].authorName).toBeTruthy();

    // Notes are scoped to their customer.
    const other = await api(`/api/crm/customers/${custB}/notes`, {}, cookie);
    expect(other.status).toBe(200);
    expect(other.body.length).toBe(0);

    const patch = await api(`/api/crm/customers/${custA}/notes/${n1.body.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "First note — gate code 9917" }),
    }, cookie);
    expect(patch.status).toBe(200);
    expect(patch.body.body).toContain("9917");

    // …but not under a different customer id.
    const wrongParent = await api(`/api/crm/customers/${custB}/notes/${n1.body.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "intrusion" }),
    }, cookie);
    expect(wrongParent.status).toBe(404);

    const del = await api(`/api/crm/customers/${custA}/notes/${n2.body.id}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(200);
    const after = await api(`/api/crm/customers/${custA}/notes`, {}, cookie);
    expect(after.body.length).toBe(1);
  });

  it("notes gates: manageCustomers is required to write (field role → 403), reads stay open", async () => {
    // Flipping the dev member's role in the DEFAULT org would race the other
    // vitest files running in parallel (they share the server), so the gate
    // probe runs in the ASPIRE org — nothing else in the suite touches it.
    const ASPIRE = "b839980a-ad26-44d4-9e83-df427bd60fe8";
    const sw = await post("/api/crm/org/switch", { orgId: ASPIRE }, cookie);
    expect(sw.status).toBe(200);
    const ac = sw.cookie;

    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const cust = await post("/api/crm/customers", {
      displayName: `Vitest C360 Gate ${stamp}`,
      email: `vitest.c360.gate.${stamp}@example.com`,
    }, ac);
    expect(cust.status).toBe(201);
    const gateCust = cust.body.id as string;
    const [{ id: aspireMemberId }] = await q<{ id: string }>(
      `select id from crm_members where org_id = $1 and user_id = 1`, [ASPIRE]);

    // Seed a note as owner so edit/delete gates have a target.
    const seeded = await post(`/api/crm/customers/${gateCust}/notes`, { body: "gate target" }, ac);
    expect(seeded.status).toBe(201);

    await q(`update crm_members set role = 'field' where id = $1`, [aspireMemberId]);
    try {
      const write = await post(`/api/crm/customers/${gateCust}/notes`, { body: "nope" }, ac);
      expect(write.status).toBe(403);

      const edit = await api(`/api/crm/customers/${gateCust}/notes/${seeded.body.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "nope" }),
      }, ac);
      expect(edit.status).toBe(403);

      const del = await api(`/api/crm/customers/${gateCust}/notes/${seeded.body.id}`, { method: "DELETE" }, ac);
      expect(del.status).toBe(403);

      const read = await api(`/api/crm/customers/${gateCust}/notes`, {}, ac);
      expect(read.status).toBe(200);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [aspireMemberId]);
      await q(`delete from crm_customer_notes where customer_id = $1`, [gateCust]);
      await q(`delete from crm_customers where id = $1`, [gateCust]);
    }
  });

  // ── Timeline ─────────────────────────────────────────────────────────────

  it("mergeTimeline sorts newest-first with deterministic ties; formatDurationSecs reads like 4m 12s", () => {
    const mk = (id: string, at: string): TimelineEntry => ({
      id, kind: "estimate_event", verb: "sent", text: id, ref: null, at,
    });
    const shuffled = [
      mk("b", "2026-07-01T10:00:00Z"),
      mk("a", "2026-07-01T10:00:00Z"), // same instant as b — id breaks the tie
      mk("c", "2026-07-03T10:00:00Z"),
      mk("d", "2026-07-02T10:00:00Z"),
    ];
    expect(mergeTimeline(shuffled).map((e) => e.id)).toEqual(["c", "d", "a", "b"]);

    expect(formatDurationSecs(45)).toBe("45s");
    expect(formatDurationSecs(252)).toBe("4m 12s");
    expect(formatDurationSecs(600)).toBe("10m");
  });

  it("timeline merges estimate events, engagement stays, comments and finance clicks — newest first", async () => {
    // A sent estimate generates the 'sent' event through the real flow.
    const est = await post("/api/crm/estimates", {
      customerId: custA,
      title: "Vitest C360 estimate",
      items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 500, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
    }, cookie);
    expect(est.status).toBe(201);
    const sent = await post(`/api/crm/estimates/${est.body.id}/send`, {}, cookie);
    expect(sent.status).toBe(200);
    const estRows = await q<{ number: string }>(`select number from crm_estimates where id = $1`, [est.body.id]);
    const estNumber = estRows[0].number;

    // A dwell session, as the heartbeat flow would have written.
    await q(
      `insert into crm_engagement_sessions (org_id, doc_type, doc_id, started_at, last_ping_at, duration_secs)
       values ($1, 'estimate', $2, now() - interval '2 minutes', now() - interval '1 minute', 252)`,
      [orgId, est.body.id],
    );

    const raw = await makeClientSession([custA]);
    const cc = `crm_client=${raw}`;
    const comment = await post("/api/client/comments", { customerId: custA, body: "Can we start Monday?" }, cc);
    expect(comment.status).toBe(201);

    // Financing link configured on the org, then clicked from the portal.
    await q(
      `update crm_orgs set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{financingLinks}', $1::jsonb) where id = $2`,
      [JSON.stringify([{ label: "Acme Finance", url: "https://lender.example.test/apply", primary: true }]), orgId],
    );
    const click = await post("/api/client/financing-click", { label: "Acme Finance", url: "https://lender.example.test/apply" }, cc);
    expect(click.status).toBe(201);

    const tl = await api(`/api/crm/customers/${custA}/timeline`, {}, cookie);
    expect(tl.status).toBe(200);
    const entries = tl.body as any[];
    const texts = entries.map((e) => e.text);

    expect(texts.some((t: string) => t === `Estimate ${estNumber} sent to the client`)).toBe(true);
    expect(texts.some((t: string) => t === `Client opened estimate ${estNumber} · stayed 4m 12s`)).toBe(true);
    expect(texts.some((t: string) => t.includes("Sent a message from the portal"))).toBe(true);
    expect(texts.some((t: string) => t === "Applied for financing via Acme Finance")).toBe(true);

    // Newest-first across every source.
    const ats = entries.map((e) => new Date(e.at).getTime());
    expect(ats.every((v, i) => i === 0 || ats[i - 1] >= v)).toBe(true);
    // …and the engagement row we seeded is present with its duration.
    const eng = entries.find((e) => e.kind === "engagement");
    expect(eng.durationSecs).toBe(252);
  });

  // ── Financing clicks ─────────────────────────────────────────────────────

  it("finance-click: recorded only for links the org offers; gated by the financeClick pref", async () => {
    const raw = await makeClientSession([custB]);
    const cc = `crm_client=${raw}`;

    // The org offers nothing yet — a click against an unknown link is a 400.
    const bogus = await post("/api/client/financing-click", { label: "Nope", url: "https://nope.example.test/" }, cc);
    expect(bogus.status).toBe(400);

    await q(
      `update crm_orgs set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{financingLinks}', $1::jsonb) where id = $2`,
      [JSON.stringify([{ label: "Acme Finance", url: "https://lender.example.test/apply", primary: true }]), orgId],
    );

    // …and it rides the documents payload (primary flagged).
    const docs = await api("/api/client/documents", {}, cc);
    expect(docs.status).toBe(200);
    expect(docs.body.financing).toEqual([
      { label: "Acme Finance", url: "https://lender.example.test/apply", primary: true },
    ]);

    const ok = await post("/api/client/financing-click", { label: "Acme Finance", url: "https://lender.example.test/apply" }, cc);
    expect(ok.status).toBe(201);
    const rows = await q<{ label: string; customer_id: string }>(
      `select label, customer_id from crm_finance_clicks where customer_id = $1`, [custB]);
    expect(rows.length).toBe(1);
    expect(rows[0].label).toBe("Acme Finance");

    // No session → 401.
    const anon = await post("/api/client/financing-click", { label: "Acme Finance", url: "https://lender.example.test/apply" });
    expect(anon.status).toBe(401);

    // The pref: default ON, explicitly silenced → off. (The click is recorded
    // either way; the pref only gates the owner email.)
    expect(crmNotificationEnabled(null, "financeClick")).toBe(true);
    expect(crmNotificationEnabled({ notificationPrefs: { financeClick: false } }, "financeClick")).toBe(false);
  });

  // ── Contractor portal preview ────────────────────────────────────────────

  it("preview grant: mint/verify round-trip, expiry and tampering refused", () => {
    const secret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "vitest-portal-preview-secret";
    try {
      const grant = mintPortalPreviewGrant(custA);
      expect(verifyPortalPreviewGrant(grant)).toBe(custA);

      // Tampered signature.
      expect(verifyPortalPreviewGrant(`${grant.slice(0, -2)}ff`)).toBeNull();
      // Re-bound to another customer.
      expect(verifyPortalPreviewGrant(grant.replace(custA, custB))).toBeNull();
      // Expired: sign a grant whose exp is in the past.
      const pastExp = Date.now() - 1000;
      const sig = createHmac("sha256", "vitest-portal-preview-secret")
        .update(`portal-preview:${custA}:${pastExp}`).digest("hex").slice(0, 32);
      expect(verifyPortalPreviewGrant(`${custA}.${pastExp}.${sig}`)).toBeNull();
      // No secret configured → never valid.
      process.env.SESSION_SECRET = "";
      expect(verifyPortalPreviewGrant(grant)).toBeNull();
    } finally {
      if (secret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = secret;
    }
  });

  it("portal preview: grant → read-only session, writes refuse, engagement untouched, 15-min cookie", async () => {
    const mint = await post(`/api/crm/customers/${custA}/portal-preview`, {}, cookie);
    expect(mint.status).toBe(200);
    expect(mint.body.url).toContain("/api/client/auth/preview?grant=");
    const grant = new URL(mint.body.url).searchParams.get("grant")!;

    // Redeem: 302 + a prev. cookie with a 15-minute Max-Age.
    const res = await fetch(`${BASE}/api/client/auth/preview?grant=${encodeURIComponent(grant)}&client=1`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?client=1");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("crm_client=prev.");
    expect(setCookie).toContain(`Max-Age=${15 * 60}`);
    const previewCookie = setCookie.split(";")[0];

    // The portal opens as the customer, flagged as a contractor preview.
    const docs = await api("/api/client/documents", {}, previewCookie);
    expect(docs.status).toBe(200);
    expect(docs.body.contractorPreview).toBe(true);
    expect(docs.body.accounts.some((a: any) => a.id === custA)).toBe(true);

    // Reads work; every write refuses with the read-only message.
    const comment = await post("/api/client/comments", { customerId: custA, body: "preview must not write" }, previewCookie);
    expect(comment.status).toBe(403);
    expect(comment.body.contractorPreview).toBe(true);

    await q(
      `update crm_orgs set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{financingLinks}', $1::jsonb) where id = $2`,
      [JSON.stringify([{ label: "Acme Finance", url: "https://lender.example.test/apply", primary: true }]), orgId],
    );
    const clicksBefore = (await q(`select id from crm_finance_clicks where customer_id = $1`, [custA])).length;
    const click = await post("/api/client/financing-click", { label: "Acme Finance", url: "https://lender.example.test/apply" }, previewCookie);
    expect(click.status).toBe(403);

    const fd = new FormData();
    fd.append("customerId", custA);
    fd.append("file", new Blob([Buffer.from("png")], { type: "image/png" }), "p.png");
    const photo = await fetch(`${BASE}/api/client/photos`, { method: "POST", headers: { cookie: previewCookie }, body: fd });
    expect(photo.status).toBe(403);

    // Nothing was written.
    expect((await q(`select id from crm_client_comments where customer_id = $1 and body = 'preview must not write'`, [custA])).length).toBe(0);
    expect((await q(`select id from crm_finance_clicks where customer_id = $1`, [custA])).length).toBe(clicksBefore);

    // A preview session is NOT a client session: engagement start no-ops…
    const est = await post("/api/crm/estimates", {
      customerId: custA,
      title: "Vitest C360 preview estimate",
      items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 500, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
    }, cookie);
    const sent = await post(`/api/crm/estimates/${est.body.id}/send`, {}, cookie);
    expect(sent.status).toBe(200);
    const tok = (await q<{ public_token: string }>(`select public_token from crm_estimates where id = $1`, [est.body.id]))[0].public_token;
    const eng = await post("/api/public/engagement/start", { docType: "estimate", token: tok }, previewCookie);
    expect(eng.status).toBe(200);
    expect(eng.body.sessionId).toBeNull();
    // …and the document email-gate does not open for it either.
    const doc = await api(`/api/public/estimates/${tok}`, {}, previewCookie);
    expect(doc.status).toBe(401);

    // A bogus grant redeems to the portal root with NO cookie.
    const bad = await fetch(`${BASE}/api/client/auth/preview?grant=bogus&client=1`, { redirect: "manual" });
    expect(bad.status).toBe(302);
    expect(bad.headers.get("set-cookie") ?? "").not.toContain("crm_client=prev.");
  });
});
