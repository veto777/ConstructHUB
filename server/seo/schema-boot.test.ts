/**
 * The SEO schema boot step (server/seo/schema.ts, server/seo/boot.ts; reliability review H1): a boot whose DDL list
 * is already applied runs no DDL; a change runs the list with lock/statement timeouts on one connection; indexes
 * build concurrently; a failure disables the module for the process instead of crashing the boot.
 */
import { describe, expect, it } from "vitest";
import express from "express";
import { SEO_SCHEMA_DDL, SEO_SCHEMA_KEY, concurrentIndexStatement, ensureSeoSchema, runSeoDdlStatement, seoSchemaHash, type DdlClient } from "./schema";
import { bootSeoModule, seoModule, seoUnavailableHandler } from "./boot";

/** A connection that records statements; `invalidIndexes` are names pg says are INVALID; `failOn` makes one statement throw. */
function fakeClient(opts: { invalidIndexes?: string[]; failOn?: RegExp } = {}) {
  const log: string[] = [];
  let released: Error | undefined | "ok";
  const client: DdlClient & { release: (err?: Error) => void } = {
    query: async (sql: string, params?: unknown[]) => {
      const flat = sql.replace(/\s+/g, " ").trim();
      log.push(params ? `${flat} ${JSON.stringify(params)}` : flat);
      if (opts.failOn?.test(flat)) throw Object.assign(new Error("relation is locked"), { code: "55P03" });
      if (/FROM pg_index/.test(flat)) return { rows: opts.invalidIndexes?.includes(String(params?.[0])) ? [{ 1: 1 }] : [] };
      return { rows: [] };
    },
    release: (err?: Error) => { released = err ?? "ok"; },
  };
  return { client, log, released: () => released };
}

