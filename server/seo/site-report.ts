/**
 * The SEO report for one site: where it stands and what changed, in a form a
 * contractor (or an agency's client) can read without logging in — on screen,
 * as a PDF, and by scheduled email. Built ONLY from saved data: rank checks,
 * the newest Site Explorer report, the newest crawl, backlink snapshots and
 * alerts. Making or sending a report never spends SEO data.
 */
import PDFDocument from "pdfkit";
import { z } from "zod";
import { pool } from "../db";
import { siteAudit } from "./audit";

export const REPORT_SCHEDULE_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_report_schedules (
    site_id integer PRIMARY KEY REFERENCES seo_sites(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    frequency text NOT NULL DEFAULT 'off' CHECK (frequency IN ('off','weekly','monthly')),
    recipients text[] NOT NULL DEFAULT '{}',
    next_send_at timestamptz,
    last_sent_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
];

export const MAX_RECIPIENTS = 5;
export const scheduleInput = z.object({
  frequency: z.enum(["off", "weekly", "monthly"]),
  recipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(MAX_RECIPIENTS),
}).strict();

export type Mover = { keyword: string; location: string | null; device: string; from: number | null; to: number | null };
export type SiteReport = {
  domain: string; generatedAt: string;
  /** What the "since" comparisons look back to: the check nearest 30 days ago. */
  comparedWith: string | null;
  rankings: {
    /** Keywords the site tracks, and how many of them the latest check covered. */
    tracked: number; checked: number; device: string; checkedOn: string | null; top3: number; top10: number; averagePosition: number | null;
    previousTop3: number | null; previousTop10: number | null; previousAverage: number | null;
    inMapPack: number; withMapPack: number;
    /** The ten biggest moves each way; the counts are of all of them. */
    improved: Mover[]; declined: Mover[]; improvedCount: number; declinedCount: number;
    keywords: { keyword: string; location: string | null; position: number | null; previous: number | null; local: number | null; volume: number | null }[];
  } | null;
  search: { fetchedAt: string; authority: number | null; referringDomains: number | null; backlinks: number | null; organicKeywords: number | null; organicTraffic: number | null; trafficValue: number | null;
    trafficChange: number | null; keywordsChange: number | null; referringDomainsChange: number | null } | null;
  audit: { scannedAt: string | null; health: number | null; healthChange: number | null; crawled: number; errors: number; warnings: number; notices: number; topIssues: { title: string; severity: string; count: number }[] } | null;
  /** Real clicks and impressions from Google Search Console, when the site's property is connected: the last 28 days and the 28 before. */
  searchConsole: { clicks: number; impressions: number; position: number | null; previousClicks: number; previousImpressions: number } | null;
  alerts: { title: string; kind: string; createdAt: string }[];
};

type Check = { keywordId: number; keyword: string; location: string | null; volume: number | null; device: string; checkedOn: string; position: number | null; local: number | null; hasPack: boolean };

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const lastChange = (series: number[] | undefined) => (series && series.length > 1 ? Math.round(series[series.length - 1] - series[0]) : null);

/**
 * Rankings now against the check nearest `daysBack` days ago, for the site's
 * first device. Pure, for tests. A keyword with no earlier check has no "previous".
 */
export function rankingsSection(checks: Check[], primaryDevice: string, daysBack = 30, today = new Date()): { section: NonNullable<SiteReport["rankings"]>; comparedWith: string | null } | null {
  const mine = checks.filter((c) => c.device === primaryDevice);
  if (!mine.length) return null;
  const dates = [...new Set(mine.map((c) => c.checkedOn))].sort();
  const latest = dates[dates.length - 1];
  const target = new Date(today.getTime() - daysBack * 864e5).toISOString().slice(0, 10);
  // The earlier check closest to the target date (never the latest itself).
  const earlier = dates.slice(0, -1).sort((a, b) => Math.abs(Date.parse(a) - Date.parse(target)) - Math.abs(Date.parse(b) - Date.parse(target)))[0] ?? null;
  const at = (date: string | null) => new Map(mine.filter((c) => c.checkedOn === date).map((c) => [c.keywordId, c]));
  const now = at(latest), before = at(earlier);
  const ranked = (m: Map<number, Check>) => [...m.values()].map((c) => c.position).filter((p): p is number => p !== null);
  const keywords = [...now.values()].map((c) => ({ keyword: c.keyword, location: c.location, position: c.position, previous: before.get(c.keywordId)?.position ?? null, local: c.local, volume: c.volume, had: before.has(c.keywordId) }));
  const moved = keywords.filter((k) => k.had && k.position !== k.previous).map((k) => ({ keyword: k.keyword, location: k.location, device: primaryDevice, from: k.previous, to: k.position, by: (k.previous ?? 101) - (k.position ?? 101) }));
  const strip = ({ by: _by, ...m }: (typeof moved)[number]): Mover => m;
  return {
    comparedWith: earlier,
    section: {
      tracked: now.size, checked: now.size, device: primaryDevice, checkedOn: latest,
      improvedCount: moved.filter((m) => m.by > 0).length, declinedCount: moved.filter((m) => m.by < 0).length,
      top3: ranked(now).filter((p) => p <= 3).length, top10: ranked(now).filter((p) => p <= 10).length, averagePosition: avg(ranked(now)),
      previousTop3: earlier ? ranked(before).filter((p) => p <= 3).length : null, previousTop10: earlier ? ranked(before).filter((p) => p <= 10).length : null, previousAverage: earlier ? avg(ranked(before)) : null,
      inMapPack: [...now.values()].filter((c) => c.local !== null).length, withMapPack: [...now.values()].filter((c) => c.hasPack).length,
      improved: moved.filter((m) => m.by > 0).sort((a, b) => b.by - a.by).slice(0, 10).map(strip),
      declined: moved.filter((m) => m.by < 0).sort((a, b) => a.by - b.by).slice(0, 10).map(strip),
      keywords: keywords.map(({ had: _had, ...k }) => k).sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.keyword.localeCompare(b.keyword)).slice(0, 50),
    },
  };
}

