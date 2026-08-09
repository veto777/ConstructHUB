/**
 * Per-channel notification matrix at the emit sites — the fix for "the whole
 * notification was gated on the EMAIL channel". For each site:
 *   {inApp:true, email:false, sms:false} → a bell row and NO email
 *   {inApp:false, email:true}            → an email and NO bell row
 *   legacy boolean false                 → nothing at all
 * Plus the actor-exclusion and division fan-out rules:
 *   - a member who records a manual payment is not bell'd/mailed about it,
 *     while the other owner(s) still are (ops.ts notifyPaymentRecorded);
 *   - estimateSent bells the other owner(s), never the actor (owner-notify);
 *   - client-comment bell fan-out skips admins pinned to another division,
 *     matching the email fan-out (attachments.ts notifyClientComment).
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL; the DB with DATABASE_URL.
 *
 * Same honest assertion path as owner-notifications.test.ts: sends sink to
 * tmp/email-outbox.jsonl, bell rows are real crm_notifications rows, every
 * fixture carries a per-run marker, and org notificationPrefs are snapshotted
 * and restored in a finally/afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import { fileURLToPath } from "url";
import pg from "pg";
import { CRM_NOTIFICATION_PREFS } from "@shared/schema";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

const OUTBOX =
  process.env.CRM_TEST_OUTBOX ??
  fileURLToPath(new URL("../../tmp/email-outbox.jsonl", import.meta.url));

type OutboxMail = { at: string; to: string[]; subject: string | null; html: string | null };

function outbox(): OutboxMail[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readFileSync(OUTBOX, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as OutboxMail;
      } catch {
        return null;
      }
    })
    .filter((m): m is OutboxMail => m !== null);
}

/** Mails whose subject mentions BOTH markers (event wording + fixture name). */
function mailsMatching(subjectPart: string, marker: string, since?: string): OutboxMail[] {
  return outbox().filter(
    (m) =>
      (!since || m.at >= since) &&
      (m.subject ?? "").includes(subjectPart) &&
      (m.subject ?? "").includes(marker),
  );
}

async function waitForMail(subjectPart: string, marker: string, since?: string, timeoutMs = 9000): Promise<OutboxMail[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = mailsMatching(subjectPart, marker, since);
    if (found.length) return found;
    if (Date.now() > deadline) return [];
    await new Promise((r) => setTimeout(r, 150));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rcpts = (m: OutboxMail) => (m.to ?? []).join(",");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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

/** Insert a client session row as a redeemed magic link would; returns the cookie. */
async function clientCookie(customerId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify([customerId])],
  );
  return `crm_client=${raw}`;
}

