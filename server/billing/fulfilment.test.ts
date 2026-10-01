import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { fulfilmentItemsFor } from "./fulfilment";

// One-time purchase fulfilment (audit 4 F08 / F09) through the real webhook:
// a child server from THIS checkout (the shared dev server runs main), real
// signed Stripe payloads, the lane's Postgres, the mail sink. No Stripe API
// call is made — the Stripe key is a dummy that only lets the SDK verify
// signatures; the sessions carry expanded line_items and no PaymentIntent, so
// nothing is looked up at Stripe. Same child-server pattern as plan-gates.
// Failure injection is a real database failure: a trigger that raises on
// service_purchases for one session id.

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = 8191;
const base = `http://127.0.0.1:${port}`;
const run = randomUUID().slice(0, 8);
const WEBHOOK_SECRET = `whsec_fulfilment_${run}`;
const FAIL_FN = `chub_test_fail_${run}`;
let child: ChildProcess;
let userId = 0;
let moduleId = 0;
let seq = 0;

const sid = (name: string) => `cs_fulfil_${run}_${name}`;
const eventId = () => `evt_fulfil_${run}_${++seq}`;

/** The Stripe-Signature header: t + v1 = HMAC-SHA256(secret, "t.payload"), as Stripe signs. */
function signature(payload: string, secret = WEBHOOK_SECRET) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}