/** Everything the report says about a site this account owns; null when the site is not theirs. */
/** Swappable: Search Console lives in server/seo/routes.ts (searchConsoleSummary); passed in to keep this module free of the route file. */
export const reportDeps: { searchConsole: (userId: number, domain: string) => Promise<SiteReport["searchConsole"]> } = { searchConsole: async () => null };

export async function buildSiteReport(userId: number, siteId: number): Promise<SiteReport | null> {
  const { rows: [site] } = await pool.query("SELECT id, domain, devices, location_code, language_code FROM seo_sites WHERE id=$1 AND user_id=$2", [siteId, userId]);
  if (!site) return null;
  const primary = site.devices === "mobile" ? "mobile" : "desktop";
  const [{ rows: checks }, { rows: [saved] }, audit, gsc, { rows: alerts }] = await Promise.all([
    pool.query(
      `SELECT c.keyword_id AS "keywordId", k.keyword, NULLIF(k.location_name, 'United States') AS location, k.search_volume AS volume, c.device, c.checked_on::text AS "checkedOn",
              c.position, c.local_position AS local, (jsonb_typeof(c.local_pack)='array' AND jsonb_array_length(c.local_pack)>0) AS "hasPack"
         FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id WHERE c.site_id=$1 AND c.checked_on >= current_date - 120`, [site.id]),
    pool.query(`SELECT report FROM seo_domain_reports WHERE user_id=$1 AND domain=$2 AND location_code=$3 AND language_code=$4 ORDER BY created_at DESC LIMIT 1`, [userId, site.domain, site.location_code, site.language_code]),
    siteAudit(userId, site.domain).catch(() => null),
    reportDeps.searchConsole(userId, site.domain).catch(() => null),
    pool.query(`SELECT title, kind, created_at AS "createdAt" FROM seo_alerts WHERE site_id=$1 AND user_id=$2 AND created_at > now() - interval '35 days' ORDER BY created_at DESC LIMIT 8`, [site.id, userId]),
  ]);
  const ranks = rankingsSection(checks, primary);
  const { rows: [count] } = await pool.query("SELECT count(*)::int n FROM seo_keywords WHERE site_id=$1", [site.id]);
  if (ranks) ranks.section.tracked = Math.max(ranks.section.checked, Number(count?.n ?? 0));
  const r = saved?.report;
  const a = audit?.audit ?? null;
  return {
    domain: site.domain, generatedAt: new Date().toISOString(), comparedWith: ranks?.comparedWith ?? null,
    rankings: ranks?.section ?? null,
    search: r ? {
      fetchedAt: r.fetchedAt, authority: r.links?.authority ?? null, referringDomains: r.links?.referringDomains ?? null, backlinks: r.links?.backlinks ?? null,
      organicKeywords: r.organic?.keywords ?? null, organicTraffic: r.organic?.traffic ?? null, trafficValue: r.organic?.trafficValue ?? null,
      trafficChange: lastChange(Array.isArray(r.history) ? r.history.map((h: any) => h.traffic) : undefined),
      keywordsChange: lastChange(Array.isArray(r.history) ? r.history.map((h: any) => h.keywords) : undefined),
      referringDomainsChange: lastChange(Array.isArray(r.linkHistory) ? r.linkHistory.map((h: any) => h.referringDomains) : undefined),
    } : null,
    audit: a ? {
      scannedAt: a.scannedAt, health: a.health, healthChange: a.healthChange, crawled: a.crawled,
      errors: a.totals.error.affected, warnings: a.totals.warning.affected, notices: a.totals.notice.affected,
      topIssues: a.issues.slice(0, 6).map((i) => ({ title: i.title, severity: i.severity, count: i.count })),
    } : null,
    searchConsole: gsc ? { clicks: Math.round(gsc.clicks), impressions: Math.round(gsc.impressions), position: gsc.position, previousClicks: Math.round(gsc.previousClicks), previousImpressions: Math.round(gsc.previousImpressions) } : null,
    alerts,
  };
}

