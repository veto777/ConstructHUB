/**
 * Reputation Desk — HTTP surface (shared/reputation.ts).
 *
 *   public (no account; rate-limited per IP / email / hour / day, reCAPTCHA where configured):
 *     GET  /api/reputation/public/config            { captchaSiteKey, available }
 *     POST /api/reputation/public/scan              { query, kind, name, email, phone?, captchaToken? } → { token }
 *     GET  /api/reputation/public/report/:token     the scan's report
 *
 *   admin (platform admins only):
 *     GET  /api/admin/reputation/summary · /leads · /cases · /cases/:id · /registry
 *     POST /api/admin/reputation/leads/:id/status { status, notes? }
 *     POST /api/admin/reputation/leads/:id/case          a case from the lead (its findings become items)
 *     POST /api/admin/reputation/{leads|cases}/:id/offer  a proposal offer from the reputation template
 *     POST /api/admin/reputation/cases                   { clientName, subject, kind, email?, phone?, terms?, ownedDomains?, services? }
 *     PUT  /api/admin/reputation/cases/:id
 *     POST /api/admin/reputation/cases/:id/check         re-scan every term now
 *     PUT  /api/admin/reputation/items/:id               { action?, status?, sentiment?, control?, playbook?, notes? }
 *     POST /api/admin/reputation/items/:id/draft         { notes? } a removal request drafted from the playbook
 *     POST /api/admin/reputation/items/:id/request       { text, via?, ticket? } recorded as sent
 *     POST /api/admin/reputation/items/:id/recheck       is the URL still live (through the research egress)
 *     POST /api/admin/reputation/cases/:id/assets · PUT/DELETE /api/admin/reputation/assets/:id
 *     GET  /api/admin/reputation/cases/:id/brokers · POST …/brokers/scan { priority? } · PUT …/brokers/:key
 *     PUT  /api/admin/reputation/cases/:id/wiki
 *
 *   signed-in users (their own name or business): server/reputation/account.ts, /api/reputation/me…
 *
 * The scheduled monitor (startReputationMonitor) re-checks active cases every `monitor_days` days, and account
 * watches weekly.
 */
import type { Express } from "express";
import { createHash, randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { pool } from "../db";
import { requirePlatformAdmin } from "../crm/admin";
import { rateLimit, takeBudget, ipKey } from "../growth-limits";
import { isConfigured as dataforseoConfigured, DataForSeoError } from "../seo/dataforseo";
import { sendWithFallback } from "../email";
import { getBaseUrl } from "../auth";
import { researchFetch } from "../research/egress";
import {
  ASSET_KINDS, ASSET_STATUSES, BROKER_STATUSES, ITEM_ACTIONS, ITEM_STATUSES, LEAD_STATUSES, REP_SUBJECT_KINDS, SENTIMENTS, CONTROLS,
  SERVICE_LINES, normalizeQuery, playbookFor, type RepResult, type RepScanReport,
} from "@shared/reputation";
import { scanName, findOnSite } from "./scan";
import { draftRequest } from "./ai";
import { checkDueWatches } from "./account";

type GetUser = (req: any, res: any) => any;
const DAY = 86_400_000;
export const PUBLIC_SCAN_LIMITS = { perIpDay: 3, perEmailDay: 2, perHour: 15, perDay: 60 } as const;
/** The proposal template an offer is made from (seeded in prod; the admin can edit it in /admin/proposals). */
export const REP_TEMPLATE_NAME = "Reputation Restoration — ConstructHUB";
const MAX_TERMS = 5;

const idParam = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const ev = (event: string, detail?: string) => JSON.stringify([{ at: new Date().toISOString(), event, ...(detail ? { detail: detail.slice(0, 300) } : {}) }]);

// ---------------------------------------------------------------------------------------------- registries

export type Broker = { key: string; name: string; domain: string; category: string; priority: number; optOutUrl: string | null; optOutEmail: string | null; method: string; requires: string[]; notes: string | null; sources: string[] };
export type Playbook = { key: string; category: string; platform: string; title: string; whenItApplies: string; notEligible: string | null; requestUrl: string | null; contact: string | null; whoMustSubmit: string | null; evidence: string[]; steps: string[]; timeline: string | null; fees: string | null; letterOutline: string[]; statutes: string[]; sources: string[]; verifiedLive?: boolean; notes?: string | null };

function loadJson<T>(file: string): T[] {
  for (const dir of [join(import.meta.dirname || __dirname, "data"), join(import.meta.dirname || __dirname, "..", "data")]) {
    const p = join(dir, file);
    if (existsSync(p)) { try { const v = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(v) ? v : []; } catch { return []; } }
  }
  return [];
}
let brokers: Broker[] | null = null;
let playbooks: Playbook[] | null = null;
export const getBrokers = () => (brokers ??= loadJson<Broker>("data-brokers.json"));
export const getPlaybooks = () => (playbooks ??= loadJson<Playbook>("removal-playbooks.json"));
export const playbookByKey = (k: string | null) => (k ? getPlaybooks().find((p) => p.key === k) ?? getPlaybooks().find((p) => p.key.startsWith(k)) ?? null : null);

// ---------------------------------------------------------------------------------------------- items from a scan

/** A stable key per thing on the page: the URL (normalized) or the prediction text. */
export function itemKey(r: { kind: string; url: string | null; title: string }): string {
  if (r.kind === "autocomplete") return `ac:${r.title.toLowerCase()}`;
  if (!r.url) return `${r.kind}:${r.title.toLowerCase().slice(0, 120)}`;
  try { const u = new URL(r.url); return `${r.kind === "image" ? "img" : "url"}:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`; } catch { return `url:${r.url}`; }
}

/** Every result and prediction of a report, merged into the case's items (position history appended). */
async function mergeReport(caseId: number, term: string, report: RepScanReport) {
  const now = new Date().toISOString();
  const rows: (RepResult & { key: string })[] = [
    ...report.results.map((r) => ({ ...r, key: itemKey(r) })),
    ...report.autocomplete.map((a, i) => ({ kind: "autocomplete" as const, position: i + 1, url: null, domain: null, title: a.suggestion, snippet: "", sentiment: a.sentiment, control: "third_party" as const, reason: a.reason, playbook: a.sentiment === "negative" ? "google-autocomplete" : null, key: `ac:${a.suggestion.toLowerCase()}` })),
  ];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const action = r.sentiment === "negative" ? (r.playbook ? "remove" : "suppress") : "monitor";
    await pool.query(
      `INSERT INTO rep_items (case_id, kind, key, url, domain, title, snippet, sentiment, control, reason, action, playbook, best_position, last_position, last_term, positions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15::jsonb)
       ON CONFLICT (case_id, key) DO UPDATE SET
         title = EXCLUDED.title, snippet = EXCLUDED.snippet, last_position = EXCLUDED.last_position, last_term = EXCLUDED.last_term,
         best_position = LEAST(rep_items.best_position, EXCLUDED.best_position), last_seen = now(), updated_at = now(),
         positions = (rep_items.positions || EXCLUDED.positions),
         status = CASE WHEN rep_items.status = 'suppressed' AND EXCLUDED.last_position <= 10 THEN 'in_progress' ELSE rep_items.status END`,
      [caseId, r.kind, r.key, r.url, r.domain, r.title.slice(0, 500), r.snippet.slice(0, 1000), r.sentiment, r.control, r.reason, action, r.playbook,
        r.position, term, JSON.stringify([{ at: now, term, pos: r.position }])]);
  }
  // A negative result that has left the first two pages of this term since the last check is now off page 1 or gone.
  await pool.query(
    `UPDATE rep_items SET last_position = NULL, positions = positions || $3::jsonb, updated_at = now(),
       status = CASE WHEN sentiment = 'negative' AND action = 'suppress' AND status IN ('open','in_progress') THEN 'suppressed' ELSE status END
     WHERE case_id = $1 AND last_term = $2 AND kind <> 'autocomplete' AND NOT (key = ANY($4::text[])) AND last_position IS NOT NULL`,
    [caseId, term, JSON.stringify([{ at: now, term, pos: null }]), [...seen]]);
}

