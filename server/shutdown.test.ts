/**
 * Graceful shutdown (server/shutdown.ts; reliability review H5): a stop finishes the requests in flight, stops
 * accepting new ones, runs the hooks, waits for tracked background work, closes the pool and exits 0; a request that
 * never ends is cut at the drain deadline rather than holding the process.
 */
import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { inflightCount, onShutdown, resetShutdownStateForTests, shutdown, trackRequests, trackWork, trackedWorkCount, isShuttingDown } from "./shutdown";

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
