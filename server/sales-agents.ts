/**
 * Sales Agents (/admin/sales-agents) — the admin console for the outbound AI sales-calling engine
 * ("ch-sales", https://sales.constructhub.us). This module is a thin, platform-admin-only proxy: the
 * engine's bearer token lives ONLY in this server's env and never reaches the browser.
 *
 *   GET  /api/admin/sales-agents/config         the engine's address + whether the token is set (never the token)
 *   GET  /api/admin/sales-agents/voices         → GET  /api/voices
 *   POST /api/admin/sales-agents/voices/:id     → POST /api/voices/:id     {active}
 *   GET  /api/admin/sales-agents/stats          → GET  /api/stats
 *   GET  /api/admin/sales-agents/calls          → GET  /api/calls?limit=
 *   POST /api/admin/sales-agents/campaign       → POST /api/campaign       {running}
 *   GET  /api/admin/sales-agents/leads          → GET  /api/leads?status=&trade=&state=&source=&linetype=&q=&limit=&offset=
 *   POST /api/admin/sales-agents/leads          → POST /api/leads          {source, leads:[…]}
 *   GET  /api/admin/sales-agents/leads/:id      → GET  /api/leads/:id      (the lead file: calls, transcripts, consents, follow-ups)
 *   GET  /api/admin/sales-agents/calllog        → GET  /api/calllog?limit= (every attempt, incl. no-answer/busy/failed)
 *
 * Guard: requirePlatformAdmin (server/crm/admin.ts) — the admin list + the admin second factor, the same
 * gate as the rest of /api/admin. POSTs also need an Origin from one of our hosts (originOk).
 *
 * Env: SALES_AGENTS_API_URL (default https://sales.constructhub.us), SALES_AGENTS_API_TOKEN (unset → 503).
 */
import type { Express, Request, Response } from "express";
import { requirePlatformAdmin } from "./crm/admin";
import { originOk } from "./hub/access";

type GetUser = (req: any, res: any) => any;
export type SalesAgentsRouteOptions = { http?: typeof fetch };

export const SALES_AGENTS_DEFAULT_URL = "https://sales.constructhub.us";
const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 20_000;
/** One import request: the page sends batches of at most this many leads. */
export const SALES_LEADS_MAX_BATCH = 2000;

const LEAD_FILTERS = ["status", "trade", "state", "source", "linetype", "q"] as const;

export function salesAgentsBaseUrl(): string {
  return (process.env.SALES_AGENTS_API_URL || SALES_AGENTS_DEFAULT_URL).replace(/\/+$/, "");
}

/** The upstream query string for GET /leads: only the known filters, clamped paging. */
export function leadsQuery(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const k of LEAD_FILTERS) {
    const v = q[k];
    if (typeof v === "string" && v.trim()) p.set(k, v.trim().slice(0, 200));
  }
  const limit = Math.min(500, Math.max(1, parseInt(String(q.limit ?? ""), 10) || 100));
  const offset = Math.max(0, parseInt(String(q.offset ?? ""), 10) || 0);
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  return p.toString();
}

