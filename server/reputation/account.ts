/**
 * Reputation for every signed-in account (/my-reputation): the user watches their own business or name, sees the
 * scored Google page 1–2 and autocomplete, gets the official removal route for each negative result (the playbook
 * registry), the people-search opt-out list, and can ask our team to fix it — that turns the scan into a lead in
 * the Reputation Desk (/admin/reputation). Prices are never shown here (owner, 2026-10-24).
 *
 *   GET    /api/reputation/me                         { available, limits, watches[], brokers[] }
 *   POST   /api/reputation/me/watches                 { query, kind, ownedDomains? } → a watch, scanned now
 *   PUT    /api/reputation/me/watches/:id             { ownedDomains?, monitor? }
 *   DELETE /api/reputation/me/watches/:id
 *   POST   /api/reputation/me/watches/:id/scan        re-scan now (monthly allowance per account)
 *   POST   /api/reputation/me/watches/:id/help        { phone?, notes? } → lead for the team
 *
 * The monitor (startReputationMonitor) re-scans watches weekly and emails the user when page 1 gets worse.
 */
import type { Express } from "express";
import { z } from "zod";
import { pool } from "../db";
import { takeBudget } from "../growth-limits";
import { isConfigured as dataforseoConfigured, DataForSeoError } from "../seo/dataforseo";
import { sendWithFallback } from "../email";
import { getBaseUrl } from "../auth";
import { REP_SUBJECT_KINDS, normalizeQuery, type RepScanReport } from "@shared/reputation";
import { scanName } from "./scan";
import { getBrokers, playbookByKey, type Playbook } from "./routes";

type GetUser = (req: any, res: any) => any;
const DAY = 86_400_000;
/** Per account: names watched, and scans a month on top of the weekly monitor. Account scans share a daily cap. */
export const ACCOUNT_LIMITS = { watches: 3, scansPer30Days: 10, globalPerDay: 400 } as const;
export const WATCH_INTERVAL_DAYS = 7;
const WATCHES_PER_HOUR = 6;

const idParam = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cleanDomains = (ds?: string[]) => (ds ?? []).map((d) => d.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]).filter(Boolean).slice(0, 10);

/** What a user sees of a removal playbook: the official route, never our internal letter outline or notes. */
export function publicGuide(p: Playbook) {
  return {
    key: p.key, platform: p.platform, title: p.title, whenItApplies: p.whenItApplies, notEligible: p.notEligible, requestUrl: p.requestUrl,
    whoMustSubmit: p.whoMustSubmit, evidence: p.evidence, steps: p.steps, timeline: p.timeline, fees: p.fees, verified: p.verifiedLive !== false,
  };
}

