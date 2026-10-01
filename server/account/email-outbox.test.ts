import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// The transactional-email outbox (audit 4 F10) against the REAL lane
// database: a send the provider fails is kept in email_log as pending with
// its message, drainEmailOutbox sends it once with backoff and bounded
// attempts, and the dedupe key stays the identity throughout. Only the mail
// transport is mocked (sendWithFallback); no real mail, no Stripe call.
process.env.SMTP_EMAIL = "noreply@example.invalid";
process.env.APP_URL = "https://app.example.invalid";

const mocks = vi.hoisted(() => ({ mail: [] as any[], sendError: null as Error | null }));
vi.mock("../email", () => ({
  sendWithFallback: async (options: any) => {
    if (mocks.sendError) throw mocks.sendError;
    mocks.mail.push(options);
    return { accepted: [options.to], rejected: [], response: "mock" };
  },
}));

import { pool } from "../db";
import {
  deliverTransactionalEmail, sendTransactionalEmail, drainEmailOutbox, startEmailOutboxDrainer, onStripeBillingEvent,
  EMAIL_MAX_ATTEMPTS, EMAIL_KINDS,
} from "./billing-emails";

const run = randomUUID().slice(0, 8);
let userId = 0;
let moduleId = 0;
const key = (name: string) => `outbox-test:${run}:${name}`;
const msg = (name: string) => ({ subject: `Outbox ${name}`, html: `<p>${name}</p>`, text: name });
const row = async (dedupeKey: string) =>
  (await pool.query("select status, attempts, sent_at, next_attempt_at, last_error, message from email_log where dedupe_key=$1", [dedupeKey])).rows[0];
