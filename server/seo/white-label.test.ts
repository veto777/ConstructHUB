/**
 * White-label regression guard (owner rule): a customer never sees who the SEO
 * data comes from, nor what it costs us.
 *
 *   1. Every route registered under /api/seo is driven as a NON-admin with the
 *      provider failing in each way it can — and succeeding — and nothing in any
 *      status line, header or body names the vendor or carries a wholesale figure.
 *      A new route without a request here fails the suite.
 *   2. Notes that are saved and shown later (rank runs, grid scans), including
 *      rows written by earlier versions with the error's own text.
 *   3. `admin` blocks reach platform admins only.
 *   4. client/src and shared/ never name the vendor.
 *
 * The database, plan checks and the ledger are faked; the provider is faked at
 * its fetch. Nothing here opens a connection.
 */
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── A stand-in database: just enough rows for every route to get to its work ──
const SITE = {
  id: 1, user_id: 1, domain: "example.com", location_code: 2840, language_code: "en", devices: "desktop", serp_depth: 10, business_name: "Acme Roofing",
  alerts_enabled: true, alert_drop: 3, keyword_count: 1, created_at: "2026-10-01T00:00:00Z", next_rank_check_at: null, last_rank_check_at: null, next_backlinks_at: null, last_backlinks_at: null,
  grid_pin: { name: "Acme Roofing", address: null, lat: 27.95, lng: -82.46, cid: null },
};
const db = vi.hoisted(() => ({ runs: [] as any[], scans: [] as any[], log: [] as string[] }));