export function registerSalesAgentsRoutes(app: Express, getUser: GetUser, opts: SalesAgentsRouteOptions = {}): void {
  const http = opts.http ?? fetch;

  /** Forward one request upstream and pass its JSON + status straight back. */
  async function forward(res: Response, method: "GET" | "POST", path: string, body?: unknown, timeoutMs = READ_TIMEOUT_MS) {
    res.setHeader("Cache-Control", "private, no-store");
    const token = process.env.SALES_AGENTS_API_TOKEN;
    if (!token) {
      return void res.status(503).json({ message: "The sales-calling engine is not connected: SALES_AGENTS_API_TOKEN is not set on this server.", code: "sales_agents_not_configured" });
    }
    let upstream: globalThis.Response;
    try {
      upstream = await http(`${salesAgentsBaseUrl()}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      console.error(`[sales-agents] ${method} ${path} failed:`, (e as Error)?.message);
      return void res.status(timedOut ? 504 : 502).json({
        message: timedOut ? "The sales-calling engine did not answer in time. Try again." : "Could not reach the sales-calling engine. Try again.",
        code: timedOut ? "sales_agents_timeout" : "sales_agents_unreachable",
      });
    }
    const text = await upstream.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    if (json === null || typeof json !== "object") {
      console.error(`[sales-agents] ${method} ${path}: non-JSON answer (${upstream.status})`);
      return void res.status(502).json({ message: `The sales-calling engine answered ${upstream.status} without JSON.`, code: "sales_agents_bad_answer" });
    }
    if (!upstream.ok && typeof json.message !== "string" && !Array.isArray(json)) {
      // The engine says {error} or {detail}; the page shows `message`.
      const why = typeof json.error === "string" ? json.error : typeof json.detail === "string" ? json.detail : `The sales-calling engine answered ${upstream.status}.`;
      json = { ...json, message: why };
    }
    res.status(upstream.status).json(json);
  }

  const admin = (req: Request, res: Response) => requirePlatformAdmin(req, res, getUser);
  const writeAllowed = (req: Request, res: Response) => {
    if (originOk(req)) return true;
    res.status(403).json({ message: "Forbidden" });
    return false;
  };

  /** Where a scraper sends leads, and whether this server has the token. Never the token itself. */
  app.get("/api/admin/sales-agents/config", async (req, res) => {
    if (!(await admin(req, res))) return;
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ apiUrl: salesAgentsBaseUrl(), configured: !!process.env.SALES_AGENTS_API_TOKEN, maxBatch: SALES_LEADS_MAX_BATCH });
  });

  app.get("/api/admin/sales-agents/voices", async (req, res) => {
    if (!(await admin(req, res))) return;
    await forward(res, "GET", "/api/voices");
  });

  app.post("/api/admin/sales-agents/voices/:id", async (req, res) => {
    const who = await admin(req, res);
    if (!who || !writeAllowed(req, res)) return;
    const id = String(req.params.id || "");
    if (!/^[a-z0-9_-]{1,64}$/i.test(id)) return void res.status(400).json({ message: "Unknown voice" });
    if (typeof req.body?.active !== "boolean") return void res.status(400).json({ message: "active must be true or false" });
    console.log(`[sales-agents] voice ${id} → ${req.body.active ? "in rotation" : "out of rotation"} by user ${who.id}`);
    await forward(res, "POST", `/api/voices/${encodeURIComponent(id)}`, { active: req.body.active }, WRITE_TIMEOUT_MS);
  });

  app.get("/api/admin/sales-agents/stats", async (req, res) => {
    if (!(await admin(req, res))) return;
    await forward(res, "GET", "/api/stats");
  });

  app.get("/api/admin/sales-agents/calls", async (req, res) => {
    if (!(await admin(req, res))) return;
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? ""), 10) || 50));
    await forward(res, "GET", `/api/calls?limit=${limit}`);
  });

  app.post("/api/admin/sales-agents/campaign", async (req, res) => {
    const who = await admin(req, res);
    if (!who || !writeAllowed(req, res)) return;
    if (typeof req.body?.running !== "boolean") return void res.status(400).json({ message: "running must be true or false" });
    console.log(`[sales-agents] campaign ${req.body.running ? "STARTED" : "paused"} by user ${who.id}`);
    await forward(res, "POST", "/api/campaign", { running: req.body.running }, WRITE_TIMEOUT_MS);
  });

  app.get("/api/admin/sales-agents/leads", async (req, res) => {
    if (!(await admin(req, res))) return;
    await forward(res, "GET", `/api/leads?${leadsQuery(req.query as Record<string, unknown>)}`);
  });

  app.get("/api/admin/sales-agents/leads/:id", async (req, res) => {
    if (!(await admin(req, res))) return;
    const id = String(req.params.id || "");
    if (!/^\d{1,12}$/.test(id)) return void res.status(400).json({ message: "Unknown lead" });
    await forward(res, "GET", `/api/leads/${id}`);
  });

  app.get("/api/admin/sales-agents/calllog", async (req, res) => {
    if (!(await admin(req, res))) return;
    const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit ?? ""), 10) || 500));
    await forward(res, "GET", `/api/calllog?limit=${limit}`, undefined, 20_000);
  });

  app.post("/api/admin/sales-agents/leads", async (req, res) => {
    const who = await admin(req, res);
    if (!who || !writeAllowed(req, res)) return;
    const body = req.body;
    const leads = Array.isArray(body) ? body : body?.leads;
    if (!Array.isArray(leads) || leads.length === 0) return void res.status(400).json({ message: "Send a list of leads" });
    if (leads.length > SALES_LEADS_MAX_BATCH) return void res.status(413).json({ message: `At most ${SALES_LEADS_MAX_BATCH} leads per request` });
    const source = typeof body?.source === "string" && body.source.trim() ? body.source.trim().slice(0, 120) : "admin-import";
    console.log(`[sales-agents] import of ${leads.length} leads (source ${source}) by user ${who.id}`);
    await forward(res, "POST", "/api/leads", { source, leads }, 60_000);
  });
}
