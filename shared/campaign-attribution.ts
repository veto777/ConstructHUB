/**
 * Campaign attribution for the first-party analytics (server/analytics.ts).
 *
 * Query strings are stripped from every recorded path because they can carry
 * tokens and email addresses. The ONLY parameters that survive are the three
 * campaign tags below, and only after sanitizing: lower-cased, trimmed,
 * `[a-z0-9._-]` only (every other character is dropped), at most 64 chars.
 * Nothing else from a query string is ever read, sent or stored.
 *
 * Pure — shared by the browser beacon, the server, the admin page and
 * scripts/campaign-report.ts.
 */

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
export const UTM_MAX_LEN = 64;

export type Utm = { source: string | null; medium: string | null; campaign: string | null };

/** One campaign tag value, or null when nothing usable is left. */
export function sanitizeUtmValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, UTM_MAX_LEN);
  return cleaned || null;
}

/** The three campaign tags of an input object — every other key is ignored. */
export function sanitizeUtm(input: unknown): Utm {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    source: sanitizeUtmValue(o.source),
    medium: sanitizeUtmValue(o.medium),
    campaign: sanitizeUtmValue(o.campaign),
  };
}

/** Read the three campaign tags out of a query string ("?a=b&…"), or null when it carries none. */
export function utmFromSearch(search: string): Utm | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return null;
  }
  const utm = sanitizeUtm({
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
  });
  return hasUtm(utm) ? utm : null;
}

export function hasUtm(utm: Utm | null | undefined): utm is Utm {
  return !!utm && !!(utm.source || utm.medium || utm.campaign);
}

/** The host of a referrer URL — never its path or query. "www."/"m." are folded away. */
export function referrerHost(referrer: unknown): string | null {
  if (typeof referrer !== "string" || !referrer.trim()) return null;
  let host: string;
  try {
    host = new URL(referrer.trim()).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/^(www|m|mobile)\./, "");
  if (!/^[a-z0-9.-]{1,100}$/.test(host) || !host.includes(".")) return null;
  return host;
}

/** example.co.uk is not handled — the site's own hosts are all two-label (constructhub.us / .app). */
const baseOf = (host: string) => host.split(".").slice(-2).join(".");

/** A referrer on the site's own domain (constructhub.us ↔ portal.constructhub.us) is a navigation, not a source. */
export function isInternalHost(host: string | null, siteHost: string | null | undefined): boolean {
  if (!host || !siteHost) return false;
  const site = siteHost.toLowerCase().replace(/:\d+$/, "").replace(/^(www|m|mobile)\./, "");
  if (host === site) return true;
  return site.includes(".") && !/^[\d.]+$/.test(site) && baseOf(host) === baseOf(site);
}

/** The referrer groups the admin page names; any other host is listed as itself.
 *  Android apps report themselves as android-app://<package>/, so the package names are listed too. */
const REFERRER_GROUPS: { label: string; test: (h: string) => boolean }[] = [
  { label: "Instagram", test: (h) => h === "instagram.com" || h.endsWith(".instagram.com") || h.startsWith("com.instagram.") },
  { label: "TikTok", test: (h) => h === "tiktok.com" || h.endsWith(".tiktok.com") || h === "com.zhiliaoapp.musically" || h.startsWith("com.ss.android.ugc.") },
  { label: "LinkedIn", test: (h) => h === "linkedin.com" || h.endsWith(".linkedin.com") || h === "lnkd.in" || h.startsWith("com.linkedin.") },
  { label: "YouTube", test: (h) => h === "youtube.com" || h.endsWith(".youtube.com") || h === "youtu.be" || h === "com.google.android.youtube" },
  { label: "Facebook", test: (h) => h === "facebook.com" || h.endsWith(".facebook.com") || h === "fb.me" || h === "fb.com" || h.startsWith("com.facebook.") },
  { label: "Google", test: (h) => /(^|\.)google\.[a-z.]{2,6}$/.test(h) || h.startsWith("com.google.android.") },
];

export const DIRECT_LABEL = "Direct (no referrer)";

export function referrerGroup(host: string | null): string {
  if (!host) return DIRECT_LABEL;
  return REFERRER_GROUPS.find((g) => g.test(host))?.label ?? host;
}

// ── The report (what /api/admin/analytics?view=campaigns and the CLI return) ──────────────────

