import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real deps (growth_budgets, support_calls, the issue desk) are injected here; the module's own imports of them are
// never exercised, so the database module is a stub like the neighbouring voice tests use.
vi.mock("../db", () => ({ pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }, db: {} }));
vi.mock("../ops/issues", () => ({ recordIssue: vi.fn(async () => {}) }));

import { admitIvrCall, codeSendGate, DAY, HOUR, LIMITS, meterCall, minutesExhausted, settleSupportCall, type Budget, type CallStore } from "./limits";

/** growth_budgets in memory: the same semantics as takeBudget (atomic, all-or-nothing, windowed). */
function fakeBudget(now = () => 1_800_000_000_000) {
  const used = new Map<string, number>();
  const k = (key: string, w: number) => `${key}@${Math.floor(now() / w)}`;
  const b: Budget = {
    async take(key, limit, amount, w) {
      if (limit === -1) return true;
      if (amount < 1 || amount > limit) return false;
      const cur = used.get(k(key, w)) ?? 0;
      if (cur + amount > limit) return false;
      used.set(k(key, w), cur + amount); return true;
    },
    async used(key, w) { return used.get(k(key, w)) ?? 0; },
  };
  return { b, used, keyAt: k };
}
function fakeIssues() { const list: string[] = []; return { list, issue: (i: { key: string }) => { list.push(i.key); } }; }
function fakeStore(calls: Record<string, { caller: string; startedMs: number; metered?: number; ended?: boolean; line?: string }>) {
  const store: CallStore = {
    async activeIvr(exceptSid, caller) { return Object.entries(calls).filter(([sid, c]) => sid !== exceptSid && !c.ended && (c.line ?? "ivr") === "ivr" && (!caller || c.caller === caller)).length; },
    async clock(sid) { const c = calls[sid]; return c ? { startedMs: c.startedMs, meteredSeconds: c.metered ?? 0 } : null; },
    async addMetered(sid, s) { calls[sid].metered = (calls[sid].metered ?? 0) + s; },
    async end(sid) { calls[sid].ended = true; },
  };
  return store;
}
const ACCT = { userId: 7, phones: ["+15555550123"] };
const ENV = ["SUPPORT_CODES_PER_HOUR", "SUPPORT_CODE_CALLERS_PER_ACCOUNT_DAY", "SUPPORT_IVR_MAX_CALLS", "SUPPORT_IVR_MAX_CALLS_PER_CALLER", "SUPPORT_IVR_CALLS_PER_CALLER_DAY", "SUPPORT_IVR_MAX_CALL_SECONDS", "SUPPORT_LINE_DAILY_MINUTES"];
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => { for (const k of ENV) delete process.env[k]; });