/** Re-scan every term of a case now; returns the score of the main term. */
export async function checkCase(caseId: number): Promise<{ score: number | null; costUsd: number }> {
  const { rows: [c] } = await pool.query(`SELECT * FROM rep_cases WHERE id = $1`, [caseId]);
  if (!c) throw new Error("Case not found");
  const terms = [c.subject, ...(c.terms ?? [])].map(normalizeQuery).filter(Boolean);
  let score: number | null = null, costUsd = 0;
  for (const term of [...new Set(terms)].slice(0, MAX_TERMS)) {
    const { report, costUsd: cost } = await scanName({ query: term, kind: c.kind, ownedDomains: c.owned_domains ?? [] });
    costUsd += cost;
    await pool.query(`INSERT INTO rep_scans (case_id, query, kind, report, score, cost_usd, lead_status) VALUES ($1,$2,$3,$4,$5,$6,'client')`,
      [caseId, term, c.kind, JSON.stringify(report), report.score, cost]);
    await mergeReport(caseId, term, report);
    if (score === null) score = report.score;
  }
  // Owned assets' positions come from the same results.
  await pool.query(
    `UPDATE rep_assets a SET last_position = i.last_position, updated_at = now()
       FROM rep_items i WHERE a.case_id = $1 AND i.case_id = $1 AND a.url IS NOT NULL AND i.url IS NOT NULL
        AND rtrim(lower(i.url), '/') = rtrim(lower(a.url), '/')`, [caseId]);
  await pool.query(`UPDATE rep_cases SET last_checked_at = now(), last_score = $2, updated_at = now(), events = events || $3::jsonb WHERE id = $1`,
    [caseId, score, ev("checked", `score ${score ?? "—"} · $${costUsd.toFixed(3)}`)]);
  return { score, costUsd };
}

// ---------------------------------------------------------------------------------------------- broker opt-out text

