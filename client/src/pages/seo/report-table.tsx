/**
 * One Site Explorer / Keywords Explorer report: filters, sort, paging, CSV
 * export and (for keyword rows) "track these". Each page is one lookup on the
 * account's SEO data credit; a page already run in the last day opens free
 * (the server keeps it), so the screen first asks for the saved page ("peek")
 * and only spends when the person presses Run.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { holdNote, isNotRunYet } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, kd, money, type SeoStatus } from "./shell";

export type TableKey =
  | "keywords" | "paidKeywords" | "pages" | "competitors" | "backlinks" | "newBacklinks" | "lostBacklinks" | "brokenBacklinks"
  | "referringDomains" | "anchors" | "bestByLinks" | "referringIps" | "linkCompetitors" | "subdomains" | "ads" | "matchingTerms" | "relatedTerms" | "questions";
type Filters = {
  positionMin?: number; positionMax?: number; volumeMin?: number; volumeMax?: number; difficultyMin?: number; difficultyMax?: number;
  intent?: string; contains?: string; follow?: "followed" | "nofollow"; everyLink?: boolean;
};
type Page = { table: TableKey; target: string; capped?: boolean; rows: any[]; sourceRows?: number; total: number | null; limit: number; offset: number; sort: string; fetchedAt: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const strip = (u: string | null | undefined) => (u ?? "").replace(/^https?:\/\/(www\.)?/, "");
const usd2 = (n: number | null | undefined) => n == null ? "—" : `$${n.toFixed(2)}`;
const usd0 = (n: number | null | undefined) => n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const Ext = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} className="g-link" target="_blank" rel="noreferrer">{children}</a>;

type Col = { key: string; label: string; num?: boolean; cell: (r: any, ctx: { target: string; onExplore?: (d: string) => void }) => ReactNode; csv: (r: any) => string | number | null };
const kwCols: Col[] = [
  { key: "keyword", label: "Keyword", cell: (r) => r.keyword, csv: (r) => r.keyword },
  { key: "position", label: "Position", num: true, cell: (r) => r.position ?? "—", csv: (r) => r.position },
  { key: "volume", label: "Volume", num: true, cell: (r) => fmtNum(r.volume), csv: (r) => r.volume },
  { key: "traffic", label: "Traffic", num: true, cell: (r) => fmtNum(r.traffic), csv: (r) => r.traffic },
  { key: "difficulty", label: "Difficulty", num: true, cell: (r) => kd(r.difficulty), csv: (r) => r.difficulty },
  { key: "cpc", label: "CPC", num: true, cell: (r) => usd2(r.cpc), csv: (r) => r.cpc },
  { key: "intent", label: "Intent", cell: (r) => (r.intent ? cap(r.intent) : "—"), csv: (r) => r.intent },
  { key: "url", label: "Page", cell: (r, c) => (r.url ? <Ext href={r.url}>{strip(r.url).replace(c.target, "") || "/"}</Ext> : "—"), csv: (r) => r.url },
];
const ideaCols: Col[] = [
  { key: "keyword", label: "Keyword", cell: (r) => r.keyword, csv: (r) => r.keyword },
  { key: "volume", label: "Volume", num: true, cell: (r) => fmtNum(r.volume), csv: (r) => r.volume },
  { key: "difficulty", label: "Difficulty", num: true, cell: (r) => kd(r.difficulty), csv: (r) => r.difficulty },
  { key: "cpc", label: "CPC", num: true, cell: (r) => usd2(r.cpc), csv: (r) => r.cpc },
  { key: "intent", label: "Intent", cell: (r) => (r.intent ? cap(r.intent) : "—"), csv: (r) => r.intent },
  { key: "competition", label: "Ad competition", cell: (r) => (r.competition ? cap(String(r.competition).toLowerCase()) : "—"), csv: (r) => r.competition },
];
const linkCols: Col[] = [
  { key: "url", label: "Linking page", cell: (r) => <span className="block max-w-[340px]"><Ext href={r.url}>{r.title || r.domain}</Ext><span className="g-text-2 block truncate text-[12px]">{strip(r.url)}</span></span>, csv: (r) => r.url },
  { key: "authority", label: "Authority", num: true, cell: (r) => r.authority ?? "—", csv: (r) => r.authority },
  { key: "anchor", label: "Anchor", cell: (r) => <span className="block max-w-[200px] truncate">{r.anchor || <span className="g-text-2">(none)</span>}</span>, csv: (r) => r.anchor },
  { key: "target", label: "Links to", cell: (r) => <span className="g-text-2 block max-w-[200px] truncate">{strip(r.target) || "—"}</span>, csv: (r) => r.target },
  { key: "followed", label: "Follow", cell: (r) => (r.followed ? "followed" : "nofollow"), csv: (r) => (r.followed ? "followed" : "nofollow") },
  { key: "spamScore", label: "Spam", num: true, cell: (r) => r.spamScore ?? "—", csv: (r) => r.spamScore },
  { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  { key: "lastSeen", label: "Last seen", num: true, cell: (r) => fmtDate(r.lastSeen), csv: (r) => r.lastSeen },
];
const COLS: Record<TableKey, Col[]> = {
  keywords: kwCols, paidKeywords: kwCols.filter((c) => c.key !== "difficulty"),
  pages: [
    { key: "url", label: "Page", cell: (r) => <span className="block max-w-[440px] truncate"><Ext href={r.url}>{strip(r.url)}</Ext></span>, csv: (r) => r.url },
    { key: "traffic", label: "Traffic", num: true, cell: (r) => fmtNum(r.traffic), csv: (r) => r.traffic },
    { key: "keywords", label: "Keywords", num: true, cell: (r) => fmtNum(r.keywords), csv: (r) => r.keywords },
    { key: "top10", label: "In top 10", num: true, cell: (r) => fmtNum(r.top10), csv: (r) => r.top10 },
    { key: "trafficValue", label: "Traffic value", num: true, cell: (r) => usd0(r.trafficValue), csv: (r) => r.trafficValue },
  ],
  competitors: [
    { key: "domain", label: "Competitor", cell: (r) => r.domain, csv: (r) => r.domain },
    { key: "commonKeywords", label: "Shared keywords", num: true, cell: (r) => fmtNum(r.commonKeywords), csv: (r) => r.commonKeywords },
    { key: "keywords", label: "Their keywords", num: true, cell: (r) => fmtNum(r.keywords), csv: (r) => r.keywords },
    { key: "traffic", label: "Their traffic", num: true, cell: (r) => fmtNum(r.traffic), csv: (r) => r.traffic },
    { key: "avgPosition", label: "Avg. position", num: true, cell: (r) => r.avgPosition ?? "—", csv: (r) => r.avgPosition },
    { key: "explore", label: "", num: true, cell: (r, c) => (c.onExplore ? <button type="button" className="g-link" aria-label={`Explore ${r.domain}`} onClick={() => c.onExplore!(r.domain)}>Explore</button> : null), csv: () => null },
  ],
  backlinks: linkCols.filter((c) => c.key !== "lastSeen"), newBacklinks: linkCols.filter((c) => c.key !== "lastSeen"),
  lostBacklinks: linkCols.filter((c) => c.key !== "spamScore"), brokenBacklinks: linkCols.filter((c) => c.key !== "lastSeen"),
  referringDomains: [
    { key: "domain", label: "Domain", cell: (r) => <Ext href={`https://${r.domain}`}>{r.domain}</Ext>, csv: (r) => r.domain },
    { key: "authority", label: "Authority", num: true, cell: (r) => r.authority ?? "—", csv: (r) => r.authority },
    { key: "backlinks", label: "Links to this site", num: true, cell: (r) => fmtNum(r.backlinks), csv: (r) => r.backlinks },
    { key: "spamScore", label: "Spam", num: true, cell: (r) => r.spamScore ?? "—", csv: (r) => r.spamScore },
    { key: "followed", label: "Follow", cell: (r) => (r.followed ? "followed" : "nofollow"), csv: (r) => (r.followed ? "followed" : "nofollow") },
    { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  ],
  anchors: [
    { key: "anchor", label: "Anchor text", cell: (r) => <span className="block max-w-[440px] truncate">{r.anchor || <span className="g-text-2">(no text — image or empty link)</span>}</span>, csv: (r) => r.anchor },
    { key: "backlinks", label: "Backlinks", num: true, cell: (r) => fmtNum(r.backlinks), csv: (r) => r.backlinks },
    { key: "referringDomains", label: "Referring domains", num: true, cell: (r) => fmtNum(r.referringDomains), csv: (r) => r.referringDomains },
    { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  ],
  bestByLinks: [
    { key: "url", label: "Page", cell: (r) => <span className="block max-w-[440px] truncate"><Ext href={r.url}>{strip(r.url)}</Ext></span>, csv: (r) => r.url },
    { key: "referringDomains", label: "Referring domains", num: true, cell: (r) => fmtNum(r.referringDomains), csv: (r) => r.referringDomains },
    { key: "backlinks", label: "Backlinks", num: true, cell: (r) => fmtNum(r.backlinks), csv: (r) => r.backlinks },
    { key: "authority", label: "Page authority", num: true, cell: (r) => r.authority ?? "—", csv: (r) => r.authority },
    { key: "brokenBacklinks", label: "Broken", num: true, cell: (r) => fmtNum(r.brokenBacklinks), csv: (r) => r.brokenBacklinks },
    { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  ],
  referringIps: [
    { key: "ip", label: "IP address", cell: (r) => r.ip, csv: (r) => r.ip },
    { key: "referringDomains", label: "Linking sites on it", num: true, cell: (r) => fmtNum(r.referringDomains), csv: (r) => r.referringDomains },
    { key: "backlinks", label: "Links", num: true, cell: (r) => fmtNum(r.backlinks), csv: (r) => r.backlinks },
    { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  ],
  linkCompetitors: [
    { key: "domain", label: "Site", cell: (r) => <Ext href={`https://${r.domain}`}>{r.domain}</Ext>, csv: (r) => r.domain },
    { key: "shared", label: "Linking sites in common", num: true, cell: (r) => fmtNum(r.shared), csv: (r) => r.shared },
    { key: "explore", label: "", num: true, cell: (r, c) => (c.onExplore ? <button type="button" className="g-link" aria-label={`Explore ${r.domain}`} onClick={() => c.onExplore!(r.domain)}>Explore</button> : null), csv: () => null },
  ],
  subdomains: [
    { key: "subdomain", label: "Subdomain", cell: (r) => <Ext href={`https://${r.subdomain}`}>{r.subdomain}</Ext>, csv: (r) => r.subdomain },
    { key: "traffic", label: "Traffic", num: true, cell: (r) => fmtNum(r.traffic), csv: (r) => r.traffic },
    { key: "keywords", label: "Keywords", num: true, cell: (r) => fmtNum(r.keywords), csv: (r) => r.keywords },
    { key: "top3", label: "In top 3", num: true, cell: (r) => fmtNum(r.top3), csv: (r) => r.top3 },
    { key: "top10", label: "In top 10", num: true, cell: (r) => fmtNum(r.top10), csv: (r) => r.top10 },
    { key: "trafficValue", label: "Traffic value", num: true, cell: (r) => usd0(r.trafficValue), csv: (r) => r.trafficValue },
  ],
  ads: [
    { key: "advertiser", label: "Advertiser", cell: (r) => <>{r.advertiser}{r.verified && <span className="g-text-2 text-[12px]"> · verified by Google</span>}</>, csv: (r) => r.advertiser },
    { key: "format", label: "Kind", cell: (r) => (r.format ? cap(r.format) : "—"), csv: (r) => r.format },
    { key: "firstShown", label: "First shown", num: true, cell: (r) => fmtDate(r.firstShown), csv: (r) => r.firstShown },
    { key: "lastShown", label: "Last shown", num: true, cell: (r) => fmtDate(r.lastShown), csv: (r) => r.lastShown },
    { key: "url", label: "Ad", num: true, cell: (r) => (r.url ? <a href={r.url} className="g-link" target="_blank" rel="noreferrer" aria-label={`See the ad from ${r.advertiser}, last shown ${fmtDate(r.lastShown)}`}>See the ad</a> : null), csv: (r) => r.url },
  ],
  matchingTerms: ideaCols, relatedTerms: ideaCols, questions: ideaCols,
};
/** A line under the title of the reports that need a word of explanation. */
/** What an empty result means for a report with nothing to loosen. */
const EMPTY_NOTE: Partial<Record<TableKey, string>> = {
  ads: "Google's ad library has no ads for this site in this country.",
  subdomains: "No part of this site with its own name ranks in search.",
  referringIps: "No linking sites were found for this site.",
  linkCompetitors: "No other sites share enough linking sites with this one.",
};
export const REPORT_NOTE: Partial<Record<TableKey, string>> = {
  referringIps: "The server addresses the linking sites sit on. It shows where links are concentrated, not who owns the sites: one address is often shared by many unrelated sites (shared hosting, or a network such as Cloudflare).",
  linkCompetitors: "Sites that many of the same websites link to. They draw on the same sources of links as this site — whether or not they sell the same thing.",
  subdomains: "The parts of this site with their own name (blog.example.com), with the search traffic each brings.",
  ads: "The Google Ads this site has run, from Google's public ad library. \"See the ad\" opens Google's own page for it.",
};

