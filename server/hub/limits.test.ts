/**
 * In-process gates (guardrails §5): the concurrency semaphore and the
 * circuit breaker. Budget order and "budget only on a model call" are
 * covered end to end in routes.test.ts.
 */
import { describe, expect, it } from "vitest";
import { Breaker, Semaphore, globalDailyCap, hubDailyLimits, maxConcurrency } from "./limits";
import { PLANS } from "@shared/plans";

describe("plan-aware daily caps", () => {
  it.each([
    ["starter", 40, 120], ["team", 40, 120], ["pro", 50, 120],
    ["growth", 150, 150], ["agency", 200, 200],
  ] as const)("%s uses its monthly allowance", (key, userDaily, ipDaily) => {
    expect(hubDailyLimits(PLANS[key].limits.gabeQuestions)).toEqual({ userDaily, ipDaily });
  });
  it("keeps anonymous/default caps and rounds fractional allowances up", () => {
    expect(hubDailyLimits()).toEqual({ userDaily: 40, ipDaily: 120 });
    expect(hubDailyLimits(null)).toEqual({ userDaily: 40, ipDaily: 120 });
    expect(hubDailyLimits(1001).userDaily).toBe(51);
  });
});

describe("Semaphore", () => {
  it("allows `max` calls in flight and one per owner", () => {
    const s = new Semaphore(() => 2);
    const a = s.tryAcquire("u1");
    expect(a).not.toBeNull();
    expect(s.tryAcquire("u1")).toBeNull(); // one per user
    const b = s.tryAcquire("u2");
    expect(b).not.toBeNull();
    expect(s.tryAcquire("u3")).toBeNull(); // global max
    a!(); a!(); // release is idempotent
    expect(s.size).toBe(1);
    expect(s.tryAcquire("u3")).not.toBeNull();
  });
});

describe("Breaker", () => {
  it("opens after 3 consecutive failures for 60 s, and a success resets the count", () => {
    let now = 0;
    const b = new Breaker(3, 60_000, () => now);
    b.failure(); b.failure(); b.success(); b.failure(); b.failure();
    expect(b.isOpen()).toBe(false);
    b.failure();
    expect(b.isOpen()).toBe(true);
    now = 59_999;
    expect(b.isOpen()).toBe(true);
    now = 60_000;
    expect(b.isOpen()).toBe(false);
  });
});

describe("env-tunable caps", () => {
  it("fall back to the spec defaults", () => {
    const keep = { cap: process.env.HUB_GLOBAL_DAILY_CAP, conc: process.env.HUB_MAX_CONCURRENCY };
    delete process.env.HUB_GLOBAL_DAILY_CAP; delete process.env.HUB_MAX_CONCURRENCY;
    expect(globalDailyCap()).toBe(1500);
    expect(maxConcurrency()).toBe(3);
    process.env.HUB_GLOBAL_DAILY_CAP = "nope";
    expect(globalDailyCap()).toBe(1500);
    process.env.HUB_GLOBAL_DAILY_CAP = keep.cap ?? ""; process.env.HUB_MAX_CONCURRENCY = keep.conc ?? "";
    if (keep.cap === undefined) delete process.env.HUB_GLOBAL_DAILY_CAP;
    if (keep.conc === undefined) delete process.env.HUB_MAX_CONCURRENCY;
  });
});
