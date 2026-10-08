/**
 * The SEO report for one site: where it stands and what changed, in a form a
 * contractor (or an agency's client) can read without logging in — on screen,
 * as a PDF, and by scheduled email. Built ONLY from saved data: rank checks,
 * the newest Site Explorer report, the newest crawl, backlink snapshots and
 * alerts. Making or sending a report never spends SEO data.
 */
import { gridReportLines, type GridReportLine } from "./grid-monitor";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { pool } from "../db";
import { countryLabel } from "@shared/seo-markets";
import { tagOverview } from "./rank-tags";
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
  // The end of the work a scheduled report covers, fixed when that report is first due: a retry for some recipients
  // tells the same work, and the next report starts exactly here (no task falls between two reports).
  `ALTER TABLE seo_report_schedules ADD COLUMN IF NOT EXISTS work_cutoff timestamptz`,
  // The rest of the occurrence, fixed with it: where its work starts, and the period its emails are counted under.
  `ALTER TABLE seo_report_schedules ADD COLUMN IF NOT EXISTS work_since timestamptz`,
  `ALTER TABLE seo_report_schedules ADD COLUMN IF NOT EXISTS work_period text`,
  // Who holds the lease: only that pass may finish the occurrence or move its next date.
  `ALTER TABLE seo_report_schedules ADD COLUMN IF NOT EXISTS lease_token text`,
  // Each recipient's delivery of each report period: 'pending' while a send is under way (with its sender's token and
  // when it started), 'sent' once the email went. A pending row older than half an hour is a send that died.
  // 'uncertain': a send that died after the email log claimed it — it may well have gone, so it is never sent again
  // automatically; the Reports page says so.
  `CREATE TABLE IF NOT EXISTS seo_report_deliveries (
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     period text NOT NULL,
     recipient text NOT NULL,
     state text NOT NULL CHECK (state IN ('pending','sent')),
     token text,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (site_id, period, recipient)
   )`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='seo_report_deliveries_state_check' AND pg_get_constraintdef(oid) NOT LIKE '%uncertain%') THEN
       ALTER TABLE seo_report_deliveries DROP CONSTRAINT seo_report_deliveries_state_check;
       ALTER TABLE seo_report_deliveries ADD CONSTRAINT seo_report_deliveries_state_check CHECK (state IN ('pending','sent','uncertain'));
     END IF; END $$`,
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
    /**
     * The changes, measured only on keywords in BOTH checks (the same rule as the tags): how many those are, the change
     * in their top 10 / top 3, and their average position now and before (of those ranked both times). null = no earlier check.
     */
    compared?: number | null; top10Change?: number | null; top3Change?: number | null; averageNow?: number | null; averageBefore?: number | null; rankedBoth?: number;
    inMapPack: number; withMapPack: number;
    /** The ten biggest moves each way; the counts are of all of them. */
    improved: Mover[]; declined: Mover[]; improvedCount: number; declinedCount: number;
    keywords: { keyword: string; location: string | null; position: number | null; previous: number | null; local: number | null; volume: number | null }[];
    /** By tag, when the keywords carry tags (up to REPORT_TAGS, most keywords first); changes only on keywords in both checks. */
    byTag?: ReportTag[]; moreTags?: number;
  } | null;
  search: { fetchedAt: string; authority: number | null; referringDomains: number | null; backlinks: number | null; organicKeywords: number | null; organicTraffic: number | null; trafficValue: number | null;
    trafficChange: number | null; keywordsChange: number | null; referringDomainsChange: number | null } | null;
  /** The newest crawl could not be read: no health is reported (never an older crawl's in its place). */
  auditUnreadable?: string | null;
  /** Site health could not be looked up just now (not "no crawl"): said; a scheduled send fails and is tried again. */
  auditUnavailable?: boolean;
  audit: { scannedAt: string | null; health: number | null; healthChange: number | null; crawled: number; errors: number; warnings: number; notices: number; topIssues: { title: string; severity: string; count: number }[] } | null;
  /** Real clicks and impressions from Google Search Console, when the site's property is connected: the last 28 days and the 28 before. */
  /** Google's own counts for the last 28 days. A number is null when nothing was synced for that period; `days` is how many of the 28 are there. */
  searchConsole: { clicks: number | null; impressions: number | null; position: number | null; previousClicks: number | null; previousImpressions: number | null; days?: number; previousDays?: number; /** The newest day synced; the 28 days end here. */ through?: string | null; syncedAt?: string | null;
    /** A read of these days is still running or failed, or whether every read finished could not be established (`completenessUnknown`): the counts may be short, so no change is shown. */ incomplete?: boolean; completenessUnknown?: boolean } | null;
  alerts: { title: string; kind: string; createdAt: string }[];
  /** Repeating local grids: the newest scan of each with the comparable one before it. */
  grids?: GridReportLine[];
  /**
   * The work done: action-plan tasks MARKED done in the last WORK_DAYS days (the customer's own record that they were
   * done — not a measurement), newest first, and how many are still open. null when the site has no plan at all.
   */
  work?: WorkSection | null;
};
export const WORK_DAYS = 30, WORK_LIST = 15;
export type WorkSection = {
  /** The period: tasks marked done after `since` (a scheduled report: since the last one went out), else the last `days` days. */
  since?: string | null;
  /** The plan could not be read: nothing is said about the work (never "nothing done"). */
  unavailable?: boolean;
  days: number; done: { title: string; doneAt: string; target: string | null; note: string | null; kind: string; owner?: string | null }[]; doneCount: number; open: number; inProgress: number;
  /** Open tasks whose due date is before `today` (UTC, said with the date), the earliest first; and how many fall due in the next 7 days. */
  today?: string; overdue?: { title: string; dueOn: string; owner: string | null }[]; overdueCount?: number; dueSoon?: number;
};
/** Pure: the work section from the plan's rows (any order). */
/** A note as the report shows it: on one line, at most 300 characters (whole characters, never half of one), "…" when cut. */
export const reportNote = (note: string | null | undefined) => {
  if (!note) return null;
  const flat = Array.from(String(note).normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim());
  return flat.length ? (flat.length > 300 ? `${flat.slice(0, 299).join("")}…` : flat.join("")) : null;
};
export function workSection(rows: { title: string; status: string; done_at: string | Date | null; target: string | null; note: string | null; kind: string; due_on?: string | null; owner?: string | null }[], now = new Date(), opts: { since?: Date | null; hasPlan?: boolean } = {}): WorkSection | null {
  if (!rows.length && !opts.hasPlan) return null;
  const since = opts.since ? opts.since.getTime() : now.getTime() - WORK_DAYS * 864e5, until = now.getTime();
  const today = now.toISOString().slice(0, 10), soon = new Date(now.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  const openRows = rows.filter((t) => t.status === "todo" || t.status === "doing");
  const due = (t: { due_on?: string | null }) => (typeof t.due_on === "string" && /^\d{4}-\d{2}-\d{2}/.test(t.due_on) ? t.due_on.slice(0, 10) : null);
  const overdue = openRows.filter((t) => { const d = due(t); return d !== null && d < today; }).sort((a, b) => due(a)!.localeCompare(due(b)!));
  const done = rows.filter((t) => t.status === "done" && t.done_at && new Date(t.done_at).getTime() > since && new Date(t.done_at).getTime() <= until)
    .sort((a, b) => new Date(b.done_at!).getTime() - new Date(a.done_at!).getTime());
  return {
    days: WORK_DAYS, doneCount: done.length, open: openRows.length, inProgress: rows.filter((t) => t.status === "doing").length,
    since: opts.since ? opts.since.toISOString() : null,
    done: done.slice(0, WORK_LIST).map((t) => ({ title: t.title, doneAt: new Date(t.done_at!).toISOString(), target: t.target ?? null, note: reportNote(t.note), kind: t.kind, owner: t.owner ?? null })),
    today, overdue: overdue.slice(0, 10).map((t) => ({ title: t.title, dueOn: due(t)!, owner: t.owner ?? null })), overdueCount: overdue.length,
    dueSoon: openRows.filter((t) => { const d = due(t); return d !== null && d >= today && d <= soon; }).length,
  };
}

type Check = { keywordId: number; keyword: string; location: string | null; volume: number | null; device: string; checkedOn: string; position: number | null; local: number | null; hasPack: boolean; tags?: string[] | null };
/** One tag (a service, a town) in the report: the same comparison as the rankings (the latest check against the earlier one). */
export type ReportTag = { tag: string; keywords: number; top3: number; top10: number; top10Change: number | null; visibility: number | null; visibilityChange: number | null;
  /** Keywords in both checks (the changes rest on these alone), and in the latest only. */ compared: number; newSince: number;
  /** The index weighted by search volume, or each keyword once — now, and for the change. */ weighted: boolean; changeWeighted: boolean | null };
export const REPORT_TAGS = 20;

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
  // By tag: the keywords of the latest check, each tag on its own; the same two checks as everything above.
  const kws = [...now.values()].map((c) => ({ id: c.keywordId, tags: Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === "string" && t) : [], volume: c.volume }));
  const tagged = kws.some((k) => k.tags.length) ? tagOverview(kws, new Map([...now].map(([id, c]) => [id, c.position])), earlier ? new Map([...before].map(([id, c]) => [id, c.position])) : null).rows.filter((t) => t.tag !== null) : [];
  const byTag: ReportTag[] = tagged.sort((a, b) => b.keywords - a.keywords || String(a.tag).localeCompare(String(b.tag))).map((t) => ({ tag: t.tag as string, keywords: t.checked, top3: t.top3, top10: t.top10, top10Change: t.top10Change, visibility: t.visibility, visibilityChange: t.visibilityChange, compared: t.compared, newSince: t.newSince, weighted: t.weighted, changeWeighted: t.changeWeighted }));
  return {
    comparedWith: earlier,
    section: {
      tracked: now.size, checked: now.size, device: primaryDevice, checkedOn: latest,
      improvedCount: moved.filter((m) => m.by > 0).length, declinedCount: moved.filter((m) => m.by < 0).length,
      top3: ranked(now).filter((p) => p <= 3).length, top10: ranked(now).filter((p) => p <= 10).length, averagePosition: avg(ranked(now)),
      ...(() => {
        if (!earlier) return { compared: null, top10Change: null, top3Change: null, averageNow: null, averageBefore: null, rankedBoth: 0 };
        const both = [...now.keys()].filter((id) => before.has(id));
        const pos = (m: Map<number, Check>, id: number) => m.get(id)!.position;
        const inTop = (m: Map<number, Check>, n: number) => both.filter((id) => { const p = pos(m, id); return p !== null && p <= n; }).length;
        const rb = both.filter((id) => pos(now, id) !== null && pos(before, id) !== null);
        return { compared: both.length, top10Change: both.length ? inTop(now, 10) - inTop(before, 10) : null, top3Change: both.length ? inTop(now, 3) - inTop(before, 3) : null,
          averageNow: avg(rb.map((id) => pos(now, id) as number)), averageBefore: avg(rb.map((id) => pos(before, id) as number)), rankedBoth: rb.length };
      })(),
      previousTop3: earlier ? ranked(before).filter((p) => p <= 3).length : null, previousTop10: earlier ? ranked(before).filter((p) => p <= 10).length : null, previousAverage: earlier ? avg(ranked(before)) : null,
      inMapPack: [...now.values()].filter((c) => c.local !== null).length, withMapPack: [...now.values()].filter((c) => c.hasPack).length,
      improved: moved.filter((m) => m.by > 0).sort((a, b) => b.by - a.by).slice(0, 10).map(strip),
      declined: moved.filter((m) => m.by < 0).sort((a, b) => a.by - b.by).slice(0, 10).map(strip),
      keywords: keywords.map(({ had: _had, ...k }) => k).sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.keyword.localeCompare(b.keyword)).slice(0, 50),
      ...(byTag.length ? { byTag: byTag.slice(0, REPORT_TAGS), moreTags: Math.max(0, byTag.length - REPORT_TAGS) } : {}),
    },
  };
}

/** Everything the report says about a site this account owns; null when the site is not theirs. */
/** Swappable: Search Console lives in server/seo/routes.ts (searchConsoleSummary); passed in to keep this module free of the route file. */
export const reportDeps: { searchConsole: (userId: number, domain: string) => Promise<SiteReport["searchConsole"]> } = { searchConsole: async () => null };

/**
 * `workSince`: the work section covers tasks marked done after this (a scheduled report passes when the last one went
 * out, so no work falls between two reports). `strict`: a plan that cannot be read fails the report (a scheduled send
 * is then tried again) instead of being shown as unavailable.
 */
export async function buildSiteReport(userId: number, siteId: number, opts: { workSince?: Date | null; workUntil?: Date | null; strict?: boolean } = {}): Promise<SiteReport | null> {
  const { rows: [site] } = await pool.query("SELECT id, domain, devices, location_code, language_code FROM seo_sites WHERE id=$1 AND user_id=$2", [siteId, userId]);
  if (!site) return null;
  const primary = site.devices === "mobile" ? "mobile" : "desktop";
  const [{ rows: checks }, { rows: [saved] }, audit, gsc, { rows: alerts }] = await Promise.all([
    pool.query(
      // A keyword's place is named only when it is not the site's own country (the default place of its keywords).
      `SELECT c.keyword_id AS "keywordId", k.keyword, NULLIF(k.location_name, $2::text) AS location, k.search_volume AS volume, c.device, c.checked_on::text AS "checkedOn",
              c.position, c.local_position AS local, (jsonb_typeof(c.local_pack)='array' AND jsonb_array_length(c.local_pack)>0) AS "hasPack", k.tags
         FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id WHERE c.site_id=$1 AND c.checked_on >= current_date - 120`, [site.id, countryLabel(site.location_code)]),
    pool.query(`SELECT report FROM seo_domain_reports WHERE user_id=$1 AND domain=$2 AND location_code=$3 AND language_code=$4 ORDER BY created_at DESC LIMIT 1`, [userId, site.domain, site.location_code, site.language_code]),
    siteAudit(userId, site.domain).catch((e) => { if (opts.strict) throw e; return "unavailable" as const; }),
    reportDeps.searchConsole(userId, site.domain).catch(() => null),
    pool.query(`SELECT title, kind, created_at AS "createdAt" FROM seo_alerts WHERE site_id=$1 AND user_id=$2 AND created_at > now() - interval '35 days' ORDER BY created_at DESC LIMIT 8`, [site.id, userId]),
  ]);
  const grids = await gridReportLines(userId, site.id).catch(() => []);
  const workSince = opts.workSince ?? new Date(Date.now() - WORK_DAYS * 864e5);
  let work: WorkSection | null;
  try {
    const [{ rows: tasks }, { rows: [all] }] = await Promise.all([
      pool.query(`SELECT title, status, done_at, target, note, kind, due_on::text AS due_on, owner FROM seo_tasks WHERE site_id=$1 AND user_id=$2 AND (status IN ('todo','doing') OR (status='done' AND done_at > $3 AND done_at <= $4))`, [site.id, userId, workSince.toISOString(), (opts.workUntil ?? new Date()).toISOString()]),
      pool.query("SELECT count(*)::int n FROM seo_tasks WHERE site_id=$1 AND user_id=$2", [site.id, userId]),
    ]);
    // A plan whose tasks were all done earlier still has a section: "nothing marked done in this period".
    work = workSection(tasks, opts.workUntil ?? new Date(), { since: opts.workSince ?? null, hasPlan: Number(all?.n ?? 0) > 0 });
  } catch (e) {
    if (opts.strict) throw e;
    work = { unavailable: true, days: WORK_DAYS, done: [], doneCount: 0, open: 0, inProgress: 0 };
  }
  const ranks = rankingsSection(checks, primary);
  const { rows: [count] } = await pool.query("SELECT count(*)::int n FROM seo_keywords WHERE site_id=$1", [site.id]);
  if (ranks) ranks.section.tracked = Math.max(ranks.section.checked, Number(count?.n ?? 0));
  const r = saved?.report;
  const auditUnavailable = audit === "unavailable";
  const auditRead = audit === "unavailable" ? null : audit;
  const a = auditRead?.audit ?? null;
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
    ...(auditRead?.newestUnreadable ? { auditUnreadable: auditRead.newestUnreadable.at ?? "" } : {}),
    ...(auditUnavailable ? { auditUnavailable: true } : {}),
    audit: a ? {
      scannedAt: a.scannedAt, health: a.health, healthChange: a.healthChange, crawled: a.crawled,
      errors: a.totals.error.affected, warnings: a.totals.warning.affected, notices: a.totals.notice.affected,
      topIssues: a.issues.slice(0, 6).map((i) => ({ title: i.title, severity: i.severity, count: i.count })),
    } : null,
    // Nothing synced for the last 28 days is no section at all, rather than a row of zeros.
    searchConsole: gsc && gsc.clicks !== null ? { clicks: rnd(gsc.clicks), impressions: rnd(gsc.impressions), position: gsc.position, previousClicks: rnd(gsc.previousClicks), previousImpressions: rnd(gsc.previousImpressions), days: gsc.days, previousDays: gsc.previousDays, through: gsc.through ?? null, syncedAt: gsc.syncedAt ? new Date(gsc.syncedAt).toISOString() : null,
      // The summary's own completeness verdict travels with the numbers (the PDF, the email and the report page all say it).
      ...(gsc.incomplete ? { incomplete: true } : {}), ...(gsc.completenessUnknown ? { completenessUnknown: true } : {}) } : null,
    alerts,
    grids,
    work,
  };
}

// ── Words ──────────────────────────────────────────────────────────────────

const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const rnd = (v: number | null | undefined) => (v == null ? null : Math.round(v));
/**
 * Both 28-day periods are complete — every day there, and every read of them finished (the summary's verdict, the same
 * rule as the by-page report); only then is the difference a change and not missing days. (One rule for the PDF, the
 * email and the rank tracker tile.)
 */
export const gscComparable = (g: NonNullable<SiteReport["searchConsole"]>) => g.previousClicks !== null && (g.days ?? 28) >= GSC_MIN_DAYS && (g.previousDays ?? 28) >= GSC_MIN_DAYS && !g.incomplete;
export const GSC_MIN_DAYS = 28;
const gscChange = (g: NonNullable<SiteReport["searchConsole"]>, now: number | null, before: number | null) => (gscComparable(g) && now !== null && before !== null ? signed(now - before) : "");
/** Why the reads of these days do not count as complete, in a few words; null when they do. */
const gscReadNote = (g: NonNullable<SiteReport["searchConsole"]>) => (!g.incomplete ? null : g.completenessUnknown ? "whether every day was fully read from Search Console is not known" : "some days are still being read from Search Console, or a read failed");
/** The period in words, with its end date and anything missing from either window — the same text wherever these numbers are shown. */
export const gscPeriod = (g: NonNullable<SiteReport["searchConsole"]>) => {
  const days = g.days ?? 28, before = g.previousDays ?? 28;
  const read = gscReadNote(g);
  const notes = [days < GSC_MIN_DAYS ? `${days} of 28 days synced` : null, before < GSC_MIN_DAYS ? `not compared: ${before} of the 28 days before are synced` : null, read ? `${before < GSC_MIN_DAYS ? "" : "not compared: "}${read}` : null].filter(Boolean);
  return `${g.through ? `28 days to ${g.through}` : "last 28 days"}${notes.length ? ` (${notes.join("; ")})` : ""}`;
};
/** The sentence under the Search Console counts: what they rest on, and why no comparison is shown when none is. */
export const gscNote = (g: NonNullable<SiteReport["searchConsole"]>) => {
  if ((g.days ?? 28) < GSC_MIN_DAYS) return `Only ${g.days} of these 28 days have been synced from Search Console, so the counts are incomplete and are not compared with the period before.`;
  if (g.incomplete) return g.completenessUnknown
    ? "These are Google's own counts for the site, but whether every one of these days was fully read from Search Console could not be checked, so they are not compared with the 28 days before."
    : "These are Google's own counts for the site, but some of these days (or of the 28 before) are still being read from Search Console, or a read of them failed: the counts may be short, so they are not compared with the 28 days before.";
  if (gscComparable(g)) return "These are Google's own counts for the site. Changes in brackets compare with the 28 days before.";
  return "These are Google's own counts for the site. The 28 days before are not fully synced, so no comparison is shown.";
};
const day = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const signed = (v: number | null | undefined) => (v == null || v === 0 ? "" : ` (${v > 0 ? "+" : "−"}${n(Math.abs(v))})`);
const where = (m: { location: string | null }) => (m.location ? ` in ${m.location}` : "");
// A missing position is "not found": the site was not within the result pages the check read — not proof it ranks nowhere.
export const moverLine = (m: Mover) =>
  m.from === null ? `"${m.keyword}"${where(m)} now ranks at ${m.to}` : m.to === null ? `"${m.keyword}"${where(m)} is no longer found in the results (was ${m.from})` : `"${m.keyword}"${where(m)} moved from ${m.from} to ${m.to}`;

/** The headline facts, as label / value pairs — the email body and the top of the PDF. */
export function reportHighlights(r: SiteReport): [string, string][] {
  const rows: [string, string][] = [];
  if (r.rankings) {
    const k = r.rankings;
    // Changes only on keywords in both checks (said with their number); none in both = no change claimed.
    const on = k.compared ? ` on the ${k.compared} in both checks` : "";
    rows.push(["Keywords in the top 10", `${k.top10} of ${k.checked} checked${k.top10Change != null && k.compared ? `${signed(k.top10Change) || " (no change)"}${on}` : ""}`]);
    if (k.tracked > k.checked) rows.push(["Not covered by the latest check", `${k.tracked - k.checked} of ${k.tracked} tracked keywords`]);
    rows.push(["Keywords in the top 3", `${k.top3}${k.top3Change != null && k.compared ? `${signed(k.top3Change) || " (no change)"}${on}` : ""}`]);
    if (k.averagePosition !== null) rows.push(["Average position", `${k.averagePosition}${k.averageNow != null && k.averageBefore != null && k.rankedBoth ? ` (the ${k.rankedBoth} ranked both times: ${k.averageBefore} then, ${k.averageNow} now)` : ""}`]);
    if (r.comparedWith && k.compared === 0) rows.push(["Compared with the earlier check", "no keyword was in both checks, so no change is shown"]);
    if (k.withMapPack > 0) rows.push(["In the Google map pack", `${k.inMapPack} of ${k.withMapPack} searches that show a map`]);
  }
  if (r.searchConsole) {
    const g = r.searchConsole;
    const period = gscPeriod(g);
    rows.push([`Clicks from Google, ${period}`, `${n(g.clicks)}${gscChange(g, g.clicks, g.previousClicks)}`]);
    rows.push([`Times shown in Google, ${period}`, `${n(g.impressions)}${gscChange(g, g.impressions, g.previousImpressions)}`]);
  }
  if (r.search) {
    rows.push(["Estimated visits from Google / month", `${n(r.search.organicTraffic)}${signed(r.search.trafficChange)}`]);
    rows.push(["Keywords the site ranks for", `${n(r.search.organicKeywords)}${signed(r.search.keywordsChange)}`]);
    rows.push(["Websites linking to it", `${n(r.search.referringDomains)}${signed(r.search.referringDomainsChange)}`]);
    if (r.search.authority !== null) rows.push(["Authority (0–100)", String(r.search.authority)]);
  }
  for (const g of r.grids ?? []) rows.push([`Local grid — "${g.keyword}"`, gridLine(g)]);
  if (r.work?.unavailable) rows.push(["Work done", "the action plan could not be read just now"]);
  else if (r.work) rows.push([r.work.since ? `Work done since ${day(r.work.since)}` : `Work done, last ${r.work.days} days`, `${r.work.doneCount} task${r.work.doneCount === 1 ? "" : "s"} marked done · ${r.work.open} still open${r.work.overdueCount ? ` · ${r.work.overdueCount} past their due date` : ""}`]);
  if (r.audit && r.audit.health !== null) rows.push(["Site health (0–100)", `${r.audit.health}${signed(r.audit.healthChange)} · ${n(r.audit.errors)} errors, ${n(r.audit.warnings)} warnings`]);
  return rows;
}

/** One repeating grid in words: where it stands and, when there is a comparable scan before it, where it stood. */
export const gridLine = (g: GridReportLine) =>
  `scanned ${String(g.at).slice(0, 10)}: in the first 3 local results at ${g.top3} of ${g.checked} points${g.previous ? ` (was ${g.previous.top3} of ${g.previous.checked} on ${String(g.previous.at).slice(0, 10)})` : ""} · position score ${g.score ?? "—"}${g.previous && g.previous.score !== null ? ` (was ${g.previous.score})` : ""}`;
// A crawl that could not be read, or site health that could not be looked up, is news too: the report says so.
export const reportIsEmpty = (r: SiteReport) => !r.rankings && !r.search && !r.audit && r.auditUnreadable === undefined && !r.auditUnavailable && !r.searchConsole && !(r.grids ?? []).length && !r.work;

// ── PDF ────────────────────────────────────────────────────────────────────

/** Whether a PDF font has a glyph for a code point. */
type HasGlyph = (codePoint: number) => boolean;
/** Characters the built-in PDF font can draw beyond Latin-1 (its Windows-1252 extras). */
const WIN_ANSI_EXTRA = new Set(Array.from("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"));
/** What PDFKit's built-in Helvetica can draw: Windows-1252 and nothing else. */
const winAnsi: HasGlyph = (n) => (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || WIN_ANSI_EXTRA.has(String.fromCodePoint(n));

/** Text as the PDF font draws it: control characters and line breaks become spaces; a character the font has no glyph for
 *  becomes "?" and is counted as lost (an embedded font would draw it as nothing at all). Without a glyph lookup the
 *  built-in font's Windows-1252 is assumed. */
// The minus sign the app uses (U+2212) is written as a hyphen-minus when the font lacks it, never as "?".
function pdfChars(t: string, hasGlyph: HasGlyph = winAnsi): { text: string; lost: boolean } {
  let lost = false;
  const text = Array.from(String(t).normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")).map((c) => {
    const n = c.codePointAt(0)!;
    if (hasGlyph(n)) return c;
    if (n === 0x2212) return "-";
    lost = true;
    return "?";
  }).join("");
  return { text, lost };
}
/** Text the PDF font can draw (see pdfChars); `hasGlyph` is the embedded font's lookup, or absent for the built-in font. */
export const pdfSafe = (t: string, hasGlyph?: HasGlyph) => pdfChars(t, hasGlyph).text;
/** Whether the PDF would lose a character of the text (draw it as "?"). */
export const pdfLoses = (t: string, hasGlyph?: HasGlyph) => pdfChars(t, hasGlyph).lost;

/** The report's own font: DejaVu Sans (server/data/fonts, with its licence), which covers Latin, Greek, Cyrillic, Arabic and
 *  Hebrew where the built-in Helvetica stops at Windows-1252. CJK and the like still have no glyph and are drawn as "?". */
const FONT_FILES = { regular: "DejaVuSans.ttf", bold: "DejaVuSans-Bold.ttf" } as const;
/** dev: server/data/fonts, built: dist/data/fonts (script/build.ts copies server/data). */
export function reportFontDir(): string {
  const here = import.meta.dirname || __dirname;
  const candidates = [path.join(here, "data", "fonts"), path.join(here, "..", "data", "fonts")];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}
type FontFiles = { regular: Buffer; bold: Buffer };
const fontFiles = new Map<string, FontFiles | null>();
/** The font files, read once per directory. A directory whose fonts cannot be used stays unusable for the process. */
const readFontFiles = (dir: string): FontFiles | null => {
  if (!fontFiles.has(dir)) {
    try { fontFiles.set(dir, { regular: fs.readFileSync(path.join(dir, FONT_FILES.regular)), bold: fs.readFileSync(path.join(dir, FONT_FILES.bold)) }); }
    catch (e) { fontsUnusable(dir, e); }
  }
  return fontFiles.get(dir)!;
};
// Said once per directory: the report still goes out, in the built-in font, with "?" for what that font cannot show.
const fontsUnusable = (dir: string, e: unknown) => {
  fontFiles.set(dir, null);
  console.warn(`SEO report PDF: the DejaVu fonts in ${dir} cannot be used (${e instanceof Error ? e.message : String(e)}); using the built-in Helvetica, which cannot show characters beyond Windows-1252.`);
};

/** The fonts one report is set in, with the text rules they need. */
type ReportFonts = { regular: string; bold: string; safe: (t: string) => string; loses: (t: string) => boolean };
const BUILT_IN_FONTS: ReportFonts = { regular: "Helvetica", bold: "Helvetica-Bold", safe: (t) => pdfSafe(t), loses: (t) => pdfLoses(t) };
/** DejaVu registered with the document and opened, or the built-in fonts exactly as before when it cannot be. */
export function reportFonts(doc: PDFKit.PDFDocument, dir: string): ReportFonts {
  const files = readFontFiles(dir);
  if (!files) return BUILT_IN_FONTS;
  try {
    doc.registerFont("ReportSans", files.regular);
    doc.registerFont("ReportSans-Bold", files.bold);
    // PDFKit's view of an opened font (fontkit) knows which characters it has glyphs for. Both faces are asked: a character
    // set in bold must exist in bold, and the two differ in a few rare code points.
    type Opened = { _font?: { font?: { hasGlyphForCodePoint?: (n: number) => boolean } } };
    const lookups = (["ReportSans-Bold", "ReportSans"] as const).map((name) => {
      const font = (doc.font(name) as unknown as Opened)._font?.font;
      const has = font?.hasGlyphForCodePoint;
      if (typeof has !== "function") throw new Error(`PDFKit gave no glyph lookup for ${name}`);
      return (n: number) => has.call(font, n);
    });
    const hasGlyph: HasGlyph = (n) => lookups.every((has) => has(n));
    return { regular: "ReportSans", bold: "ReportSans-Bold", safe: (t) => pdfSafe(t, hasGlyph), loses: (t) => pdfLoses(t, hasGlyph) };
  } catch (e) {
    fontsUnusable(dir, e);
    return BUILT_IN_FONTS;
  }
}

/** The report as a PDF. `brand` is the account's white-label name and logo (Site Scan branding), when set; `fontDir` is where
 *  the report's font files are (tests point it elsewhere). */
export function renderReportPdf(r: SiteReport, brand?: { name?: string | null; logo?: string | null } | null, deps: { fontDir?: string } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "LETTER", info: { Title: `SEO report — ${r.domain}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const fonts = reportFonts(doc, deps.fontDir ?? reportFontDir());
    // Everything drawn below goes through the rule of the font this report is actually set in.
    const pdfSafe = fonts.safe;
    doc.info.Author = pdfSafe(brand?.name || "ConstructHUB");
    const width = doc.page.width - 96, ink = "#1a1a2e", soft = "#666666", rule = "#dddddd";
    const room = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };
    const heading = (t: string) => { room(60); doc.moveDown(1).fontSize(14).fillColor(ink).font(fonts.bold).text(pdfSafe(t)).moveDown(0.3); doc.moveTo(48, doc.y).lineTo(48 + width, doc.y).strokeColor(rule).stroke().moveDown(0.5); doc.font(fonts.regular).fontSize(10).fillColor(ink); };
    const pair = (label0: string, value0: string) => { const label = pdfSafe(label0), value = pdfSafe(value0); room(18); const y = doc.y; doc.fontSize(10).fillColor(soft).text(label, 48, y, { width: width * 0.55 }); doc.fillColor(ink).font(fonts.bold).text(value, 48 + width * 0.55, y, { width: width * 0.45, align: "right" }).font(fonts.regular); doc.x = 48; doc.moveDown(0.35); };
    const line = (t0: string, color = ink) => { const t = pdfSafe(t0); room(16); doc.fontSize(10).fillColor(color).text(t, 48, doc.y, { width }); doc.moveDown(0.2); };

    try { if (brand?.logo && /^data:image\/(png|jpe?g);base64,/.test(brand.logo)) { doc.image(Buffer.from(brand.logo.split(",")[1], "base64"), { fit: [150, 60] }); doc.moveDown(0.5); } } catch { /* an unreadable logo must not stop the report */ }
    doc.fontSize(22).fillColor(ink).font(fonts.bold).text(`SEO report`).font(fonts.regular).fontSize(13).fillColor(soft).text(pdfSafe(r.domain));
    doc.fontSize(10).text(`${day(r.generatedAt)}${r.comparedWith ? ` · rankings compared with ${day(r.comparedWith)}` : ""}${brand?.name ? ` · prepared by ${pdfSafe(brand.name)}` : ""}`);

    if (reportIsEmpty(r)) { doc.moveDown(2).fontSize(11).fillColor(ink).text("There is nothing to report yet. Add keywords to the rank tracker, analyse the site in Site Explorer, and run a site audit — the next report will have their numbers.", { width }); doc.end(); return; }

    heading("At a glance");
    for (const [label, value] of reportHighlights(r)) pair(label, value);

    if (r.rankings) {
      const k = r.rankings;
      heading(`Rankings on Google (${k.device}) — checked ${day(k.checkedOn)}`);
      if (k.improved.length) { line(k.improvedCount > k.improved.length ? `Moved up — the ${k.improved.length} biggest of ${k.improvedCount}` : "Moved up", "#188038"); for (const m of k.improved) line(`  • ${moverLine(m)}`); doc.moveDown(0.3); }
      if (k.declined.length) { line(k.declinedCount > k.declined.length ? `Moved down — the ${k.declined.length} biggest of ${k.declinedCount}` : "Moved down", "#c5221f"); for (const m of k.declined) line(`  • ${moverLine(m)}`); doc.moveDown(0.3); }
      if (!k.improved.length && !k.declined.length) line(!r.comparedWith ? "This is the first check, so there is nothing to compare with yet." : k.compared === 0 ? "No keyword was in both checks, so nothing is compared." : "No keyword changed position since the earlier check.", soft);
      room(40); doc.moveDown(0.4).font(fonts.bold).fontSize(9).fillColor(soft);
      // The built-in PDF font has no arrow glyphs, and a header must fit its column: both were wrong on the first render.
      const cols = [0, width * 0.5, width * 0.63, width * 0.74, width * 0.87];
      const row = (cells: string[], bold = false) => { room(16); const y = doc.y; doc.font(bold ? fonts.bold : fonts.regular).fontSize(9).fillColor(bold ? soft : ink); cells.forEach((c, i) => doc.text(pdfSafe(c), 48 + cols[i], y, { width: (cols[i + 1] ?? width) - cols[i] - 6, height: 11, lineBreak: false, ellipsis: true })); doc.x = 48; doc.y = y + 14; };
      row(["Keyword", "Position", "Was", "Map pack", "Volume"], true);
      for (const kw of k.keywords) row([`${kw.keyword}${kw.location ? ` · ${kw.location}` : ""}`, kw.position === null ? "not found" : String(kw.position), kw.previous === null ? "—" : String(kw.previous), kw.local === null ? "—" : `#${kw.local}`, n(kw.volume)]);
      if (k.checked > k.keywords.length) line(`…and ${k.checked - k.keywords.length} more checked keywords.`, soft);
      if (k.byTag?.length) {
        room(60); doc.moveDown(0.5).font(fonts.bold).fontSize(11).fillColor(ink).text("By tag"); doc.moveDown(0.2);
        // Short cells that fit their column (no cell is cut short); the header comes again after a page break; the
        // weighting of each figure is said in lines under the table.
        const tcols = [0, width * 0.36, width * 0.5, width * 0.66, width * 0.82];
        const head = ["Tag", "Keywords", "In both / new", "In the top 10", "Visibility index"];
        const tline = (cells: string[], bold = false) => { if (doc.y + 16 > doc.page.height - 60) doc.addPage(); const y = doc.y; doc.font(bold ? fonts.bold : fonts.regular).fontSize(9).fillColor(bold ? soft : ink); cells.forEach((c, i) => doc.text(pdfSafe(c), 48 + tcols[i], y, { width: (tcols[i + 1] ?? width) - tcols[i] - 6, height: 11, lineBreak: false, ellipsis: true })); doc.x = 48; doc.y = y + 14; };
        const trow = (cells: string[]) => { if (doc.y + 16 > doc.page.height - 60) { doc.addPage(); tline(head, true); } tline(cells); };
        // A change that was measured is shown even when it is zero ("±0" is written "0"); none measured is "(—)" written "(-)".
        const chg = (v: number | null) => (v === null ? " (-)" : v === 0 ? " (0)" : ` (${v > 0 ? "+" : "-"}${Math.abs(v)})`);
        room(32); tline(head, true);
        // Every row is numbered and carries its own weighting marker; a tag name cut to fit is given in full under the table.
        const cut: string[] = [];
        k.byTag.forEach((t, idx) => {
          const label = `${idx + 1}. ${t.tag}`;
          doc.font(fonts.regular).fontSize(9);
          // A name with characters the PDF font really cannot show is flagged too (the report page shows it as written).
          if (fonts.loses(t.tag)) cut.push(`${idx + 1}. ${t.tag} (has characters this PDF cannot show - see the report page)`);
          else if (doc.widthOfString(pdfSafe(label)) > tcols[1] - 6) cut.push(`${idx + 1}. ${t.tag}`);
          const mark = t.visibility === null ? "" : ` ${t.weighted ? "v" : "o"}${r.comparedWith && t.changeWeighted != null && t.changeWeighted !== t.weighted ? (t.changeWeighted ? "/v" : "/o") : ""}`;
          trow([label, n(t.keywords), r.comparedWith ? `${n(t.compared)} / ${n(t.newSince)}` : "-", `${n(t.top10)}${r.comparedWith ? chg(t.top10Change) : ""}`,
            t.visibility === null ? "-" : `${t.visibility}${r.comparedWith ? chg(t.visibilityChange) : ""}${mark}`]);
        });
        line("Visibility index weighting: v = by search volume, o = each keyword counted once (some keywords have no volume); a second letter after \"/\" is the change's own weighting when it differs.", soft);
        if (cut.length) line(`Tag names cut to fit or not fully shown, in full: ${cut.join("; ")}.`, soft);
        if (k.moreTags) line(`…and ${k.moreTags} more tags.`, soft);
        line(`${r.comparedWith ? "Changes in brackets count only the keywords in both checks (\"In both\"); (-) means none was in both, (0) a measured no change. A keyword can carry several tags. " : ""}The visibility index is not a share of real clicks: 100 would mean every keyword first.`, soft);
      }
    }
    if (r.searchConsole) {
      const g = r.searchConsole;
      heading(`Clicks from Google — Search Console, ${gscPeriod(g)}`);
      pair("Clicks", `${n(g.clicks)}${gscChange(g, g.clicks, g.previousClicks)}`);
      pair("Times shown in results", `${n(g.impressions)}${gscChange(g, g.impressions, g.previousImpressions)}`);
      if (g.position !== null) pair("Average position", String(g.position));
      line(gscNote(g), soft);
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
    if (r.auditUnavailable) {
      heading("Site health");
      line("Site health could not be looked up when this report was made, so it is left out of this report (it is not \"no crawl\").", soft);
    }
    if (r.auditUnreadable !== undefined && !r.audit) {
      heading("Site health");
      line(`The newest crawl${r.auditUnreadable ? ` (${day(r.auditUnreadable)})` : ""} could not be read, so no health score is reported. A new crawl will put it right.`, soft);
    }
    if (r.audit) {
      heading(`Site health — crawled ${day(r.audit.scannedAt)}`);
      pair("Health score (pages with no errors)", r.audit.health === null ? "—" : `${r.audit.health} / 100${signed(r.audit.healthChange)}`);
      pair("Pages crawled", n(r.audit.crawled));
      pair("Errors / warnings / notices", `${n(r.audit.errors)} / ${n(r.audit.warnings)} / ${n(r.audit.notices)}`);
      if (r.audit.topIssues.length) { doc.moveDown(0.3); line("What to fix first", soft); for (const i of r.audit.topIssues) line(`  • ${i.title} — ${n(i.count)} affected (${i.severity})`); }
    }
    if ((r.grids ?? []).length) {
      heading("Local grid — Google's local results across your area");
      for (const g of r.grids!) pair(`"${g.keyword}" · ${g.size} × ${g.size} points, ${g.spacing} mi apart · ${day(g.at)}`, gridLine(g));
      line("Each point is one lookup of Google's local results made for that spot at the time of the scan. The position score counts a point where the business is not in the first 20 as 21; lower is better.", soft);
    }
    if (r.work?.unavailable) { heading("Work done"); line("The action plan could not be read just now, so this report says nothing about the work done.", soft); }
    else if (r.work) {
      heading(r.work.since ? `Work done — since ${day(r.work.since)}` : `Work done — the last ${r.work.days} days`);
      if (!r.work.done.length) line("No task in the action plan was marked done in this period.", soft);
      for (const t of r.work.done) line(`  • ${day(t.doneAt)} — ${t.title}${t.note ? ` (${t.note})` : ""}`);
      if (r.work.doneCount > r.work.done.length) line(`…and ${r.work.doneCount - r.work.done.length} more.`, soft);
      if (r.work.overdue?.length) {
        doc.moveDown(0.3); line(`Past their due date (due before ${day(r.work.today)}, UTC)`, "#c5221f");
        for (const t of r.work.overdue) line(`  • due ${day(t.dueOn)} — ${t.title}${t.owner ? ` · ${t.owner}` : ""}`);
        if ((r.work.overdueCount ?? 0) > r.work.overdue.length) line(`…and ${(r.work.overdueCount ?? 0) - r.work.overdue.length} more.`, soft);
      }
      line(`${r.work.open} task${r.work.open === 1 ? " is" : "s are"} still open${r.work.inProgress ? `, ${r.work.inProgress} of them in progress` : ""}${r.work.dueSoon ? `; ${r.work.dueSoon} due today or in the next 7 days` : ""}. "Done" is what was marked in the action plan; whether a site issue is gone shows in the next crawl.`, soft);
    }
    if (r.alerts.length) { heading("Alerts in the last month"); for (const a of r.alerts) line(`${day(a.createdAt)} — ${a.title}`); }
    doc.moveDown(1.5).fontSize(8).fillColor(soft).text("Positions are Google's organic results for the place each keyword is tracked from, as read by each dated check; \"not found\" means the site was not within the result pages the check read. The map pack is the block of local businesses Google shows above them.", 48, doc.y, { width });
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

export const UNCERTAIN_DAYS = 60, UNCERTAIN_LIST = 20;
/** A delivery period in words: "the October 2026 report", "the weekly report of the week from Oct 5", "a report sent by hand". */
export function periodWords(period: string): string {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (m) return `the ${new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })} report`;
  const w = period.match(/^w(\d+)$/);
  if (w) return `the weekly report of the week from ${new Date(Number(w[1]) * 7 * 864e5).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  return "a report sent by hand";
}
export async function getSchedule(userId: number, siteId: number) {
  const { rows: [s] } = await pool.query(`SELECT frequency, recipients, next_send_at AS "nextSendAt", last_sent_at AS "lastSentAt" FROM seo_report_schedules WHERE site_id=$1 AND user_id=$2`, [siteId, userId]);
  // Sends of the last 60 days that may have gone without our knowing: not sent again, and said — with the report they
  // belong to. null = they could not be read just now (never shown as "none").
  const r = await pool.query(
    `SELECT recipient, period, updated_at AS at, count(*) OVER ()::int AS total FROM seo_report_deliveries WHERE site_id=$1 AND state='uncertain' AND updated_at > now() - interval '${UNCERTAIN_DAYS} days'
       AND EXISTS (SELECT 1 FROM seo_sites WHERE id=$1 AND user_id=$2) ORDER BY updated_at DESC LIMIT ${UNCERTAIN_LIST}`, [siteId, userId]).catch(() => null);
  return { ...(s ?? { frequency: "off", recipients: [], nextSendAt: null, lastSentAt: null }),
    uncertain: r ? r.rows.map((u: any) => ({ recipient: u.recipient as string, period: periodWords(u.period), at: new Date(u.at).toISOString() })) : null,
    uncertainMore: r?.rows.length ? Math.max(0, r.rows[0].total - r.rows.length) : 0, uncertainDays: UNCERTAIN_DAYS };
}
export async function saveSchedule(userId: number, siteId: number, input: z.infer<typeof scheduleInput>) {
  const recipients = [...new Set(input.recipients)];
  await pool.query(
    `INSERT INTO seo_report_schedules(site_id, user_id, frequency, recipients, next_send_at) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (site_id) DO UPDATE SET frequency=EXCLUDED.frequency, recipients=EXCLUDED.recipients, next_send_at=EXCLUDED.next_send_at, updated_at=now()`,
    [siteId, userId, input.frequency, recipients, nextSendAt(input.frequency)]);
  return getSchedule(userId, siteId);
}