const SORT_LABELS: Record<TableKey, [string, string][]> = {
  keywords: [["traffic", "Most traffic"], ["volume", "Highest volume"], ["position", "Best position"], ["difficulty", "Easiest"], ["cpc", "Highest CPC"]],
  paidKeywords: [["traffic", "Most traffic"], ["volume", "Highest volume"], ["cpc", "Highest CPC"]],
  pages: [["traffic", "Most traffic"], ["keywords", "Most keywords"]],
  competitors: [["shared", "Most shared keywords"]],
  backlinks: [["authority", "Strongest sites"], ["newest", "Newest"], ["oldest", "Oldest"]],
  newBacklinks: [["newest", "Newest"], ["authority", "Strongest sites"]],
  lostBacklinks: [["newest", "Most recently lost"], ["authority", "Strongest sites"]],
  brokenBacklinks: [["authority", "Strongest sites"], ["newest", "Newest"]],
  referringDomains: [["authority", "Strongest sites"], ["links", "Most links"], ["newest", "Newest"]],
  anchors: [["links", "Most backlinks"], ["domains", "Most domains"]],
  bestByLinks: [["links", "Most backlinks"], ["domains", "Most domains"]],
  referringIps: [["domains", "Most linking sites"], ["links", "Most links"]],
  linkCompetitors: [["shared", "Most shared linking sites"]],
  subdomains: [["traffic", "Most traffic"], ["keywords", "Most keywords"]],
  ads: [["newest", "Most recently shown"]],
  matchingTerms: [["volume", "Highest volume"], ["difficulty", "Easiest"], ["cpc", "Highest CPC"]],
  relatedTerms: [["volume", "Highest volume"], ["difficulty", "Easiest"]],
  questions: [["volume", "Highest volume"], ["difficulty", "Easiest"]],
};
const HAS: Record<string, TableKey[]> = {
  position: ["keywords"],
  volume: ["keywords", "paidKeywords", "matchingTerms", "relatedTerms", "questions"],
  difficulty: ["keywords", "matchingTerms", "relatedTerms", "questions"],
  intent: ["keywords", "matchingTerms", "questions"],
  contains: ["keywords", "paidKeywords", "pages", "competitors", "backlinks", "newBacklinks", "lostBacklinks", "referringDomains", "anchors", "bestByLinks", "matchingTerms", "questions"],
  follow: ["backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks"],
  everyLink: ["backlinks", "newBacklinks", "lostBacklinks"],
};
/** Reports that can be narrowed to one section or one page of the site (server/seo/reports.ts SCOPED_TABLES). */
const SCOPED: ReadonlySet<TableKey> = new Set<TableKey>(["keywords", "paidKeywords", "pages", "backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks", "bestByLinks"]);
/**
 * What was typed, as a path on the site. A pasted address must be on this site (with or without "www") — one from
 * another site is refused, not quietly applied here; its #fragment is dropped (a place on a page, not a page);
 * "blog" becomes "/blog". Pure.
 */