async function scanWatch(w: any, user: { id: number; email?: string | null; displayName?: string | null }) {
  const { report, costUsd } = await scanName({ query: w.query, kind: w.kind, ownedDomains: w.owned_domains ?? [] });
  const { rows: [s] } = await pool.query(
    `INSERT INTO rep_scans (user_id, watch_id, query, kind, name, email, report, score, cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [user.id, w.id, report.query, w.kind, user.displayName ?? null, user.email ?? null, JSON.stringify(report), report.score, costUsd]);
  await pool.query(`UPDATE rep_watches SET last_scan_id = $2, last_score = $3, last_checked_at = now(), updated_at = now() WHERE id = $1`, [w.id, s.id, report.score]);
  return { report, scanId: Number(s.id) };
}

async function watchView(w: any) {
  const latest = w.last_scan_id ? (await pool.query(`SELECT report FROM rep_scans WHERE id = $1`, [w.last_scan_id])).rows[0]?.report as RepScanReport | undefined : undefined;
  const history = (await pool.query(`SELECT created_at AS at, score FROM rep_scans WHERE watch_id = $1 AND score IS NOT NULL ORDER BY created_at DESC LIMIT 26`, [w.id])).rows.reverse();
  const guides: Record<string, ReturnType<typeof publicGuide>> = {};
  for (const r of latest?.results ?? []) {
    if (r.sentiment !== "negative" || !r.playbook) continue;
    const p = playbookByKey(r.playbook);
    if (p) guides[r.playbook] = publicGuide(p);
  }
  if (latest?.autocomplete.some((a) => a.sentiment === "negative")) {
    const p = playbookByKey("google-autocomplete");
    if (p) guides["google-autocomplete"] = publicGuide(p);
  }
  return {
    id: Number(w.id), query: w.query, kind: w.kind, ownedDomains: w.owned_domains ?? [], monitor: w.monitor, lastCheckedAt: w.last_checked_at,
    helpRequestedAt: w.help_requested_at, report: latest ?? null, history, guides,
  };
}

const scansUsed = async (userId: number) =>
  Number((await pool.query(`SELECT count(*)::int AS n FROM rep_scans WHERE user_id = $1 AND created_at > now() - interval '30 days'`, [userId])).rows[0].n);

/** The monitor's share: up to WATCHES_PER_HOUR watches not scanned for a week, oldest first. */
export async function checkDueWatches(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT w.*, u.email, u.display_name FROM rep_watches w LEFT JOIN users u ON u.id = w.user_id
      WHERE w.monitor AND (w.last_checked_at IS NULL OR w.last_checked_at < now() - make_interval(days => $1))
      ORDER BY w.last_checked_at NULLS FIRST LIMIT $2`, [WATCH_INTERVAL_DAYS, WATCHES_PER_HOUR]);
  for (const w of rows) {
    try {
      const before = w.last_scan_id ? (await pool.query(`SELECT report->'counts' AS c, score FROM rep_scans WHERE id = $1`, [w.last_scan_id])).rows[0] : null;
      const { report } = await scanWatch(w, { id: w.user_id, email: w.email, displayName: w.display_name });
      const worse = before && (report.counts.negativeTop10 > Number(before.c?.negativeTop10 ?? 0) || report.counts.negativeAutocomplete > Number(before.c?.negativeAutocomplete ?? 0));
      if (worse && w.email) {
        const base = "https://constructhub.us";
        void sendWithFallback({
          to: w.email, subject: `Your Google results for “${report.query}” changed — score ${report.score}/100`,
          html: `<p>Our weekly check of <b>${esc(report.query)}</b> found more negative results than last time: ${report.counts.negativeTop10} negative on page 1 and ${report.counts.negativeAutocomplete} negative search prediction(s). Score ${report.score}/100 (was ${before.score}).</p><p><a href="${esc(base)}/my-reputation">See what changed and how to remove it</a></p>`,
          text: `Your Google results for ${report.query} got worse: score ${report.score}/100 (was ${before.score}). ${base}/my-reputation`,
        }).catch((e: any) => console.error("[reputation] watch email failed:", e?.message));
      }
    } catch (e: any) {
      console.warn(`[reputation] watch ${w.id}:`, e?.message ?? e);
      // A failed check waits a day before the next try rather than every hour.
      await pool.query(`UPDATE rep_watches SET last_checked_at = now() - make_interval(days => $2) + interval '1 day' WHERE id = $1`, [w.id, WATCH_INTERVAL_DAYS]).catch(() => {});
    }
  }
}