function fakeQuery(sqlText: unknown, params: any[] = []): { rows: any[]; rowCount: number } {
  const sql = String(typeof sqlText === "string" ? sqlText : (sqlText as any)?.text ?? "").replace(/\s+/g, " ").trim();
  const many = (rows: any[]) => ({ rows, rowCount: rows.length });
  // Rank runs: kept, because their note is saved by the worker and shown by two routes later.
  if (/seo_rank_runs/.test(sql)) {
    const byId = (id: unknown) => db.runs.find((r) => r.id === id);
    if (/^SELECT id FROM seo_rank_runs WHERE site_id=\$1 AND status IN/.test(sql)) return many(db.runs.filter((r) => r.status === "queued" || r.status === "running").map((r) => ({ id: r.id })));
    if (/^INSERT INTO seo_rank_runs/.test(sql)) { db.runs.unshift({ id: params[0], site_id: params[1], user_id: params[2], trigger: params[3], status: "queued", total: 0, checked: 0, failed: 0, posted: 0, error: null, tasks: [], cost_usd: 0, created_at: new Date().toISOString(), started_at: null, finished_at: null }); return many([]); }
    if (/^UPDATE seo_rank_runs SET status='running'/.test(sql)) { const r = db.runs.find((x) => x.status === "queued" && (!params[0] || x.id === params[0])); if (!r) return many([]); r.status = "running"; r.started_at = new Date().toISOString(); return many([r]); }
    if (/^UPDATE seo_rank_runs SET status=\$2, error=\$3/.test(sql)) { const r = byId(params[0]); if (r) { r.status = params[1]; r.error = params[2]; r.tasks = []; } return many([]); }
    if (/^UPDATE seo_rank_runs SET tasks=\$2, total=\$3, cost_usd=\$4, error=\$5/.test(sql)) { const r = byId(params[0]); if (r) { r.tasks = JSON.parse(params[1]); r.total = params[2]; r.error = params[4]; r.posted = params[6]; } return many([]); }
    if (/^UPDATE seo_rank_runs SET tasks=\$2, posted=\$3/.test(sql)) { const r = byId(params[0]); if (r) { r.tasks = JSON.parse(params[1]); r.posted = params[2]; } return many([]); }
    if (/^UPDATE seo_rank_runs SET lease_until=now\(\)\+interval '5 minutes' WHERE id IN/.test(sql)) return many(db.runs.filter((r) => r.status === "running"));
    if (/^UPDATE seo_rank_runs SET status='done'/.test(sql)) { const r = byId(params[0]); if (r) { r.status = "done"; r.checked += params[1]; r.error = params[2]; r.tasks = []; } return many([]); }
    if (/^UPDATE seo_rank_runs SET tasks=\$2, checked=checked\+\$3, error=\$4/.test(sql)) { const r = byId(params[0]); if (r) { r.tasks = JSON.parse(params[1]); r.error = params[3]; } return many([]); }
    if (/^SELECT id, trigger, status, total, checked, error/.test(sql)) return many(db.runs.map(({ id, trigger, status, total, checked, error, created_at, started_at, finished_at }) => ({ id, trigger, status, total, checked, error, created_at, started_at, finished_at })));
    return many([]);
  }
  // Grid scans: the same — failed in the background, read back by the page.
  if (/seo_grid_scans/.test(sql)) {
    if (/^INSERT INTO seo_grid_scans/.test(sql)) { const id = db.scans.length + 1; db.scans.push({ id, status: "running", scan: null, error: null, stale: false }); return many([{ id }]); }
    if (/SET status='failed', error=\$2/.test(sql)) { const s = db.scans.find((x) => x.id === params[0]); if (s) { s.status = "failed"; s.error = params[1]; } return many([]); }
    if (/SET status='done', scan=\$2/.test(sql)) { const s = db.scans.find((x) => x.id === params[0]); if (s) { s.status = "done"; s.scan = JSON.parse(params[1]); } return many([]); }
    if (/^SELECT id, scan, status, error/.test(sql)) return many(db.scans.filter((x) => x.id === params[0]));
    return many([]);
  }
  if (/FROM seo_sites WHERE id=\$1/.test(sql) || /FROM seo_sites s WHERE s\.user_id/.test(sql) || /^UPDATE seo_sites SET business_name/.test(sql) || /^INSERT INTO seo_sites/.test(sql)) return many([{ ...SITE }]);
  if (/^SELECT 1 FROM seo_sites/.test(sql)) return many([{ "?column?": 1 }]);
  if (/count\(\*\)::int (n|total)\b/.test(sql)) return many([{ n: 1, total: 1, has: false }]);
  if (/^UPDATE seo_keywords SET tags/.test(sql)) return { rows: [], rowCount: 1 };
  // The usage page reads the ledger rows, which hold our own cost next to the customer's: only the customer's may come out.
  if (/FROM seo_reservations WHERE user_id/.test(sql)) return many([{ id: "00000000-0000-4000-8000-000000000002", label: "Keyword ideas — roof repair", created_at: "2026-10-02T00:00:00Z", settled_at: "2026-10-02T00:00:01Z", estimate_usd: "0.018", customer_usd: "0.012", credit: { fromIncluded: 5, fromWallet: 0 }, refunded_cents: 0 }]);
  if (/FROM seo_keywords WHERE site_id=\$1 AND keyword=ANY/.test(sql)) return many([]);
  if (/FROM seo_keywords/.test(sql) && /^SELECT (id, )?keyword/.test(sql)) return many([{ id: 1, keyword: "roof repair", location_code: null, location_name: null, tags: [], search_volume: null, cpc: null, difficulty: null, location: null }]);
  // No list of places saved: the route has to ask the source for it.
  if (/seo_meta WHERE key='locations_loaded'/.test(sql)) return many([{ newest: null, any: false }]);
  if (/FROM seo_locations WHERE code=/.test(sql)) return many([{ code: 2840, name: "United States", type: "Country" }]);
  if (/FROM seo_keyword_lists/.test(sql) && /^SELECT/.test(sql)) return many([{ id: 1, user_id: 1, name: "Roofing", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", items: 1, n: 1 }]);
  if (/FROM seo_keyword_list_items/.test(sql) && /^SELECT/.test(sql)) return many([{ keyword: "roof repair", volume: null, difficulty: null, cpc: null, intent: null, added_at: "2026-10-01T00:00:00Z", n: 1, have: 1 }]);
  if (/FROM users WHERE id=/.test(sql)) return many([{ email: "customer@example.com", id: 1 }]);
  if (/RETURNING/.test(sql)) return many([{ ...SITE, id: 1, taken_on: "2026-10-01", inserted: true }]);
  db.log.push(sql.slice(0, 90));
  return many([]);
}
vi.mock("../db", () => {
  const query = vi.fn(async (sql: unknown, params?: any[]) => fakeQuery(sql, params));
  return { pool: { query, connect: async () => ({ query, release() {} }) }, db: {} };
});

// ── The platform around the module ──────────────────────────────────────────
const ENT = { accessPlan: "pro", allowances: { seoKeywords: 100, seoCreditCents: 2000, siteScans: 5, siteScansPerLocation: 0 } };
vi.mock("../entitlements", () => ({
  requirePlan: async () => ENT, getEntitlements: async () => ENT, sendLimitReached: (res: any, body: any) => res.status(403).json(body),
  raiseHint: () => ({ text: "", upgradePlan: null, addon: null }), plural: (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`,
}));
vi.mock("../admin", () => ({ isPlatformAdmin: (u: any) => u?.email === "owner@platform.test" }));
vi.mock("../growth-quotas", () => ({ monthlyUsage: async () => ({}), reserveQuotaFor: async () => ({ ok: true }), refundReservation: async () => {}, resetsAt: () => "2026-11-01T00:00:00.000Z" }));
vi.mock("../growth-limits", () => ({ takeBudget: async () => true }));
const issues = vi.hoisted(() => ({ recorded: [] as { status: number; err: any }[] }));
vi.mock("../ops/server-errors", () => ({ recordUnhandledError: (_req: any, _res: any, err: any, status: number) => { if (status >= 500) issues.recorded.push({ status, err }); } }));
vi.mock("../ops/issues", () => ({ recordFailure: async () => {}, recordIssue: async () => {} }));
vi.mock("./credits", async (actual) => ({ ...(await actual<typeof import("./credits")>()), creditStatus: async () => ({ includedCents: 2000, includedUsedCents: 100, walletCents: 0, availableCents: 1900 }) }));
vi.mock("./site-report-send", async (actual) => ({ ...(await actual<typeof import("./site-report-send")>()), sendSiteReport: async () => ({ sent: 1, failed: 0, skipped: 0 }), validUnsubscribe: () => true, optOut: async () => {}, optedOut: async () => [] }));

/** The ledger, without a database: a lookup runs, and a refusal is the real error with its real (internal) detail. */
const ledger = vi.hoisted(() => ({ refuse: null as null | "cap" | "credits" }));
vi.mock("./budget", async (actual) => {
  const real = await actual<typeof import("./budget")>();
  const { outOfCreditMessage } = await import("./credits");
  const refusal = (estimateUsd: number) => {
    if (ledger.refuse === "cap") { const d = real.budgetDecision(99.5, Math.max(estimateUsd, 5), 100); if (!d.ok) return new real.SeoBudgetError(d.message, d.remainingUsd, estimateUsd, d.detail); }
    if (ledger.refuse === "credits") { const m = outOfCreditMessage(48, 0); return new real.SeoBudgetError(m, 0, estimateUsd, m, "seo_credits"); }
    return null;
  };
  return {
    ...real,
    budgetStatus: async () => ({ month: "2026-10", capUsd: 100, spentUsd: ledger.refuse === "cap" ? 100 : 12.345678, remainingUsd: ledger.refuse === "cap" ? 0 : 87.654322, accountUsd: 1.234567, accountRequests: 7 }),
    monthlySpendByAccount: async () => [{ userId: 1, email: "customer@example.com", costUsd: 1.234567, requests: 7 }],
    reserveBudget: async (userId: number, estimateUsd: number) => { const e = refusal(estimateUsd); if (e) throw e; return { id: "00000000-0000-4000-8000-000000000001", userId, month: "2026-10", estimateUsd, credit: null }; },
    settleBudget: async () => {}, reconcileReservations: async () => 0, refundReservation: async () => 0,
    withBudget: async (_user: number, estimateUsd: number, call: () => Promise<any>) => { const e = refusal(estimateUsd); if (e) throw e; return call(); },
  };
});

import { dataforseoDeps, DataForSeoError, SEO_SOURCE_PUBLIC_MESSAGES } from "./dataforseo";
import * as pricing from "./pricing";
import { registerSeoRoutes } from "./routes";
import { collectRunningRuns } from "./jobs";
import { budgetDecision, SeoBudgetError, BUDGET_PAUSED_MESSAGE } from "./budget";
import { VENDOR_NAME_RE, publicNote, publicFailure, seoErrorResponse, SEO_NOTE_FALLBACK, SEO_UNEXPECTED_MESSAGE } from "./public-errors";
import { DOMAIN_TABLES, KEYWORD_TABLES } from "./reports";

// ── The provider, failing in every way it can ───────────────────────────────
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LEAKY = "DataForSEO: account login user-4471@constructhub.us — see https://docs.dataforseo.com/v3/appendix/errors (Data For SEO support)";
const taskOf = (url: string, extra: Record<string, unknown>) => ({ id: "10081234-1535-0066-0000-aaaaaaaaaaaa", path: new URL(url).pathname.split("/").filter(Boolean), data: { tag: "1:desktop" }, ...extra });
const PROVIDER: Record<string, (url: string) => Promise<Response>> = {
  success: async (url) => json({ status_code: 20000, status_message: "Ok.", cost: 0.012, tasks: [taskOf(url, { status_code: /task_post/.test(url) ? 20100 : 20000, status_message: "Ok.", cost: 0.012, result_count: 1, result: [{ total_count: 0, items_count: 0, items: [] }] })] }),
  auth: async () => json({ status_code: 40100, status_message: "You are not authorized to access this resource. " + LEAKY }, 401),
  timeout: async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); },
  unreachable: async () => { throw new Error("getaddrinfo ENOTFOUND api.dataforseo.com"); },
  http500: async () => new Response("<html>DataForSEO gateway error</html>", { status: 500 }),
  rateLimited: async () => json({ status_code: 40202, status_message: "Rate limit per minute exceeded. " + LEAKY }, 429),
  upstream: async (url) => json({ status_code: 20000, tasks: [taskOf(url, { status_code: 50000, status_message: "Internal Error. " + LEAKY, cost: 0 })] }),
  balance: async (url) => json({ status_code: 20000, tasks: [taskOf(url, { status_code: 40200, status_message: "Payment Required. Top up your DataForSEO balance: $0.31 left of the $50 minimum deposit.", cost: 0 })] }),
  invalid: async () => json({ status_code: 40501, status_message: "Invalid Field: 'keyword'. " + LEAKY }),
  taskFailed: async (url) => json({ status_code: 20000, tasks: [taskOf(url, { status_code: 40400, status_message: "Not Found. " + LEAKY, cost: 0.012 })] }),
  garbage: async () => new Response("<!doctype html><title>DataForSEO</title>", { status: 200 }),
};
let provider = "success";

// ── What must never be in a customer response ───────────────────────────────
/** Every wholesale price in pricing.ts, as the number and as it would be printed. */
const WHOLESALE: number[] = [...Object.values(pricing.SERP_PAGE_USD), pricing.LABS_TASK_USD, pricing.LABS_ITEM_USD, ...Object.values(pricing.ADS_TASK_USD), pricing.BACKLINKS_REQUEST_USD, pricing.BACKLINKS_ROW_USD];
const WHOLESALE_TEXT = new RegExp(`(?<![\\d.])(${WHOLESALE.map((n) => String(n).replace(".", "\\.")).join("|")})(?!\\d)`);
const INTERNAL_TEXT = /SEO_MONTHLY_BUDGET_USD|DATAFORSEO_|monthly cap|wholesale|status_message|user-4471|minimum deposit|ENOTFOUND/i;
const PRICE_SHEET_TEXT = [...pricing.PRICE_SHEET.lines.flatMap((l) => [l.price, l.source]), pricing.PRICE_SHEET.example];

function leaksIn(text: string): string[] {
  const found: string[] = [];
  const vendor = text.match(VENDOR_NAME_RE); if (vendor) found.push(`vendor name "${vendor[0]}"`);
  const price = text.match(WHOLESALE_TEXT); if (price) found.push(`wholesale price ${price[0]}`);
  const internal = text.match(INTERNAL_TEXT); if (internal) found.push(`internal wording "${internal[0]}"`);
  for (const p of PRICE_SHEET_TEXT) if (text.includes(p)) found.push(`price sheet line "${p}"`);
  return found;
}
/** Keys and numbers that only the admin view has: any `...Usd` field, an `admin`/`vendor`/`env` block, a wholesale constant as a value. */
function leaksInJson(v: unknown, at = "body"): string[] {
  if (typeof v === "number") return WHOLESALE.includes(v) ? [`${at} = wholesale price ${v}`] : [];
  if (!v || typeof v !== "object") return [];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaksInJson(x, `${at}[${i}]`));
  return Object.entries(v).flatMap(([k, x]) => [
    ...(/usd/i.test(k) || ["admin", "vendor", "env", "detail", "estimate_usd", "cost_usd"].includes(k) ? [`${at}.${k} is an internal field`] : []),
    ...leaksInJson(x, `${at}.${k}`),
  ]);
}

// ── The app ─────────────────────────────────────────────────────────────────
let base = "";
let server: ReturnType<express.Express["listen"]>;
const app = express();
type Hit = { status: number; text: string; body: any; leaks: string[] };
async function hit(method: string, url: string, body?: unknown, as: "customer" | "admin" = "customer"): Promise<Hit> {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-test-user": as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const pdf = (res.headers.get("content-type") ?? "").includes("application/pdf");
  const text = pdf ? "" : await res.text();
  if (pdf) await res.arrayBuffer();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* html or empty */ }
  const head = `${res.status} ${res.statusText}\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}`;
  return { status: res.status, text, body: parsed, leaks: [...leaksIn(head).map((l) => `header: ${l}`), ...leaksIn(text), ...leaksInJson(parsed)] };
}

/** One request (or more) for every route. Keyed by how the route is registered, so a new route has to be added here. */
const SPECS: Record<string, { url: string; body?: unknown }[]> = {
  "GET /api/seo/status": [{ url: "/api/seo/status" }],
  "GET /api/seo/admin/usage": [{ url: "/api/seo/admin/usage" }],
  "GET /api/seo/sites": [{ url: "/api/seo/sites" }],
  "POST /api/seo/sites": [{ url: "/api/seo/sites", body: { domain: "example.com" } }],
  "DELETE /api/seo/sites/:id": [{ url: "/api/seo/sites/1" }],
  "GET /api/seo/sites/:id/overview": [{ url: "/api/seo/sites/1/overview" }],
  "POST /api/seo/sites/:id/keywords": [{ url: "/api/seo/sites/1/keywords", body: { keywords: ["roof repair tampa"] } }],
  "DELETE /api/seo/keywords/:id": [{ url: "/api/seo/keywords/1" }],
  "POST /api/seo/sites/:id/keywords/volumes": [{ url: "/api/seo/sites/1/keywords/volumes", body: {} }],
  "POST /api/seo/sites/:id/rank-check": [{ url: "/api/seo/sites/1/rank-check", body: {} }],
  "GET /api/seo/sites/:id/runs": [{ url: "/api/seo/sites/1/runs" }],
  "POST /api/seo/keywords/research": [{ url: "/api/seo/keywords/research", body: { seed: "roof repair" } }],
  "GET /api/seo/sites/:id/backlinks": [{ url: "/api/seo/sites/1/backlinks" }],
  "POST /api/seo/sites/:id/backlinks/refresh": [{ url: "/api/seo/sites/1/backlinks/refresh", body: {} }],
  "GET /api/seo/explorer/recent": [{ url: "/api/seo/explorer/recent" }],
  "GET /api/seo/explorer": [{ url: "/api/seo/explorer?domain=example.com" }],
  "POST /api/seo/explorer": [{ url: "/api/seo/explorer", body: { domain: "example.com", refresh: true } }],
  "POST /api/seo/report": [
    ...DOMAIN_TABLES.map((table) => ({ url: "/api/seo/report", body: { table, domain: "example.com" } })),
    ...KEYWORD_TABLES.map((table) => ({ url: "/api/seo/report", body: { table, keyword: "roof repair" } })),
  ],
  "GET /api/seo/sites/:id/grid": [{ url: "/api/seo/sites/1/grid" }],
  "POST /api/seo/sites/:id/grid/locate": [{ url: "/api/seo/sites/1/grid/locate", body: { query: "Acme Roofing Tampa" } }],
  "POST /api/seo/sites/:id/grid/pin": [{ url: "/api/seo/sites/1/grid/pin", body: { name: "Acme Roofing", lat: 27.95, lng: -82.46 } }],
  "POST /api/seo/sites/:id/grid/scan": [{ url: "/api/seo/sites/1/grid/scan", body: { keyword: "roofer near me", size: 3 } }],
  "GET /api/seo/sites/:id/grid/:scanId": [{ url: "/api/seo/sites/1/grid/1" }],
  "POST /api/seo/keyword": [{ url: "/api/seo/keyword", body: { keyword: "roof repair", refresh: true } }],
  "POST /api/seo/gap": [
    { url: "/api/seo/gap", body: { kind: "content", domain: "example.com", competitors: ["rival.com"], refresh: true } },
    { url: "/api/seo/gap", body: { kind: "links", domain: "example.com", competitors: ["rival.com", "other.com"], refresh: true } },
  ],
  "GET /api/seo/dashboard": [{ url: "/api/seo/dashboard" }],
  "POST /api/seo/keywords/bulk": [{ url: "/api/seo/keywords/bulk", body: { keywords: ["roof repair", "metal roof cost"] } }],
  "GET /api/seo/lists": [{ url: "/api/seo/lists" }],
  "POST /api/seo/lists/items": [{ url: "/api/seo/lists/items", body: { name: "Roofing", items: [{ keyword: "roof repair" }] } }],
  "POST /api/seo/lists/:id/refresh": [{ url: "/api/seo/lists/1/refresh", body: {} }],
  "GET /api/seo/lists/:id": [{ url: "/api/seo/lists/1" }],
  "POST /api/seo/lists/:id/remove": [{ url: "/api/seo/lists/1/remove", body: { keywords: ["roof repair"] } }],
  "DELETE /api/seo/lists/:id": [{ url: "/api/seo/lists/1" }],
  "POST /api/seo/content": [{ url: "/api/seo/content", body: { query: "metal roofing" } }],
  "POST /api/seo/batch": [{ url: "/api/seo/batch", body: { domains: ["example.com", "rival.com"], refresh: true } }],
  "GET /api/seo/sites/:id/ai": [{ url: "/api/seo/sites/1/ai" }],
  "POST /api/seo/sites/:id/ai/ask": [{ url: "/api/seo/sites/1/ai/ask", body: { prompt: "Who is the best roofer in Tampa?", engines: ["chatgpt", "gemini", "perplexity"] } }],
  "POST /api/seo/sites/:id/ai/track": [{ url: "/api/seo/sites/1/ai/track", body: { prompt: "Who is the best roofer in Tampa?", on: true } }],
  "POST /api/seo/ai/mentions": [{ url: "/api/seo/ai/mentions", body: { domain: "example.com" } }, { url: "/api/seo/ai/mentions", body: { domain: "example.com", platform: "chat_gpt" } }],
  "GET /api/seo/sites/:id/voice": [{ url: "/api/seo/sites/1/voice" }],
  "POST /api/seo/sites/:id/tracked-competitors": [{ url: "/api/seo/sites/1/tracked-competitors", body: { domain: "rival.com" } }],
  "DELETE /api/seo/sites/:id/tracked-competitors/:domain": [{ url: "/api/seo/sites/1/tracked-competitors/rival.com" }],
  "GET /api/seo/report-unsubscribe": [{ url: "/api/seo/report-unsubscribe?u=1&e=a%40b.co&t=x" }],
  "POST /api/seo/report-unsubscribe": [{ url: "/api/seo/report-unsubscribe?u=1&e=a%40b.co&t=x", body: {} }],
  "GET /api/seo/sites/:id/report": [{ url: "/api/seo/sites/1/report" }],
  "GET /api/seo/sites/:id/report.pdf": [{ url: "/api/seo/sites/1/report.pdf" }],
  "POST /api/seo/sites/:id/report/schedule": [{ url: "/api/seo/sites/1/report/schedule", body: { frequency: "weekly", recipients: ["owner@example.com"] } }],
  "POST /api/seo/sites/:id/report/send": [{ url: "/api/seo/sites/1/report/send", body: { recipients: ["owner@example.com"] } }],
  "GET /api/seo/usage": [{ url: "/api/seo/usage" }],
  "GET /api/seo/locations": [{ url: "/api/seo/locations?q=tampa" }],
  "POST /api/seo/sites/:id/settings": [{ url: "/api/seo/sites/1/settings", body: { businessName: "Acme Roofing" } }],
  "GET /api/seo/alerts": [{ url: "/api/seo/alerts" }],
  "POST /api/seo/alerts/read": [{ url: "/api/seo/alerts/read", body: {} }],
  "GET /api/seo/sites/:id/audit": [{ url: "/api/seo/sites/1/audit" }],
  "GET /api/seo/sites/:id/audit/pages": [{ url: "/api/seo/sites/1/audit/pages" }],
  "GET /api/seo/sites/:id/rank-history": [{ url: "/api/seo/sites/1/rank-history" }],
  "GET /api/seo/keywords/:id/history": [{ url: "/api/seo/keywords/1/history" }],
  "POST /api/seo/keywords/:id/tags": [{ url: "/api/seo/keywords/1/tags", body: { tags: ["roofing"] } }],
  "POST /api/seo/sites/:id/competitors": [{ url: "/api/seo/sites/1/competitors", body: { competitor: "rival.com" } }],
};
/** Routes that ask the provider while the request waits: with the provider down they must answer with the neutral error. */
const ASKS_PROVIDER = new Set([
  "POST /api/seo/sites/:id/keywords/volumes", "POST /api/seo/keywords/research", "POST /api/seo/sites/:id/backlinks/refresh", "POST /api/seo/explorer", "POST /api/seo/report",
  "POST /api/seo/sites/:id/grid/locate", "POST /api/seo/keyword", "POST /api/seo/gap", "POST /api/seo/keywords/bulk", "POST /api/seo/content", "POST /api/seo/batch",
  "POST /api/seo/sites/:id/ai/ask", "POST /api/seo/ai/mentions", "GET /api/seo/locations", "POST /api/seo/sites/:id/competitors",
]);

const registered = (): string[] => {
  const stack: any[] = (app as any).router?.stack ?? (app as any)._router?.stack ?? [];
  return stack.filter((l) => l.route && String(l.route.path).startsWith("/api/seo")).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`));
};
const settle = async (until: () => boolean) => { for (let i = 0; i < 200 && !until(); i++) await new Promise((r) => setTimeout(r, 10)); };

const originalFetch = dataforseoDeps.fetch, originalEnv = dataforseoDeps.env;
beforeAll(async () => {
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "user-4471@constructhub.us", DATAFORSEO_PASSWORD: "secret" } as any);
  dataforseoDeps.fetch = (async (url: any) => PROVIDER[provider](String(url))) as typeof fetch;
  vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "info").mockImplementation(() => {});
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = req.headers["x-test-user"] === "admin" ? { id: 1, email: "owner@platform.test" } : { id: 1, email: "customer@example.com" }; next(); });
  registerSeoRoutes(app, (req: any) => req.user);
  // The platform's last-resort handler (server/index.ts) forwards err.message: an SEO error must never get this far.
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ message: `ESCAPED TO THE GLOBAL HANDLER: ${err?.message}` }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { dataforseoDeps.fetch = originalFetch; dataforseoDeps.env = originalEnv; vi.restoreAllMocks(); await new Promise((r) => server.close(r)); });
beforeEach(() => { provider = "success"; ledger.refuse = null; db.runs.length = 0; db.scans.length = 0; issues.recorded.length = 0; });