describe("notification channel matrix (dev server)", () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const owner2Email = `vitest.nc.owner2.${stamp}@example.com`;

  let cookie: string | undefined;
  let orgId: string;
  let devMemberId: string;
  let devMemberEmail: string | null;
  let orgEmail: string | null;
  let owner2Id: string;
  let priorPrefs: Record<string, unknown> | undefined;

  const customerIds: string[] = [];
  const estimateIds: string[] = [];
  const invoiceIds: string[] = [];
  const projectIds: string[] = [];
  const divisionIds: string[] = [];
  const memberIds: string[] = [];

  type PrefValue = boolean | { inApp?: boolean; email?: boolean; sms?: boolean };

  async function setPref(key: string, value: PrefValue) {
    const r = await api(
      "/api/crm/org",
      { method: "PATCH", body: JSON.stringify({ notificationPrefs: { [key]: value } }) },
      cookie,
    );
    expect(r.status).toBe(200);
  }

  const restorePref = (key: string) => setPref(key, (priorPrefs?.[key] as PrefValue) ?? true);

  /** Bell rows whose title mentions the marker, with the recipient member. */
  const bellRows = (marker: string) =>
    q<{ member_id: string; type: string; title: string }>(
      `select member_id, type, title from crm_notifications where org_id = $1 and title like $2`,
      [orgId, `%${marker}%`],
    );

  /**
   * Poll until a bell row matches BOTH the per-run marker and (optionally) a
   * title fragment. The marker must be specific — other suites leave their
   * own crm_notifications rows behind, so a generic title like "opened
   * estimate" would satisfy the poll instantly with stale rows.
   */
  async function waitForBell(marker: string, titlePart?: string, timeoutMs = 9000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let rows = await bellRows(marker);
      if (titlePart) rows = rows.filter((r) => r.title.includes(titlePart));
      if (rows.length) return rows;
      if (Date.now() > deadline) return [];
      await sleep(200);
    }
  }

  async function makeCustomer(label: string) {
    const r = await api(
      "/api/crm/customers",
      { method: "POST", body: JSON.stringify({ displayName: `Vitest NC ${stamp} ${label}`, email: `vitest.nc.${stamp}.${label}@example.com` }) },
      cookie,
    );
    expect(r.status).toBe(201);
    customerIds.push(r.body.id);
    return { id: r.body.id as string, name: `Vitest NC ${stamp} ${label}` };
  }

  async function makeSentEstimate(custId: string) {
    const est = await api(
      "/api/crm/estimates",
      {
        method: "POST",
        body: JSON.stringify({
          customerId: custId,
          title: "Vitest NC estimate",
          items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 42000, taxable: false, hiddenFromClient: false, sortOrder: 0 }],
        }),
      },
      cookie,
    );
    expect(est.status).toBe(201);
    estimateIds.push(est.body.id);
    const send = await api(`/api/crm/estimates/${est.body.id}/send`, { method: "POST", body: "{}" }, cookie);
    expect(send.status).toBe(200);
    const token = String(send.body.link).split("/e/")[1].split("?")[0];
    return { id: est.body.id as string, token };
  }

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    orgId = me.body.org.id;
    devMemberId = me.body.member.id;
    orgEmail = me.body.org.email ?? null;
    priorPrefs = (me.body.org.customFields as any)?.notificationPrefs ?? undefined;

    const [dm] = await q<{ email: string | null }>(`select email from crm_members where id = $1`, [devMemberId]);
    devMemberEmail = dm?.email ?? null;

    // A second owner seat: the dev user is the actor in the exclusion tests,
    // so without this seat nobody would be left to notify.
    const [o2] = await q<{ id: string }>(
      `insert into crm_members (org_id, email, role, status, display_name)
       values ($1, $2, 'owner', 'active', $3) returning id`,
      [orgId, owner2Email, `Vitest NC Owner Two ${stamp}`],
    );
    owner2Id = o2.id;
    memberIds.push(owner2Id);
  });

  afterAll(async () => {
    try {
      if (cookie) {
        await api(
          "/api/crm/org",
          {
            method: "PATCH",
            body: JSON.stringify({
              notificationPrefs: Object.fromEntries(
                CRM_NOTIFICATION_PREFS.map((p) => [p, (priorPrefs?.[p] as PrefValue) ?? true]),
              ),
            }),
          },
          cookie,
        );
      }
      await q(`delete from crm_notifications where org_id = $1 and title like $2`, [orgId, `%${stamp}%`]);
      await q(`delete from crm_client_comments where customer_id = any($1)`, [customerIds]);
      await q(`delete from crm_payments where invoice_id = any($1)`, [invoiceIds]);
      await q(`delete from crm_invoice_items where invoice_id = any($1)`, [invoiceIds]);
      await q(`delete from crm_invoices where id = any($1)`, [invoiceIds]);
      await q(`delete from crm_estimate_events where estimate_id = any($1)`, [estimateIds]);
      await q(`delete from crm_estimate_items where estimate_id = any($1)`, [estimateIds]);
      await q(`delete from crm_estimates where id = any($1)`, [estimateIds]);
      for (const cid of customerIds) {
        await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%'`, [cid]);
      }
      await q(`delete from crm_projects where id = any($1)`, [projectIds]);
      await q(`delete from crm_divisions where id = any($1)`, [divisionIds]);
      await q(`delete from crm_members where id = any($1)`, [memberIds]);
      await q(`delete from crm_customers where id = any($1)`, [customerIds]);
      // Website leads come back as { ok: true } — no id — so they go by name.
      await q(`delete from crm_customers where display_name like $1`, [`Vitest NC ${stamp} Lead %`]);
    } finally {
      await pool.end();
    }
  });

  // ── portal.ts notifyOwner (estimateViewed) ────────────────────────────────

  it("estimateViewed {inApp:true,email:false}: bell row, no email", async () => {
    await setPref("estimateViewed", { inApp: true, email: false, sms: false });
    try {
      const cust = await makeCustomer("view-inapp");
      const est = await makeSentEstimate(cust.id);
      const since = new Date().toISOString();
      const open = await api(`/api/public/estimates/${est.token}`, {}, await clientCookie(cust.id));
      expect(open.status).toBe(200);

      const mine = await waitForBell(cust.name, "opened estimate");
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.some((r) => r.member_id === devMemberId)).toBe(true);

      await sleep(1500);
      expect(mailsMatching("opened estimate", cust.name, since).length).toBe(0);
    } finally {
      await restorePref("estimateViewed");
    }
  });

  it("estimateViewed {inApp:false,email:true}: email, no bell row", async () => {
    await setPref("estimateViewed", { inApp: false, email: true });
    try {
      const cust = await makeCustomer("view-email");
      const est = await makeSentEstimate(cust.id);
      const since = new Date().toISOString();
      const open = await api(`/api/public/estimates/${est.token}`, {}, await clientCookie(cust.id));
      expect(open.status).toBe(200);

      const mails = await waitForMail("opened estimate", cust.name, since);
      expect(mails.length).toBeGreaterThanOrEqual(1);

      await sleep(1200);
      const rows = (await bellRows(cust.name)).filter((r) => r.title.includes("opened estimate"));
      expect(rows.length).toBe(0);
    } finally {
      await restorePref("estimateViewed");
    }
  });

  it("estimateViewed legacy false: no bell row, no email", async () => {
    await setPref("estimateViewed", false);
    try {
      const cust = await makeCustomer("view-off");
      const est = await makeSentEstimate(cust.id);
      const since = new Date().toISOString();
      const open = await api(`/api/public/estimates/${est.token}`, {}, await clientCookie(cust.id));
      expect(open.status).toBe(200);

      await sleep(1500);
      const rows = (await bellRows(cust.name)).filter((r) => r.title.includes("opened estimate"));
      expect(rows.length).toBe(0);
      expect(mailsMatching("opened estimate", cust.name, since).length).toBe(0);
    } finally {
      await restorePref("estimateViewed");
    }
  });

  // ── ops.ts notifyPaymentRecorded (paymentReceived) ───────────────────────

  async function makeInvoiceWithPayment(custId: string) {
    const inv = await api(
      "/api/crm/invoices",
      {
        method: "POST",
        body: JSON.stringify({
          customerId: custId,
          title: "Vitest NC invoice",
          items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 123400 }],
        }),
      },
      cookie,
    );
    expect(inv.status).toBe(201);
    invoiceIds.push(inv.body.id);
    const pay = await api(
      `/api/crm/invoices/${inv.body.id}/payments`,
      { method: "POST", body: JSON.stringify({ amountCents: 50000, method: "cash" }) },
      cookie,
    );
    expect(pay.status).toBe(201);
  }

  it("paymentReceived: the recording member gets no bell row and no email; the other owner gets both", async () => {
    await setPref("paymentReceived", true);
    try {
      const cust = await makeCustomer("pay-actor");
      const since = new Date().toISOString();
      await makeInvoiceWithPayment(cust.id);

      const rows = await waitForBell(cust.name);
      expect(rows.some((r) => r.member_id === owner2Id)).toBe(true);
      // The actor (dev member) recorded the payment — no bell about themselves.
      expect(rows.some((r) => r.member_id === devMemberId)).toBe(false);

      const mails = await waitForMail("Payment received", cust.name, since);
      expect(mails.length).toBeGreaterThanOrEqual(1);
      expect(rcpts(mails[0])).toContain(owner2Email);
      // …and the actor is out of the email recipient set too (unless the
      // org's own mailbox happens to be the actor's address).
      if (devMemberEmail && devMemberEmail.toLowerCase() !== (orgEmail ?? "").toLowerCase()) {
        expect(rcpts(mails[0])).not.toContain(devMemberEmail);
      }
    } finally {
      await restorePref("paymentReceived");
    }
  });

  it("paymentReceived {inApp:false,email:true}: email, no bell row", async () => {
    await setPref("paymentReceived", { inApp: false, email: true });
    try {
      const cust = await makeCustomer("pay-email");
      const since = new Date().toISOString();
      await makeInvoiceWithPayment(cust.id);

      const mails = await waitForMail("Payment received", cust.name, since);
      expect(mails.length).toBeGreaterThanOrEqual(1);

      await sleep(1200);
      expect((await bellRows(cust.name)).length).toBe(0);
    } finally {
      await restorePref("paymentReceived");
    }
  });

  it("paymentReceived legacy false: no bell row, no email", async () => {
    await setPref("paymentReceived", false);
    try {
      const cust = await makeCustomer("pay-off");
      const since = new Date().toISOString();
      await makeInvoiceWithPayment(cust.id);

      await sleep(1500);
      expect((await bellRows(cust.name)).length).toBe(0);
      expect(mailsMatching("Payment received", cust.name, since).length).toBe(0);
    } finally {
      await restorePref("paymentReceived");
    }
  });

  // ── owner-notify.ts notifyOrgOwners (estimateSent) ────────────────────────

  it("estimateSent {inApp:true,email:false}: the other owner gets a bell row, the actor does not, no email", async () => {
    await setPref("estimateSent", { inApp: true, email: false, sms: false });
    try {
      const cust = await makeCustomer("sent-inapp");
      const since = new Date().toISOString();
      await makeSentEstimate(cust.id);

      const rows = await waitForBell(cust.name, "Bid sent");
      expect(rows.some((r) => r.member_id === owner2Id)).toBe(true);
      // The actor sent the bid — no bell about themselves.
      expect(rows.some((r) => r.member_id === devMemberId)).toBe(false);

      await sleep(1500);
      expect(mailsMatching("Bid sent", cust.name, since).length).toBe(0);
    } finally {
      await restorePref("estimateSent");
    }
  });

  it("estimateSent legacy false: no bell row, no email", async () => {
    await setPref("estimateSent", false);
    try {
      const cust = await makeCustomer("sent-off");
      const since = new Date().toISOString();
      await makeSentEstimate(cust.id);

      await sleep(1500);
      const rows = (await bellRows(cust.name)).filter((r) => r.title.includes("Bid sent"));
      expect(rows.length).toBe(0);
      expect(mailsMatching("Bid sent", cust.name, since).length).toBe(0);
    } finally {
      await restorePref("estimateSent");
    }
  });

  // ── lead-capture.ts notifyLeadReceived (leadReceived) ─────────────────────

  it("leadReceived {inApp:true,email:false}: bell row, no email; legacy false: nothing", async () => {
    const tokenRes = await api("/api/crm/integrations/lead-capture", {}, cookie);
    expect(tokenRes.status).toBe(200);
    const token = tokenRes.body.token as string;
    const ip = `10.251.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

    await setPref("leadReceived", { inApp: true, email: false, sms: false });
    try {
      const name = `Vitest NC ${stamp} Lead A`;
      const since = new Date().toISOString();
      const lead = await api(`/api/public/leads/${token}`, {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: JSON.stringify({ name, message: "roof leak" }),
      });
      expect(lead.status).toBe(201);

      const rows = await waitForBell(`New website lead — ${name}`);
      expect(rows.length).toBeGreaterThanOrEqual(1);

      await sleep(1500);
      expect(mailsMatching("New website lead", name, since).length).toBe(0);
    } finally {
      await restorePref("leadReceived");
    }

    await setPref("leadReceived", false);
    try {
      const name = `Vitest NC ${stamp} Lead B`;
      const since = new Date().toISOString();
      const lead = await api(`/api/public/leads/${token}`, {
        method: "POST",
        headers: { "x-forwarded-for": ip.replace(/\d+$/, "99") },
        body: JSON.stringify({ name, message: "siding" }),
      });
      expect(lead.status).toBe(201);

      await sleep(1500);
      expect((await bellRows(`New website lead — ${name}`)).length).toBe(0);
      expect(mailsMatching("New website lead", name, since).length).toBe(0);
    } finally {
      await restorePref("leadReceived");
    }
  });

  // ── attachments.ts notifyClientComment (division fan-out) ────────────────

  it("clientComments: admins pinned to another division get no bell row; same-division admins do", async () => {
    const [div1] = await q<{ id: string }>(
      `insert into crm_divisions (org_id, name, code) values ($1, $2, $3) returning id`,
      [orgId, `Vitest NC Div One ${stamp}`, `NC1${stamp.slice(0, 4)}`],
    );
    const [div2] = await q<{ id: string }>(
      `insert into crm_divisions (org_id, name, code) values ($1, $2, $3) returning id`,
      [orgId, `Vitest NC Div Two ${stamp}`, `NC2${stamp.slice(0, 4)}`],
    );
    divisionIds.push(div1.id, div2.id);

    const [admin1] = await q<{ id: string }>(
      `insert into crm_members (org_id, email, role, status, display_name, division_id)
       values ($1, $2, 'admin', 'active', $3, $4) returning id`,
      [orgId, `vitest.nc.admin1.${stamp}@example.com`, `Vitest NC Admin One ${stamp}`, div1.id],
    );
    const [admin2] = await q<{ id: string }>(
      `insert into crm_members (org_id, email, role, status, display_name, division_id)
       values ($1, $2, 'admin', 'active', $3, $4) returning id`,
      [orgId, `vitest.nc.admin2.${stamp}@example.com`, `Vitest NC Admin Two ${stamp}`, div2.id],
    );
    memberIds.push(admin1.id, admin2.id);

    const cust = await makeCustomer("comment-div");
    const [proj] = await q<{ id: string }>(
      `insert into crm_projects (org_id, customer_id, name, division_id)
       values ($1, $2, $3, $4) returning id`,
      [orgId, cust.id, `Vitest NC Project ${stamp}`, div1.id],
    );
    projectIds.push(proj.id);

    const post = await api(
      "/api/client/comments",
      { method: "POST", body: JSON.stringify({ customerId: cust.id, body: "Is Tuesday still good?" }) },
      await clientCookie(cust.id),
    );
    expect(post.status).toBe(201);

    const rows = await waitForBell(`${cust.name} sent a message`);
    expect(rows.some((r) => r.member_id === admin1.id)).toBe(true);
    expect(rows.some((r) => r.member_id === admin2.id)).toBe(false);
  });
});