export type CampaignRow = {
  source: string | null; medium: string | null; campaign: string | null;
  visits: number; visitors: number; signups: number;
};
export type ReferrerRow = { label: string; hosts: string[]; visits: number; visitors: number; signups: number };
export type DailyRow = { day: string; source: string; visits: number; visitors: number; signups: number };
export type CampaignReport = {
  since: string; until: string;
  /** When campaign tags started being recorded on this database (ISO), or null. */
  attributionStartedAt: string | null;
  totals: { visits: number; visitors: number; signups: number; attributedSignups: number };
  campaigns: CampaignRow[];
  referrers: ReferrerRow[];
  daily: DailyRow[];
};

const byVisits = <T extends { visits: number; signups: number }>(a: T, b: T) =>
  b.visits - a.visits || b.signups - a.signups;

/** Merge per-host rows into the named groups, most visits first. Visitors are summed per host. */
export function groupReferrers(rows: { host: string | null; visits: number; visitors: number; signups: number }[]): ReferrerRow[] {
  const out = new Map<string, ReferrerRow>();
  for (const r of rows) {
    const label = referrerGroup(r.host);
    const g = out.get(label) ?? { label, hosts: [], visits: 0, visitors: 0, signups: 0 };
    if (r.host && !g.hosts.includes(r.host)) g.hosts.push(r.host);
    g.visits += r.visits; g.visitors += r.visitors; g.signups += r.signups;
    out.set(label, g);
  }
  return Array.from(out.values()).sort(byVisits);
}

export function sortCampaigns(rows: CampaignRow[]): CampaignRow[] {
  return [...rows].sort(byVisits);
}

/** Same guard the site's other exports use: a cell starting = + - @ is text, not a formula. */
export const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export const CAMPAIGN_CSV_HEADER = ["Section", "Source", "Medium", "Campaign", "Referrer hosts", "Day", "Visits", "Visitors", "Sign-ups"] as const;

export function campaignReportCsv(report: CampaignReport): string {
  const lines: (string | number | null)[][] = [[...CAMPAIGN_CSV_HEADER]];
  for (const c of report.campaigns) lines.push(["Campaign", c.source, c.medium, c.campaign, "", "", c.visits, c.visitors, c.signups]);
  for (const r of report.referrers) lines.push(["Referrer", r.label, "", "", r.hosts.join(" "), "", r.visits, r.visitors, r.signups]);
  for (const d of report.daily) lines.push(["Daily", d.source, "", "", "", d.day, d.visits, d.visitors, d.signups]);
  return lines.map((l) => l.map(csvCell).join(",")).join("\n");
}

/** Plain-text table for the operator CLI. */
export function campaignReportText(report: CampaignReport): string {
  const table = (head: string[], rows: (string | number)[][]) => {
    const all = [head, ...rows.map((r) => r.map(String))];
    const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
    const fmt = (r: string[]) => r.map((c, i) => (i < head.length - 3 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ").trimEnd();
    return [fmt(head), w.map((n) => "-".repeat(n)).join("  "), ...all.slice(1).map(fmt)].join("\n");
  };
  const dash = (v: string | null) => v ?? "-";
  const out: string[] = [];
  out.push(`Campaign report ${report.since} to ${report.until} (US Eastern days)`);
  out.push(report.attributionStartedAt
    ? `Attribution recorded from ${report.attributionStartedAt.slice(0, 10)} - earlier visits carry no campaign.`
    : "Attribution has not started on this database (schema not applied yet).");
  out.push("Only visitors who accepted the cookie banner are counted.");
  out.push(`Landings ${report.totals.visits} | visitors ${report.totals.visitors} | sign-ups ${report.totals.signups} (${report.totals.attributedSignups} attributed)`);
  out.push("", "CAMPAIGNS");
  out.push(report.campaigns.length
    ? table(["Source", "Medium", "Campaign", "Visits", "Visitors", "Sign-ups"],
        report.campaigns.map((c) => [dash(c.source), dash(c.medium), dash(c.campaign), c.visits, c.visitors, c.signups]))
    : "(no tagged visits in this range)");
  out.push("", "REFERRERS");
  out.push(report.referrers.length
    ? table(["Referrer", "Hosts", "Visits", "Visitors", "Sign-ups"],
        report.referrers.map((r) => [r.label, r.hosts.join(" ") || "-", r.visits, r.visitors, r.signups]))
    : "(no landings in this range)");
  if (report.daily.length) {
    out.push("", "DAILY BY SOURCE");
    out.push(table(["Day", "Source", "Visits", "Visitors", "Sign-ups"],
      report.daily.map((d) => [d.day, d.source, d.visits, d.visitors, d.signups])));
  }
  return out.join("\n");
}

/** YYYY-MM-DD or null — the only date shape the report accepts. */
export function parseReportDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