export function scopePathOf(raw: string, domain: string): { path: string } | { error: string } {
  let v = raw.trim();
  const site = domain.toLowerCase().replace(/^www\./, "");
  const bad = { error: "Enter a path on this site, such as /blog/ — no spaces." };
  if (!v) return bad;
  // An address in any of the ways one is pasted: with its scheme, without it ("//host/…"), or starting with the site's own name.
  const asUrl = /^https?:\/\//i.test(v) ? v : v.startsWith("//") ? `https:${v}` : new RegExp(`^(www\\.)?${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([:/]|$)`, "i").test(v) ? `https://${v}` : null;
  if (asUrl) {
    let u: URL; try { u = new URL(asUrl); } catch { return bad; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== site) return { error: `That address is on ${u.hostname}, not ${domain}. Open that site in Site explorer to look at its pages${host.endsWith(`.${site}`) ? " — a sub-domain is its own site here" : ""}.` };
    // What cannot be matched is said, not quietly dropped: another port is another site to a browser, and a sign-in is not part of an address.
    if (u.port) return { error: `That address is on port ${u.port}. Only the site's ordinary address can be looked at here — leave the port out if the page is the same.` };
    if (u.username || u.password) return { error: "Leave the user name and password out of the address." };
    v = u.pathname + u.search;
  } else {
    v = v.split("#")[0];
    if (!v.startsWith("/")) v = `/${v}`;
  }
  // A "?" with nothing after it is no query (the server reads it the same way).
  v = v.replace(/\?$/, "");
  return /^\/(?!\/)[^\s\\#]*$/.test(v) && v.length <= 300 ? { path: v } : bad;
}
/** The one spelling of a scope (the server's rule, server/seo/reports.ts canonicalScope): no last slash unless there is a query; the section "/" is the whole site. */
export function canonicalScope(path: string, exact: boolean): { path: string; exact: boolean } | null {
  const q = path.replace(/\?$/, "");
  const p = q.includes("?") ? q : q.replace(/\/+$/, "") || "/";
  return p === "/" && !exact ? null : { path: p, exact };
}
const CONTAINS_LABEL: Partial<Record<TableKey, string>> = { pages: "URL contains", backlinks: "Anchor contains", newBacklinks: "Anchor contains", lostBacklinks: "Anchor contains", referringDomains: "Domain contains", anchors: "Anchor contains", competitors: "Domain contains", bestByLinks: "URL contains" };
const isKeywordRows = (t: TableKey) => ["keywords", "paidKeywords", "matchingTerms", "relatedTerms", "questions"].includes(t);

function csvOf(cols: Col[], rows: any[]): string {
  const esc = (v: unknown) => { const raw = v == null ? "" : String(v); /* A cell from the open web must not run as a spreadsheet formula. */ const s = typeof v !== "number" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const used = cols.filter((c) => c.label);
  return [used.map((c) => esc(c.label)).join(","), ...rows.map((r) => used.map((c) => esc(c.csv(r))).join(","))].join("\n");
}

/** Reports that differ by country; link reports are the same everywhere, so they are not bought again per country. */
const BY_COUNTRY: ReadonlySet<TableKey> = new Set<TableKey>(["keywords", "paidKeywords", "pages", "competitors", "subdomains", "ads", "matchingTerms", "relatedTerms", "questions"]);

const sortKeyOf = (table: TableKey, sort: string) => (SORT_LABELS[table].some(([k]) => k === sort) ? sort : SORT_LABELS[table][0][0]);
export function ReportView({ table, domain, keyword, status, onExplore, onTrack, trackLabel, extraAction, market }: {
  /** The country to look at (United States when absent). */
  market?: { locationCode: number; languageCode: string };
  /** Keyword tables: something else to do with the ticked rows (e.g. add them to a list). */
  extraAction?: (rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent?: string | null }[], clear: () => void) => ReactNode;
  table: TableKey; domain?: string; keyword?: string; status: SeoStatus | undefined;
  onExplore?: (domain: string) => void;
  /** Keyword tables: track the ticked keywords (the page supplies the site). */
  onTrack?: (rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null }[]) => void | Promise<unknown>;
  trackLabel?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const target = (domain ?? keyword ?? "").trim();
  const [sort, setSort] = useState(SORT_LABELS[table][0][0]);
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  /** The section or page the report is narrowed to: what is typed, and what was applied. */
  const [scopeDraft, setScopeDraft] = useState<{ text: string; exact: boolean }>({ text: "", exact: false });
  const [scope, setScope] = useState<{ path: string; exact: boolean } | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState<25 | 50 | 100>(50);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** A tracking request is on its way: the button waits, and the ticks are cleared only when it has succeeded. */
  const [tracking, setTracking] = useState(false);
  // A different report or target starts clean.
  useEffect(() => { setSort(SORT_LABELS[table][0][0]); setDraft({}); setFilters({}); setOffset(0); setPicked(new Set()); setScopeDraft({ text: "", exact: false }); setScope(null); setScopeError(null); }, [table, target]);
  const scoped = !!domain && SCOPED.has(table);
  // Belt and braces with the remount: a sort the report does not have is never sent.
  const sortKey = SORT_LABELS[table].some(([k]) => k === sort) ? sort : SORT_LABELS[table][0][0];
  const loc = market && BY_COUNTRY.has(table) ? market.locationCode : undefined, lang = market && BY_COUNTRY.has(table) ? market.languageCode : undefined;
  const body = useMemo(() => ({ ...(domain ? { domain } : { keyword }), table, sort: sortKey, filters, limit, offset, ...(loc ? { locationCode: loc, languageCode: lang } : {}), ...(scoped && scope ? { path: scope.path, exactPage: scope.exact } : {}) }), [domain, keyword, table, sortKey, filters, limit, offset, loc, lang, scoped, scope]);
  const queryKey = ["/api/seo/report", body];
  const saved = useQuery<{ page: Page } | null>({
    queryKey, enabled: !!target, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/report", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const rowsOf = saved.data?.page?.fetchedAt ?? null;
  // The ticks belong to the rows on screen: another page of rows starts with none, so the number on the button is what is sent.
  // ("rowsOf" changes when the rows themselves are replaced under the same page — a fresh purchase, a refresh.)
  useEffect(() => { setPicked(new Set()); }, [offset, limit, sortKeyOf(table, sort), rowsOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMutation({
    mutationFn: (v: { body: unknown; key: readonly unknown[] }) => api("POST", "/api/seo/report", v.body),
    onSuccess: (data: { page: Page; saved?: boolean }, v) => {
      qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this page again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't run the report", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const page = saved.data?.page ?? null;
  const cols = COLS[table];
  const has = (f: string) => HAS[f]?.includes(table);
  // The Ads report is one small lookup for every ad; the others are bought a page at a time.
  const priceKey = table === "ads" && status?.prices?.adsReport != null ? "adsReport" as const : "reportPage" as const;
  const price = status?.prices ? money(status.prices[priceKey] ?? status.prices.reportPage) : "";
  const affordable = canAfford(status, priceKey);
  const whole = table === "ads";
  const hasFilters = Object.keys(HAS).some((f) => HAS[f]?.includes(table));
  const numField = (key: keyof Filters, label: string, width = "w-[88px]") => (
    <label className="g-text-2 flex items-center gap-1 text-[12px]">{label}
      <input className={`g-input ${width} !py-1`} inputMode="numeric" value={(draft[key] as number | undefined) ?? ""} data-testid={`filter-${key}`}
        onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ""); setDraft((d) => ({ ...d, [key]: v === "" ? undefined : Number(v) })); }} />
    </label>
  );
  const apply = () => {
    // The section first: a path that cannot be used is said, and nothing else changes until it is put right.
    if (scoped) {
      const typed = scopeDraft.text.trim();
      const parsed = typed ? scopePathOf(typed, domain!) : null;
      if (parsed && "error" in parsed) { setScopeError(parsed.error); return; }
      if (scopeDraft.exact && !parsed) { setScopeError("Say which page: a path such as /services/roofing."); return; }
      setScopeError(null);
      setScope(parsed ? canonicalScope(parsed.path, scopeDraft.exact) : null);
    }
    setFilters(Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined && v !== "" && v !== false)) as Filters); setOffset(0); setPicked(new Set());
  };
  const download = () => {
    if (!page) return;
    const blob = new Blob([csvOf(cols, page.rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    // The file name says what the rows are: the site, the section or page when narrowed, the report, the country when it matters, the rows.
    const slug = (v: string) => v.replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "");
    const scopeName = scoped && scope ? `-${scope.exact ? "page" : "section"}-${slug(scope.path) || "home"}` : "";
    a.href = URL.createObjectURL(blob); a.download = `${slug(target)}${scopeName}-${table}${loc ? `-${loc}-${lang}` : ""}-${offset + 1}-${offset + page.rows.length}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const trackable = (!!onTrack || !!extraAction) && isKeywordRows(table);
  const from = offset + 1, to = offset + (page?.rows.length ?? 0);

  return (
    <div data-testid={`report-${table}`}>
      <form className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2" onSubmit={(e) => { e.preventDefault(); apply(); }} data-testid="report-filters">
        {scoped && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label className="g-text-2 flex items-center gap-1 text-[12px]">Only pages under
              <input className="g-input w-[170px] !py-1" value={scopeDraft.text} maxLength={300} placeholder="/blog/" autoComplete="off" spellCheck={false} aria-invalid={!!scopeError} aria-describedby={scopeError ? `scope-error-${table}` : undefined}
                onChange={(e) => { setScopeDraft((d) => ({ ...d, text: e.target.value })); setScopeError(null); }} data-testid="filter-scope" />
            </label>
            <label className="g-text flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={scopeDraft.exact} onChange={(e) => { setScopeDraft((d) => ({ ...d, exact: e.target.checked })); setScopeError(null); }} data-testid="filter-scope-exact" /> this page only</label>
          </span>
        )}
        {has("position") && <>{numField("positionMin", "Position from", "w-[60px]")}{numField("positionMax", "to", "w-[60px]")}</>}
        {has("volume") && numField("volumeMin", "Volume ≥")}
        {has("difficulty") && numField("difficultyMax", "Difficulty ≤", "w-[60px]")}
        {has("intent") && (
          <label className="g-text-2 flex items-center gap-1 text-[12px]">Intent
            <select className="g-input g-select !w-auto !py-1" value={draft.intent ?? ""} onChange={(e) => setDraft((d) => ({ ...d, intent: e.target.value || undefined }))} data-testid="filter-intent">
              <option value="">Any</option>{["informational", "navigational", "commercial", "transactional"].map((i) => <option key={i} value={i}>{cap(i)}</option>)}
            </select>
          </label>
        )}
        {has("follow") && (
          <label className="g-text-2 flex items-center gap-1 text-[12px]">Links
            <select className="g-input g-select !w-auto !py-1" value={draft.follow ?? ""} onChange={(e) => setDraft((d) => ({ ...d, follow: (e.target.value || undefined) as Filters["follow"] }))} data-testid="filter-follow">
              <option value="">All</option><option value="followed">Followed</option><option value="nofollow">Nofollow</option>
            </select>
          </label>
        )}
        {has("everyLink") && <label className="g-text flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={!!draft.everyLink} onChange={(e) => setDraft((d) => ({ ...d, everyLink: e.target.checked || undefined }))} data-testid="filter-everyLink" /> Every link, not one per site</label>}
        {has("contains") && (
          <label className="g-text-2 flex items-center gap-1 text-[12px]">{CONTAINS_LABEL[table] ?? "Keyword contains"}
            <input className="g-input w-[150px] !py-1" value={draft.contains ?? ""} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, contains: e.target.value.replace(/[%_\\]/g, "") || undefined }))} data-testid="filter-contains" />
          </label>
        )}
        <label className="g-text-2 flex items-center gap-1 text-[12px]">Sort
          <select className="g-input g-select !w-auto !py-1" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }} data-testid="report-sort">
            {SORT_LABELS[table].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="g-text-2 flex items-center gap-1 text-[12px]">Rows
          <select className="g-input g-select !w-auto !py-1" value={limit} onChange={(e) => { setLimit(Number(e.target.value) as 25 | 50 | 100); setOffset(0); }} data-testid="report-limit">
            <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
        {(scoped || Object.keys(HAS).some((f) => has(f))) && <button type="submit" className="g-pill g-pill--sm" data-testid="button-apply-filters">Apply filters</button>}
      </form>
      {scopeError && <p id={`scope-error-${table}`} className="mb-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="scope-error">{scopeError}</p>}
      {scoped && scope && (
        <p className="g-text mb-2 text-[13px]" role="status" data-testid="text-scope">
          Narrowed to {scope.exact ? "the page" : "the section"} <b className="font-medium">{domain}{scope.path}</b>
          {scope.exact ? (scope.path.includes("?") ? " — that address exactly as written" : " — with or without its last slash") : ` — that page and everything under it (${scope.path}/…), not paths that merely begin the same`}, on {domain} with or without "www"; sub-domains are not included. A narrowed report is saved, and paid for, separately from the whole site's.{" "}
          <button type="button" className="g-link" onClick={() => { setScope(null); setScopeDraft({ text: "", exact: false }); setOffset(0); setPicked(new Set()); }} data-testid="button-scope-clear">Show the whole site</button>
        </p>
      )}

      {saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved copy…</p>}
      {saved.isError && !page && (
        <div className="g-callout" role="alert" data-testid="report-saved-error">
          <h3>Couldn't check for a saved copy</h3><p>{apiErrorMessage(saved.error)} Nothing has been charged.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="g-pill" onClick={() => void saved.refetch()}>Try again</button>
            {offset > 0 && <button type="button" className="g-pill" onClick={() => setOffset(Math.max(0, offset - limit))}>Back</button>}
          </div>
        </div>
      )}
      {saved.isSuccess && !page && (
        <Empty testId="report-not-run">
          <h3>{offset ? `Rows ${fmtNum(offset + 1)}–${fmtNum(offset + limit)} haven't been loaded` : hasFilters ? "This report hasn't been run with these settings" : "This report hasn't been run yet"}</h3>
          <p>{whole ? `This report costs about ${price} of your SEO data and brings every ad Google's library will give (up to 120); paging through them is free.` : `Each page of a report costs about ${price} of your SEO data.`} {whole ? "It" : "A page you've run"} is kept for a day and opens free.{holdNote(status, priceKey)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={run.isPending || !status?.configured || !affordable} onClick={() => run.mutate({ body, key: queryKey })} data-testid="button-run-report">
              {run.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}{offset ? "Load these rows" : "Run report"} — about {price}
            </Button>
            {offset > 0 && <button type="button" className="g-pill" onClick={() => setOffset(Math.max(0, offset - limit))}>Back</button>}
            {!affordable && <span className="text-[13px]" style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit above.</span>}
          </div>
        </Empty>
      )}
      {page && (
        <>
          <div className="g-text-2 mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span data-testid="report-meta">
              {page.rows.length ? `Rows ${fmtNum(from)}–${fmtNum(to)}` : "No rows"}{page.total != null ? ` of ${fmtNum(page.total)}` : ""}{page.capped ? " most recent (Google's library gives no more; the site may have run others)" : ""} · as of {fmtDate(page.fetchedAt)}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {trackable && extraAction && page.rows.some((r) => picked.has(r.keyword)) && extraAction(page.rows.filter((r) => picked.has(r.keyword)), () => setPicked(new Set()))}
              {trackable && onTrack && page.rows.some((r) => picked.has(r.keyword)) && (
                <Button size="sm" disabled={tracking} aria-busy={tracking} data-testid="button-track-picked" onClick={() => {
                  const out = onTrack(page.rows.filter((r) => picked.has(r.keyword)));
                  // The page says when tracking has finished (it returns a promise): the ticks go only on success; on failure they stay for another try.
                  if (out && typeof (out as Promise<unknown>).then === "function") { setTracking(true); (out as Promise<unknown>).then(() => setPicked(new Set()), () => {}).finally(() => setTracking(false)); }
                }}>{tracking ? "Tracking…" : `${trackLabel ?? "Track"} (${page.rows.filter((r) => picked.has(r.keyword)).length})`}</Button>
              )}
              <button type="button" className="g-pill g-pill--sm" disabled={!page.rows.length} onClick={download} data-testid="button-export-csv"><Download /> Export CSV</button>
            </span>
          </div>
          {page.rows.length === 0 ? <Empty testId="report-empty">{scoped && scope ? <>Nothing {Object.keys(filters).length ? "matches these filters" : "was found"} for {scope.exact ? "the page" : "the section"} {domain}{scope.path}. <button type="button" className="g-link" onClick={() => { setScope(null); setScopeDraft({ text: "", exact: false }); setOffset(0); setPicked(new Set()); }}>Show the whole site</button></> : Object.keys(filters).length ? "Nothing matches. Try wider filters." : EMPTY_NOTE[table] ?? "Nothing was found for this site."}</Empty> : (
            <div className="overflow-x-auto">
              <table className="g-table" data-testid={`table-${table}`}>
                <thead><tr>{trackable && <th className="w-8"></th>}{cols.map((c) => <th key={c.key} className={c.num ? "num" : undefined}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {page.rows.map((r, i) => (
                    <tr key={`${r.keyword ?? r.url ?? r.domain ?? r.anchor}-${i}`}>
                      {trackable && <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>}
                      {cols.map((c, j) => <td key={c.key} className={c.num ? "num" : undefined} data-label={j ? c.label : undefined}>{c.cell(r, { target, onExplore })}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <button type="button" className="g-pill g-pill--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-prev-page">← Previous</button>
            <button type="button" className="g-pill g-pill--sm" disabled={(page.sourceRows ?? page.rows.length) < limit || (page.total != null && to >= page.total) || offset + limit > 9900} onClick={() => setOffset(offset + limit)} data-testid="button-next-page">Next →</button>
            <span className="g-text-2">{whole ? "Paging through these is free." : `A page you haven't opened yet costs about ${price}.`}</span>
          </div>
        </>
      )}
    </div>
  );
}