async function deliver(event: any, opts: { secret?: string } = {}) {
  const payload = JSON.stringify(event);
  const r = await fetch(`${base}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature(payload, opts.secret) },
    body: payload,
  });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body };
}

const event = (type: string, session: any, extra: any = {}) =>
  ({ id: eventId(), object: "event", type, api_version: "2025-01-27.acacia", data: { object: session }, ...extra });

/** A payment-mode Checkout Session as the webhook sees it: our metadata, Stripe's line items, no PaymentIntent (nothing to fetch). */
const session = (id: string, metadata: Record<string, string>, extra: any = {}) => ({
  id, object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete", currency: "usd", amount_total: 9900,
  created: Math.floor(Date.now() / 1000), customer: null, payment_intent: null, subscription: null,
  line_items: { object: "list", data: [{ description: "ConstructHUB Master Class — Fulfilment test", amount_total: 9900, quantity: 1 }] },
  metadata, ...extra,
});
const courseMeta = () => ({ userId: String(userId), type: "master_class", moduleId: String(moduleId) });
const cartMeta = (items: any[]) => ({ userId: String(userId), type: "cart", items: JSON.stringify(items) });
const cartItems = () => [
  { id: `course_module_${moduleId}`, type: "course_module", name: "Master Class — Fulfilment test", price: 9900, moduleId },
  { id: "course_bundle", type: "course_bundle", name: "Master Class bundle", price: 155000, moduleId: null },
  { id: "dfy_fulfilment_test", type: "dfy_service", name: "DFY fulfilment test service", price: 49900, moduleId: null },
];

const courseRows = async (s: string) => (await pool.query("select module_id, is_bundle, user_id from course_purchases where stripe_session_id=$1 order by id", [s])).rows;
const serviceRows = async (s: string) => (await pool.query("select service_type, service_name, price, user_id from service_purchases where stripe_session_id=$1 order by id", [s])).rows;
const claimed = async (id: string) => (await pool.query("select user_id from billing_events where stripe_event_id=$1", [id])).rows;
const ledger = async (s: string) => (await pool.query("select kind, amount from billing_purchases where id=$1", [s])).rows;
const receipts = async (s: string) => (await pool.query("select status, attempts from email_log where dedupe_key=$1", [`purchase_receipt:${s}`])).rows;

async function injectServiceInsertFailure(s: string) {
  await pool.query(`CREATE OR REPLACE FUNCTION ${FAIL_FN}() RETURNS trigger AS $$
    BEGIN
      IF NEW.stripe_session_id = '${s}' THEN RAISE EXCEPTION 'injected: service_purchases insert failed for %', NEW.stripe_session_id; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await pool.query(`CREATE TRIGGER ${FAIL_FN}_trg BEFORE INSERT ON service_purchases FOR EACH ROW EXECUTE FUNCTION ${FAIL_FN}()`);
}
async function removeInjectedFailure() {
  await pool.query(`DROP TRIGGER IF EXISTS ${FAIL_FN}_trg ON service_purchases`);
  await pool.query(`DROP FUNCTION IF EXISTS ${FAIL_FN}()`);
}

describe("fulfilmentItemsFor (what a session's metadata grants)", () => {
  const meta = (metadata: Record<string, string>) => ({ id: "cs_x", metadata }) as any;
  it("reads our cart and master_class metadata; other one-time checkouts grant nothing through these tables", () => {
    expect(fulfilmentItemsFor(meta({ type: "master_class", moduleId: "7" }))).toEqual([{ kind: "course", moduleId: 7, isBundle: false }]);
    expect(fulfilmentItemsFor(meta({ type: "master_class", bundle: "true" }))).toEqual([{ kind: "course", moduleId: null, isBundle: true }]);
    expect(fulfilmentItemsFor(meta({ type: "cart", items: JSON.stringify([
      { type: "course_module", moduleId: 3 }, { type: "course_bundle" }, { id: "gbp_setup", type: "dfy_service", name: "GBP setup", price: 49900 },
      { id: "growth_pack", type: "dfy_bundle", name: "Growth pack", price: 99900 }, { type: "something_else" },
    ]) }))).toEqual([
      { kind: "course", moduleId: 3, isBundle: false }, { kind: "course", moduleId: null, isBundle: true },
      { kind: "service", serviceType: "gbp_setup", serviceName: "GBP setup", price: 49900 },
      { kind: "service", serviceType: "growth_pack", serviceName: "Growth pack", price: 99900 },
    ]);
    expect(fulfilmentItemsFor(meta({ type: "cart", items: "[]" }))).toEqual([]);
    expect(fulfilmentItemsFor(meta({ type: "seo_contract", contractId: "9" }))).toEqual([]);
    expect(fulfilmentItemsFor(meta({ type: "reinstatement" }))).toEqual([]);
    expect(fulfilmentItemsFor({ id: "cs_x" } as any)).toEqual([]);
  });
  it("refuses metadata our checkout could not have written instead of guessing a grant", () => {
    expect(() => fulfilmentItemsFor(meta({ type: "master_class" }))).toThrow(/neither the bundle nor a module/);
    expect(() => fulfilmentItemsFor(meta({ type: "master_class", moduleId: "abc" }))).toThrow(/fulfilment refused/);
    expect(() => fulfilmentItemsFor(meta({ type: "cart", items: "not json" }))).toThrow(/not JSON/);
    expect(() => fulfilmentItemsFor(meta({ type: "cart", items: JSON.stringify({ type: "course_bundle" }) }))).toThrow(/not a list/);
    expect(() => fulfilmentItemsFor(meta({ type: "cart", items: JSON.stringify([{ type: "course_module" }]) }))).toThrow(/without a module id/);
    expect(() => fulfilmentItemsFor(meta({ type: "cart", items: JSON.stringify([{ id: "x", type: "dfy_service", name: "X" }]) }))).toThrow(/incomplete/);
    expect(() => fulfilmentItemsFor(meta({ type: "cart", items: JSON.stringify([{ id: "x", type: "dfy_service", name: "X", price: 12.5 }]) }))).toThrow(/incomplete/);
  });
});

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("one-time purchase fulfilment through the webhook (auxiliary child server)", () => {
  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false",
        SESSION_SECRET: `fulfilment-${run}`, EMAIL_FORCE_SINK: "1",
        STRIPE_SECRET_KEY: "sk_test_dummy_fulfilment_never_called", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        GOOGLE_PLACES_API_KEY: "", SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/fulfilment-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Fulfilment test server exited");
      try { if ((await fetch(base + "/api/auth/me")).ok) { ready = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Fulfilment test server did not start");
    const { rows: [user] } = await pool.query("insert into users(email, display_name, email_verified) values($1, 'P-Fulfilment', true) returning id", [`p-fulfil-${run}@example.invalid`]);
    userId = user.id;
    const { rows: [mod] } = await pool.query("insert into master_class_modules(title, description, price, category) values($1, 'test fixture', 9900, 'test') returning id", [`Fulfilment test ${run}`]);
    moduleId = mod.id;
  }, 90_000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await removeInjectedFailure().catch(() => undefined);
    await pool.query("delete from course_purchases where stripe_session_id like $1 or user_id=$2", [`cs_fulfil_${run}_%`, userId]);
    await pool.query("delete from service_purchases where stripe_session_id like $1 or user_id=$2", [`cs_fulfil_${run}_%`, userId]);
    await pool.query("delete from billing_purchases where id like $1", [`cs_fulfil_${run}_%`]);
    await pool.query("delete from billing_events where stripe_event_id like $1", [`evt_fulfil_${run}_%`]);
    await pool.query("delete from email_log where dedupe_key like $1 or user_id=$2", [`purchase_receipt:cs_fulfil_${run}_%`, userId]);
    await pool.query("delete from master_class_modules where id=$1", [moduleId]);
    await pool.query("delete from users where id=$1", [userId]);
    await pool.end();
  });

  it("F08: a checkout that completed UNPAID grants nothing; the later async_payment_succeeded grants it exactly once, under any event id", async () => {
    const s = sid("ach");
    const unpaid = event("checkout.session.completed", session(s, courseMeta(), { payment_status: "unpaid" }));
    const first = await deliver(unpaid);
    expect(first).toEqual({ status: 200, body: { received: true } });
    expect(await courseRows(s)).toEqual([]);
    expect(await ledger(s)).toEqual([]);
    expect(await receipts(s)).toEqual([]);
    expect(await claimed(unpaid.id)).toEqual([{ user_id: userId }]); // processed and attributed — just nothing granted

    // Days later the bank debit settles: the same session, a different event id, now paid.
    const paid = event("checkout.session.async_payment_succeeded", session(s, courseMeta()));
    expect(await deliver(paid)).toEqual({ status: 200, body: { received: true } });
    expect(await courseRows(s)).toEqual([{ module_id: moduleId, is_bundle: false, user_id: userId }]);
    expect(await ledger(s)).toEqual([{ kind: "course", amount: 9900 }]);
    expect(await receipts(s)).toEqual([{ status: "sent", attempts: 1 }]);

    // Stripe redelivers the same event id: the event claim answers for it.
    expect(await deliver(paid)).toEqual({ status: 200, body: { received: true, duplicate: true } });
    // …and the same session under a NEW event id: the (session, item) identity answers for it.
    expect(await deliver(event("checkout.session.async_payment_succeeded", session(s, courseMeta())))).toEqual({ status: 200, body: { received: true } });
    expect(await deliver(event("checkout.session.completed", session(s, courseMeta())))).toEqual({ status: 200, body: { received: true } });
    expect(await courseRows(s)).toHaveLength(1);
    expect(await receipts(s)).toHaveLength(1);
  });

  it("F08: reversed order — the paid async event first, the unpaid completion snapshot after — still one grant that stays", async () => {
    const s = sid("reversed");
    expect((await deliver(event("checkout.session.async_payment_succeeded", session(s, courseMeta())))).status).toBe(200);
    expect(await courseRows(s)).toHaveLength(1);
    expect((await deliver(event("checkout.session.completed", session(s, courseMeta(), { payment_status: "unpaid" })))).status).toBe(200);
    expect(await courseRows(s)).toHaveLength(1);
    expect((await deliver(event("checkout.session.completed", session(s, courseMeta())))).status).toBe(200);
    expect(await courseRows(s)).toEqual([{ module_id: moduleId, is_bundle: false, user_id: userId }]);
    expect(await ledger(s)).toHaveLength(1);
  });

  it("F08: async_payment_failed grants nothing and records nothing (the event is kept for the account)", async () => {
    const s = sid("ach_failed");
    expect((await deliver(event("checkout.session.completed", session(s, cartMeta(cartItems()), { payment_status: "unpaid" })))).status).toBe(200);
    const failed = event("checkout.session.async_payment_failed", session(s, cartMeta(cartItems()), { payment_status: "unpaid" }));
    expect(await deliver(failed)).toEqual({ status: 200, body: { received: true } });
    expect(await courseRows(s)).toEqual([]);
    expect(await serviceRows(s)).toEqual([]);
    expect(await ledger(s)).toEqual([]);
    expect(await receipts(s)).toEqual([]);
    expect(await claimed(failed.id)).toEqual([{ user_id: userId }]);
  });

  it("a paid cart grants every item once — courses and a DFY service — however many event ids carry the session", async () => {
    const s = sid("cart");
    const completed = event("checkout.session.completed", session(s, cartMeta(cartItems()), { amount_total: 214800 }));
    expect(await deliver(completed)).toEqual({ status: 200, body: { received: true } });
    expect(await courseRows(s)).toEqual([
      { module_id: moduleId, is_bundle: false, user_id: userId },
      { module_id: null, is_bundle: true, user_id: userId },
    ]);
    expect(await serviceRows(s)).toEqual([{ service_type: "dfy_fulfilment_test", service_name: "DFY fulfilment test service", price: 49900, user_id: userId }]);
    expect(await deliver(completed)).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(await deliver(event("checkout.session.completed", session(s, cartMeta(cartItems()), { amount_total: 214800 })))).toEqual({ status: 200, body: { received: true } });
    expect(await deliver(event("checkout.session.async_payment_succeeded", session(s, cartMeta(cartItems()), { amount_total: 214800 })))).toEqual({ status: 200, body: { received: true } });
    expect(await courseRows(s)).toHaveLength(2);
    expect(await serviceRows(s)).toHaveLength(1);
    expect(await ledger(s)).toEqual([{ kind: "other", amount: 214800 }]);
    expect(await receipts(s)).toHaveLength(1);
  });

  it("F09: a database failure on one item rolls the whole session back, answers non-2xx and releases the claim; the redelivery grants everything exactly once", async () => {
    const s = sid("dbfail");
    const items = cartItems();
    const completed = event("checkout.session.completed", session(s, cartMeta(items), { amount_total: 214800 }));
    await injectServiceInsertFailure(s);
    try {
      const failed = await deliver(completed);
      expect(failed.status).toBe(400);
      expect(failed.body.message).toMatch(/injected: service_purchases insert failed/);
      // Atomic: the course rows written before the failing service row are gone too.
      expect(await courseRows(s)).toEqual([]);
      expect(await serviceRows(s)).toEqual([]);
      expect(await ledger(s)).toEqual([]);
      expect(await receipts(s)).toEqual([]);
      // The claim was released: this event id is unknown again, so Stripe's retry is processed, not skipped.
      expect(await claimed(completed.id)).toEqual([]);
      // While the fault persists, every retry fails the same honest way and still grants nothing.
      expect((await deliver(completed)).status).toBe(400);
      expect(await courseRows(s)).toEqual([]);
    } finally {
      await removeInjectedFailure();
    }
    // Stripe retries the same event id once the database is healthy: granted, once.
    expect(await deliver(completed)).toEqual({ status: 200, body: { received: true } });
    expect(await courseRows(s)).toHaveLength(2);
    expect(await serviceRows(s)).toHaveLength(1);
    expect(await ledger(s)).toEqual([{ kind: "other", amount: 214800 }]);
    expect(await receipts(s)).toEqual([{ status: "sent", attempts: 1 }]);
    expect(await deliver(completed)).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(await courseRows(s)).toHaveLength(2);
    expect(await serviceRows(s)).toHaveLength(1);
  });

  it("a paid session our checkout can't be the author of is refused loudly, not guessed: nothing granted, claim released", async () => {
    const s = sid("badmeta");
    const bad = event("checkout.session.completed", session(s, { userId: String(userId), type: "master_class" }));
    const r = await deliver(bad);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/neither the bundle nor a module/);
    expect(await courseRows(s)).toEqual([]);
    expect(await claimed(bad.id)).toEqual([]);
  });

  it("security: a Connect event, a bad signature and a session without our userId grant nothing; another checkout type is recorded, not granted", async () => {
    const connect = event("checkout.session.completed", session(sid("connect"), courseMeta()), { account: "acct_client" });
    expect(await deliver(connect)).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(await courseRows(sid("connect"))).toEqual([]);
    expect(await claimed(connect.id)).toEqual([]);

    const forged = event("checkout.session.completed", session(sid("forged"), courseMeta()));
    expect((await deliver(forged, { secret: "whsec_wrong" })).status).toBe(400);
    expect(await courseRows(sid("forged"))).toEqual([]);
    expect(await claimed(forged.id)).toEqual([]);

    expect((await deliver(event("checkout.session.completed", session(sid("nouser"), { type: "master_class", moduleId: String(moduleId) })))).status).toBe(200);
    expect(await courseRows(sid("nouser"))).toEqual([]);

    const seo = sid("seo");
    expect((await deliver(event("checkout.session.completed", session(seo, { userId: String(userId), type: "seo_contract", contractId: "1", packageId: "local_seo" }, { amount_total: 480000 })))).status).toBe(200);
    expect(await courseRows(seo)).toEqual([]);
    expect(await serviceRows(seo)).toEqual([]);
    expect(await ledger(seo)).toEqual([{ kind: "service", amount: 480000 }]);
  });
});
