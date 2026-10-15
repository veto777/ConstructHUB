/**
 * Graceful shutdown (server/shutdown.ts; reliability review H5): a stop finishes the requests in flight, stops
 * accepting new ones, runs the hooks, waits for tracked background work, closes the pool and exits 0; a request that
 * never ends is cut at the drain deadline rather than holding the process.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { inflightCount, onShutdown, resetShutdownStateForTests, shutdown, trackRequests, trackWork, trackedWorkCount, isShuttingDown } from "./shutdown";
import { registerWorker, registeredWorkers, workerInterval } from "./workers";
import { createIssueRecorder, recordFailure } from "./ops/issues";

// The issue desk's default pool must never be touched once shutdown began (the second describe below).
vi.mock("./db", () => ({ pool: { query: vi.fn(async () => { throw new Error("the pool must not be used after shutdown began"); }) } }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listening(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}` };
}

describe("shutdown", () => {
  afterEach(() => resetShutdownStateForTests());

  it("finishes the request in flight, refuses new ones, runs hooks, waits for tracked work, closes the pool, exits 0", async () => {
    const app = express();
    app.use(trackRequests);
    app.get("/slow", async (_req, res) => { await sleep(300); res.json({ ok: true }); });
    app.get("/fast", (_req, res) => res.json({ ok: true }));
    const { server, url } = await listening(app);
    const events: string[] = [];
    onShutdown("worker timer", () => { events.push("hook"); });
    let workDone = false;
    void trackWork("paid lookup", sleep(200).then(() => { workDone = true; }));
    const slow = fetch(`${url}/slow`);
    await sleep(30);
    expect(inflightCount()).toBe(1);
    expect(trackedWorkCount()).toBe(1);

    let exitCode: number | null = null;
    const done = shutdown("SIGTERM", {
      server, drainMs: 5_000, log: (l) => events.push(l), exit: (c) => { exitCode = c; events.push(`exit ${c}`); },
      closePools: async () => { events.push("pools closed"); },
    });
    await sleep(60);
    expect(isShuttingDown()).toBe(true);
    // A new connection is refused once the listener closed.
    await expect(fetch(`${url}/fast`)).rejects.toThrow();
    const res = await slow;
    expect(res.status).toBe(200);
    await done;
    expect(workDone).toBe(true);
    expect(exitCode).toBe(0);
    expect(events.indexOf("hook")).toBeLessThan(events.indexOf("pools closed"));
    expect(events.at(-2)).toMatch(/^\[shutdown\] done in \d+ms$/);
    expect(events.at(-1)).toBe("exit 0");
    expect(inflightCount()).toBe(0);
  });

  it("a request that never ends is cut at the drain deadline and counted as left behind", async () => {
    const app = express();
    app.use(trackRequests);
    app.get("/hang", () => { /* never answers */ });
    const { server, url } = await listening(app);
    const hung = fetch(`${url}/hang`).catch((e) => e);
    await sleep(30);
    const events: string[] = [];
    const started = Date.now();
    await shutdown("SIGTERM", { server, drainMs: 300, log: (l) => events.push(l), exit: (c) => events.push(`exit ${c}`), closePools: async () => {} });
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(events.some((l) => /drain ended after \d+ms with 1 request\(s\) and 0 task\(s\) left behind/.test(l))).toBe(true);
    expect(events.at(-2)).toMatch(/\(1 left behind\)$/);
    expect(await hung).toBeInstanceOf(Error); // the connection was cut
  });

  it("a second signal exits at once", async () => {
    const app = express();
    const { server } = await listening(app);
    const codes: number[] = [];
    const first = shutdown("SIGTERM", { server, drainMs: 500, log: () => {}, exit: (c) => codes.push(c), closePools: async () => {} });
    await shutdown("SIGTERM", { server, drainMs: 500, log: () => {}, exit: (c) => codes.push(c), closePools: async () => {} });
    expect(codes).toEqual([1]);
    await first;
    expect(codes).toEqual([1, 0]);
  });
});

