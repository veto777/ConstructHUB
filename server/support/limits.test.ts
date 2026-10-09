import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real deps (growth_budgets, support_calls, the issue desk) are injected here; the module's own imports of them are
// never exercised, so the database module is a stub like the neighbouring voice tests use.
vi.mock("../db", () => ({ pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }, db: {} }));
vi.mock("../ops/issues", () => ({ recordIssue: vi.fn(async () => {}) }));

import { codeSendGate, DAY, HOUR, LIMITS, type Budget } from "./limits";

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
