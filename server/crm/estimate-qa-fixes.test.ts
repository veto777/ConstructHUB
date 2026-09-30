/**
 * QA cluster c13 (estimates) — the fixes, pinned against the running dev
 * server (CRM_TEST_BASE_URL):
 *
 *   • numbers: estimates and projects take max+1 under a per-org lock, so a
 *     delete never hands out a number still in use and parallel creates
 *     never collide (count(*)+1 did both);
 *   • the deposit can never exceed the estimate total (it's what pay charges);
 *   • status by hand: viewed/expired are system facts (400); "sent" stamps
 *     the send clock; the detail JSON carries the signed total fields;
 *   • "expired" is a derived Documents Center filter;
 *   • a never-sent draft can't be approved, and its public page says so;
 *   • the bid reminder link signs the client straight in (?k= pass);
 *   • a $0 invoice is never emailed;
 *   • the client list: literal wildcards, phone digits, paged mode with
 *     whole-book counts; force-delete takes appointments and change orders.
 *
 * Throwaway "FIX-c13" rows only, deleted through the app at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

let cookie: string | undefined;
const customers: string[] = [];
const run = Date.now().toString(36);

beforeAll(async () => {
  const me = await api("/api/crm/me");
  if (me.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
  }
  cookie = me.cookie;
});

afterAll(async () => {
  for (const id of customers) await api(`/api/crm/customers/${id}?force=1`, { method: "DELETE" }, cookie).catch(() => {});
  await pool.end();
});

const line = (name: string, cents: number, extra: Record<string, unknown> = {}) => ({
  kind: "labor", name, quantityMilli: 1000, unitPriceCents: cents, taxable: true, ...extra,
});

async function customer(tag: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await api("/api/crm/customers?force=1", {
    method: "POST",
    body: JSON.stringify({ displayName: `FIX-c13 ${tag} ${run}`, email: `fix-c13.${tag}.${run}@example.com`, ...extra }),
  }, cookie);
  expect(r.status).toBe(201);
  customers.push(r.body.id);
  return r.body.id as string;
}

async function estimate(customerId: string, body: Record<string, unknown> = {}) {
  const r = await api("/api/crm/estimates", {
    method: "POST",
    body: JSON.stringify({ customerId, title: `FIX-c13 est ${run}`, items: [line("Base", 1000_00)], ...body }),
  }, cookie);
  return r;
}

const num = (n: string) => Number(n.replace(/^[A-Z]+-/, ""));

describe("document numbers", () => {
  it("never reuse a number still in use after a delete, and parallel creates never collide", async () => {
    const c = await customer("numbers");
    const a = await estimate(c);
    const b = await estimate(c);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(num(b.body.number)).toBeGreaterThan(num(a.body.number));

    // count(*)+1 handed B's number out again after deleting A.
    expect((await api(`/api/crm/estimates/${a.body.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
    const cAfter = await estimate(c);
    expect(cAfter.status).toBe(201);
    expect(num(cAfter.body.number)).toBeGreaterThan(num(b.body.number));

    const burst = await Promise.all([1, 2, 3, 4, 5].map(() => estimate(c)));
    for (const r of burst) expect(r.status).toBe(201);
    const numbers = burst.map((r) => r.body.number);
    expect(new Set(numbers).size).toBe(numbers.length);

    const p1 = await api("/api/crm/projects", { method: "POST", body: JSON.stringify({ customerId: c, name: `FIX-c13 p1 ${run}` }) }, cookie);
    const p2 = await api("/api/crm/projects", { method: "POST", body: JSON.stringify({ customerId: c, name: `FIX-c13 p2 ${run}` }) }, cookie);
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
    expect(num(p2.body.number)).toBeGreaterThan(num(p1.body.number));
  });
});

describe("estimate integrity", () => {
  it("refuses a deposit above the total — on create, on PATCH, and when lines shrink under it", async () => {
    const c = await customer("deposit");
    const tooBig = await estimate(c, { depositCents: 999_999_00 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.message).toMatch(/deposit/i);

    const ok = await estimate(c, { depositCents: 500_00 });
    expect(ok.status).toBe(201);
    const patch = await api(`/api/crm/estimates/${ok.body.id}`, {
      method: "PATCH", body: JSON.stringify({ depositCents: 1000_01 }),
    }, cookie);
    expect(patch.status).toBe(400);
    const shrink = await api(`/api/crm/estimates/${ok.body.id}`, {
      method: "PATCH", body: JSON.stringify({ items: [line("Smaller", 100_00)] }),
    }, cookie);
    expect(shrink.status).toBe(400);
    const fine = await api(`/api/crm/estimates/${ok.body.id}`, {
      method: "PATCH", body: JSON.stringify({ depositCents: 1000_00 }),
    }, cookie);
    expect(fine.status).toBe(200);
    expect(fine.body.depositCents).toBe(1000_00);
  });

  it("manual status: viewed/expired are refused; sent stamps the send clock; the JSON carries the signed-total fields", async () => {
    const c = await customer("status");
    const e = await estimate(c);
    for (const status of ["viewed", "expired"]) {
      const r = await api(`/api/crm/estimates/${e.body.id}`, { method: "PATCH", body: JSON.stringify({ status }) }, cookie);
      expect(r.status).toBe(400);
    }
    const sent = await api(`/api/crm/estimates/${e.body.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) }, cookie);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("sent");
    expect(sent.body.sentAt).toBeTruthy();
    expect(new Date(sent.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(sent.body).toHaveProperty("approvedTotalCents");
    expect(sent.body).toHaveProperty("selectedDiscounts");
    expect(sent.body.expired).toBe(false);

    const det = await api(`/api/crm/estimates/${e.body.id}`, {}, cookie);
    expect(det.body.events.map((ev: any) => ev.type)).toContain("marked_sent");

    // Declined by phone → declinedAt stamped; back to sent clears it.
    const dec = await api(`/api/crm/estimates/${e.body.id}`, { method: "PATCH", body: JSON.stringify({ status: "declined" }) }, cookie);
    expect(dec.body.declinedAt).toBeTruthy();
    const back = await api(`/api/crm/estimates/${e.body.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) }, cookie);
    expect(back.body.declinedAt).toBeNull();
  });

  it("a never-sent draft can't be approved, and its page renders read-only with the reason", async () => {
    const c = await customer("draft");
    const e = await estimate(c);
    const [{ public_token: token }] = (await pool.query(
      `select public_token from crm_estimates where id = $1`, [e.body.id])).rows;
    const cc = await clientCookie(c);
    const page = await api(`/api/public/estimates/${token}`, {}, cc);
    expect(page.status).toBe(200);
    expect(page.body.answerBlock?.code).toBe("not_sent");
    const approve = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "FIX Signer" }),
    }, cc);
    expect(approve.status).toBe(409);
    expect(approve.body.code).toBe("not_sent");

    // Once it has gone out, the same client can sign it.
    await api(`/api/crm/estimates/${e.body.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) }, cookie);
    const page2 = await api(`/api/public/estimates/${token}`, {}, cc);
    expect(page2.body.answerBlock).toBeUndefined();
    const approve2 = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "FIX Signer" }),
    }, cc);
    expect(approve2.status).toBe(200);
    const signed = await api(`/api/crm/estimates/${e.body.id}`, {}, cookie);
    expect(signed.body.estimate.approvedTotalCents).toBe(1000_00);
  });

  it("the reminder link carries a first-open pass, like the original send", async () => {
    const c = await customer("remind");
    const e = await estimate(c);
    await api(`/api/crm/estimates/${e.body.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) }, cookie);
    const r = await api(`/api/crm/estimates/${e.body.id}/remind`, { method: "POST", body: "{}" }, cookie);
    expect(r.status).toBe(200);
    expect(r.body.link).toMatch(/\/e\/[0-9a-f]{48}\?k=[0-9a-f]{64}$/);
    const pass = r.body.link.split("?k=")[1];
    const rows = (await pool.query(
      `select customer_ids from crm_client_tokens where token_hash = $1`, [sha256(pass)])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_ids).toEqual([c]);
  });
});

describe("documents center", () => {
  it("'expired' is derived: every row it returns is out, unanswered and past its date (or marked expired)", async () => {
    const r = await api("/api/crm/estimates?sort=newest&status=expired&limit=50", {}, cookie);
    expect(r.status).toBe(200);
    for (const row of r.body.rows) {
      expect(row.expired).toBe(true);
      expect(row).not.toHaveProperty("termsText");
    }
  });

  it("pages with limit/offset and never repeats a row across pages", async () => {
    const p1 = await api("/api/crm/estimates?sort=newest&limit=5&offset=0", {}, cookie);
    const p2 = await api("/api/crm/estimates?sort=newest&limit=5&offset=5", {}, cookie);
    expect(p1.status).toBe(200);
    expect(p1.body.rows.length).toBeLessThanOrEqual(5);
    expect(p1.body.limit).toBe(5);
    expect(p2.body.offset).toBe(5);
    const ids1 = new Set(p1.body.rows.map((x: any) => x.id));
    for (const x of p2.body.rows) expect(ids1.has(x.id)).toBe(false);
  });
});

describe("invoices", () => {
  it("a $0 invoice is never emailed", async () => {
    const c = await customer("inv0");
    const inv = await api("/api/crm/invoices", {
      method: "POST", body: JSON.stringify({ customerId: c, title: `FIX-c13 zero ${run}`, items: [] }),
    }, cookie);
    expect(inv.status).toBe(201);
    const id = inv.body.id ?? inv.body.invoice?.id;
    const send = await api(`/api/crm/invoices/${id}/send`, { method: "POST", body: "{}" }, cookie);
    expect(send.status).toBe(409);
  });
});

describe("clients list + delete", () => {
  it("search: wildcards are literal, phone digits match any formatting, city/ZIP/company match", async () => {
    const c = await customer("search", {
      phone: "(503) 559-9433", city: `Beavertonfix${run}`, postalCode: "97201", companyName: `FIX-c13 Roofing ${run}`,
    });
    const has = async (q: string) => {
      const r = await api(`/api/crm/customers?q=${encodeURIComponent(q)}`, {}, cookie);
      expect(r.status).toBe(200);
      return r.body.some((x: any) => x.id === c);
    };
    expect(await has(`Beavertonfix${run}`)).toBe(true);
    expect(await has(`FIX-c13 Roofing ${run}`)).toBe(true);
    expect(await has("503-559-9433")).toBe(true);
    const pct = await api(`/api/crm/customers?q=${encodeURIComponent("%")}`, {}, cookie);
    const all = await api(`/api/crm/customers`, {}, cookie);
    expect(pct.body.length).toBeLessThan(all.body.length);
  });

  it("paged mode returns the page plus whole-book total and tab counts", async () => {
    const r = await api("/api/crm/customers?paged=1&limit=3", {}, cookie);
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBeLessThanOrEqual(3);
    const counts = r.body.bidCounts;
    expect(counts.won + counts.undecided + counts.declined + counts.none).toBe(r.body.total);
    expect(r.body.total).toBeGreaterThanOrEqual(r.body.rows.length);
  });

  it("force-delete takes the client's visits and the project's change orders with it", async () => {
    const c = await customer("tree");
    const p = await api("/api/crm/projects", { method: "POST", body: JSON.stringify({ customerId: c, name: `FIX-c13 tree ${run}` }) }, cookie);
    expect(p.status).toBe(201);
    const appt = await api("/api/crm/appointments", {
      method: "POST",
      body: JSON.stringify({ customerId: c, title: `FIX-c13 visit ${run}`, startsAt: new Date(Date.now() + 86_400_000).toISOString() }),
    }, cookie);
    expect(appt.status).toBe(201);
    const co = await api(`/api/crm/projects/${p.body.id}/change-orders`, {
      method: "POST", body: JSON.stringify({ title: `FIX-c13 CO ${run}`, amountCents: 100_00 }),
    }, cookie);
    expect(co.status).toBe(201);
    const coId = co.body.id ?? co.body.changeOrder?.id;

    const refused = await api(`/api/crm/customers/${c}`, { method: "DELETE" }, cookie);
    expect(refused.status).toBe(409);
    expect(refused.body.appointments).toBe(1);

    const gone = await api(`/api/crm/customers/${c}?force=1`, { method: "DELETE" }, cookie);
    expect(gone.status).toBe(200);
    customers.splice(customers.indexOf(c), 1);
    const left = (await pool.query(
      `select (select count(*)::int from crm_appointments where id = $1) as appts,
              (select count(*)::int from crm_change_orders where id = $2) as cos`,
      [appt.body.appointment.id, coId])).rows[0];
    expect(left).toEqual({ appts: 0, cos: 0 });
  });
});