describe("shutdown and the workers (2026-10-15: no tick on an ended pool)", () => {
  afterEach(() => resetShutdownStateForTests());

  it("stops the registered workers in boot order, waits for their ticks, then runs the hooks, then closes the pool", async () => {
    const app = express();
    app.use(trackRequests);
    const { server } = await listening(app);
    const events: string[] = [];
    // Three workers of the two kinds: a guarded interval mid-tick, a self-timed one, and a plain registration.
    let release!: () => void;
    const tickInFlight = new Promise<void>((r) => { release = r; });
    let ticks = 0;
    workerInterval("ads worker", () => { ticks++; events.push("ads tick"); return tickInFlight.then(() => events.push("ads tick done")); }, 5, { firstAfterMs: 0 });
    const own = setInterval(() => events.push("own tick"), 1_000);
    registerWorker("competitor worker", () => { clearInterval(own); events.push("stop competitor"); });
    registerWorker("disk watch", () => events.push("stop disk"));
    onShutdown("queue flush", () => events.push("hook"));
    await sleep(20);
    expect(ticks).toBe(1); // parked on its first tick
    expect(registeredWorkers()).toEqual(["ads worker", "competitor worker", "disk watch"]);

    let exitCode: number | null = null;
    const done = shutdown("SIGTERM", {
      server, drainMs: 2_000, workersMs: 2_000, log: (l) => events.push(l), exit: (c) => { exitCode = c; },
      closePools: async () => { events.push("pools closed"); },
    });
    await sleep(100);
    expect(events).not.toContain("pools closed"); // waiting for the ads tick, pool untouched
    release();
    await done;
    expect(exitCode).toBe(0);
    expect(ticks).toBe(1); // no tick started once stopping began
    const at = (e: string) => events.indexOf(e);
    expect(at("stop competitor")).toBeGreaterThan(-1);
    expect(at("stop competitor")).toBeLessThan(at("stop disk"));
    expect(at("ads tick done")).toBeLessThan(at("hook"));
    expect(at("hook")).toBeLessThan(at("pools closed"));
    expect(events.filter((e) => e.startsWith("[shutdown] workers:"))).toEqual([expect.stringMatching(/^\[shutdown\] workers: 3 stopped in \d+ms$/)]);
    expect(registeredWorkers()).toEqual([]);
  });

  it("a worker whose tick never ends is left behind after the bounded wait and the pool still closes", async () => {
    const app = express();
    const { server } = await listening(app);
    const events: string[] = [];
    registerWorker("stuck worker", () => events.push("stop stuck"), () => new Promise(() => {}));
    let exitCode: number | null = null;
    await shutdown("SIGTERM", {
      server, drainMs: 1_000, workersMs: 150, log: (l) => events.push(l), exit: (c) => { exitCode = c; },
      closePools: async () => { events.push("pools closed"); },
    });
    expect(exitCode).toBe(0);
    expect(events.find((e) => e.startsWith("[shutdown] workers:"))).toMatch(/still running: stuck worker$/);
    expect(events.indexOf("stop stuck")).toBeLessThan(events.indexOf("pools closed"));
  });

  it("the issue desk stops recording once shutdown began (a failed tick never reaches the ended pool)", async () => {
    const app = express();
    const { server } = await listening(app);
    const writes: string[] = [];
    const fake = { query: async (sql: string) => { writes.push(sql); return { rows: [{ id: 1 }], rowCount: 1 }; } };
    const desk = createIssueRecorder({ pool: fake as any, minIntervalMs: 0 });
    await desk.record({ source: "job", title: "before", key: "k1", detail: {} });
    expect(writes.length).toBeGreaterThan(0);
    const before = writes.length;

    await shutdown("SIGTERM", { server, drainMs: 100, workersMs: 100, log: () => {}, exit: () => {}, closePools: async () => {} });
    expect(isShuttingDown()).toBe(true);
    await desk.record({ source: "job", title: "after", key: "k2", detail: {} });
    await desk.flush();
    expect(writes.length).toBe(before);
    // The default recorder (what every worker's catch calls) is a no-op too: the mocked db pool above would throw.
    const { pool } = await import("./db");
    await expect(recordFailure("job", "Ads worker tick", new Error("Cannot use a pool after calling end on the pool"))).resolves.toBeUndefined();
    expect(vi.mocked(pool.query)).not.toHaveBeenCalled();
  });
});