describe("every SEO route, as a customer", () => {
  it("has a request in this suite", () => {
    const routes = [...new Set(registered())];
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.filter((r) => !SPECS[r])).toEqual([]);
    expect(Object.keys(SPECS).filter((r) => !routes.includes(r))).toEqual([]);
  });

  for (const mode of Object.keys(PROVIDER)) {
    it(`provider ${mode}: no response names the vendor or carries a wholesale figure`, async () => {
      provider = mode;
      const problems: string[] = [];
      const statuses: Record<string, number[]> = {};
      for (const [route, specs] of Object.entries(SPECS)) {
        for (const spec of specs) {
          const r = await hit(route.split(" ")[0], spec.url, spec.body);
          (statuses[route] ??= []).push(r.status);
          for (const l of r.leaks) problems.push(`${route} ${JSON.stringify(spec.body ?? "")} -> ${r.status}: ${l}`);
          if (r.text.includes("ESCAPED TO THE GLOBAL HANDLER")) problems.push(`${route} -> an error reached the global handler: ${r.text.slice(0, 160)}`);
          if (r.status >= 400 && r.body && typeof r.body.message !== "string") problems.push(`${route} -> ${r.status} without a message`);
        }
      }
      // Background work started by those requests (a rank run posting, a grid scan) saves a note; read it back.
      await settle(() => db.runs.every((r) => r.status !== "queued") && db.scans.every((s) => s.status !== "running"));
      if (mode === "success") { provider = "taskFailed"; await collectRunningRuns(); }
      for (const url of ["/api/seo/sites/1/runs", "/api/seo/sites/1/overview", ...db.scans.map((s) => `/api/seo/sites/1/grid/${s.id}`)]) {
        const r = await hit("GET", url);
        for (const l of r.leaks) problems.push(`stored then returned by ${url}: ${l}`);
      }
      expect(problems).toEqual([]);
      expect(statuses["GET /api/seo/admin/usage"]).toEqual([403]);
      if (mode === "success") return;
      // With the provider down, the routes that call it answer with the neutral error — not a 200, not a 500.
      for (const route of ASKS_PROVIDER) for (const s of statuses[route]) expect([400, 429, 502, 504], `${route} with provider ${mode} answered ${s}`).toContain(s);
      expect(db.runs.length).toBeGreaterThan(0);
      expect(db.scans.length).toBeGreaterThan(0);
      for (const run of db.runs) expect(run.error ?? "", "the saved run note").not.toMatch(VENDOR_NAME_RE);
      for (const scan of db.scans) { expect(scan.status).toBe("failed"); expect(scan.error ?? "").not.toMatch(VENDOR_NAME_RE); }
    });
  }

  for (const refuse of ["cap", "credits"] as const) {
    it(`ledger refuses (${refuse}): the customer reads about SEO credit, never the internal dollars`, async () => {
      ledger.refuse = refuse;
      const problems: string[] = [];
      let refused = 0;
      for (const [route, specs] of Object.entries(SPECS)) for (const spec of specs) {
        const r = await hit(route.split(" ")[0], spec.url, spec.body);
        for (const l of r.leaks) problems.push(`${route} -> ${r.status}: ${l}`);
        if (r.status === 402) {
          refused++;
          expect(r.body.code).toBe(refuse === "cap" ? "seo_budget" : "seo_credits");
          if (refuse === "cap") { expect(r.body.message).toBe(BUDGET_PAUSED_MESSAGE); expect(r.body.message).not.toMatch(/\$/); }
          else expect(r.body.message).toMatch(/^This needs about \$0\.48 of SEO data and you have \$0\.00 left this month\./);
        }
      }
      await settle(() => db.runs.every((r) => r.status !== "queued") && db.scans.every((s) => s.status !== "running"));
      for (const url of ["/api/seo/sites/1/runs", ...db.scans.map((s) => `/api/seo/sites/1/grid/${s.id}`)]) for (const l of (await hit("GET", url)).leaks) problems.push(`stored then returned by ${url}: ${l}`);
      expect(problems).toEqual([]);
      expect(refused).toBeGreaterThan(10);
    });
  }

  it("an error nobody expected gets neutral copy, not its own text", async () => {
    const { pool } = await import("../db");
    (pool.query as any).mockImplementationOnce(async () => { throw new Error('relation "seo_sites" does not exist — DataForSEO ledger at $0.0006'); });
    const r = await hit("GET", "/api/seo/sites");
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ code: "seo_error", message: SEO_UNEXPECTED_MESSAGE });
    expect(r.leaks).toEqual([]);
    // ...and the issue desk still got the real error.
    expect(issues.recorded.map((i) => i.err.message).join()).toMatch(/does not exist/);
  });
});