/** The opt-out request for an email-method broker: plain facts the operator fills in (no generated claims). */
export function brokerRequestText(b: Broker, subject: string, listingUrl: string | null): string {
  return [
    `To: ${b.optOutEmail ?? "[opt-out address]"}`,
    `Subject: Request to delete personal information — ${subject}`,
    "",
    `Hello ${b.name} privacy team,`,
    "",
    `I am requesting that you delete and stop selling or sharing the personal information you hold about ${subject}, and remove any public listing of it from ${b.domain}.`,
    listingUrl ? `The listing is at: ${listingUrl}` : "Listing URL: [paste the listing URL]",
    "Name: " + subject,
    "Current city and state: [city, state]",
    "Email for confirmation: [email]",
    "",
    "Please confirm when the deletion is complete.",
    "",
    "Thank you,",
    `${subject}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------- proposals

async function createOffer(admin: { id: number }, rec: { name: string | null; email: string | null; company?: string | null }, findings: RepResult[], subject: string) {
  const { rows: [tpl] } = await pool.query(`SELECT * FROM proposals WHERE kind = 'template' AND name = $1 AND status <> 'archived' ORDER BY id LIMIT 1`, [REP_TEMPLATE_NAME]);
  if (!tpl) throw Object.assign(new Error(`Create a proposal template named “${REP_TEMPLATE_NAME}” in Proposals first.`), { status: 409 });
  const content = tpl.content ?? {};
  const neg = findings.filter((r) => r.sentiment === "negative").sort((a, b) => a.position - b.position).slice(0, 12);
  if (neg.length) {
    const body = [`We searched Google for “${subject}”. These results could hurt your reputation:`, "", ...neg.map((r) => `- #${r.position} ${r.title}${r.domain ? ` (${r.domain})` : ""}`)].join("\n");
    content.sections = [{ id: "findings", eyebrow: "What we found", heading: "Your search results today", body }, ...(content.sections ?? [])];
  }
  const token = randomBytes(24).toString("base64url");
  const { rows: [o] } = await pool.query(
    `INSERT INTO proposals (kind, name, public_token, template_id, recipient_name, recipient_email, recipient_company, content, file_id, created_by, events)
     VALUES ('offer', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING id`,
    [`Reputation — ${rec.name || subject}`.slice(0, 200), token, tpl.id, rec.name, rec.email?.toLowerCase() ?? null, rec.company ?? null,
      JSON.stringify(content), tpl.file_id, admin.id, ev("created", `from the Reputation Desk (${subject})`)]);
  return Number(o.id);
}

// ---------------------------------------------------------------------------------------------- monitor

let monitorTimer: NodeJS.Timeout | null = null;
let monitorBusy = false;
/**
 * Hourly: the one most overdue active case is re-checked (each case every monitor_days days; 0 = never), and up to
 * WATCHES_PER_HOUR account watches that are a week old (server/reputation/account.ts).
 */
export function startReputationMonitor(): void {
  if (monitorTimer || !dataforseoConfigured()) return;
  monitorTimer = setInterval(async () => {
    if (monitorBusy) return;
    monitorBusy = true;
    try {
      const { rows: [c] } = await pool.query(
        `SELECT id FROM rep_cases WHERE status = 'active' AND monitor_days > 0
           AND (last_checked_at IS NULL OR last_checked_at < now() - make_interval(days => monitor_days))
         ORDER BY last_checked_at NULLS FIRST LIMIT 1`);
      if (c) await checkCase(Number(c.id));
      await checkDueWatches();
    } catch (e: any) { console.error("[reputation] monitor:", e?.message ?? e); }
    finally { monitorBusy = false; }
  }, 3600_000);
  monitorTimer.unref?.();
}

// ---------------------------------------------------------------------------------------------- routes

const brokerScans = new Map<number, { done: number; total: number }>();