// ── Words ──────────────────────────────────────────────────────────────────

const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const day = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const signed = (v: number | null | undefined) => (v == null || v === 0 ? "" : ` (${v > 0 ? "+" : "−"}${n(Math.abs(v))})`);
const where = (m: { location: string | null }) => (m.location ? ` in ${m.location}` : "");
export const moverLine = (m: Mover) =>
  m.from === null ? `"${m.keyword}"${where(m)} now ranks at ${m.to}` : m.to === null ? `"${m.keyword}"${where(m)} dropped out of the results (was ${m.from})` : `"${m.keyword}"${where(m)} moved from ${m.from} to ${m.to}`;

/** The headline facts, as label / value pairs — the email body and the top of the PDF. */
export function reportHighlights(r: SiteReport): [string, string][] {
  const rows: [string, string][] = [];
  if (r.rankings) {
    const k = r.rankings;
    rows.push(["Keywords in the top 10", `${k.top10} of ${k.checked} checked${k.previousTop10 !== null ? signed(k.top10 - k.previousTop10) : ""}`]);
    if (k.tracked > k.checked) rows.push(["Not covered by the latest check", `${k.tracked - k.checked} of ${k.tracked} tracked keywords`]);
    rows.push(["Keywords in the top 3", `${k.top3}${k.previousTop3 !== null ? signed(k.top3 - k.previousTop3) : ""}`]);
    if (k.averagePosition !== null) rows.push(["Average position", `${k.averagePosition}${k.previousAverage !== null && k.previousAverage !== k.averagePosition ? ` (was ${k.previousAverage})` : ""}`]);
    if (k.withMapPack > 0) rows.push(["In the Google map pack", `${k.inMapPack} of ${k.withMapPack} searches that show a map`]);
  }
  if (r.searchConsole) {
    const g = r.searchConsole;
    rows.push(["Clicks from Google, last 28 days", `${n(g.clicks)}${signed(g.clicks - g.previousClicks)}`]);
    rows.push(["Times shown in Google, last 28 days", `${n(g.impressions)}${signed(g.impressions - g.previousImpressions)}`]);
  }
  if (r.search) {
    rows.push(["Estimated visits from Google / month", `${n(r.search.organicTraffic)}${signed(r.search.trafficChange)}`]);
    rows.push(["Keywords the site ranks for", `${n(r.search.organicKeywords)}${signed(r.search.keywordsChange)}`]);
    rows.push(["Websites linking to it", `${n(r.search.referringDomains)}${signed(r.search.referringDomainsChange)}`]);
    if (r.search.authority !== null) rows.push(["Authority (0–100)", String(r.search.authority)]);
  }
  if (r.audit && r.audit.health !== null) rows.push(["Site health (0–100)", `${r.audit.health}${signed(r.audit.healthChange)} · ${n(r.audit.errors)} errors, ${n(r.audit.warnings)} warnings`]);
  return rows;
}

export const reportIsEmpty = (r: SiteReport) => !r.rankings && !r.search && !r.audit && !r.searchConsole;