describe("notes saved by earlier versions are made safe when read", () => {
  const legacy = [
    "DataForSEO accepted none of the tasks",
    "DataForSEO task failed (40501)",
    "DataForSEO balance problem: Payment Required.",
    "DataForSEO request timed out on /serp/google/organic/task_post",
    "Payment Required. Your account user-4471 has $0.31",
    'duplicate key value violates unique constraint "seo_rank_runs_one_active"',
    "3 of 40 checks were not accepted by the search data service · 2 check(s) failed: roof repair (desktop) — their cost was refunded",
    "DataForSEO task failed (50000) · 1 check(s) never came back from the queue — their cost was refunded",
  ];
  beforeEach(() => { db.runs.push(...legacy.map((error, i) => ({ id: `legacy-${i}`, site_id: 1, user_id: 1, trigger: "weekly", status: "failed", total: 40, checked: 0, error, created_at: "2026-10-01T00:00:00Z", started_at: null, finished_at: null }))); });

  it("a customer reads neutral notes; the row itself is untouched", async () => {
    for (const url of ["/api/seo/sites/1/runs", "/api/seo/sites/1/overview"]) {
      const r = await hit("GET", url);
      expect(r.status).toBe(200);
      expect(r.leaks).toEqual([]);
      const notes: string[] = (url.endsWith("runs") ? r.body : r.body.runs).map((x: any) => x.error);
      expect(notes.slice(0, 6)).toEqual(Array(6).fill(SEO_NOTE_FALLBACK));
      expect(notes[6]).toBe(legacy[6]);
      expect(notes[7]).toBe(`${SEO_NOTE_FALLBACK} · 1 check(s) never came back from the queue — their cost was refunded`);
    }
    expect(db.runs.map((r) => r.error)).toEqual(legacy);
  });
  it("a platform admin reads them as saved", async () => {
    const r = await hit("GET", "/api/seo/sites/1/runs", undefined, "admin");
    expect(r.body.map((x: any) => x.error)).toEqual(legacy);
  });
  it("a grid scan saved with an error's own text", async () => {
    db.scans.push({ id: 1, status: "failed", scan: null, error: "DataForSEO HTTP 500 on /serp/google/maps/live/advanced", stale: false }, { id: 2, status: "failed", scan: null, error: "The scan ran but its results could not be saved.", stale: false });
    const a = await hit("GET", "/api/seo/sites/1/grid/1"), b = await hit("GET", "/api/seo/sites/1/grid/2");
    expect(a.body.error).toBe("The scan could not be completed.");
    expect(b.body.error).toBe("The scan ran but its results could not be saved.");
    expect([...a.leaks, ...b.leaks]).toEqual([]);
  });
  it("publicNote keeps what this code writes and nothing else", () => {
    expect(publicNote(null)).toBeNull();
    expect(publicNote("  ")).toBeNull();
    for (const m of Object.values(SEO_SOURCE_PUBLIC_MESSAGES)) expect(publicNote(m)).toBe(m);
    expect(publicNote(BUDGET_PAUSED_MESSAGE)).toBe(BUDGET_PAUSED_MESSAGE);
    expect(publicNote("This needs about $0.48 of SEO data and you have $0.00 left this month. Add credit to keep going — your plan's allowance comes back on the 1st.")).toMatch(/^This needs about \$0\.48/);
    expect(publicNote("This needs about $0.0120 of DataForSEO data and $0.00 of the $100.00 monthly cap is left.")).toBe(SEO_NOTE_FALLBACK);
    expect(publicNote("1 check(s) failed: dataforseo pricing (desktop)")).toBe(SEO_NOTE_FALLBACK);
    expect(publicNote("x · y")).toBe(SEO_NOTE_FALLBACK);
  });
});

