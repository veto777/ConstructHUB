/**
 * In-process gates (guardrails §5): the concurrency semaphore and the
 * circuit breaker. Budget order and "budget only on a model call" are
 * covered end to end in routes.test.ts.
 */
import { describe, expect, it } from "vitest";
import { Breaker, Semaphore, globalDailyCap, maxConcurrency } from "./limits";

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