export function registerReputationAccountRoutes(app: Express, getDevUser: GetUser): void {
  const route = (method: "get" | "post" | "put" | "delete", path: string, fn: (req: any, res: any, u: any) => Promise<any>) =>
    app[method](path, async (req, res, next) => {
      try {
        const u = getDevUser(req, res);
        if (!u) return;
        res.setHeader("Cache-Control", "no-store");
        await fn(req, res, u);
      } catch (e: any) {
        if (e instanceof z.ZodError) return void res.status(400).json({ message: e.issues[0]?.message ?? "Invalid input" });
        if (e instanceof DataForSeoError) return void res.status(502).json({ message: "The Google check failed. Please try again in a few minutes." });
        if (e?.status) return void res.status(e.status).json({ message: e.message });
        next(e);
      }
    });
  const ownWatch = async (req: any, u: any) => {
    const { rows: [w] } = await pool.query(`SELECT * FROM rep_watches WHERE id = $1 AND user_id = $2`, [idParam.parse(req.params.id), u.id]);
    if (!w) throw Object.assign(new Error("Not found"), { status: 404 });
    return w;
  };
  const allowance = async (u: any) => (await scansUsed(u.id)) < ACCOUNT_LIMITS.scansPer30Days && (await takeBudget("rep:account-day", ACCOUNT_LIMITS.globalPerDay, 1, DAY));

  route("get", "/api/reputation/me", async (_req, res, u) => {
    const { rows } = await pool.query(`SELECT * FROM rep_watches WHERE user_id = $1 ORDER BY created_at`, [u.id]);
    const used = await scansUsed(u.id);
    res.json({
      available: dataforseoConfigured(),
      limits: { watches: ACCOUNT_LIMITS.watches, scansPer30Days: ACCOUNT_LIMITS.scansPer30Days, scansLeft: Math.max(0, ACCOUNT_LIMITS.scansPer30Days - used), intervalDays: WATCH_INTERVAL_DAYS },
      watches: await Promise.all(rows.map(watchView)),
      // The people-search sites to opt out of first, with the official opt-out page where we have one.
      brokers: getBrokers().filter((b) => b.priority === 1).map((b) => ({ key: b.key, name: b.name, domain: b.domain, optOutUrl: b.optOutUrl, optOutEmail: b.optOutEmail, requires: b.requires, method: b.method })),
    });
  });

  route("post", "/api/reputation/me/watches", async (req, res, u) => {
    const b = z.object({ query: z.string().trim().min(2).max(120), kind: z.enum(REP_SUBJECT_KINDS), ownedDomains: z.array(z.string().max(200)).max(10).optional() }).parse(req.body);
    if (!dataforseoConfigured()) return res.status(503).json({ message: "Reputation checks are unavailable right now. Please try again later." });
    const n = Number((await pool.query(`SELECT count(*)::int AS n FROM rep_watches WHERE user_id = $1`, [u.id])).rows[0].n);
    if (n >= ACCOUNT_LIMITS.watches) return res.status(409).json({ message: `You can watch up to ${ACCOUNT_LIMITS.watches} names. Remove one to add another.` });
    if (!(await allowance(u))) return res.status(429).json({ message: "You've used this month's checks. Your names are still re-checked every week." });
    const { rows: [w] } = await pool.query(`INSERT INTO rep_watches (user_id, query, kind, owned_domains) VALUES ($1,$2,$3,$4) RETURNING *`,
      [u.id, normalizeQuery(b.query), b.kind, cleanDomains(b.ownedDomains)]);
    try { await scanWatch(w, u); } catch (e) { await pool.query(`DELETE FROM rep_watches WHERE id = $1`, [w.id]); throw e; }
    res.status(201).json(await watchView((await pool.query(`SELECT * FROM rep_watches WHERE id = $1`, [w.id])).rows[0]));
  });

  route("put", "/api/reputation/me/watches/:id", async (req, res, u) => {
    const w = await ownWatch(req, u);
    const b = z.object({ ownedDomains: z.array(z.string().max(200)).max(10).optional(), monitor: z.boolean().optional() }).parse(req.body);
    await pool.query(`UPDATE rep_watches SET owned_domains = COALESCE($2, owned_domains), monitor = COALESCE($3, monitor), updated_at = now() WHERE id = $1`,
      [w.id, b.ownedDomains ? cleanDomains(b.ownedDomains) : null, b.monitor ?? null]);
    res.json({ ok: true });
  });

  route("delete", "/api/reputation/me/watches/:id", async (req, res, u) => {
    const { rowCount } = await pool.query(`DELETE FROM rep_watches WHERE id = $1 AND user_id = $2`, [idParam.parse(req.params.id), u.id]);
    if (!rowCount) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  route("post", "/api/reputation/me/watches/:id/scan", async (req, res, u) => {
    const w = await ownWatch(req, u);
    if (!dataforseoConfigured()) return res.status(503).json({ message: "Reputation checks are unavailable right now. Please try again later." });
    if (!(await allowance(u))) return res.status(429).json({ message: "You've used this month's checks. Your names are still re-checked every week." });
    await scanWatch(w, u);
    res.json(await watchView((await pool.query(`SELECT * FROM rep_watches WHERE id = $1`, [w.id])).rows[0]));
  });

  route("post", "/api/reputation/me/watches/:id/help", async (req, res, u) => {
    const w = await ownWatch(req, u);
    const b = z.object({ phone: z.string().trim().max(40).optional(), notes: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    if (!w.last_scan_id) return res.status(409).json({ message: "Run a check first." });
    // The latest scan becomes the lead (the Desk's Leads tab lists account scans once help is asked for).
    await pool.query(`UPDATE rep_scans SET help_requested_at = now(), lead_status = 'new', phone = COALESCE($2, phone), lead_notes = COALESCE($3, lead_notes) WHERE id = $1`,
      [w.last_scan_id, b.phone || null, b.notes || null]);
    await pool.query(`UPDATE rep_watches SET help_requested_at = now(), updated_at = now() WHERE id = $1`, [w.id]);
    const { rows: [s] } = await pool.query(`SELECT score, report->'counts' AS counts FROM rep_scans WHERE id = $1`, [w.last_scan_id]);
    const base = getBaseUrl(req);
    void sendWithFallback({
      to: "support@constructhub.us", subject: `Reputation help requested — ${u.displayName || u.email} (${w.query}, ${s?.score ?? "—"}/100)`,
      html: `<p><b>${esc(String(u.displayName || ""))}</b> &lt;${esc(String(u.email || ""))}&gt;${b.phone ? ` · ${esc(b.phone)}` : ""} (account #${u.id}) asked us to fix <b>${esc(w.query)}</b> (${w.kind}).</p><p>Score ${s?.score ?? "—"}/100 · ${s?.counts?.negativeTop10 ?? 0} negative on page 1 · ${s?.counts?.negativeAutocomplete ?? 0} negative predictions.</p>${b.notes ? `<p>Notes: ${esc(b.notes)}</p>` : ""}<p><a href="${esc(base)}/admin/reputation?lead=${w.last_scan_id}">Open in the Reputation Desk</a></p>`,
      text: `Reputation help requested: ${u.email} — ${w.query} ${s?.score ?? "—"}/100`,
    }).catch((e: any) => console.error("[reputation] help email failed:", e?.message));
    res.json({ ok: true });
  });
}