describe("the admin view is for platform admins only", () => {
  it("status: plan units and customer prices for a customer; the vendor and the dollars for an admin", async () => {
    const customer = await hit("GET", "/api/seo/status"), admin = await hit("GET", "/api/seo/status", undefined, "admin");
    expect(customer.status).toBe(200);
    expect(customer.leaks).toEqual([]);
    expect(customer.body.admin).toBeUndefined();
    expect(Object.keys(customer.body).sort()).toEqual(["alertsUnread", "configured", "credits", "holds", "packs", "prices", "resetsAt", "usage"]);
    // Customer prices are whole cents at the customer's rate — never the wholesale figure they are worked out from.
    for (const cents of [...Object.values(customer.body.prices), ...Object.values(customer.body.holds)] as number[]) expect(Number.isInteger(cents) && cents >= 1).toBe(true);
    expect(admin.body.admin).toMatchObject({ vendor: "DataForSEO", configured: true, capUsd: 100, spentUsd: 12.345678 });
    expect(admin.body.admin.env).toContain("SEO_MONTHLY_BUDGET_USD");
  });
  it("per-account wholesale spend: 403 for a customer", async () => {
    const customer = await hit("GET", "/api/seo/admin/usage"), admin = await hit("GET", "/api/seo/admin/usage", undefined, "admin");
    expect(customer.status).toBe(403);
    expect(customer.body).toEqual({ message: "Platform admin access required" });
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({ vendor: "DataForSEO", capUsd: 100, totalUsd: 1.234567 });
  });
  it("a provider error: the admin block with the vendor's own words goes to an admin alone", async () => {
    provider = "taskFailed";
    const body = { seed: "roof repair" };
    const customer = await hit("POST", "/api/seo/keywords/research", body), admin = await hit("POST", "/api/seo/keywords/research", body, "admin");
    expect(customer.status).toBe(400);
    expect(customer.body).toEqual({ code: "seo_source_task_failed", message: SEO_SOURCE_PUBLIC_MESSAGES.task_failed });
    expect(admin.body.message).toBe(customer.body.message);
    expect(admin.body.admin).toMatchObject({ vendor: "DataForSEO", code: "task_failed", vendorStatus: 40400, costUsd: 0.012 });
    expect(admin.body.admin.detail).toContain("Not Found. DataForSEO: account login");
  });
  it("the internal cap: dollars for an admin, a neutral pause for a customer", async () => {
    ledger.refuse = "cap";
    const body = { seed: "roof repair" };
    const customer = await hit("POST", "/api/seo/keywords/research", body), admin = await hit("POST", "/api/seo/keywords/research", body, "admin");
    expect(customer.status).toBe(402);
    expect(customer.body).toEqual({ code: "seo_budget", message: BUDGET_PAUSED_MESSAGE });
    expect(admin.body.admin.detail).toMatch(/of DataForSEO data and \$0\.50 of the \$100\.00 monthly cap is left/);
  });
});

