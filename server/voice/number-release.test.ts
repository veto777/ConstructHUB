/**
 * The Call Assistant number is part of the service (owner, 2026-10-02): an
 * ended subscription or a removed tier releases the org's numbers; fewer
 * extra numbers release the newest extras; a failed payment (past_due) never
 * releases anything. The subscription is the Call Assistant's OWN
 * (call_assistant_subscriptions — a separate service since 2026-10-08; the
 * platform plan plays no part). Against the lane's development DB with a FAKE
 * carrier (every release is recorded, nothing reaches SignalWire), and only
 * this file's own accounts/orgs are ever swept.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureVoiceSchema } from "./schema";
import {
  numbersKeptFor, scheduleAccountCallNumbers, scheduleOrgReleases, releaseDueCallNumbers, afterSubscriptionChange, runCallNumberSweep,
  voiceNumberReleaseWorkerOffReason, releaseReasonText, releaseIsFinal, previewCallNumberReleases,
} from "./number-release";
import { heldNumberCount } from "./numbers";
import { lookupNumber } from "./profile-store";
import { isPlatformAdminEmail } from "../admin";
import { CALL_NUMBER_MIN_DAYS, callAssistantTierOf } from "@shared/plans";

// A throwaway "number-release-admin-…@example.invalid" account counts as a platform admin (the real
// ADMIN_EMAILS are never seeded into a lane DB), the way server/voice/billing.test.ts does it.
vi.mock("../admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("../admin")>();
  const testAdmin = (email?: string | null) => !!email && /^number-release-admin-.*@example\.invalid$/i.test(email);
  return { ...real, isPlatformAdminEmail: (email?: string | null) => real.isPlatformAdminEmail(email) || testAdmin(email), isPlatformAdmin: (user: any) => real.isPlatformAdmin(user) || testAdmin(user?.email) };
});

const DAY = 86_400_000;
const users: number[] = [];
const orgs: string[] = [];

/** The fake carrier: records every SID it is asked to release; `fail` makes the next call throw. */
const carrier = { released: [] as string[], fail: 0 };
const fakeCarrier = () => ({
  search: async () => [],
  purchase: async () => { throw new Error("no purchases in this test"); },
  release: async (sid: string) => {
    if (carrier.fail > 0) { carrier.fail -= 1; throw new Error("carrier down (fixture)"); }
    carrier.released.push(sid);
    return { released: true as const, alreadyGone: false };
  },
});
const deps = (now = new Date()) => ({ carrierFor: fakeCarrier, now });

/** A test-only number in the 555-01xx fictional range, unique per run. */
const testPhone = () => `+1206555${String(randomInt(0, 10000)).padStart(4, "0")}`;

/** The tier and extra numbers a Call Assistant subscription holds, from the quantities map the tests speak in. */
const lines = (addons: Record<string, number> = {}) => ({ tier: callAssistantTierOf(addons)?.tier ?? null, extraNumbers: addons.call_number ?? 0 });

async function account(sub: { status: string; addons?: Record<string, number> } | null, email?: string) {
  const { rows: [u] } = await pool.query("insert into users(email, display_name, email_verified) values ($1, 'Number Release Test', true) returning id",
    [email ?? `number-release-${randomUUID()}@example.invalid`]);
  users.push(u.id);
  if (sub) {
    const { tier, extraNumbers } = lines(sub.addons);
    await pool.query("insert into call_assistant_subscriptions(user_id, tier, extra_numbers, status, stripe_subscription_id, stripe_customer_id, billing_interval) values ($1, $2, $3, $4, $5, $6, 'month')",
      [u.id, tier, extraNumbers, sub.status, `sub_nr_${randomUUID()}`, `cus_nr_${randomUUID()}`]);
  }
  const { rows: [o] } = await pool.query("insert into crm_orgs(name, owner_user_id, phone, state, industry) values ('Vitest Number Release', $1, '(206) 555-0142', 'WA', 'Siding') returning id", [u.id]);
  orgs.push(o.id);
  const { rows: [m] } = await pool.query("insert into crm_members(org_id, user_id, email, role, status, display_name) values ($1, $2, 'owner@example.invalid', 'owner', 'active', 'Owner Person') returning id", [o.id, u.id]);
  return { userId: Number(u.id), orgId: String(o.id), memberId: String(m.id) };
}