export function registerReputationRoutes(app: Express, getDevUser: GetUser): void {
  const admin = (method: "get" | "post" | "put" | "delete", path: string, fn: (req: any, res: any, a: any) => Promise<any>) =>
    app[method](path, async (req, res, next) => {
      try {
        const a = await requirePlatformAdmin(req, res, getDevUser);
        if (!a) return;
        await fn(req, res, a);
      } catch (e: any) {
        if (e instanceof z.ZodError) return void res.status(400).json({ message: e.issues[0]?.message ?? "Invalid input" });
        if (e instanceof DataForSeoError) return void res.status(502).json({ message: `Search data unavailable: ${e.message}` });
        if (e?.status) return void res.status(e.status).json({ message: e.message });
        next(e);
      }
    });

  // ---- public free scan
  app.get("/api/reputation/public/config", (_req, res) => {
    res.json({ captchaSiteKey: process.env.RECAPTCHA_SITE_KEY || process.env.VITE_RECAPTCHA_SITE_KEY || null, available: dataforseoConfigured() });
  });

  app.post("/api/reputation/public/scan", rateLimit("reputation-public", 30, 30), async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const body = z.object({
        query: z.string().trim().min(2).max(120),
        kind: z.enum(REP_SUBJECT_KINDS),
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
        phone: z.string().trim().max(40).optional(),
        captchaToken: z.string().max(4096).optional(),
      }).safeParse(req.body);
      if (!body.success) return res.status(400).json({ message: "Enter the name to check, your name and a valid email." });
      if (!dataforseoConfigured()) return res.status(503).json({ message: "The free scan is unavailable right now. Please try again later." });
      if (process.env.RECAPTCHA_SECRET_KEY) {
        if (!body.data.captchaToken) return res.status(400).json({ message: "Complete the CAPTCHA." });
        const r = await fetch("https://www.google.com/recaptcha/api/siteverify", { method: "POST", body: new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET_KEY, response: body.data.captchaToken }), signal: AbortSignal.timeout(5000) }).catch(() => null);
        const c: any = r ? await r.json().catch(() => null) : null;
        if (!c?.success) return res.status(400).json({ message: "CAPTCHA failed. Please try again." });
      }
      const ip = ipKey(req);
      const L = PUBLIC_SCAN_LIMITS;
      const ok = (await takeBudget(`rep:ip:${ip}`, L.perIpDay, 1, DAY)) && (await takeBudget(`rep:email:${sha(body.data.email)}`, L.perEmailDay, 1, DAY))
        && (await takeBudget("rep:global-hour", L.perHour, 1, 3600_000)) && (await takeBudget("rep:global-day", L.perDay, 1, DAY));
      if (!ok) return res.status(429).json({ message: "Free scan limit reached. Please try again tomorrow, or call us." });

      const { report, costUsd } = await scanName({ query: body.data.query, kind: body.data.kind });
      const token = randomBytes(24).toString("base64url");
      const { rows: [s] } = await pool.query(
        `INSERT INTO rep_scans (token_hash, query, kind, name, email, phone, ip_hash, report, score, cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [sha(token), report.query, body.data.kind, body.data.name, body.data.email, body.data.phone || null, sha(ip), JSON.stringify(report), report.score, costUsd]);
      const base = getBaseUrl(req);
      const link = `${base}/reputation/report/${token}`;
      void sendWithFallback({
        to: body.data.email, subject: `Your reputation scan for “${report.query}” — score ${report.score}/100`,
        html: `<p>Hi ${esc(body.data.name)},</p><p>Your free reputation scan for <b>${esc(report.query)}</b> is ready: score <b>${report.score}/100 (${report.grade})</b>, ${report.counts.negativeTop10} negative result(s) on page 1 and ${report.counts.negativeAutocomplete} negative search prediction(s).</p><p><a href="${esc(link)}">Open your report</a></p><p>Reply to this email or book a free call and we'll walk you through a restoration plan.</p>`,
        text: `Your reputation scan for ${report.query}: ${report.score}/100. ${link}`,
      }).catch((e: any) => console.error("[reputation] report email failed:", e?.message));
      void sendWithFallback({
        to: "support@constructhub.us", subject: `New reputation lead — ${body.data.name} (${report.query}, ${report.score}/100)`,
        html: `<p><b>${esc(body.data.name)}</b> &lt;${esc(body.data.email)}&gt;${body.data.phone ? ` · ${esc(body.data.phone)}` : ""} scanned <b>${esc(report.query)}</b> (${body.data.kind}).</p><p>Score ${report.score}/100 · ${report.counts.negativeTop10} negative on page 1 · ${report.counts.negativeAutocomplete} negative predictions.</p><p><a href="${esc(base)}/admin/reputation?lead=${s.id}">Open in the Reputation Desk</a></p>`,
        text: `New reputation lead: ${body.data.name} ${body.data.email} — ${report.query} ${report.score}/100`,
      }).catch((e: any) => console.error("[reputation] lead email failed:", e?.message));
      res.json({ token });
    } catch (e: any) {
      if (e instanceof DataForSeoError) return res.status(502).json({ message: "The search check failed. Please try again in a few minutes." });
      next(e);
    }
  });

  app.get("/api/reputation/public/report/:token", async (req, res) => {
    const t = String(req.params.token || "");
    const { rows: [s] } = t.length > 10 && t.length < 64 ? await pool.query(`SELECT query, kind, name, report, created_at FROM rep_scans WHERE token_hash = $1`, [sha(t)]) : { rows: [] as any[] };
    if (!s) return res.status(404).json({ message: "This report link is not valid." });
    res.setHeader("X-Robots-Tag", "noindex");
    res.json({ name: s.name, report: s.report });
  });

  // ---- admin
  admin("get", "/api/admin/reputation/summary", async (_req, res) => {
    const q = async (sql: string) => (await pool.query(sql)).rows[0];
    res.json({
      leads: await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE lead_status = 'new')::int AS new FROM rep_scans WHERE case_id IS NULL AND (user_id IS NULL OR help_requested_at IS NOT NULL)`),
      cases: await q(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*)::int AS total FROM rep_cases`),
      items: await q(`SELECT count(*) FILTER (WHERE i.sentiment = 'negative' AND i.status IN ('open','in_progress'))::int AS open_negatives,
                         count(*) FILTER (WHERE i.status = 'requested')::int AS requested,
                         count(*) FILTER (WHERE i.status IN ('removed','suppressed','done'))::int AS resolved
                       FROM rep_items i JOIN rep_cases c ON c.id = i.case_id WHERE c.status <> 'closed'`),
      brokers: await q(`SELECT count(*) FILTER (WHERE status = 'listed')::int AS listed, count(*) FILTER (WHERE status IN ('submitted','verify_needed'))::int AS pending, count(*) FILTER (WHERE status = 'removed')::int AS removed FROM rep_brokers`),
      spend: await q(`SELECT COALESCE(sum(cost_usd), 0)::float AS usd FROM rep_scans WHERE created_at >= date_trunc('month', now())`),
      registry: { brokers: getBrokers().length, playbooks: getPlaybooks().length },
      searchData: dataforseoConfigured(),
    });
  });

  admin("get", "/api/admin/reputation/registry", async (_req, res) => {
    res.json({ brokers: getBrokers(), playbooks: getPlaybooks(), services: SERVICE_LINES });
  });

  admin("get", "/api/admin/reputation/leads", async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, query, kind, name, email, phone, score, lead_status, lead_notes, created_at, user_id, help_requested_at, report->'counts' AS counts,
              (SELECT id FROM rep_cases c WHERE c.origin_scan_id = s.id LIMIT 1) AS case_id
         FROM rep_scans s WHERE case_id IS NULL AND (user_id IS NULL OR help_requested_at IS NOT NULL) ORDER BY COALESCE(help_requested_at, created_at) DESC LIMIT 300`);
    res.json({ rows });
  });

  admin("get", "/api/admin/reputation/leads/:id", async (req, res) => {
    const { rows: [s] } = await pool.query(`SELECT * FROM rep_scans WHERE id = $1 AND case_id IS NULL`, [idParam.parse(req.params.id)]);
    if (!s) return res.status(404).json({ message: "Lead not found" });
    res.json(s);
  });

  admin("post", "/api/admin/reputation/leads/:id/status", async (req, res) => {
    const b = z.object({ status: z.enum(LEAD_STATUSES), notes: z.string().max(4000).optional() }).parse(req.body);
    await pool.query(`UPDATE rep_scans SET lead_status = $2, lead_notes = COALESCE($3, lead_notes) WHERE id = $1 AND case_id IS NULL`, [idParam.parse(req.params.id), b.status, b.notes ?? null]);
    res.json({ ok: true });
  });

  admin("post", "/api/admin/reputation/leads/:id/case", async (req, res, a) => {
    const { rows: [s] } = await pool.query(`SELECT * FROM rep_scans WHERE id = $1 AND case_id IS NULL`, [idParam.parse(req.params.id)]);
    if (!s) return res.status(404).json({ message: "Lead not found" });
    const existing = (await pool.query(`SELECT id FROM rep_cases WHERE origin_scan_id = $1`, [s.id])).rows[0];
    if (existing) return res.json({ id: Number(existing.id) });
    const { rows: [c] } = await pool.query(
      `INSERT INTO rep_cases (kind, client_name, subject, email, phone, origin_scan_id, services, created_by, last_score, events)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
      [s.kind, s.name || s.query, s.query, s.email, s.phone, s.id, ["suppress", "remove", "autocomplete", "brokers"], a.id, s.score, ev("created", `from free scan #${s.id}`)]);
    if (s.report) await mergeReport(Number(c.id), s.query, s.report);
    await pool.query(`UPDATE rep_scans SET lead_status = 'client' WHERE id = $1`, [s.id]);
    res.status(201).json({ id: Number(c.id) });
  });

  admin("post", "/api/admin/reputation/leads/:id/offer", async (req, res, a) => {
    const { rows: [s] } = await pool.query(`SELECT * FROM rep_scans WHERE id = $1 AND case_id IS NULL`, [idParam.parse(req.params.id)]);
    if (!s) return res.status(404).json({ message: "Lead not found" });
    const id = await createOffer(a, { name: s.name, email: s.email }, s.report?.results ?? [], s.query);
    await pool.query(`UPDATE rep_scans SET lead_status = 'offer_sent' WHERE id = $1 AND lead_status IN ('new','contacted')`, [s.id]);
    res.status(201).json({ proposalId: id });
  });

  const caseBody = z.object({
    clientName: z.string().trim().min(1).max(200),
    subject: z.string().trim().min(2).max(120),
    kind: z.enum(REP_SUBJECT_KINDS),
    email: z.string().trim().email().max(254).or(z.literal("")).optional(),
    phone: z.string().trim().max(40).optional(),
    terms: z.array(z.string().trim().min(2).max(120)).max(MAX_TERMS - 1).optional(),
    ownedDomains: z.array(z.string().trim().max(200)).max(30).optional(),
    services: z.array(z.enum(SERVICE_LINES.map((s) => s.key) as [string, ...string[]])).optional(),
    notes: z.string().max(10_000).optional(),
    monitorDays: z.number().int().min(0).max(90).optional(),
    status: z.enum(["lead", "active", "paused", "closed"]).optional(),
  });
  const cleanDomains = (ds?: string[]) => (ds ?? []).map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]).filter(Boolean);

  admin("post", "/api/admin/reputation/cases", async (req, res, a) => {
    const b = caseBody.parse(req.body);
    const { rows: [c] } = await pool.query(
      `INSERT INTO rep_cases (kind, client_name, subject, email, phone, terms, owned_domains, services, notes, monitor_days, created_by, events)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
      [b.kind, b.clientName, normalizeQuery(b.subject), b.email || null, b.phone || null, (b.terms ?? []).map(normalizeQuery), cleanDomains(b.ownedDomains),
        b.services ?? ["suppress", "remove", "autocomplete", "brokers"], b.notes ?? null, b.monitorDays ?? 7, a.id, ev("created")]);
    res.status(201).json({ id: Number(c.id) });
  });

  admin("get", "/api/admin/reputation/cases", async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.status, c.kind, c.client_name, c.subject, c.last_score, c.last_checked_at, c.proposal_id, c.created_at,
              count(i.*) FILTER (WHERE i.sentiment = 'negative' AND i.status IN ('open','in_progress'))::int AS open_negatives,
              count(i.*) FILTER (WHERE i.status IN ('removed','suppressed','done'))::int AS resolved
         FROM rep_cases c LEFT JOIN rep_items i ON i.case_id = c.id GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 500`);
    res.json({ rows });
  });

  admin("get", "/api/admin/reputation/cases/:id", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { rows: [c] } = await pool.query(`SELECT * FROM rep_cases WHERE id = $1`, [id]);
    if (!c) return res.status(404).json({ message: "Case not found" });
    const items = (await pool.query(`SELECT * FROM rep_items WHERE case_id = $1 ORDER BY (sentiment = 'negative') DESC, last_position NULLS LAST, best_position NULLS LAST`, [id])).rows;
    const assets = (await pool.query(`SELECT * FROM rep_assets WHERE case_id = $1 ORDER BY created_at`, [id])).rows;
    const history = (await pool.query(`SELECT created_at AS at, query, score, cost_usd FROM rep_scans WHERE case_id = $1 OR id = $2 ORDER BY created_at`, [id, c.origin_scan_id ?? 0])).rows;
    const brokerCounts = (await pool.query(`SELECT status, count(*)::int AS n FROM rep_brokers WHERE case_id = $1 GROUP BY status`, [id])).rows;
    const proposal = c.proposal_id ? (await pool.query(`SELECT id, name, status, public_token FROM proposals WHERE id = $1`, [c.proposal_id])).rows[0] ?? null : null;
    res.json({ case: c, items, assets, history, brokerCounts, proposal });
  });

  admin("put", "/api/admin/reputation/cases/:id", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const b = caseBody.partial().parse(req.body);
    await pool.query(
      `UPDATE rep_cases SET client_name = COALESCE($2, client_name), subject = COALESCE($3, subject), kind = COALESCE($4, kind),
         email = CASE WHEN $5::boolean THEN $6 ELSE email END, phone = CASE WHEN $7::boolean THEN $8 ELSE phone END,
         terms = COALESCE($9, terms), owned_domains = COALESCE($10, owned_domains), services = COALESCE($11, services),
         notes = COALESCE($12, notes), monitor_days = COALESCE($13, monitor_days), status = COALESCE($14, status), updated_at = now()
       WHERE id = $1`,
      [id, b.clientName ?? null, b.subject ? normalizeQuery(b.subject) : null, b.kind ?? null, b.email !== undefined, b.email || null, b.phone !== undefined, b.phone || null,
        b.terms ? b.terms.map(normalizeQuery) : null, b.ownedDomains ? cleanDomains(b.ownedDomains) : null, b.services ?? null, b.notes ?? null, b.monitorDays ?? null, b.status ?? null]);
    res.json({ ok: true });
  });

  admin("post", "/api/admin/reputation/cases/:id/check", async (req, res) => {
    if (!dataforseoConfigured()) return res.status(503).json({ message: "Search data (DataForSEO) is not connected." });
    res.json(await checkCase(idParam.parse(req.params.id)));
  });

  admin("post", "/api/admin/reputation/cases/:id/offer", async (req, res, a) => {
    const id = idParam.parse(req.params.id);
    const { rows: [c] } = await pool.query(`SELECT * FROM rep_cases WHERE id = $1`, [id]);
    if (!c) return res.status(404).json({ message: "Case not found" });
    const items = (await pool.query(`SELECT kind, last_position AS position, url, domain, title, snippet, sentiment, control FROM rep_items WHERE case_id = $1 AND last_position IS NOT NULL AND kind <> 'autocomplete'`, [id])).rows;
    const pid = await createOffer(a, { name: c.client_name, email: c.email }, items as RepResult[], c.subject);
    await pool.query(`UPDATE rep_cases SET proposal_id = $2, updated_at = now(), events = events || $3::jsonb WHERE id = $1`, [id, pid, ev("offer_created", `proposal #${pid}`)]);
    res.status(201).json({ proposalId: pid });
  });

  // ---- items
  admin("put", "/api/admin/reputation/items/:id", async (req, res) => {
    const b = z.object({
      action: z.enum(ITEM_ACTIONS).optional(), status: z.enum(ITEM_STATUSES).optional(), sentiment: z.enum(SENTIMENTS).optional(),
      control: z.enum(CONTROLS).optional(), playbook: z.string().max(80).nullable().optional(), notes: z.string().max(10_000).optional(),
    }).parse(req.body);
    const { rowCount } = await pool.query(
      `UPDATE rep_items SET action = COALESCE($2, action), status = COALESCE($3, status), sentiment = COALESCE($4, sentiment), control = COALESCE($5, control),
         playbook = CASE WHEN $6::boolean THEN $7 ELSE playbook END, notes = COALESCE($8, notes), updated_at = now() WHERE id = $1`,
      [idParam.parse(req.params.id), b.action ?? null, b.status ?? null, b.sentiment ?? null, b.control ?? null, b.playbook !== undefined, b.playbook ?? null, b.notes ?? null]);
    if (!rowCount) return res.status(404).json({ message: "Item not found" });
    res.json({ ok: true });
  });

  admin("post", "/api/admin/reputation/items/:id/draft", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { rows: [i] } = await pool.query(`SELECT i.*, c.subject, c.client_name, c.kind AS case_kind FROM rep_items i JOIN rep_cases c ON c.id = i.case_id WHERE i.id = $1`, [id]);
    if (!i) return res.status(404).json({ message: "Item not found" });
    const notes = z.string().max(4000).optional().parse(req.body?.notes);
    const pb = playbookByKey(i.playbook ?? playbookFor(i.domain, i.kind));
    const { text, provider } = await draftRequest({
      // Citations the playbook marks UNVERIFIED stay out of letters until someone confirms them.
      playbook: pb && { ...pb, statutes: pb.statutes.filter((t) => !/UNVERIFIED/i.test(t)) }, item: { url: i.url, title: i.title, snippet: i.snippet, kind: i.kind }, subject: i.subject, clientName: i.client_name, kind: i.case_kind, operatorNotes: notes ?? i.notes,
    });
    const request = { ...(i.request ?? {}), draft: text, draftedAt: new Date().toISOString(), draftedBy: provider, playbook: pb?.key ?? null };
    await pool.query(`UPDATE rep_items SET request = $2::jsonb, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = now() WHERE id = $1`, [id, JSON.stringify(request)]);
    res.json({ request, playbook: pb });
  });

  admin("post", "/api/admin/reputation/items/:id/request", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const b = z.object({ text: z.string().min(1).max(20_000), via: z.string().max(300).optional(), ticket: z.string().max(200).optional() }).parse(req.body);
    const { rows: [i] } = await pool.query(`SELECT request FROM rep_items WHERE id = $1`, [id]);
    if (!i) return res.status(404).json({ message: "Item not found" });
    const request = { ...(i.request ?? {}), sent: b.text, via: b.via ?? null, ticket: b.ticket ?? null, sentAt: new Date().toISOString() };
    await pool.query(`UPDATE rep_items SET request = $2::jsonb, status = 'requested', updated_at = now() WHERE id = $1`, [id, JSON.stringify(request)]);
    res.json({ request });
  });

  admin("post", "/api/admin/reputation/items/:id/recheck", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { rows: [i] } = await pool.query(`SELECT url FROM rep_items WHERE id = $1`, [id]);
    if (!i?.url) return res.status(400).json({ message: "This item has no URL to check." });
    let status = 0;
    try {
      const r = await researchFetch(i.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" } });
      status = r.status;
      await r.body?.cancel().catch(() => {});
    } catch { status = 0; }
    const gone = status === 404 || status === 410;
    await pool.query(`UPDATE rep_items SET live_status = $2, status = CASE WHEN $3 AND status IN ('requested','in_progress','open') THEN 'removed' ELSE status END, updated_at = now() WHERE id = $1`, [id, status, gone]);
    res.json({ liveStatus: status, removed: gone });
  });

  // ---- assets
  const assetBody = z.object({ kind: z.enum(ASSET_KINDS), title: z.string().trim().min(1).max(300), url: z.string().trim().max(1000).optional(), status: z.enum(ASSET_STATUSES).optional(), notes: z.string().max(4000).optional() });
  admin("post", "/api/admin/reputation/cases/:id/assets", async (req, res) => {
    const b = assetBody.parse(req.body);
    const { rows: [r] } = await pool.query(`INSERT INTO rep_assets (case_id, kind, title, url, status, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [idParam.parse(req.params.id), b.kind, b.title, b.url || null, b.status ?? "planned", b.notes ?? null]);
    res.status(201).json(r);
  });
  admin("put", "/api/admin/reputation/assets/:id", async (req, res) => {
    const b = assetBody.partial().parse(req.body);
    await pool.query(`UPDATE rep_assets SET kind = COALESCE($2, kind), title = COALESCE($3, title), url = CASE WHEN $4::boolean THEN $5 ELSE url END, status = COALESCE($6, status), notes = COALESCE($7, notes), updated_at = now() WHERE id = $1`,
      [idParam.parse(req.params.id), b.kind ?? null, b.title ?? null, b.url !== undefined, b.url || null, b.status ?? null, b.notes ?? null]);
    res.json({ ok: true });
  });
  admin("delete", "/api/admin/reputation/assets/:id", async (req, res) => {
    await pool.query(`DELETE FROM rep_assets WHERE id = $1`, [idParam.parse(req.params.id)]);
    res.json({ ok: true });
  });

  // ---- brokers
  admin("get", "/api/admin/reputation/cases/:id/brokers", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { rows: [c] } = await pool.query(`SELECT subject FROM rep_cases WHERE id = $1`, [id]);
    if (!c) return res.status(404).json({ message: "Case not found" });
    const rows = (await pool.query(`SELECT * FROM rep_brokers WHERE case_id = $1`, [id])).rows;
    const byKey = new Map(rows.map((r) => [r.broker_key, r]));
    res.json({
      brokers: getBrokers().map((b) => {
        const r = byKey.get(b.key);
        return { ...b, status: r?.status ?? "not_checked", listingUrl: r?.listing_url ?? null, evidence: r?.evidence ?? null, checkedAt: r?.checked_at ?? null, submittedAt: r?.submitted_at ?? null, notes: r?.notes ?? null,
          requestText: b.method.includes("email") || b.optOutEmail ? brokerRequestText(b, c.subject, r?.listing_url ?? null) : null };
      }),
      scanning: brokerScans.get(id) ?? null,
    });
  });

  admin("post", "/api/admin/reputation/cases/:id/brokers/scan", async (req, res) => {
    const id = idParam.parse(req.params.id);
    if (!dataforseoConfigured()) return res.status(503).json({ message: "Search data (DataForSEO) is not connected." });
    if (brokerScans.has(id)) return res.status(409).json({ message: "A people-search check is already running for this case." });
    const { rows: [c] } = await pool.query(`SELECT subject, kind FROM rep_cases WHERE id = $1`, [id]);
    if (!c) return res.status(404).json({ message: "Case not found" });
    const maxPriority = z.coerce.number().int().min(1).max(3).default(1).parse(req.body?.priority);
    const list = getBrokers().filter((b) => (b.priority ?? 3) <= maxPriority && b.domain);
    brokerScans.set(id, { done: 0, total: list.length });
    res.json({ started: list.length });
    void (async () => {
      let cost = 0;
      try {
        for (const b of list) {
          try {
            const f = await findOnSite(b.domain, c.subject);
            cost += f.costUsd;
            await pool.query(
              `INSERT INTO rep_brokers (case_id, broker_key, status, listing_url, evidence, checked_at) VALUES ($1,$2,$3,$4,$5,now())
               ON CONFLICT (case_id, broker_key) DO UPDATE SET checked_at = now(), updated_at = now(),
                 status = CASE WHEN rep_brokers.status IN ('submitted','verify_needed','removed') AND EXCLUDED.status = 'not_found' THEN 'removed'
                               WHEN rep_brokers.status IN ('submitted','verify_needed','removed') THEN rep_brokers.status ELSE EXCLUDED.status END,
                 listing_url = COALESCE(EXCLUDED.listing_url, rep_brokers.listing_url), evidence = EXCLUDED.evidence`,
              [id, b.key, f.listed ? "listed" : "not_found", f.url, f.title]);
          } catch (e: any) { console.warn(`[reputation] broker ${b.domain}:`, e?.message); }
          const s = brokerScans.get(id); if (s) s.done++;
        }
      } finally {
        brokerScans.delete(id);
        await pool.query(`INSERT INTO rep_scans (case_id, query, kind, cost_usd, lead_status) VALUES ($1,$2,$3,$4,'client')`, [id, `people-search check (${list.length} sites)`, c.kind, cost]).catch(() => {});
        await pool.query(`UPDATE rep_cases SET events = events || $2::jsonb WHERE id = $1`, [id, ev("brokers_checked", `${list.length} sites · $${cost.toFixed(3)}`)]).catch(() => {});
      }
    })();
  });

  admin("put", "/api/admin/reputation/cases/:id/brokers/:key", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const key = z.string().min(1).max(80).parse(req.params.key);
    if (!getBrokers().some((b) => b.key === key)) return res.status(404).json({ message: "Unknown site" });
    const b = z.object({ status: z.enum(BROKER_STATUSES), listingUrl: z.string().max(1000).optional(), notes: z.string().max(4000).optional() }).parse(req.body);
    await pool.query(
      `INSERT INTO rep_brokers (case_id, broker_key, status, listing_url, notes, submitted_at) VALUES ($1,$2,$3,$4,$5, CASE WHEN $3 IN ('submitted','verify_needed') THEN now() END)
       ON CONFLICT (case_id, broker_key) DO UPDATE SET status = EXCLUDED.status, listing_url = COALESCE(EXCLUDED.listing_url, rep_brokers.listing_url),
         notes = COALESCE(EXCLUDED.notes, rep_brokers.notes), submitted_at = COALESCE(EXCLUDED.submitted_at, rep_brokers.submitted_at), updated_at = now()`,
      [id, key, b.status, b.listingUrl || null, b.notes ?? null]);
    res.json({ ok: true });
  });

  // ---- wikipedia
  admin("put", "/api/admin/reputation/cases/:id/wiki", async (req, res) => {
    const b = z.object({
      stage: z.enum(["assess", "sources", "draft", "submitted", "published", "declined", "not_notable"]),
      sources: z.array(z.object({ url: z.string().max(1000), title: z.string().max(300), independent: z.boolean() })).max(60).default([]),
      draft: z.string().max(60_000).default(""),
      disclosure: z.string().max(2000).default(""),
      articleUrl: z.string().max(1000).default(""),
      notes: z.string().max(10_000).default(""),
    }).parse(req.body);
    await pool.query(`UPDATE rep_cases SET wiki = $2::jsonb, updated_at = now() WHERE id = $1`, [idParam.parse(req.params.id), JSON.stringify(b)]);
    res.json({ ok: true });
  });

}
