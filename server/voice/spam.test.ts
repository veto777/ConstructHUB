/**
 * Spam ledger (SPEC § 12) against the real lane DB: strikes, the two-strike
 * auto-block, the pre-answer status the engine asks for, unblock (strikes
 * start over), manual block, and per-org isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { cleanup, fakePhone, made, makeAccount, type Account } from "./calls-fixtures";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const bag = made();

let spam: typeof import("./spam");
let a: Account, b: Account;

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
  const { ensureVoiceSchema } = await import("./schema");
  await ensureVoiceSchema(pool);
  spam = await import("./spam");
  a = await makeAccount(pool, bag);
  b = await makeAccount(pool, bag);
});

afterAll(async () => {
  await cleanup(pool, bag);
  await pool.end();
  const { pool: appPool } = await import("../db");
  await appPool.end();
});

describe("spam thresholds", () => {
  it("match the compiler's sensitivity table (SPEC § 3)", () => {
    expect(spam.SPAM_THRESHOLDS_BY_SENSITIVITY).toEqual({
      low: { flagAt: 0.9, strikeAt: 0.98 }, normal: { flagAt: 0.8, strikeAt: 0.95 }, high: { flagAt: 0.7, strikeAt: 0.9 },
    });
    expect(spam.SPAM_STRIKES_TO_BLOCK).toBe(2);
  });
});

describe("unmistakable pitches", () => {
  it("raise a flagged call's confidence to the strike line; ordinary calls are untouched", async () => {
    const { spamConfidenceWithFloor } = await import("./spam");
    expect(spamConfidenceWithFloor(0.9, 0.95, "Google listing verification scam")).toBe(0.95);
    expect(spamConfidenceWithFloor(0.85, 0.95, null, "Hi, I'm calling about your Google Business listing, it's unverified")).toBe(0.95);
    expect(spamConfidenceWithFloor(0.85, 0.95, "vague caller", "press 1 to speak to an agent")).toBe(0.95);
    expect(spamConfidenceWithFloor(0.98, 0.95, "SEO pitch")).toBe(0.98);
    expect(spamConfidenceWithFloor(0.85, 0.95, "would not give an address", "I need my roof looked at")).toBe(0.85);
  });
});

describe("spam ledger (real DB)", () => {
  it("a flagged-but-not-certain verdict counts the call without a strike", async () => {
    const from = fakePhone();
    const r = await spam.recordSpamVerdict({ orgId: a.orgId, from, confidence: 0.85, reason: "maybe a pitch", strikeAt: 0.95 });
    expect(r).toEqual({ strikes: 0, calls: 1, blocked: false, strike: false });
    expect(await spam.callerSpamStatus(a.orgId, from)).toEqual({ blocked: false, strikes: 0, calls: 1 });
  });

  it("two near-certain verdicts block the number for that org only", async () => {
    const from = fakePhone();
    const first = await spam.recordSpamVerdict({ orgId: a.orgId, from, confidence: 0.97, reason: "Google listing pitch", strikeAt: 0.95 });
    expect(first).toMatchObject({ strikes: 1, blocked: false, strike: true });
    const second = await spam.recordSpamVerdict({ orgId: a.orgId, from: from.replace("+1", ""), confidence: 0.99, reason: "same pitch", strikeAt: 0.95 });
    expect(second).toMatchObject({ strikes: 2, calls: 2, blocked: true });
    expect((await spam.callerSpamStatus(a.orgId, from)).blocked).toBe(true);
    const { rows: [row] } = await pool.query("select * from voice_spam where org_id = $1 and phone_number = $2", [a.orgId, from]);
    expect(row.blocked_by).toBe("auto");
    expect(Number(row.last_confidence)).toBe(0.99);
    expect(row.last_reason).toBe("same pitch");
    // No cross-org list in v1.
    expect((await spam.callerSpamStatus(b.orgId, from)).blocked).toBe(false);

    // A rejected call from the blocked number is counted, still blocked.
    await spam.recordBlockedCall(a.orgId, from, null);
    expect(await spam.callerSpamStatus(a.orgId, from)).toEqual({ blocked: true, strikes: 2, calls: 3 });
  });

  it("unblock resets the strikes: one more strike does not re-block, two do", async () => {
    const from = fakePhone();
    await spam.recordSpamVerdict({ orgId: a.orgId, from, confidence: 1, reason: "x", strikeAt: 0.95 });
    await spam.recordSpamVerdict({ orgId: a.orgId, from, confidence: 1, reason: "x", strikeAt: 0.95 });
    const { rows: [row] } = await pool.query("select id from voice_spam where org_id = $1 and phone_number = $2", [a.orgId, from]);
    // Org-scoped by id: another org cannot unblock it.
    expect(await spam.unblockNumber(b.orgId, row.id)).toBeNull();
    const un = await spam.unblockNumber(a.orgId, row.id);
    expect(un && spam.isBlocked(un)).toBe(false);
    expect(un?.strikes).toBe(0);
    expect((await spam.recordSpamVerdict({ orgId: a.orgId, from, confidence: 1, reason: "x", strikeAt: 0.95 }))?.blocked).toBe(false);
    expect((await spam.recordSpamVerdict({ orgId: a.orgId, from, confidence: 1, reason: "x", strikeAt: 0.95 }))?.blocked).toBe(true);
  });

  it("a manual block carries the member id and is listed blocked", async () => {
    const from = fakePhone();
    const row = await spam.blockNumber(a.orgId, from, a.memberId, "Blocked by hand");
    expect(row?.blockedBy).toBe(a.memberId);
    expect(await spam.blockNumber(a.orgId, "abc", a.memberId)).toBeNull();
    const list = (await spam.listSpamLedger(a.orgId)).map(spam.presentSpamRow);
    expect(list.find((e) => e.phoneNumber === from)).toMatchObject({ blocked: true, blockedBy: a.memberId });
    expect(list.every((e) => typeof e.blocked === "boolean")).toBe(true);
  });

  it("an unusable caller id is never stored", async () => {
    expect(await spam.recordSpamVerdict({ orgId: a.orgId, from: "anonymous", confidence: 1, reason: "x" })).toBeNull();
    expect(await spam.callerSpamStatus(a.orgId, null)).toEqual({ blocked: false, strikes: 0, calls: 0 });
  });

  it("isBlocked: an unblock after the block wins; a re-block after the unblock wins", () => {
    const t = (s: string) => new Date(`2026-10-01T${s}:00Z`);
    expect(spam.isBlocked({ blockedAt: null, unblockedAt: null })).toBe(false);
    expect(spam.isBlocked({ blockedAt: t("10:00"), unblockedAt: null })).toBe(true);
    expect(spam.isBlocked({ blockedAt: t("10:00"), unblockedAt: t("11:00") })).toBe(false);
    expect(spam.isBlocked({ blockedAt: t("12:00"), unblockedAt: t("11:00") })).toBe(true);
  });
});
