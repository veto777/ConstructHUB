/**
 * The worker registry (server/workers.ts): every boot worker registers its timer; shutdown stops them in boot order
 * and waits (bounded) for the ticks in flight before the pool ends.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWorker, registeredWorkers, resetWorkersForTests, stopWorkers, workerInterval, workersStopping } from "./workers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("registerWorker / stopWorkers", () => {
  afterEach(() => { resetWorkersForTests(); vi.useRealTimers(); });

  it("stops every registered worker once, in registration order, then waits for the ticks in flight", async () => {
    const events: string[] = [];
    let inflightDone = false;
    const inflight = sleep(80).then(() => { inflightDone = true; });
    registerWorker("first", () => events.push("stop first"));
    registerWorker("second", () => events.push("stop second"), () => inflight);
    registerWorker("third", () => events.push("stop third"));
    expect(registeredWorkers()).toEqual(["first", "second", "third"]);
    expect(workersStopping()).toBe(false);

    const lines: string[] = [];
    const r = await stopWorkers({ log: (l) => lines.push(l), waitMs: 2_000 });
    expect(events).toEqual(["stop first", "stop second", "stop third"]);
    expect(inflightDone).toBe(true);
    expect(r.stopped).toEqual(["first", "second", "third"]);
    expect(r.unfinished).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(workersStopping()).toBe(true);
    expect(registeredWorkers()).toEqual([]);
    expect(lines).toEqual([expect.stringMatching(/^\[shutdown\] workers: 3 stopped in \d+ms$/)]);
    // A second call stops nothing more.
    expect((await stopWorkers({ log: () => {} })).stopped).toEqual([]);
  });

  it("gives the ticks in flight a bounded wait and names the ones still running", async () => {
    registerWorker("stuck", () => {}, () => new Promise(() => {}));
    registerWorker("quick", () => {}, () => sleep(10));
    const lines: string[] = [];
    const r = await stopWorkers({ log: (l) => lines.push(l), waitMs: 150 });
    expect(r.unfinished).toEqual(["stuck"]);
    expect(r.waitedMs).toBeGreaterThanOrEqual(140);
    expect(r.waitedMs).toBeLessThan(1_000);
    expect(lines[0]).toMatch(/still running: stuck$/);
  });

  it("a stop that throws is logged and does not stop the others; a late registration is stopped at once", async () => {
    const events: string[] = [];
    registerWorker("bad", () => { throw new Error("boom"); });
    registerWorker("good", () => events.push("stop good"));
    const lines: string[] = [];
    const r = await stopWorkers({ log: (l) => lines.push(l) });
    expect(r.failed).toEqual(["bad"]);
    expect(events).toEqual(["stop good"]);
    expect(lines[0]).toBe('[shutdown] worker "bad" stop failed: boom');
    registerWorker("late", () => events.push("stop late"));
    expect(events).toEqual(["stop good", "stop late"]);
    expect(registeredWorkers()).toEqual([]);
  });

  it("the unregister forgets a worker", async () => {
    const off = registerWorker("gone", () => { throw new Error("must not run"); });
    off();
    expect((await stopWorkers({ log: () => {} })).stopped).toEqual([]);
  });
});

describe("workerInterval", () => {
  afterEach(() => { resetWorkersForTests(); vi.useRealTimers(); });

  it("ticks on its interval and after firstAfterMs, never overlapping, and registers under its name", async () => {
    vi.useFakeTimers();
    let ticks = 0;
    let release!: () => void;
    const w = workerInterval("slow worker", () => { ticks++; return new Promise<void>((r) => { release = r; }); }, 100, { firstAfterMs: 10 });
    expect(registeredWorkers()).toEqual(["slow worker"]);
    expect(w.timer).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(ticks).toBe(1);
    await vi.advanceTimersByTimeAsync(300); // three intervals pass while the first tick still runs: no overlap
    expect(ticks).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(ticks).toBe(2);
  });

  it("stop() clears the timers, waits for the tick in flight, and no tick starts again", async () => {
    vi.useFakeTimers();
    let ticks = 0;
    let release!: () => void;
    let finished = false;
    workerInterval("worker", () => { ticks++; return new Promise<void>((r) => { release = r; }).then(() => { finished = true; }); }, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(ticks).toBe(1);
    const stopping = stopWorkers({ log: () => {}, waitMs: 5_000 });
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(500);
    expect(stopped).toBe(false); // waiting on the tick in flight
    release();
    await vi.advanceTimersByTimeAsync(0);
    const r = await stopping;
    expect(finished).toBe(true);
    expect(r.unfinished).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ticks).toBe(1);
  });

  it("a tick that throws or rejects reaches onError and the worker keeps ticking", async () => {
    vi.useFakeTimers();
    const errors: string[] = [];
    let n = 0;
    workerInterval("flaky", () => { n++; if (n === 1) throw new Error("sync"); if (n === 2) return Promise.reject(new Error("async")); }, 10, { onError: (e) => errors.push((e as Error).message) });
    await vi.advanceTimersByTimeAsync(35);
    expect(n).toBe(3);
    expect(errors).toEqual(["sync", "async"]);
  });

  it("started after shutdown began, it never ticks", async () => {
    vi.useFakeTimers();
    await stopWorkers({ log: () => {} });
    let ticks = 0;
    const w = workerInterval("too late", () => { ticks++; }, 10, { firstAfterMs: 0 });
    expect(w.stopped).toBe(true);
    expect(w.timer).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(ticks).toBe(0);
  });
});
