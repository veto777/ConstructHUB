/**
 * Single-project GET — the /crm/projects/:id page contract.
 *
 * The pipeline board payload caps at the newest 2000 cards (server-computed
 * stageCounts cover the rest), so the page cannot trust the cached list for a
 * direct link: an older project must still load. Audit lane 4, 2026-10-04:
 * 438 of 2438 projects in the rehearsal org were missing from the list and
 * their pages read "Project not found" while existing.
 *
 *   1. GET /api/crm/projects/:id returns the project (200).
 *   2. Another org's project id answers 404 — tenant isolation.
 *
 * Throwaway rows only (unique run stamp), safe alongside other lanes.
 */
import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

describe("GET /api/crm/projects/:id (the project page's fallback)", () => {
  let customerId: string;
  let projectId: string;

  beforeAll(async () => {
    const stamp = `project-detail-${Date.now().toString(36)}`;
    const c = await api("/api/crm/customers", { method: "POST", body: JSON.stringify({ displayName: stamp }) });
    expect(c.status).toBe(201);
    customerId = c.body.id;
    const p = await api("/api/crm/projects", { method: "POST", body: JSON.stringify({ customerId, name: stamp }) });
    expect(p.status).toBe(201);
    projectId = p.body.id;
  }, 30_000);

  it("returns the project for the page header and tabs", async () => {
    const r = await api(`/api/crm/projects/${projectId}`);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(projectId);
    expect(r.body.number).toMatch(/^P-\d+/);
    expect(r.body.stageLabel).toBe("Lead");
  });

  it("404s another org's project (tenant isolation)", async () => {
    const other = await pool.query(
      `select id from crm_projects where org_id <> (select org_id from crm_projects where id = $1) limit 1`,
      [projectId],
    );
    if (!other.rows.length) return; // single-org dev DB — nothing foreign to probe
    const r = await api(`/api/crm/projects/${other.rows[0].id}`);
    expect(r.status).toBe(404);
  });

  it("404s a made-up id", async () => {
    const r = await api(`/api/crm/projects/${crypto.randomUUID()}`);
    expect(r.status).toBe(404);
  });
});