/** A held number bought `ageDays` ago (release_eligible_at = bought + 14 days, as a purchase sets it). */
async function number(orgId: string, ageDays: number, extra: { isTest?: boolean; status?: string } = {}) {
  const phone = testPhone();
  const bought = new Date(Date.now() - ageDays * DAY);
  const sid = `PNfixture${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await pool.query(
    `insert into voice_numbers(org_id, phone_number, label, provider, provider_sid, status, is_test, purchased_at, release_eligible_at)
     values ($1, $2, 'Fixture', 'signalwire', $3, $4, $5, $6, $7)`,
    [orgId, phone, sid, extra.status ?? "active", extra.isTest ?? false, bought, new Date(bought.getTime() + CALL_NUMBER_MIN_DAYS * DAY)]);
  return { phone, sid, bought };
}
const row = async (phone: string) => (await pool.query("select * from voice_numbers where phone_number = $1", [phone])).rows[0];
/** A change to the account's Call Assistant subscription, as the webhook writes it: the status, and/or the tier + extras. */
const setSub = async (userId: number, set: { status?: string; addons?: Record<string, number> }) => {
  if (set.status) await pool.query("update call_assistant_subscriptions set status = $2 where user_id = $1", [userId, set.status]);
  if (set.addons) {
    const { tier, extraNumbers } = lines(set.addons);
    await pool.query("update call_assistant_subscriptions set tier = $2, extra_numbers = $3 where user_id = $1", [userId, tier, extraNumbers]);
  }
};
const notifications = async (orgId: string) => (await pool.query("select title, body, link, member_id from crm_notifications where org_id = $1 and type = 'call.number_released' order by created_at", [orgId])).rows;
async function activity(orgId: string, action: string) {
  // recordActivity is fire-and-forget: poll briefly for the row.
  for (let i = 0; i < 40; i++) {
    const { rows } = await pool.query("select meta from crm_activity_log where org_id = $1 and action = $2", [orgId, action]);
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) throw new Error("Requires a local ConstructHUB development lane DB");
  await ensureVoiceSchema();
  const { callAssistantSchemaReady } = await import("./subscription-store");
  await callAssistantSchemaReady();
});
afterAll(async () => {
  for (const t of ["voice_numbers", "crm_notifications", "crm_activity_log", "crm_members"]) await pool.query(`delete from ${t} where org_id = any($1::text[])`, [orgs]);
  await pool.query("delete from crm_orgs where id = any($1::text[])", [orgs]);
  await pool.query("delete from call_assistant_subscriptions where user_id = any($1::int[])", [users]);
  await pool.query("delete from users where id = any($1::int[])", [users]);
});
beforeEach(() => { carrier.released.length = 0; carrier.fail = 0; });

describe("the release decision (pure)", () => {
  /** The Call Assistant subscription as the decision reads it: its status and its lines as a quantities map. */
  const sub = (status: string, addons: Record<string, number> = { call_assistant: 1 }) => ({ status, addons });

  it("ended subscriptions keep nothing; past_due, incomplete and paused hold everything; admins are never touched", () => {
    for (const status of ["canceled", "incomplete_expired", "inactive"]) {
      expect(numbersKeptFor(sub(status), false)).toEqual({ keep: 0, reason: "subscription_ended" });
    }
    // Stripe stopped retrying a failed payment: released too, but a fixed card can still undo it.
    expect(numbersKeptFor(sub("unpaid"), false)).toEqual({ keep: 0, reason: "payment_failed" });
    expect(numbersKeptFor(null, false)).toEqual({ keep: 0, reason: "subscription_ended" });
    expect(numbersKeptFor({ status: null, addons: {} }, false)).toEqual({ keep: 0, reason: "subscription_ended" });
    // A failed payment pauses the assistant but NEVER releases the number.
    expect(numbersKeptFor(sub("past_due", { call_assistant: 1, call_number: 2 }), false)).toEqual({ keep: 3, reason: "over_allowance" });
    for (const status of ["incomplete", "paused", "something_new"]) expect(numbersKeptFor(sub(status), false)).toBeNull();
    expect(numbersKeptFor(sub("canceled"), true)).toBeNull();
  });

  it("an active subscription keeps the held tier's numbers plus every extra number; the platform plan plays no part", () => {
    expect(numbersKeptFor(sub("active", { call_assistant: 1 }), false)).toEqual({ keep: 1, reason: "over_allowance" });
    expect(numbersKeptFor(sub("trialing", { call_assistant: 1, call_number: 3 }), false)).toEqual({ keep: 4, reason: "over_allowance" });
    // The 2,000 minutes tier includes 2 numbers, 5,000 minutes 5: a downgrade keeps fewer (the newest extras go; not final — upgrading back restores them).
    expect(numbersKeptFor(sub("active", { call_assistant_crew: 1 }), false)).toEqual({ keep: 2, reason: "over_allowance" });
    expect(numbersKeptFor(sub("active", { call_assistant_fleet: 1, call_number: 2 }), false)).toEqual({ keep: 7, reason: "over_allowance" });
    // A live subscription with no tier line (the tier was removed) pays for no number.
    expect(numbersKeptFor(sub("active", {}), false)).toEqual({ keep: 0, reason: "addon_removed" });
    expect(numbersKeptFor(sub("active", { call_number: 2 }), false)).toEqual({ keep: 0, reason: "addon_removed" });
    // The 500 minutes tier includes 1 number: a 5,000 → 500 downgrade keeps 1 (plus extras); past_due holds; a cancel keeps none.
    expect(numbersKeptFor(sub("active", { call_assistant_lite: 1 }), false)).toEqual({ keep: 1, reason: "over_allowance" });
    expect(numbersKeptFor(sub("active", { call_assistant_lite: 1, call_number: 1 }), false)).toEqual({ keep: 2, reason: "over_allowance" });
    expect(numbersKeptFor(sub("past_due", { call_assistant_lite: 1 }), false)).toEqual({ keep: 1, reason: "over_allowance" });
    expect(numbersKeptFor(sub("canceled", { call_assistant_lite: 1 }), false)).toEqual({ keep: 0, reason: "subscription_ended" });
    expect(releaseReasonText("subscription_ended")).toBe("the subscription ended");
    expect(releaseReasonText("payment_failed")).toBe("the subscription's payment was not recovered");
    expect(releaseReasonText("addon_removed")).toBe("the AI Call Assistant tier was removed from the subscription");
  });

  it("a cancellation (or an attempted release) is final; a payment problem or fewer extras is not", () => {
    for (const reason of ["subscription_ended", "addon_removed"]) expect(releaseIsFinal({ status: "releasing", release_reason: reason })).toBe(true);
    for (const reason of ["payment_failed", "over_allowance"]) expect(releaseIsFinal({ status: "releasing", release_reason: reason })).toBe(false);
    expect(releaseIsFinal({ status: "releasing", release_reason: "over_allowance", last_error: "Release failed, will retry: timeout" })).toBe(true);
    expect(releaseIsFinal({ status: "active", release_reason: null })).toBe(false);
    expect(releaseIsFinal({ status: "releasing", release_reason: null, last_error: "manual" })).toBe(false);
  });

  it("the sweep worker is on in production unless switched off, and off elsewhere unless switched on", () => {
    expect(voiceNumberReleaseWorkerOffReason({ NODE_ENV: "production" } as any)).toBeNull();
    expect(voiceNumberReleaseWorkerOffReason({ NODE_ENV: "production", VOICE_NUMBER_RELEASE_WORKER_ENABLED: "false" } as any)).toMatch(/false/);
    expect(voiceNumberReleaseWorkerOffReason({ NODE_ENV: "development" } as any)).toMatch(/not a production server/);
    expect(voiceNumberReleaseWorkerOffReason({ NODE_ENV: "development", VOICE_NUMBER_RELEASE_WORKER_ENABLED: "true" } as any)).toBeNull();
  });
});

describe("cancel → the number is released", () => {
  it("subscription deleted, number past its 14 days: released on the carrier right away, the owner is told", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const n = await number(a.orgId, 30);
    // While paid up nothing happens.
    expect((await scheduleAccountCallNumbers(a.userId, deps())).scheduled).toBe(0);
    expect((await row(n.phone)).status).toBe("active");

    // customer.subscription.deleted → endCallAssistantSubscription (status canceled, tier gone).
    await setSub(a.userId, { status: "canceled", addons: {} });
    const s = await scheduleAccountCallNumbers(a.userId, deps());
    expect(s).toMatchObject({ decision: { keep: 0, reason: "subscription_ended" }, scheduled: 1, due: 1 });
    expect(await row(n.phone)).toMatchObject({ status: "releasing", release_reason: "subscription_ended" });
    const run = await releaseDueCallNumbers({ ...deps(), orgIds: s.orgIds });
    expect(run).toEqual({ released: [n.phone], failed: [] });
    expect(carrier.released).toEqual([n.sid]);
    expect(await row(n.phone)).toMatchObject({ status: "released", last_error: null });
    expect((await row(n.phone)).released_at).not.toBeNull();

    const bell = await notifications(a.orgId);
    expect(bell.map((b) => b.title)).toEqual([
      `Your Call Assistant number ${n.phone} stopped answering because the subscription ended`,
      `Your Call Assistant number ${n.phone} was released because the subscription ended`,
    ]);
    expect(bell.every((b) => b.member_id === a.memberId && b.link === "/call-assistant?tab=numbers")).toBe(true);
    expect(bell[1].body).toMatch(/never moved/);
    expect(await activity(a.orgId, "call.number_released")).toEqual([{ meta: { phone: n.phone, reason: "subscription_ended" } }]);

    // A webhook redelivery (or a second decision) releases nothing twice.
    expect((await afterSubscriptionChange(a.userId, deps()))).toMatchObject({ scheduled: 0 });
    expect(await releaseDueCallNumbers(deps())).toMatchObject({ released: expect.not.arrayContaining([n.phone]) });
    expect(carrier.released).toEqual([n.sid]);
    expect(await notifications(a.orgId)).toHaveLength(2);
  });

  it("not yet eligible: scheduled, stops answering, then the job releases it once the 14 days have passed", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const n = await number(a.orgId, 3);
    await setSub(a.userId, { status: "canceled", addons: {} });

    const s = await afterSubscriptionChange(a.userId, deps());
    expect(s).toMatchObject({ scheduled: 1, due: 0 });
    const scheduled = await row(n.phone);
    expect(scheduled).toMatchObject({ status: "releasing", release_reason: "subscription_ended" });
    expect(new Date(scheduled.release_eligible_at).getTime()).toBe(n.bought.getTime() + CALL_NUMBER_MIN_DAYS * DAY);
    // Still on the carrier, but the engine is told "paused" for it (internal-profile.ts: number_releasing).
    expect(await lookupNumber(n.phone)).toMatchObject({ number: { status: "releasing" } });
    expect(carrier.released).toEqual([]);
    expect((await notifications(a.orgId))[0].body).toMatch(/released on .* \(the carrier keeps a number for at least 14 days\)/);

    // The job today: too early, nothing released.
    expect(await runCallNumberSweep({ ...deps(), userIds: [a.userId] })).toMatchObject({ released: [], scheduled: 0 });
    expect((await row(n.phone)).status).toBe("releasing");

    // A carrier failure keeps it scheduled with the error; the next run retries.
    const later = new Date(n.bought.getTime() + (CALL_NUMBER_MIN_DAYS + 1) * DAY);
    carrier.fail = 1;
    const failed = await runCallNumberSweep({ ...deps(later), userIds: [a.userId] });
    expect(failed.failed).toEqual([{ phone: n.phone, error: "carrier down (fixture)" }]);
    expect(await row(n.phone)).toMatchObject({ status: "releasing", last_error: "Release failed, will retry: carrier down (fixture)" });

    const done = await runCallNumberSweep({ ...deps(later), userIds: [a.userId] });
    expect(done.released).toEqual([n.phone]);
    expect(carrier.released).toEqual([n.sid]);
    expect(await row(n.phone)).toMatchObject({ status: "released", last_error: null });
    expect(await lookupNumber(n.phone)).toBeNull();
    // And again: nothing left to do.
    expect((await runCallNumberSweep({ ...deps(later), userIds: [a.userId] })).released).toEqual([]);
    expect(carrier.released).toEqual([n.sid]);
  });

  it("a subscription that loses its tier (still active) releases the number too", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const n = await number(a.orgId, 20);
    await setSub(a.userId, { addons: {} });
    const s = await scheduleAccountCallNumbers(a.userId, deps());
    expect(s.decision).toEqual({ keep: 0, reason: "addon_removed" });
    await releaseDueCallNumbers({ ...deps(), orgIds: s.orgIds });
    expect(await row(n.phone)).toMatchObject({ status: "released", release_reason: "addon_removed" });
    expect((await notifications(a.orgId)).at(-1)!.title).toBe(`Your Call Assistant number ${n.phone} was released because the AI Call Assistant tier was removed from the subscription`);
  });
});

describe("fewer extra numbers → the newest extras go", () => {
  it("call_number 2 → 0 keeps the oldest number and releases the two newest", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1, call_number: 2 } });
    const oldest = await number(a.orgId, 40);
    const middle = await number(a.orgId, 30);
    const newest = await number(a.orgId, 20);
    expect((await scheduleAccountCallNumbers(a.userId, deps())).scheduled).toBe(0);

    await setSub(a.userId, { addons: { call_assistant: 1, call_number: 0 } });
    const s = await scheduleAccountCallNumbers(a.userId, deps());
    expect(s).toMatchObject({ decision: { keep: 1, reason: "over_allowance" }, scheduled: 2, due: 2 });
    const run = await releaseDueCallNumbers({ ...deps(), orgIds: s.orgIds });
    expect(run.released.sort()).toEqual([middle.phone, newest.phone].sort());
    expect(carrier.released.sort()).toEqual([middle.sid, newest.sid].sort());
    expect((await row(oldest.phone)).status).toBe("active");
    expect((await row(middle.phone)).status).toBe("released");
    expect((await row(newest.phone)).status).toBe("released");
  });

  it("a scheduled extra is kept again when the extra-number add-on comes back before it is released", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1, call_number: 1 } });
    const first = await number(a.orgId, 30);
    const extra = await number(a.orgId, 2);
    await setSub(a.userId, { addons: { call_assistant: 1 } });
    expect((await scheduleAccountCallNumbers(a.userId, deps())).scheduled).toBe(1);
    expect((await row(extra.phone)).status).toBe("releasing");
    expect((await row(first.phone)).status).toBe("active");

    await setSub(a.userId, { addons: { call_assistant: 1, call_number: 1 } });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ restored: 1 });
    expect(await row(extra.phone)).toMatchObject({ status: "active", release_reason: null, release_scheduled_at: null });
    expect(carrier.released).toEqual([]);
  });
});

describe("a failed payment never releases", () => {
  it("past_due holds every number (only the assistant pauses); unpaid then releases", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const n = await number(a.orgId, 3);
    await setSub(a.userId, { status: "past_due" });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ decision: { keep: 1 }, scheduled: 0 });
    expect(await runCallNumberSweep({ ...deps(new Date(Date.now() + 60 * DAY)), userIds: [a.userId] })).toMatchObject({ scheduled: 0, released: [] });
    expect((await row(n.phone)).status).toBe("active");
    expect(carrier.released).toEqual([]);

    // Stripe gives up retrying → unpaid: the subscription has ended for the number.
    await setSub(a.userId, { status: "unpaid" });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ scheduled: 1, due: 0 });
    expect((await row(n.phone)).release_reason).toBe("payment_failed");
    // The card is fixed before the 14 days pass: the number is kept.
    await setSub(a.userId, { status: "active" });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ restored: 1 });
    expect((await row(n.phone)).status).toBe("active");
  });
});

describe("what is never touched", () => {
  it("numbers of another org, the build's test number, and a platform admin's org", async () => {
    const a = await account({ status: "canceled" });
    const mine = await number(a.orgId, 30);
    const testLine = await number(a.orgId, 30, { isTest: true });
    const other = await account({ status: "active", addons: { call_assistant: 1 } });
    const theirs = await number(other.orgId, 30);
    const noNumbers = await account(null);
    // A platform admin's org: its numbers are never released, whatever its (absent) subscription says. The admin
    // is this file's own throwaway account (the ../admin mock above), so no lane DB has to carry a real admin.
    const admin = await account(null, `number-release-admin-${randomUUID()}@example.invalid`);
    expect(isPlatformAdminEmail((await pool.query("select email from users where id = $1", [admin.userId])).rows[0].email)).toBe(true);
    const adminPhone = (await number(admin.orgId, 30)).phone;

    const s = await scheduleAccountCallNumbers(a.userId, deps());
    expect(s.orgIds).toEqual([a.orgId]);
    await releaseDueCallNumbers({ ...deps(), orgIds: s.orgIds });
    expect(carrier.released).toEqual([mine.sid]);
    expect((await row(testLine.phone)).status).toBe("active");
    expect((await row(theirs.phone)).status).toBe("active");
    expect(await scheduleAccountCallNumbers(admin.userId, deps())).toMatchObject({ decision: null, scheduled: 0 });
    expect((await row(adminPhone)).status).toBe("active");
    // An account with no numbers costs one query and decides nothing.
    expect(await scheduleAccountCallNumbers(noNumbers.userId, deps())).toMatchObject({ orgIds: [], scheduled: 0 });
  });
});

describe("a cancellation is final (owner: \"you don't keep the number\")", () => {
  it("a customer who cancels and subscribes again within the 14 days does not get the young number back; they can buy a new one", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const n = await number(a.orgId, 3);
    await setSub(a.userId, { status: "canceled", addons: {} });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ scheduled: 1, due: 0 });
    expect(await row(n.phone)).toMatchObject({ status: "releasing", release_reason: "subscription_ended" });

    // A new checkout a few days later (checkout.session.completed → afterSubscriptionChange).
    await setSub(a.userId, { status: "active", addons: { call_assistant: 1 } });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ restored: 0, scheduled: 0 });
    expect(await row(n.phone)).toMatchObject({ status: "releasing", release_reason: "subscription_ended" });
    // The old number no longer counts against the allowance: the returning customer can buy a new one now.
    expect(await heldNumberCount(a.orgId)).toBe(0);
    // And the sweep still releases it on day 14.
    const later = new Date(n.bought.getTime() + (CALL_NUMBER_MIN_DAYS + 1) * DAY);
    expect((await runCallNumberSweep({ ...deps(later), userIds: [a.userId] })).released).toEqual([n.phone]);
  });

  it("removing the add-on is final too; a payment-failed schedule becomes final when the subscription is then cancelled", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const n = await number(a.orgId, 2);
    await setSub(a.userId, { addons: {} });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ decision: { reason: "addon_removed" }, scheduled: 1 });
    await setSub(a.userId, { addons: { call_assistant: 1 } });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ restored: 0 });
    expect((await row(n.phone)).status).toBe("releasing");

    const b = await account({ status: "active", addons: { call_assistant: 1 } });
    const m = await number(b.orgId, 2);
    await setSub(b.userId, { status: "unpaid" });
    await scheduleAccountCallNumbers(b.userId, deps());
    expect((await row(m.phone)).release_reason).toBe("payment_failed");
    // Stripe then cancels the unpaid subscription: the release is final from here on.
    await setSub(b.userId, { status: "canceled", addons: {} });
    expect(await scheduleAccountCallNumbers(b.userId, deps())).toMatchObject({ scheduled: 0 });
    const r = await row(m.phone);
    expect(r).toMatchObject({ status: "releasing", release_reason: "subscription_ended" });
    expect(new Date(r.release_eligible_at).getTime()).toBe(m.bought.getTime() + CALL_NUMBER_MIN_DAYS * DAY);
    await setSub(b.userId, { status: "active", addons: { call_assistant: 1 } });
    expect(await scheduleAccountCallNumbers(b.userId, deps())).toMatchObject({ restored: 0 });
    expect((await row(m.phone)).status).toBe("releasing");
  });

  it("a number whose release was already attempted is not restored (the carrier may have taken it)", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const n = await number(a.orgId, 30);
    await pool.query("update voice_numbers set status = 'releasing', release_reason = 'payment_failed', last_error = 'Release failed, will retry: timeout' where phone_number = $1", [n.phone]);
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ restored: 0 });
    expect((await row(n.phone)).status).toBe("releasing");
    expect(await heldNumberCount(a.orgId)).toBe(0);
  });
});

describe("a restore never races a release", () => {
  it("a decision waits for an in-flight carrier release, never reports the released number as kept, and keeps the next one", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const older = await number(a.orgId, 30);
    const newer = await number(a.orgId, 2);
    // Both scheduled (fewer extras); the older is past its 14 days, so the sweep picks it up.
    await pool.query("update voice_numbers set status = 'releasing', release_reason = 'over_allowance', release_scheduled_at = now() where phone_number = any($1::text[])", [[older.phone, newer.phone]]);

    let unblock!: () => void;
    const gate = new Promise<void>((r) => { unblock = r; });
    let entered!: () => void;
    const inCarrier = new Promise<void>((r) => { entered = r; });
    const slowCarrier = () => ({
      ...fakeCarrier(),
      release: async (sid: string) => { entered(); await gate; carrier.released.push(sid); return { released: true as const, alreadyGone: false }; },
    });
    const releasing = releaseDueCallNumbers({ carrierFor: slowCarrier, orgIds: [a.orgId] });
    await inCarrier;
    // Meanwhile the subscription pays for one number again: keep 1.
    const deciding = scheduleOrgReleases({ id: a.orgId }, { keep: 1, reason: "over_allowance" });
    await new Promise((r) => setTimeout(r, 200));
    unblock();
    const [run, decided] = await Promise.all([releasing, deciding]);
    expect(run.released).toEqual([older.phone]);
    expect(decided.restored).toEqual([newer.phone]);
    expect((await row(older.phone)).status).toBe("released");
    expect((await row(newer.phone)).status).toBe("active");
  });
});

describe("the off switch and the Billing preview", () => {
  it("VOICE_NUMBER_RELEASE_WORKER_ENABLED=false stops the background release after a webhook; decisions still run", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1 } });
    const n = await number(a.orgId, 30);
    await setSub(a.userId, { status: "canceled", addons: {} });
    const off = await afterSubscriptionChange(a.userId, { ...deps(), env: { NODE_ENV: "production", VOICE_NUMBER_RELEASE_WORKER_ENABLED: "false" } });
    expect(off).toMatchObject({ scheduled: 1, due: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(carrier.released).toEqual([]);
    expect((await row(n.phone)).status).toBe("releasing");

    await afterSubscriptionChange(a.userId, { ...deps(), env: { NODE_ENV: "production" } });
    for (let i = 0; i < 40 && (await row(n.phone)).status !== "released"; i++) await new Promise((r) => setTimeout(r, 50));
    expect(carrier.released).toEqual([n.sid]);
  });

  it("previews which answering numbers a lower add-on count or a cancellation would release", async () => {
    const a = await account({ status: "active", addons: { call_assistant: 1, call_number: 1 } });
    const first = await number(a.orgId, 30);
    const extra = await number(a.orgId, 5);
    expect(await previewCallNumberReleases(a.userId, { addons: { call_number: 1 } })).toEqual([]);
    expect(await previewCallNumberReleases(a.userId, { addons: { call_number: 0 } })).toEqual([{ phoneNumber: extra.phone, orgName: "Vitest Number Release" }]);
    const all = [first.phone, extra.phone].sort();
    expect((await previewCallNumberReleases(a.userId, { addons: { call_assistant: 0 } })).map((n) => n.phoneNumber).sort()).toEqual(all);
    expect((await previewCallNumberReleases(a.userId, { cancel: true })).map((n) => n.phoneNumber).sort()).toEqual(all);
    // Read only: nothing changed.
    expect((await row(first.phone)).status).toBe("active");
    expect((await row(extra.phone)).status).toBe("active");
    expect(carrier.released).toEqual([]);
  });

  it("a smaller tier keeps fewer numbers: the preview names the newest ones, the switch schedules them (not final), upgrading back restores them", async () => {
    // The 5,000 minutes tier includes 5 numbers (+ 2 extras = 7), 2,000 minutes 2, 1,000 minutes 1; the org holds 7 (oldest first).
    const a = await account({ status: "active", addons: { call_assistant_fleet: 1, call_number: 2 } });
    const held = [];
    for (const age of [70, 60, 50, 40, 30, 20, 3]) held.push(await number(a.orgId, age));
    // → 2,000 minutes (as the confirm step asks it: just the new tier; the extras stay): keeps 2 + 2, names the 3 newest.
    expect(await previewCallNumberReleases(a.userId, { addons: { call_assistant_crew: 1 } }))
      .toEqual(held.slice(4).map((n) => ({ phoneNumber: n.phone, orgName: "Vitest Number Release" })));
    // → 1,000 minutes names the 4 newest; the held tier names none.
    expect((await previewCallNumberReleases(a.userId, { addons: { call_assistant: 1 } })).map((n) => n.phoneNumber)).toEqual(held.slice(3).map((n) => n.phone));
    expect(await previewCallNumberReleases(a.userId, { addons: { call_assistant_fleet: 1 } })).toEqual([]);
    expect(carrier.released).toEqual([]);

    // The switch lands (webhook / the change route): 1,000 minutes keeps the three oldest; the rest stop answering, over_allowance.
    await setSub(a.userId, { addons: { call_assistant: 1, call_number: 2 } });
    const s1 = await scheduleAccountCallNumbers(a.userId, deps());
    expect(s1).toMatchObject({ decision: { keep: 3, reason: "over_allowance" }, scheduled: 4 });
    for (const n of held.slice(0, 3)) expect((await row(n.phone)).status).toBe("active");
    for (const n of held.slice(3)) expect(await row(n.phone)).toMatchObject({ status: "releasing", release_reason: "over_allowance" });
    // Back up to 2,000 minutes before they are released: the fourth is kept again (a downgrade is not a cancellation).
    await setSub(a.userId, { addons: { call_assistant_crew: 1, call_number: 2 } });
    const s2 = await scheduleAccountCallNumbers(a.userId, deps());
    expect(s2).toMatchObject({ decision: { keep: 4, reason: "over_allowance" }, restored: 1 });
    expect((await row(held[3].phone)).status).toBe("active");
    expect((await row(held[4].phone)).status).toBe("releasing");
  });

  it("5,000 → 500 minutes keeps the oldest number and schedules the rest (not final); a cancel then releases them all", async () => {
    const a = await account({ status: "active", addons: { call_assistant_fleet: 1 } });
    const held = [];
    for (const age of [70, 60, 3]) held.push(await number(a.orgId, age));
    expect((await previewCallNumberReleases(a.userId, { addons: { call_assistant_lite: 1 } })).map((n) => n.phoneNumber)).toEqual(held.slice(1).map((n) => n.phone));
    await setSub(a.userId, { addons: { call_assistant_lite: 1 } });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ decision: { keep: 1, reason: "over_allowance" }, scheduled: 2 });
    expect((await row(held[0].phone)).status).toBe("active");
    for (const n of held.slice(1)) expect(await row(n.phone)).toMatchObject({ status: "releasing", release_reason: "over_allowance" });
    await setSub(a.userId, { status: "canceled", addons: { call_assistant_lite: 1 } });
    expect(await scheduleAccountCallNumbers(a.userId, deps())).toMatchObject({ decision: { keep: 0, reason: "subscription_ended" } });
    expect(await row(held[0].phone)).toMatchObject({ release_reason: "subscription_ended" });
  });
});