describe("the boundary itself", () => {
  it("every kind of provider error has customer copy that names nobody", () => {
    for (const code of ["not_configured", "auth", "rate_limited", "upstream", "task_failed", "invalid", "timeout"] as const) {
      const e = new DataForSeoError(code, `DataForSEO said: ${LEAKY}`, 0.012, 40400);
      expect(e.message).toContain("DataForSEO");
      expect(e.publicMessage).not.toMatch(VENDOR_NAME_RE);
      expect(e.publicMessage.length).toBeGreaterThan(20);
      const out = seoErrorResponse(e);
      expect(out.body).toEqual({ code: `seo_source_${code}`, message: e.publicMessage, ...(code === "not_configured" ? { configured: false } : {}) });
      expect(JSON.stringify(seoErrorResponse(e, { admin: true }).body)).toContain("DataForSEO said");
      expect(publicFailure(e, "fallback")).toBe(e.publicMessage);
    }
  });
  it("the cap's dollar sentence stays in `detail`", () => {
    const d = budgetDecision(99.5, 5, 100);
    if (d.ok) throw new Error("expected a refusal");
    expect(d.detail).toMatch(/DataForSEO/);
    expect(leaksIn(d.message)).toEqual([]);
    const out = seoErrorResponse(new SeoBudgetError(d.message, d.remainingUsd, 5, d.detail));
    expect(out.status).toBe(402);
    expect(leaksIn(JSON.stringify(out.body))).toEqual([]);
    expect(leaksInJson(out.body)).toEqual([]);
  });
  it("anything else is a neutral 500", () => {
    const out = seoErrorResponse(new TypeError("Cannot read properties of undefined (reading 'dataforseo_labs')"));
    expect(out).toMatchObject({ status: 500, unexpected: true, body: { code: "seo_error", message: SEO_UNEXPECTED_MESSAGE } });
    expect(publicFailure(new Error("DataForSEO unreachable"), "The scan could not be completed.")).toBe("The scan could not be completed.");
  });
});

describe("the vendor is not named in anything shipped to the browser", () => {
  /**
   * Files under client/ and shared/ that may name the vendor. There are none: the platform-admin
   * "Data source" card (client/src/pages/seo/shell.tsx DataSourceCard) prints `admin.vendor` from
   * the admin-only API block, so even the admin bundle does not carry the name.
   */
  const ALLOWED: string[] = [];
  const root = path.resolve(import.meta.dirname, "../..");
  const TEXT = /\.(tsx?|jsx?|mjs|cjs|css|html?|json|md|mdx|txt|svg|xml|webmanifest)$/i;
  const walk = (dir: string): string[] => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.name === "node_modules" || d.name.startsWith(".") ? [] : d.isDirectory() ? walk(path.join(dir, d.name)) : TEXT.test(d.name) ? [path.join(dir, d.name)] : []);

  it("client/ and shared/", () => {
    const files = [...walk(path.join(root, "client")), ...walk(path.join(root, "shared"))];
    expect(files.length).toBeGreaterThan(100);
    const named = files.filter((f) => VENDOR_NAME_RE.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f)).sort();
    expect(named).toEqual(ALLOWED);
  });
});