// ── PDF ────────────────────────────────────────────────────────────────────

/** The report as a PDF. `brand` is the account's white-label name and logo (Site Scan branding), when set. */
export function renderReportPdf(r: SiteReport, brand?: { name?: string | null; logo?: string | null } | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "LETTER", info: { Title: `SEO report — ${r.domain}`, Author: brand?.name || "ConstructHUB" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const width = doc.page.width - 96, ink = "#1a1a2e", soft = "#666666", rule = "#dddddd";
    const room = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };
    const heading = (t: string) => { room(60); doc.moveDown(1).fontSize(14).fillColor(ink).font("Helvetica-Bold").text(t).moveDown(0.3); doc.moveTo(48, doc.y).lineTo(48 + width, doc.y).strokeColor(rule).stroke().moveDown(0.5); doc.font("Helvetica").fontSize(10).fillColor(ink); };
    const pair = (label: string, value: string) => { room(18); const y = doc.y; doc.fontSize(10).fillColor(soft).text(label, 48, y, { width: width * 0.55 }); doc.fillColor(ink).font("Helvetica-Bold").text(value, 48 + width * 0.55, y, { width: width * 0.45, align: "right" }).font("Helvetica"); doc.x = 48; doc.moveDown(0.35); };
    const line = (t: string, color = ink) => { room(16); doc.fontSize(10).fillColor(color).text(t, 48, doc.y, { width }); doc.moveDown(0.2); };

    try { if (brand?.logo && /^data:image\/(png|jpe?g);base64,/.test(brand.logo)) { doc.image(Buffer.from(brand.logo.split(",")[1], "base64"), { fit: [150, 60] }); doc.moveDown(0.5); } } catch { /* an unreadable logo must not stop the report */ }
    doc.fontSize(22).fillColor(ink).font("Helvetica-Bold").text(`SEO report`).font("Helvetica").fontSize(13).fillColor(soft).text(r.domain);
    doc.fontSize(10).text(`${day(r.generatedAt)}${r.comparedWith ? ` · rankings compared with ${day(r.comparedWith)}` : ""}${brand?.name ? ` · prepared by ${brand.name}` : ""}`);

    if (reportIsEmpty(r)) { doc.moveDown(2).fontSize(11).fillColor(ink).text("There is nothing to report yet. Add keywords to the rank tracker, analyse the site in Site Explorer, and run a site audit — the next report will have their numbers.", { width }); doc.end(); return; }

    heading("At a glance");
    for (const [label, value] of reportHighlights(r)) pair(label, value);

    if (r.rankings) {
      const k = r.rankings;
      heading(`Rankings on Google (${k.device}) — checked ${day(k.checkedOn)}`);
      if (k.improved.length) { line(k.improvedCount > k.improved.length ? `Moved up — the ${k.improved.length} biggest of ${k.improvedCount}` : "Moved up", "#188038"); for (const m of k.improved) line(`  • ${moverLine(m)}`); doc.moveDown(0.3); }
      if (k.declined.length) { line(k.declinedCount > k.declined.length ? `Moved down — the ${k.declined.length} biggest of ${k.declinedCount}` : "Moved down", "#c5221f"); for (const m of k.declined) line(`  • ${moverLine(m)}`); doc.moveDown(0.3); }
      if (!k.improved.length && !k.declined.length) line(r.comparedWith ? "No keyword changed position since the earlier check." : "This is the first check, so there is nothing to compare with yet.", soft);
      room(40); doc.moveDown(0.4).font("Helvetica-Bold").fontSize(9).fillColor(soft);
      // The built-in PDF font has no arrow glyphs, and a header must fit its column: both were wrong on the first render.
      const cols = [0, width * 0.5, width * 0.63, width * 0.74, width * 0.87];
      const row = (cells: string[], bold = false) => { room(16); const y = doc.y; doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(bold ? soft : ink); cells.forEach((c, i) => doc.text(c, 48 + cols[i], y, { width: (cols[i + 1] ?? width) - cols[i] - 6, lineBreak: false, ellipsis: true })); doc.x = 48; doc.y = y + 14; };
      row(["Keyword", "Position", "Was", "Map pack", "Volume"], true);
      for (const kw of k.keywords) row([`${kw.keyword}${kw.location ? ` · ${kw.location}` : ""}`, kw.position === null ? "not ranked" : String(kw.position), kw.previous === null ? "—" : String(kw.previous), kw.local === null ? "—" : `#${kw.local}`, n(kw.volume)]);
      if (k.checked > k.keywords.length) line(`…and ${k.checked - k.keywords.length} more checked keywords.`, soft);
    }
    if (r.searchConsole) {
      const g = r.searchConsole;
      heading("Clicks from Google — Search Console, last 28 days");
      pair("Clicks", `${n(g.clicks)}${signed(g.clicks - g.previousClicks)}`);
      pair("Times shown in results", `${n(g.impressions)}${signed(g.impressions - g.previousImpressions)}`);
      if (g.position !== null) pair("Average position", String(g.position));
      line("These are Google's own counts for the site. Changes in brackets compare with the 28 days before.", soft);
    }
    if (r.search) {
      heading(`Search presence — analysed ${day(r.search.fetchedAt)}`);
      pair("Estimated visits from Google / month", `${n(r.search.organicTraffic)}${signed(r.search.trafficChange)}`);
      if (r.search.trafficValue != null) pair("What those visits would cost as ads / month", `$${n(r.search.trafficValue)}`);
      pair("Keywords the site ranks for", `${n(r.search.organicKeywords)}${signed(r.search.keywordsChange)}`);
      pair("Websites linking to it", `${n(r.search.referringDomains)}${signed(r.search.referringDomainsChange)}`);
      pair("Links in total", n(r.search.backlinks));
      line("Changes in brackets are over the period the data covers (up to two years). Visits are estimates from rankings, not analytics.", soft);
    }
    if (r.audit) {
      heading(`Site health — crawled ${day(r.audit.scannedAt)}`);
      pair("Health score (pages with no errors)", r.audit.health === null ? "—" : `${r.audit.health} / 100${signed(r.audit.healthChange)}`);
      pair("Pages crawled", n(r.audit.crawled));
      pair("Errors / warnings / notices", `${n(r.audit.errors)} / ${n(r.audit.warnings)} / ${n(r.audit.notices)}`);
      if (r.audit.topIssues.length) { doc.moveDown(0.3); line("What to fix first", soft); for (const i of r.audit.topIssues) line(`  • ${i.title} — ${n(i.count)} affected (${i.severity})`); }
    }
    if (r.alerts.length) { heading("Alerts in the last month"); for (const a of r.alerts) line(`${day(a.createdAt)} — ${a.title}`); }
    doc.moveDown(1.5).fontSize(8).fillColor(soft).text("Positions are Google's organic results for the place each keyword is tracked from. The map pack is the block of local businesses Google shows above them.", 48, doc.y, { width });
    doc.end();
  });
}