describe("S-10 — one-time-code budgets are the caller's, never the customer's", () => {
  it("defaults: 3 an hour per caller, 2 an hour and 6 a day per (caller, account), 300 an hour overall, 4 callers per account a day", () => {
    expect([LIMITS.codesPerCallerHour, LIMITS.codesPerPairHour, LIMITS.codesPerPairDay, LIMITS.codesPerHour(), LIMITS.codeCallersPerTargetDay()]).toEqual([3, 2, 6, 300, 4]);
  });
  it("a stranger who burns their allowance against an account leaves the account holder's untouched", async () => {
    const { b } = fakeBudget(), { issue } = fakeIssues();
    // the stranger: 2 codes an hour against account 7, then silence (same words, nothing sent)
    expect(await codeSendGate(ACCT, "12345678", "+19990001111", b, issue)).toBe("send");
    expect(await codeSendGate(ACCT, "12345678", "+19990001111", b, issue)).toBe("send");
    expect(await codeSendGate(ACCT, "12345678", "+19990001111", b, issue)).toBe("silent");
    // the customer, from their own phone, right after: served
    expect(await codeSendGate(ACCT, "12345678", "+15555550123", b, issue)).toBe("send");
    expect(await codeSendGate(ACCT, "12345678", "+15555550123", b, issue)).toBe("send");
    // and so is a second legitimate caller for the same account (an employee's phone)
    expect(await codeSendGate(ACCT, "12345678", "+14440002222", b, issue)).toBe("send");
  });
  it("the per-caller hourly budget refuses audibly, and identically for a real and a made-up account", async () => {
    const { b } = fakeBudget(), { issue } = fakeIssues();
    const seq: string[] = [];
    for (let i = 0; i < 4; i++) seq.push(await codeSendGate(ACCT, "12345678", "+1999", b, issue));
    expect(seq).toEqual(["send", "send", "silent", "refuse"]);   // 2 per pair, then the caller's 3rd, then the caller's cap
    const { b: b2 } = fakeBudget();
    const miss: string[] = [];
    for (let i = 0; i < 4; i++) miss.push(await codeSendGate(null, "87654321", "+1999", b2, issue));
    expect(miss).toEqual(["silent", "silent", "silent", "refuse"]);   // the same budget work, the same audible refusal on the 4th
  });
  it("hit and miss do the same budget work (no timing oracle): identical key shapes, identical call counts", async () => {
    const calls = { hit: [] as string[], miss: [] as string[] };
    const spy = (log: string[]): Budget => { const { b } = fakeBudget(); return { take: (k, l, a, w) => { log.push(`take ${k.replace(/acct:\d+|miss:[0-9a-f]+/, "T").replace(/from:[0-9a-f]+/, "from:C")}`); return b.take(k, l, a, w); }, used: (k, w) => { log.push(`used ${k.replace(/acct:\d+|miss:[0-9a-f]+/, "T").replace(/from:[0-9a-f]+/, "from:C")}`); return b.used(k, w); } }; };
    const { issue } = fakeIssues();
    await codeSendGate(ACCT, "12345678", "+1999", spy(calls.hit), issue);
    await codeSendGate(null, "00000000", "+1999", spy(calls.miss), issue);
    expect(calls.miss).toEqual(calls.hit);
    expect(calls.hit.length).toBeGreaterThan(3);
  });
  it("too many distinct callers for one account in a day: the new caller is locked (silently), earlier callers and the phone on file still work, ops is told", async () => {
    const { b } = fakeBudget(), { issue, list } = fakeIssues();
    for (let i = 1; i <= 4; i++) expect(await codeSendGate(ACCT, "12345678", `+1700000000${i}`, b, issue)).toBe("send");
    expect(await codeSendGate(ACCT, "12345678", "+17000000005", b, issue)).toBe("silent");
    expect(await codeSendGate(ACCT, "12345678", "+17000000005", b, issue)).toBe("silent");   // stays locked — it took nothing
    expect(list).toEqual(["code-probe|acct:7", "code-probe|acct:7"]);
    expect(await codeSendGate(ACCT, "12345678", "+17000000001", b, issue)).toBe("send");     // already on today's list
    expect(await codeSendGate(ACCT, "12345678", "+15555550123", b, issue)).toBe("send");     // the account's own phone
    // a made-up identifier gets the same ceiling (same words, nothing sent either way; no issue — there is no account)
    for (let i = 1; i <= 4; i++) await codeSendGate(null, "11112222", `+1800000000${i}`, b, issue);
    expect(await codeSendGate(null, "11112222", "+18000000005", b, issue)).toBe("silent");
    expect(list.length).toBe(2);
  });
  it("the line-wide hourly cap refuses audibly and raises an ops issue; it is configurable", async () => {
    process.env.SUPPORT_CODES_PER_HOUR = "2";
    const { b } = fakeBudget(), { issue, list } = fakeIssues();
    expect(await codeSendGate(ACCT, "1", "+1001", b, issue)).toBe("send");
    expect(await codeSendGate(ACCT, "1", "+1002", b, issue)).toBe("send");
    expect(await codeSendGate(ACCT, "1", "+1003", b, issue)).toBe("refuse");
    expect(list).toEqual(["codes-per-hour"]);
  });
  it("the day budget per pair is 6 and the window rolls", async () => {
    let t = 1_800_000_000_000;
    const { b } = fakeBudget(() => t), { issue } = fakeIssues();
    const got: string[] = [];
    for (let h = 0; h < 4; h++) { got.push(await codeSendGate(ACCT, "1", "+1999", b, issue), await codeSendGate(ACCT, "1", "+1999", b, issue)); t += HOUR; }
    expect(got.filter((g) => g === "send").length).toBe(6);
    t += DAY;
    expect(await codeSendGate(ACCT, "1", "+1999", b, issue)).toBe("send");
  });
});