const due = (dedupeKey: string) => pool.query("update email_log set next_attempt_at = now() - interval '1 second' where dedupe_key=$1", [dedupeKey]);
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 50; i++) { if (await check()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
}

describe("email outbox (real database, mocked transport)", () => {
  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    const { rows: [user] } = await pool.query("insert into users(email, display_name, email_verified) values($1, 'P-Outbox', true) returning id", [`p-outbox-${run}@example.invalid`]);
    userId = user.id;
    const { rows: [mod] } = await pool.query("insert into master_class_modules(title, description, price, category) values($1, 'test fixture', 19900, 'test') returning id", [`Outbox test ${run}`]);
    moduleId = mod.id;
  });
  afterAll(async () => {
    await pool.query("delete from email_log where user_id=$1", [userId]);
    await pool.query("delete from master_class_modules where id=$1", [moduleId]);
    await pool.query("delete from users where id=$1", [userId]);
    await pool.end();
  });
  beforeEach(() => { mocks.mail.length = 0; mocks.sendError = null; });

  it("a failed send keeps its claim as a pending row with the message; the drainer sends it once, and only once", async () => {
    mocks.sendError = new Error("smtp down");
    expect(await deliverTransactionalEmail(userId, "test", key("basic"), msg("basic"))).toBe("queued");
    let r = await row(key("basic"));
    expect(r).toMatchObject({ status: "pending", attempts: 1, sent_at: null, last_error: "smtp down", message: { subject: "Outbox basic", html: "<p>basic</p>", text: "basic" } });
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30_000); // first retry after a minute
    // The caller retrying meanwhile finds the key claimed: nothing is sent twice.
    expect(await deliverTransactionalEmail(userId, "test", key("basic"), msg("basic"))).toBe("duplicate");
    expect(await sendTransactionalEmail(userId, "test", key("basic"), msg("basic"))).toBe(false);
    expect(mocks.mail).toHaveLength(0);

    // Not due yet: the drainer leaves it alone (even with the provider back).
    mocks.sendError = null;
    expect(await drainEmailOutbox()).toEqual({ sent: 0, deferred: 0, failed: 0 });
    await due(key("basic"));
    const drained = await drainEmailOutbox();
    expect(drained.sent).toBe(1);
    expect(mocks.mail).toHaveLength(1);
    expect(mocks.mail[0]).toMatchObject({ to: `p-outbox-${run}@example.invalid`, subject: "Outbox basic", text: "basic", headers: { "X-ConstructHUB-Email": "test" } });
    r = await row(key("basic"));
    expect(r).toMatchObject({ status: "sent", attempts: 2, next_attempt_at: null, last_error: null, message: null });
    expect(r.sent_at).not.toBeNull();

    // A second drain, and the caller again: nothing more goes out.
    expect(await drainEmailOutbox()).toEqual({ sent: 0, deferred: 0, failed: 0 });
    expect(await deliverTransactionalEmail(userId, "test", key("basic"), msg("basic"))).toBe("duplicate");
    expect(mocks.mail).toHaveLength(1);
  });

  it("a retry that fails again is deferred with a longer backoff; past the last attempt the row is marked failed and kept", async () => {
    mocks.sendError = new Error("smtp still down");
    expect(await deliverTransactionalEmail(userId, "test", key("backoff"), msg("backoff"))).toBe("queued");
    await due(key("backoff"));
    expect(await drainEmailOutbox()).toEqual({ sent: 0, deferred: 1, failed: 0 });
    let r = await row(key("backoff"));
    expect(r).toMatchObject({ status: "pending", attempts: 2, last_error: "smtp still down" });
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000); // second retry after five minutes
    expect(r.message).toMatchObject({ subject: "Outbox backoff" });

    // Fast-forward to the last allowed attempt: one more failure gives up, honestly, and keeps the message for an operator.
    await pool.query("update email_log set attempts=$2, next_attempt_at = now() - interval '1 second' where dedupe_key=$1", [key("backoff"), EMAIL_MAX_ATTEMPTS - 1]);
    expect(await drainEmailOutbox()).toEqual({ sent: 0, deferred: 0, failed: 1 });
    r = await row(key("backoff"));
    expect(r).toMatchObject({ status: "failed", attempts: EMAIL_MAX_ATTEMPTS, next_attempt_at: null, last_error: "smtp still down", sent_at: null });
    expect(r.message).toMatchObject({ subject: "Outbox backoff" });
    // Failed rows are not retried on their own…
    mocks.sendError = null;
    expect(await drainEmailOutbox()).toEqual({ sent: 0, deferred: 0, failed: 0 });
    expect(mocks.mail).toHaveLength(0);
    // …but an operator re-queues one by setting it pending again.
    await pool.query("update email_log set status='pending', next_attempt_at=now() where dedupe_key=$1", [key("backoff")]);
    expect(await drainEmailOutbox()).toEqual({ sent: 1, deferred: 0, failed: 0 });
    expect(mocks.mail).toHaveLength(1);
  });

  it("two drains at the same time (two processes) send a due row once: the lease skips the row the other holds", async () => {
    mocks.sendError = new Error("smtp down");
    await deliverTransactionalEmail(userId, "test", key("lease"), msg("lease"));
    await due(key("lease"));
    mocks.sendError = null;
    const results = await Promise.all([drainEmailOutbox(), drainEmailOutbox()]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(mocks.mail).toHaveLength(1);
    expect(await row(key("lease"))).toMatchObject({ status: "sent" });
  });

  it("the webhook adapter: a receipt whose send fails is queued (the webhook still answers 200), a redelivery adds nothing, the drainer sends it once", async () => {
    const session = {
      id: `cs_outbox_${run}`, object: "checkout.session", mode: "payment", payment_status: "paid", currency: "usd", amount_total: 19900,
      created: 1893456000, customer: null, payment_intent: null, metadata: { userId: String(userId), type: "master_class", moduleId: String(moduleId) },
    };
    const event = { id: `evt_outbox_${run}`, type: "checkout.session.completed", data: { object: session } } as any;
    const dedupeKey = `purchase_receipt:cs_outbox_${run}`;
    mocks.sendError = new Error("smtp down");
    expect(await onStripeBillingEvent(event, { userId })).toEqual([{ kind: EMAIL_KINDS.purchaseReceipt, dedupeKey, sent: false, queued: true }]);
    expect(await row(dedupeKey)).toMatchObject({ status: "pending", attempts: 1 });
    mocks.sendError = null;
    // Stripe redelivers (or the async_payment_succeeded for the same session arrives): the claim holds.
    expect(await onStripeBillingEvent({ ...event, id: `evt_outbox_${run}_2`, type: "checkout.session.async_payment_succeeded" }, { userId }))
      .toEqual([{ kind: EMAIL_KINDS.purchaseReceipt, dedupeKey, sent: false }]);
    expect(mocks.mail).toHaveLength(0);
    await due(dedupeKey);
    expect((await drainEmailOutbox()).sent).toBe(1);
    expect(mocks.mail).toHaveLength(1);
    expect(mocks.mail[0].subject).toMatch(/^Receipt — \$199\.00 paid to ConstructHUB/);
    expect(mocks.mail[0].text).toContain(`Master Class — Outbox test ${run}`);
    expect(await row(dedupeKey)).toMatchObject({ status: "sent", message: null });
    expect(await drainEmailOutbox()).toEqual({ sent: 0, deferred: 0, failed: 0 });
    expect(mocks.mail).toHaveLength(1);
  });

  it("startEmailOutboxDrainer runs the drain on its interval and is started once per process", async () => {
    mocks.sendError = new Error("smtp down");
    await deliverTransactionalEmail(userId, "test", key("interval"), msg("interval"));
    await due(key("interval"));
    mocks.sendError = null;
    const drainer = startEmailOutboxDrainer({ intervalMs: 25, firstRunMs: 0 });
    try {
      expect(startEmailOutboxDrainer()).toBe(drainer);
      expect(await eventually(async () => (await row(key("interval")))?.status === "sent")).toBe(true);
      expect(mocks.mail).toHaveLength(1);
      await new Promise((r) => setTimeout(r, 100));
      expect(mocks.mail).toHaveLength(1); // later ticks find nothing to do
    } finally {
      drainer.stop();
    }
  });
});
