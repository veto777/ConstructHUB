import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ usage: new Map<string, number>(), failMeter: false }));
vi.mock("../account/api-keys", () => ({
  apiMonthResetsAt: () => "2099-01-01T00:00:00.000Z",
  monthlyUsage: async (key: string) => {
    const snapshot = { key: state.usage.get(key) || 0, user: [...state.usage.values()].reduce((a, b) => a + b, 0) };
    await new Promise(r => setTimeout(r, 5));
    return snapshot;
  },
  recordUnits: async (key: string, _user: number, units: number) => {
    await new Promise(r => setTimeout(r, 5));
    if (state.failMeter) throw new Error("CODEX-meter-outage");
    state.usage.set(key, (state.usage.get(key) || 0) + units);
  },
}));
import { quota } from "./quota";

let server: ReturnType<express.Express["listen"]>, base: string;
beforeAll(async () => {
  const app = express();
  app.use((req: any, _res, next) => {
    req.publicApi = { userId: 123, key: { id: String(req.query.key || "CODEX-key"), monthlyUnitLimit: Number(req.query.cap || 100) }, plan: { unitsPerMonth: Number(req.query.plan || 100), key: "pro", requiredPlan: "pro" } };
    next();
  });
  app.use(quota);
  app.get("/", (req, res) => { res.json({ data: Array(Number(req.query.rows || 0)).fill({ ok: true }) }); });
  app.get("/error", (_req, res) => { res.status(400).json({ error: { code: "validation_error" } }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { state.usage.clear(); state.failMeter = false; });
const get = async (path: string) => { const r = await fetch(base + path); return { status: r.status, remaining: r.headers.get("X-Units-Remaining"), body: await r.json() }; };

describe("monthly API quota under concurrent requests", () => {
  it("allows only one concurrent read against a one-unit key cap", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => get("/?cap=1")));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 429)).toHaveLength(7);
    expect(state.usage.get("CODEX-key")).toBe(1);
  });
  it("shares the account cap across different keys", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => get(`/?plan=1&key=CODEX-${i}`)));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
  });
  it("refuses a large read when its actual row cost exceeds the remaining cap", async () => {
    const r = await get("/?cap=1&rows=100");
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("quota_exceeded");
    expect(state.usage.size).toBe(0);
  });
  it("returns remaining units after charging the actual row count", async () => {
    const r = await get("/?cap=10&rows=200");
    expect(r.status).toBe(200);
    expect(r.remaining).toBe("7");
    expect(state.usage.get("CODEX-key")).toBe(3);
  });
  it("does not meter failures or leave the account locked after one", async () => {
    const error = await get("/error?cap=1");
    expect(error.status).toBe(400);
    expect(error.remaining).toBe("1");
    expect((await get("/?cap=1")).status).toBe(200);
    expect(state.usage.get("CODEX-key")).toBe(1);
  });
  it("reports a metering outage instead of silently returning unmetered data", async () => {
    state.failMeter = true;
    const r = await get("/");
    expect(r.status).toBe(503);
    expect(r.body).toHaveProperty("error");
  });
});