describe("S-11 — the keypad line has a ceiling", () => {
  it("defaults: 10 calls at once, 2 per caller, 10 a day per caller, 6-minute calls, 600 minutes a day", () => {
    expect([LIMITS.ivrMaxCalls(), LIMITS.ivrMaxCallsPerCaller(), LIMITS.ivrCallsPerCallerDay(), LIMITS.ivrMaxCallSeconds(), LIMITS.dailyMinutes()]).toEqual([10, 2, 10, 360, 600]);
    process.env.SUPPORT_IVR_MAX_CALLS = "3"; process.env.SUPPORT_LINE_DAILY_MINUTES = "-1"; process.env.SUPPORT_IVR_MAX_CALL_SECONDS = "junk";
    expect([LIMITS.ivrMaxCalls(), LIMITS.dailyMinutes(), LIMITS.ivrMaxCallSeconds()]).toEqual([3, -1, 360]);
  });
  it("the 11th concurrent keypad call hears busy and ops is told; a finished call frees its seat; a re-sent webhook keeps its own", async () => {
    const calls: Record<string, any> = {};
    for (let i = 0; i < 10; i++) calls[`CA${i}`] = { caller: `+1${i}`, startedMs: 0 };
    const store = fakeStore(calls), { b } = fakeBudget(), { issue, list } = fakeIssues();
    expect(await admitIvrCall("CAnew", "+1555", true, { store, budget: b, issue })).toEqual({ ok: false, why: "busy" });
    expect(list).toEqual(["ivr-busy"]);
    expect(await admitIvrCall("CA3", "+13", false, { store, budget: b, issue })).toEqual({ ok: true });   // the carrier re-sent CA3's webhook
    await store.end("CA0");
    expect(await admitIvrCall("CAnew", "+1555", true, { store, budget: b, issue })).toEqual({ ok: true });
  });
  it("the cap is configurable, and spoken (engine) calls don't count against the keypad seats", async () => {
    process.env.SUPPORT_IVR_MAX_CALLS = "1";
    const store = fakeStore({ CA1: { caller: "+11", startedMs: 0 }, CA2: { caller: "+12", startedMs: 0, line: "engine" } });
    const { b } = fakeBudget(), { issue } = fakeIssues();
    expect(await admitIvrCall("CA3", "+13", true, { store, budget: b, issue })).toEqual({ ok: false, why: "busy" });
    process.env.SUPPORT_IVR_MAX_CALLS = "2";
    expect(await admitIvrCall("CA3", "+13", true, { store, budget: b, issue })).toEqual({ ok: true });
  });
  it("one caller number: at most 2 keypad calls at once and 10 a day", async () => {
    const store = fakeStore({ CA1: { caller: "+1555", startedMs: 0 }, CA2: { caller: "+1555", startedMs: 0 } });
    const { b } = fakeBudget(), { issue, list } = fakeIssues();
    expect(await admitIvrCall("CA3", "+1555", true, { store, budget: b, issue })).toEqual({ ok: false, why: "caller_busy" });
    expect(await admitIvrCall("CA3", "+1666", true, { store, budget: b, issue })).toEqual({ ok: true });   // someone else is fine
    const quiet = fakeStore({});
    for (let i = 0; i < 10; i++) expect((await admitIvrCall(`CB${i}`, "+1777", true, { store: quiet, budget: b, issue })).ok).toBe(true);
    expect(await admitIvrCall("CB10", "+1777", true, { store: quiet, budget: b, issue })).toEqual({ ok: false, why: "caller_day" });
    expect(await admitIvrCall("CB10", "+1777", false, { store: quiet, budget: b, issue })).toEqual({ ok: true });   // a re-sent webhook costs no daily call
    expect(list).toEqual(["ivr-caller-busy", "ivr-caller-day"]);
  });
  it("metering: each turn adds the seconds since the last one (bounded), the call's age is reported for the per-call cap", async () => {
    const calls = { CA1: { caller: "+1", startedMs: 1_000_000 } };
    const store = fakeStore(calls), { b, used, keyAt } = fakeBudget(), { issue } = fakeIssues();
    expect(await meterCall("CA1", 1_000_000 + 30_000, { store, budget: b, issue })).toEqual({ ok: true, total: 30 });
    expect(await meterCall("CA1", 1_000_000 + 95_000, { store, budget: b, issue })).toEqual({ ok: true, total: 95 });
    expect(calls.CA1.metered).toBe(95);
    expect(used.get(keyAt("support:minutes:d", DAY))).toBe(95);
    // a clock that jumped an hour meters at most one turn's worth
    expect((await meterCall("CA1", 1_000_000 + 3_700_000, { store, budget: b, issue })).total).toBe(3700);
    expect(calls.CA1.metered).toBe(95 + LIMITS.maxSecondsPerTurn);
    // the per-call cap is the caller's decision (service.ts): the keypad line ends at 360 s by default
    expect(LIMITS.ivrMaxCallSeconds()).toBe(360);
    // an unknown call meters nothing and is fine
    expect(await meterCall("nope", 5, { store, budget: b, issue })).toEqual({ ok: true, total: 0 });
  });
  it("the day's minutes: spent → new calls are refused with 'call back', a running call ends at its next turn, ops is told once per key", async () => {
    process.env.SUPPORT_LINE_DAILY_MINUTES = "2";   // 120 s
    const calls = { CA1: { caller: "+1", startedMs: 0 }, CA2: { caller: "+2", startedMs: 0 } };
    const store = fakeStore(calls), { b, used, keyAt } = fakeBudget(), { issue, list } = fakeIssues();
    expect(await minutesExhausted(b)).toBe(false);
    expect((await meterCall("CA1", 100_000, { store, budget: b, issue })).ok).toBe(true);          // 100 s used
    expect((await meterCall("CA2", 50_000, { store, budget: b, issue })).ok).toBe(false);          // 50 more don't fit: the day is marked spent
    expect(used.get(keyAt("support:minutes:d", DAY))).toBe(120);
    expect(await minutesExhausted(b)).toBe(true);
    expect(await admitIvrCall("CA3", "+3", true, { store, budget: b, issue })).toEqual({ ok: false, why: "minutes" });
    expect(list).toEqual(["daily-minutes", "daily-minutes"]);
    // -1 = unlimited; 0 = closed
    process.env.SUPPORT_LINE_DAILY_MINUTES = "-1";
    expect(await minutesExhausted(b)).toBe(false);
    expect((await meterCall("CA2", 400_000, { store, budget: b, issue })).ok).toBe(true);
    process.env.SUPPORT_LINE_DAILY_MINUTES = "0";
    expect(await minutesExhausted(b)).toBe(true);
  });
  it("the carrier's status callback settles the exact duration and marks the call over; a Call Assistant sid is not ours", async () => {
    const calls: Record<string, any> = { CA1: { caller: "+1", startedMs: 0, metered: 40 } };
    const store = fakeStore(calls), { b, used, keyAt } = fakeBudget();
    expect(await settleSupportCall("CA1", 130, { store, budget: b })).toBe(true);
    expect(calls.CA1).toMatchObject({ metered: 130, ended: true });
    expect(used.get(keyAt("support:minutes:d", DAY))).toBe(90);
    expect(await settleSupportCall("CA1", 100, { store, budget: b })).toBe(true);   // shorter than metered: nothing more
    expect(calls.CA1.metered).toBe(130);
    expect(await settleSupportCall("CAx", 10, { store, budget: b })).toBe(false);
    expect(await store.activeIvr("other", null)).toBe(0);   // the ended call holds no seat
  });
});