// ── Schedule ───────────────────────────────────────────────────────────────

/** When the next report goes out: weekly = 7 days on; monthly = the 1st of next month, 13:00 UTC. Pure. */
export function nextSendAt(frequency: "off" | "weekly" | "monthly", from = new Date()): Date | null {
  if (frequency === "off") return null;
  if (frequency === "weekly") return new Date(from.getTime() + 7 * 864e5);
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 13, 0, 0));
}
/** The dedupe period a send belongs to: one email per recipient per week / month. */
export const sendPeriod = (frequency: string, at = new Date()) => (frequency === "weekly" ? `w${Math.floor(at.getTime() / (7 * 864e5))}` : at.toISOString().slice(0, 7));

export async function getSchedule(userId: number, siteId: number) {
  const { rows: [s] } = await pool.query(`SELECT frequency, recipients, next_send_at AS "nextSendAt", last_sent_at AS "lastSentAt" FROM seo_report_schedules WHERE site_id=$1 AND user_id=$2`, [siteId, userId]);
  return s ?? { frequency: "off", recipients: [], nextSendAt: null, lastSentAt: null };
}
export async function saveSchedule(userId: number, siteId: number, input: z.infer<typeof scheduleInput>) {
  const recipients = [...new Set(input.recipients)];
  await pool.query(
    `INSERT INTO seo_report_schedules(site_id, user_id, frequency, recipients, next_send_at) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (site_id) DO UPDATE SET frequency=EXCLUDED.frequency, recipients=EXCLUDED.recipients, next_send_at=EXCLUDED.next_send_at, updated_at=now()`,
    [siteId, userId, input.frequency, recipients, nextSendAt(input.frequency)]);
  return getSchedule(userId, siteId);
}