describe("the schema hash", () => {
  it("is stable for one list and changes with any statement", () => {
    expect(seoSchemaHash()).toBe(seoSchemaHash(SEO_SCHEMA_DDL));
    expect(seoSchemaHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(seoSchemaHash([...SEO_SCHEMA_DDL, "ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS x text"])).not.toBe(seoSchemaHash());
    expect(seoSchemaHash(["a", "b"])).not.toBe(seoSchemaHash(["ab"]));
  });
});

describe("index statements", () => {
  it("are rewritten to concurrent builds, with the index's name; other statements are left alone", () => {
    expect(concurrentIndexStatement("CREATE INDEX IF NOT EXISTS seo_alerts_user ON seo_alerts(user_id, created_at DESC)"))
      .toEqual({ name: "seo_alerts_user", sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS seo_alerts_user ON seo_alerts(user_id, created_at DESC)" });
    expect(concurrentIndexStatement("  CREATE UNIQUE INDEX IF NOT EXISTS seo_rank_runs_one_active ON seo_rank_runs(site_id) WHERE status IN ('queued','running')")?.sql)
      .toMatch(/^\s*CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS seo_rank_runs_one_active ON/);
    expect(concurrentIndexStatement("CREATE TABLE IF NOT EXISTS seo_x (id int)")).toBeNull();
    expect(concurrentIndexStatement("ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS planner jsonb")).toBeNull();
    // Every index in the real list is recognised (none slips through as a blocking build).
    const indexes = SEO_SCHEMA_DDL.filter((s) => /^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(s));
    expect(indexes.length).toBeGreaterThan(5);
    for (const s of indexes) expect(concurrentIndexStatement(s), s).not.toBeNull();
  });

  it("drop an INVALID leftover before building, and drop their own failed build", async () => {
    const ok = fakeClient({ invalidIndexes: ["seo_alerts_user"] });
    await runSeoDdlStatement(ok.client, "CREATE INDEX IF NOT EXISTS seo_alerts_user ON seo_alerts(user_id)");
    expect(ok.log.filter((l) => !/pg_index/.test(l))).toEqual([
      "DROP INDEX CONCURRENTLY IF EXISTS seo_alerts_user",
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS seo_alerts_user ON seo_alerts(user_id)",
    ]);
    const bad = fakeClient({ failOn: /CREATE INDEX CONCURRENTLY/ });
    await expect(runSeoDdlStatement(bad.client, "CREATE INDEX IF NOT EXISTS seo_alerts_user ON seo_alerts(user_id)")).rejects.toThrow("relation is locked");
    expect(bad.log.at(-1)).toBe("DROP INDEX CONCURRENTLY IF EXISTS seo_alerts_user");
  });
});

describe("ensureSeoSchema with a connection of its own", () => {
  it("sets lock and statement timeouts first, runs every statement, remembers the hash last, and resets the session", async () => {
    const f = fakeClient();
    const out = await ensureSeoSchema({ force: true, connect: async () => f.client });
    expect(out.skipped).toBe(false);
    expect(out.ran).toBe(SEO_SCHEMA_DDL.length);
    expect(f.log[0]).toBe("SET lock_timeout = 5000");
    expect(f.log[1]).toBe("SET statement_timeout = 60000");
    const remember = f.log.findIndex((l) => l.startsWith("INSERT INTO seed_state(key, hash, row_count)"));
    expect(remember).toBeGreaterThan(SEO_SCHEMA_DDL.length);
    expect(f.log[remember]).toContain(JSON.stringify([SEO_SCHEMA_KEY, out.hash, SEO_SCHEMA_DDL.length]));
    expect(f.log.slice(-2)).toEqual(["RESET lock_timeout", "RESET statement_timeout"]);
    expect(f.released()).toBe("ok");
  });

  it("a failing statement throws with its position, remembers nothing, and still releases the connection", async () => {
    const f = fakeClient({ failOn: /ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS label/ });
    await expect(ensureSeoSchema({ force: true, connect: async () => f.client })).rejects.toThrow(/SEO schema statement \d+\/\d+ failed: relation is locked — ALTER TABLE seo_reservations/);
    expect(f.log.some((l) => l.startsWith("INSERT INTO seed_state"))).toBe(false);
    expect(f.released()).toBe("ok");
  });
});

describe("bootSeoModule", () => {
  it("registers the routes and starts the worker when the schema step succeeds, and says what the step did", async () => {
    const lines: string[] = [];
    let routes = 0, workers = 0;
    seoModule.enabled = true; seoModule.reason = null;
    const ok = await bootSeoModule(express(), () => null, {
      ensureSchema: async () => ({ skipped: true, ran: 0, ms: 3, hash: "abcdef123456789" }),
      registerRoutes: () => { routes++; }, startWorker: () => { workers++; return undefined; }, log: (l) => lines.push(l),
    });
    expect(ok).toBe(true);
    expect(routes).toBe(1); expect(workers).toBe(1);
    expect(lines).toEqual(["[seo] schema up to date (abcdef123456), no DDL run, 3ms"]);
    expect(seoModule.enabled).toBe(true);
  });

  it("on a schema failure boots WITHOUT the module: no routes, no worker, /api/seo answers 503, the process goes on", async () => {
    const app = express();
    let routes = 0, workers = 0;
    const ok = await bootSeoModule(app, () => null, {
      ensureSchema: async () => { throw new Error("canceling statement due to lock timeout"); },
      registerRoutes: () => { routes++; }, startWorker: () => { workers++; return undefined; }, log: () => {},
    });
    expect(ok).toBe(false);
    expect(routes).toBe(0); expect(workers).toBe(0);
    expect(seoModule.enabled).toBe(false);
    expect(seoModule.reason).toContain("lock timeout");
    const res = await fetchFrom(app, "/api/seo/status");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ configured: false, code: "seo_unavailable", message: expect.stringContaining("not available on this server") });
    expect(JSON.stringify(res.body)).not.toContain("lock timeout");
    seoModule.enabled = true; seoModule.reason = null;
  });

  it("the unavailable handler never echoes the schema error", () => {
    let sent: { status: number; body: any } | null = null;
    seoUnavailableHandler({}, { status: (n: number) => ({ json: (b: unknown) => { sent = { status: n, body: b }; } }) });
    expect(sent).toEqual({ status: 503, body: { configured: false, code: "seo_unavailable", message: expect.any(String) } });
  });
});

async function fetchFrom(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  const { createServer } = await import("node:http");
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}
