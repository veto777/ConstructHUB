/**
 * One Site Explorer / Keywords Explorer report: filters, sort, paging, CSV
 * export and (for keyword rows) "track these". Each page is one lookup on the
 * account's SEO data credit; a page already run in the last day opens free
 * (the server keeps it), so the screen first asks for the saved page ("peek")
 * and only spends when the person presses Run.
 *
 * Every row leads somewhere (owner 2026-10-09): a keyword to the keywords explorer, a domain to its own Site
 * explorer, a page to the report narrowed to that page, an anchor to the links that use it — the page itself stays
 * behind a separate icon. With `linked`, the filters live in the address (links.ts): they are read on arrival and
 * written on "Apply filters", and what narrows the list is said in the chip (data-testid="active-filter").
 */
import { useRef, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import { holdNote, isNotRunYet } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, money, type SeoStatus } from "./shell";
import { DifficultyBadge, PositionBadge } from "./viz";
import { Fig, FIG, OpenIcon } from "./viz-explorer";
import { seoLinks, setParam, setParams } from "./links";
import { marketParams } from "./keyword-links";
import { addressFromFilters, bandOfPosition, canonicalScope, filtersFromAddress, filterWords, HAS, pathOfUrl, SCOPED, scopePathOf, SORT_LABELS, sortKeyOf, SORTS_BY_DATE, sortWords, type Filters, type Scope, type TableKey } from "./explorer-filters";

export { scopePathOf, canonicalScope, type TableKey } from "./explorer-filters";
type Page = { table: TableKey; target: string; capped?: boolean; rows: any[]; sourceRows?: number; total: number | null; limit: number; offset: number; sort: string; fetchedAt: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const strip = (u: string | null | undefined) => (u ?? "").replace(/^https?:\/\/(www\.)?/, "");
const usd2 = (n: number | null | undefined) => n == null ? "—" : `$${n.toFixed(2)}`;
const usd0 = (n: number | null | undefined) => n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const Ext = ({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) => <a href={href} className={FIG} target="_blank" rel="noreferrer" data-testid={testId}>{children}</a>;
const Open = OpenIcon;

/** What a cell knows besides its row: the report's target, the site (for a site report), the country and, when the site is tracked, its id. */
type Ctx = { target: string; onExplore?: (d: string) => void; domain?: string; table: TableKey; market?: { locationCode: number; languageCode: string }; siteId?: number };
type ExplorerParams = NonNullable<Parameters<typeof seoLinks.explorer>[2]>;
/** A Site explorer address that carries the country the row was looked at in. */
const ex = (c: Ctx, domain: string, view: string, p: ExplorerParams = {}) => seoLinks.explorer(domain, view, { ...marketParams(c.market), ...p });
/** A keyword's own page in the keywords explorer, in the same country. */
const kw = (c: Ctx, keyword: string, p: Omit<NonNullable<Parameters<typeof seoLinks.keywords>[1]>, "locationCode" | "languageCode"> = {}) => seoLinks.keywords(keyword, { ...marketParams(c.market), ...p });
/** A site's name, leading to its own Site explorer; the site itself behind the icon. */
const SiteLink = ({ domain, c, testId }: { domain: string | null | undefined; c: Ctx; testId: string }) =>
  domain ? <><Fig href={ex(c, domain, "overview")} testId={testId}>{domain}</Fig><Open href={`https://${domain}`} what={domain} /></> : <>—</>;
/** A page on the site, leading to `view` narrowed to that page; the page itself behind the icon. An address that is not on this site just opens. */
const PageLink = ({ url, text, view, c, testId, p = {} }: { url: string; text: ReactNode; view: TableKey; c: Ctx; testId: string; p?: ExplorerParams }) => {
  const path = c.domain ? pathOfUrl(url, c.domain) : null;
  return path && c.domain ? <><Fig href={ex(c, c.domain, view, { path, ...p })} testId={testId}>{text}</Fig><Open href={url} what="the page" /></> : <Ext href={url} testId={testId}>{text}</Ext>;
};
/** A figure of a page row, leading to `view` narrowed to that page (plain when the address is not on this site). */
const PageFigure = ({ url, value, view, c, testId, p = {}, words }: { url: string; value: ReactNode; view: TableKey; c: Ctx; testId: string; p?: ExplorerParams; words?: string }) => {
  const path = c.domain ? pathOfUrl(url, c.domain) : null;
  return path && c.domain ? <Fig href={ex(c, c.domain, view, { path, ...p })} testId={testId} label={words}>{value}</Fig> : <>{value}</>;
};
/** A figure of a site row (a competitor, a linking site, a sub-domain), leading to that site's `view`. */
const SiteFigure = ({ domain, value, view, c, testId, p = {}, words }: { domain: string | null | undefined; value: ReactNode; view: string; c: Ctx; testId: string; p?: ExplorerParams; words?: string }) =>
  domain ? <Fig href={ex(c, domain, view, p)} testId={testId} label={words}>{value}</Fig> : <>{value}</>;
/** A figure of this site's own row, leading to `view` of this site with `p` (plain for a keyword report with no site). */
const OwnFigure = ({ value, view, c, testId, p = {}, words }: { value: ReactNode; view: string; c: Ctx; testId: string; p?: ExplorerParams; words?: string }) =>
  c.domain ? <Fig href={ex(c, c.domain, view, p)} testId={testId} label={words}>{value}</Fig> : <>{value}</>;
/** A date cell: the report in date order when it offers one (the label names that order as the picker does — lost links are "most recently lost"), else the row's own place. */
const DateCell = ({ date, c, testId, fallback }: { date: string | null | undefined; c: Ctx; testId: string; /** Where the row leads, for a report with no date order. */ fallback?: string }) =>
  date && c.domain && SORTS_BY_DATE.has(c.table) ? <Fig href={ex(c, c.domain, c.table, { sort: "newest" })} testId={testId} label={`${fmtDate(date)} — the list ordered by “${sortWords(c.table, "newest").toLowerCase()}”`}>{fmtDate(date)}</Fig>
    : date && fallback ? <Fig href={fallback} testId={testId}>{fmtDate(date)}</Fig> : <>{fmtDate(date)}</>;

type Col = { key: string; label: string; num?: boolean; cell: (r: any, ctx: Ctx) => ReactNode; csv: (r: any) => string | number | null };
const keywordCell: Col = { key: "keyword", label: "Keyword", cell: (r, c) => <Fig href={kw(c, r.keyword)} testId="link-keyword">{r.keyword}</Fig>, csv: (r) => r.keyword };
/** The cells a keyword row shares between the site reports and the keyword-ideas reports: each figure leads to the part of the keyword's page that explains it. */
const volumeCell: Col = { key: "volume", label: "Volume", num: true, cell: (r, c) => <Fig href={kw(c, r.keyword, { section: "volume" })} testId="link-keyword-volume" label={`${fmtNum(r.volume)} searches a month — the keyword's volume`}>{fmtNum(r.volume)}</Fig>, csv: (r) => r.volume };
const difficultyCell: Col = { key: "difficulty", label: "Difficulty", num: true, cell: (r, c) => <Fig href={kw(c, r.keyword, { section: "serp" })} testId="link-keyword-difficulty" label="Difficulty — the keyword's results page"><DifficultyBadge value={r.difficulty} /></Fig>, csv: (r) => r.difficulty };
const cpcCell: Col = { key: "cpc", label: "CPC", num: true, cell: (r, c) => <Fig href={kw(c, r.keyword, { section: "cpc" })} testId="link-keyword-cpc" label={`${usd2(r.cpc)} a click — the keyword's ad prices`}>{usd2(r.cpc)}</Fig>, csv: (r) => r.cpc };
const kwCols: Col[] = [
  keywordCell,
  // The position's band: the keywords of this site in the same band.
  { key: "position", label: "Position", num: true, cell: (r, c) => { const b = bandOfPosition(r.position); return b && c.domain ? <Fig href={ex(c, c.domain, "keywords", b)} testId="link-keyword-position" label={`Position ${r.position} — the keywords in that band`}><PositionBadge value={r.position} /></Fig> : <PositionBadge value={r.position} />; }, csv: (r) => r.position },
  volumeCell,
  // The traffic goes to the keyword's page: that page's keywords; without a page, the keyword's own results.
  { key: "traffic", label: "Traffic", num: true, cell: (r, c) => { const path = r.url && c.domain ? pathOfUrl(r.url, c.domain) : null; return <Fig href={path && c.domain ? ex(c, c.domain, "keywords", { path }) : kw(c, r.keyword, { section: "results" })} testId="link-keyword-traffic" label={`${fmtNum(r.traffic)} visits a month — ${path ? "the keywords of that page" : "the keyword's results"}`}>{fmtNum(r.traffic)}</Fig>; }, csv: (r) => r.traffic },
  difficultyCell,
  cpcCell,
  { key: "intent", label: "Intent", cell: (r, c) => (r.intent ? <OwnFigure value={cap(r.intent)} view="keywords" c={c} p={{ intent: r.intent }} testId="link-keyword-intent" words={`${cap(r.intent)} keywords`} /> : "—"), csv: (r) => r.intent },
  { key: "url", label: "Page", cell: (r, c) => (r.url ? <PageLink url={r.url} text={strip(r.url).replace(c.target, "") || "/"} view="pages" c={c} testId="link-keyword-page" /> : "—"), csv: (r) => r.url },
];
const ideaCols: Col[] = [
  keywordCell,
  volumeCell,
  difficultyCell,
  cpcCell,
  // A keyword idea has no site: its intent and ad competition are facts of the keyword, on its own page.
  { key: "intent", label: "Intent", cell: (r, c) => (r.intent ? <Fig href={kw(c, r.keyword)} testId="link-keyword-intent" label={`${cap(r.intent)} — the keyword's page`}>{cap(r.intent)}</Fig> : "—"), csv: (r) => r.intent },
  { key: "competition", label: "Ad competition", cell: (r, c) => (r.competition ? <Fig href={kw(c, r.keyword, { section: "cpc" })} testId="link-keyword-competition" label="Ad competition — the keyword's ad prices">{cap(String(r.competition).toLowerCase())}</Fig> : "—"), csv: (r) => r.competition },
];
const linkCols: Col[] = [
  // The linking site's name leads to its own Site explorer; the linking page itself is behind the icon.
  { key: "url", label: "Linking page", cell: (r, c) => <span className="block max-w-[340px]">{r.domain ? <><Fig href={ex(c, r.domain, "overview")} testId="link-linking-site">{r.title || r.domain}</Fig><Open href={r.url} what="the linking page" /></> : <Ext href={r.url}>{r.title || strip(r.url)}</Ext>}<span className="g-text-2 block truncate text-[12px]">{strip(r.url)}</span></span>, csv: (r) => r.url },
  { key: "authority", label: "Authority", num: true, cell: (r, c) => <SiteFigure domain={r.domain} value={r.authority ?? "—"} view="referringDomains" c={c} testId="link-link-authority" words={`Authority ${r.authority ?? "unknown"} — the sites linking to ${r.domain ?? "it"}`} />, csv: (r) => r.authority },
  { key: "anchor", label: "Anchor", cell: (r, c) => <span className="block max-w-[200px] truncate">{r.anchor ? c.domain ? <Fig href={ex(c, c.domain, "anchors", { anchor: r.anchor })} testId="link-anchor">{r.anchor}</Fig> : r.anchor : <span className="g-text-2">(none)</span>}</span>, csv: (r) => r.anchor },
  // The page on this site the link points at: the same report narrowed to that page.
  { key: "target", label: "Links to", cell: (r, c) => <span className="block max-w-[200px] truncate">{r.target ? <PageLink url={r.target} text={strip(r.target)} view={c.table} c={c} testId="link-links-to" /> : <span className="g-text-2">—</span>}</span>, csv: (r) => r.target },
  { key: "followed", label: "Follow", cell: (r, c) => <OwnFigure value={r.followed ? "followed" : "nofollow"} view={c.table} c={c} p={{ followed: !!r.followed }} testId="link-link-follow" words={`${r.followed ? "Followed" : "Nofollow"} links only`} />, csv: (r) => (r.followed ? "followed" : "nofollow") },
  { key: "spamScore", label: "Spam", num: true, cell: (r, c) => (r.spamScore == null ? "—" : <SiteFigure domain={r.domain} value={r.spamScore} view="backlinks" c={c} p={{ why: "spam" }} testId="link-link-spam" words={`Spam score ${r.spamScore} — ${r.domain ?? "the site"}'s own links (no view lists spam scores)`} />), csv: (r) => r.spamScore },
  { key: "firstSeen", label: "First seen", num: true, cell: (r, c) => <DateCell date={r.firstSeen} c={c} testId="link-link-first-seen" />, csv: (r) => r.firstSeen },
  { key: "lastSeen", label: "Last seen", num: true, cell: (r, c) => <DateCell date={r.lastSeen} c={c} testId="link-link-last-seen" />, csv: (r) => r.lastSeen },
];
const COLS: Record<TableKey, Col[]> = {
  keywords: kwCols, paidKeywords: kwCols.filter((c) => c.key !== "difficulty"),
  pages: [
    { key: "url", label: "Page", cell: (r, c) => <span className="block max-w-[440px] truncate"><PageLink url={r.url} text={strip(r.url)} view="pages" c={c} testId="link-page" /></span>, csv: (r) => r.url },
    // A page's traffic and value come from its keywords.
    { key: "traffic", label: "Traffic", num: true, cell: (r, c) => <PageFigure url={r.url} value={fmtNum(r.traffic)} view="keywords" c={c} testId="link-page-traffic" words={`${fmtNum(r.traffic)} visits a month — the keywords of this page`} />, csv: (r) => r.traffic },
    { key: "keywords", label: "Keywords", num: true, cell: (r, c) => <PageFigure url={r.url} value={fmtNum(r.keywords)} view="keywords" c={c} testId="link-page-keywords" />, csv: (r) => r.keywords },
    { key: "top10", label: "In top 10", num: true, cell: (r, c) => <PageFigure url={r.url} value={fmtNum(r.top10)} view="keywords" c={c} testId="link-page-top10" p={{ band: "top10" }} />, csv: (r) => r.top10 },
    { key: "trafficValue", label: "Traffic value", num: true, cell: (r, c) => <PageFigure url={r.url} value={usd0(r.trafficValue)} view="keywords" c={c} testId="link-page-value" p={{ sort: "cpc" }} words={`${usd0(r.trafficValue)} a month as ads — this page's keywords by ad price`} />, csv: (r) => r.trafficValue },
  ],
  competitors: [
    { key: "domain", label: "Competitor", cell: (r, c) => <SiteLink domain={r.domain} c={c} testId="link-competitor" />, csv: (r) => r.domain },
    // What two sites share is counted in Content gap; the competitor's keywords are the rows, and the chip says so.
    { key: "commonKeywords", label: "Shared keywords", num: true, cell: (r, c) => <SiteFigure domain={r.domain} value={fmtNum(r.commonKeywords)} view="keywords" c={c} p={{ why: "shared" }} testId="link-competitor-shared" words={`${fmtNum(r.commonKeywords)} shared keywords — ${r.domain}'s keywords`} />, csv: (r) => r.commonKeywords },
    { key: "keywords", label: "Their keywords", num: true, cell: (r, c) => <SiteFigure domain={r.domain} value={fmtNum(r.keywords)} view="keywords" c={c} testId="link-competitor-keywords" />, csv: (r) => r.keywords },
    { key: "traffic", label: "Their traffic", num: true, cell: (r, c) => <SiteFigure domain={r.domain} value={fmtNum(r.traffic)} view="pages" c={c} testId="link-competitor-traffic" />, csv: (r) => r.traffic },
    { key: "avgPosition", label: "Avg. position", num: true, cell: (r, c) => <SiteFigure domain={r.domain} value={r.avgPosition ?? "—"} view="keywords" c={c} p={{ sort: "position" }} testId="link-competitor-position" words={`Average position ${r.avgPosition ?? "unknown"} — ${r.domain}'s keywords, best position first`} />, csv: (r) => r.avgPosition },
    { key: "explore", label: "", num: true, cell: (r, c) => <Fig href={ex(c, r.domain, "overview")} testId="link-competitor-explore" label={`Explore ${r.domain}`}>Explore</Fig>, csv: () => null },
  ],
  backlinks: linkCols.filter((c) => c.key !== "lastSeen"), newBacklinks: linkCols.filter((c) => c.key !== "lastSeen"),
  lostBacklinks: linkCols.filter((c) => c.key !== "spamScore"), brokenBacklinks: linkCols.filter((c) => c.key !== "lastSeen"),
  referringDomains: [
    { key: "domain", label: "Domain", cell: (r, c) => <SiteLink domain={r.domain} c={c} testId="link-referring-domain" />, csv: (r) => r.domain },
    { key: "authority", label: "Authority", num: true, cell: (r, c) => <SiteFigure domain={r.domain} value={r.authority ?? "—"} view="referringDomains" c={c} testId="link-referring-authority" words={`Authority ${r.authority ?? "unknown"} — the sites linking to ${r.domain}`} />, csv: (r) => r.authority },
    // The links from one site: the Backlinks page can pick them out for a tracked site; the explorer's list can't yet, and says so.
    { key: "backlinks", label: "Links to this site", num: true, cell: (r, c) => (c.siteId != null ? <Fig href={seoLinks.backlinks(c.siteId, { domain: r.domain })} testId="link-referring-links" label={`${fmtNum(r.backlinks)} links from ${r.domain}`}>{fmtNum(r.backlinks)}</Fig> : <OwnFigure value={fmtNum(r.backlinks)} view="backlinks" c={c} p={{ source: r.domain }} testId="link-referring-links" words={`${fmtNum(r.backlinks)} links from ${r.domain} — the links list`} />), csv: (r) => r.backlinks },
    { key: "spamScore", label: "Spam", num: true, cell: (r, c) => (r.spamScore == null ? "—" : <SiteFigure domain={r.domain} value={r.spamScore} view="backlinks" c={c} p={{ why: "spam" }} testId="link-referring-spam" words={`Spam score ${r.spamScore} — ${r.domain}'s own links (no view lists spam scores)`} />), csv: (r) => r.spamScore },
    { key: "followed", label: "Follow", cell: (r, c) => <OwnFigure value={r.followed ? "followed" : "nofollow"} view="referringDomains" c={c} p={{ followed: !!r.followed }} testId="link-referring-follow" words={`${r.followed ? "Followed" : "Not followed"} referring domains`} />, csv: (r) => (r.followed ? "followed" : "nofollow") },
    { key: "firstSeen", label: "First seen", num: true, cell: (r, c) => <DateCell date={r.firstSeen} c={c} testId="link-referring-first-seen" />, csv: (r) => r.firstSeen },
  ],
  anchors: [
    // An anchor leads to the links that use it; its counts to the same links, every one or one per site.
    { key: "anchor", label: "Anchor text", cell: (r, c) => <span className="block max-w-[440px] truncate">{r.anchor ? c.domain ? <Fig href={ex(c, c.domain, "backlinks", { anchor: r.anchor })} testId="link-anchor-links">{r.anchor}</Fig> : r.anchor : <span className="g-text-2">(no text — image or empty link)</span>}</span>, csv: (r) => r.anchor },
    { key: "backlinks", label: "Backlinks", num: true, cell: (r, c) => <OwnFigure value={fmtNum(r.backlinks)} view="backlinks" c={c} p={{ anchor: r.anchor || undefined, everyLink: true }} testId="link-anchor-backlinks" words={`${fmtNum(r.backlinks)} links with this anchor`} />, csv: (r) => r.backlinks },
    { key: "referringDomains", label: "Referring domains", num: true, cell: (r, c) => <OwnFigure value={fmtNum(r.referringDomains)} view="backlinks" c={c} p={{ anchor: r.anchor || undefined }} testId="link-anchor-domains" words={`${fmtNum(r.referringDomains)} sites using this anchor — one link per site`} />, csv: (r) => r.referringDomains },
    { key: "firstSeen", label: "First seen", num: true, cell: (r, c) => <DateCell date={r.firstSeen} c={c} testId="link-anchor-first-seen" fallback={c.domain ? ex(c, c.domain, "backlinks", { anchor: r.anchor || undefined, sort: "newest" }) : undefined} />, csv: (r) => r.firstSeen },
  ],
  bestByLinks: [
    // A page here is about its links: the page and its figures lead to the links pointing at it.
    { key: "url", label: "Page", cell: (r, c) => <span className="block max-w-[440px] truncate"><PageLink url={r.url} text={strip(r.url)} view="backlinks" c={c} testId="link-page-links" /></span>, csv: (r) => r.url },
    { key: "referringDomains", label: "Referring domains", num: true, cell: (r, c) => <PageFigure url={r.url} value={fmtNum(r.referringDomains)} view="backlinks" c={c} testId="link-page-referring-domains" />, csv: (r) => r.referringDomains },
    { key: "backlinks", label: "Backlinks", num: true, cell: (r, c) => <PageFigure url={r.url} value={fmtNum(r.backlinks)} view="backlinks" c={c} testId="link-page-backlinks" p={{ everyLink: true }} />, csv: (r) => r.backlinks },
    { key: "authority", label: "Page authority", num: true, cell: (r, c) => <PageFigure url={r.url} value={r.authority ?? "—"} view="backlinks" c={c} testId="link-page-authority" words={`Page authority ${r.authority ?? "unknown"} — the links to this page`} />, csv: (r) => r.authority },
    { key: "brokenBacklinks", label: "Broken", num: true, cell: (r, c) => <PageFigure url={r.url} value={fmtNum(r.brokenBacklinks)} view="brokenBacklinks" c={c} testId="link-page-broken" />, csv: (r) => r.brokenBacklinks },
    { key: "firstSeen", label: "First seen", num: true, cell: (r, c) => <DateCell date={r.firstSeen} c={c} testId="link-page-first-seen" fallback={c.domain && pathOfUrl(r.url, c.domain) ? ex(c, c.domain, "backlinks", { path: pathOfUrl(r.url, c.domain)!, sort: "newest" }) : undefined} />, csv: (r) => r.firstSeen },
  ],
  referringIps: [
    // An address has no report of its own here, so it is said as it is; its counts lead to the whole lists, and the chip says so.
    { key: "ip", label: "IP address", cell: (r) => r.ip, csv: (r) => r.ip },
    { key: "referringDomains", label: "Linking sites on it", num: true, cell: (r, c) => <OwnFigure value={fmtNum(r.referringDomains)} view="referringDomains" c={c} p={{ why: "ip" }} testId="link-ip-domains" words={`${fmtNum(r.referringDomains)} linking sites on ${r.ip} — the whole list of referring domains`} />, csv: (r) => r.referringDomains },
    { key: "backlinks", label: "Links", num: true, cell: (r, c) => <OwnFigure value={fmtNum(r.backlinks)} view="backlinks" c={c} p={{ why: "ip" }} testId="link-ip-links" words={`${fmtNum(r.backlinks)} links from ${r.ip} — the whole list of links`} />, csv: (r) => r.backlinks },
    { key: "firstSeen", label: "First seen", num: true, cell: (r, c) => <DateCell date={r.firstSeen} c={c} testId="link-ip-first-seen" fallback={c.domain ? ex(c, c.domain, "referringDomains", { why: "ip", sort: "newest" }) : undefined} />, csv: (r) => r.firstSeen },
  ],
  linkCompetitors: [
    { key: "domain", label: "Site", cell: (r, c) => <SiteLink domain={r.domain} c={c} testId="link-link-competitor" />, csv: (r) => r.domain },
    { key: "shared", label: "Linking sites in common", num: true, cell: (r, c) => <SiteFigure domain={r.domain} value={fmtNum(r.shared)} view="referringDomains" c={c} p={{ why: "shared" }} testId="link-link-competitor-shared" words={`${fmtNum(r.shared)} linking sites in common — ${r.domain}'s referring domains`} />, csv: (r) => r.shared },
    { key: "explore", label: "", num: true, cell: (r, c) => <Fig href={ex(c, r.domain, "overview")} testId="link-link-competitor-explore" label={`Explore ${r.domain}`}>Explore</Fig>, csv: () => null },
  ],
  subdomains: [
    // A sub-domain is its own site here.
    { key: "subdomain", label: "Subdomain", cell: (r, c) => <SiteLink domain={r.subdomain} c={c} testId="link-subdomain" />, csv: (r) => r.subdomain },
    { key: "traffic", label: "Traffic", num: true, cell: (r, c) => <SiteFigure domain={r.subdomain} value={fmtNum(r.traffic)} view="pages" c={c} testId="link-subdomain-traffic" />, csv: (r) => r.traffic },
    { key: "keywords", label: "Keywords", num: true, cell: (r, c) => <SiteFigure domain={r.subdomain} value={fmtNum(r.keywords)} view="keywords" c={c} testId="link-subdomain-keywords" />, csv: (r) => r.keywords },
    { key: "top3", label: "In top 3", num: true, cell: (r, c) => <SiteFigure domain={r.subdomain} value={fmtNum(r.top3)} view="keywords" c={c} p={{ band: "top3" }} testId="link-subdomain-top3" />, csv: (r) => r.top3 },
    { key: "top10", label: "In top 10", num: true, cell: (r, c) => <SiteFigure domain={r.subdomain} value={fmtNum(r.top10)} view="keywords" c={c} p={{ band: "top10" }} testId="link-subdomain-top10" />, csv: (r) => r.top10 },
    { key: "trafficValue", label: "Traffic value", num: true, cell: (r, c) => <SiteFigure domain={r.subdomain} value={usd0(r.trafficValue)} view="keywords" c={c} p={{ sort: "cpc" }} testId="link-subdomain-value" words={`${usd0(r.trafficValue)} a month as ads — ${r.subdomain}'s keywords by ad price`} />, csv: (r) => r.trafficValue },
  ],
  ads: [
    // Everything on an ad row is the ad: each cell opens Google's own page for it (there is no view of ours behind an ad).
    { key: "advertiser", label: "Advertiser", cell: (r) => <>{r.url ? <Ext href={r.url} testId="link-ad-advertiser">{r.advertiser}</Ext> : r.advertiser}{r.verified && <span className="g-text-2 text-[12px]"> · verified by Google</span>}</>, csv: (r) => r.advertiser },
    { key: "format", label: "Kind", cell: (r) => (r.format ? r.url ? <Ext href={r.url} testId="link-ad-kind">{cap(r.format)}</Ext> : cap(r.format) : "—"), csv: (r) => r.format },
    { key: "firstShown", label: "First shown", num: true, cell: (r) => (r.firstShown && r.url ? <Ext href={r.url} testId="link-ad-first-shown">{fmtDate(r.firstShown)}</Ext> : fmtDate(r.firstShown)), csv: (r) => r.firstShown },
    { key: "lastShown", label: "Last shown", num: true, cell: (r) => (r.lastShown && r.url ? <Ext href={r.url} testId="link-ad-last-shown">{fmtDate(r.lastShown)}</Ext> : fmtDate(r.lastShown)), csv: (r) => r.lastShown },
    { key: "url", label: "Ad", num: true, cell: (r) => (r.url ? <a href={r.url} className={FIG} target="_blank" rel="noreferrer" aria-label={`See the ad from ${r.advertiser}, last shown ${fmtDate(r.lastShown)}`} data-testid="link-ad">See the ad</a> : null), csv: (r) => r.url },
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
  backlinks: "Authority (0–100) is an estimate of link strength made from these links: how many there are and how strong the sites they come from are. It is not a Google figure.",
  referringIps: "The server addresses the linking sites sit on. It shows where links are concentrated, not who owns the sites: one address is often shared by many unrelated sites (shared hosting, or a network such as Cloudflare).",
  linkCompetitors: "Sites that many of the same websites link to. They draw on the same sources of links as this site — whether or not they sell the same thing.",
  subdomains: "The parts of this site with their own name (blog.example.com), with the search traffic each brings.",
  ads: "The Google Ads this site has run, from Google's public ad library. \"See the ad\" opens Google's own page for it.",
};

const CONTAINS_LABEL: Partial<Record<TableKey, string>> = { pages: "URL contains", backlinks: "Anchor contains", newBacklinks: "Anchor contains", lostBacklinks: "Anchor contains", referringDomains: "Domain contains", anchors: "Anchor contains", competitors: "Domain contains", bestByLinks: "URL contains" };
const isKeywordRows = (t: TableKey) => ["keywords", "paidKeywords", "matchingTerms", "relatedTerms", "questions"].includes(t);

function csvOf(cols: Col[], rows: any[]): string {
  const esc = (v: unknown) => { const raw = v == null ? "" : String(v); /* A cell from the open web must not run as a spreadsheet formula. */ const s = typeof v !== "number" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const used = cols.filter((c) => c.label);
  return [used.map((c) => esc(c.label)).join(","), ...rows.map((r) => used.map((c) => esc(c.csv(r))).join(","))].join("\n");
}

/** Reports that differ by country; link reports are the same everywhere, so they are not bought again per country. */
const BY_COUNTRY: ReadonlySet<TableKey> = new Set<TableKey>(["keywords", "paidKeywords", "pages", "competitors", "subdomains", "ads", "matchingTerms", "relatedTerms", "questions"]);

export function ReportView({ table, domain, keyword, status, onExplore, onTrack, trackLabel, extraAction, market, linked = false, siteId }: {
  /** The country to look at (United States when absent). */
  market?: { locationCode: number; languageCode: string };
  /** The filters live in the address (links.ts explorer words): read on arrival and whenever it changes, written on "Apply filters". */
  linked?: boolean;
  /** The tracked site this report is of, when it is one: a referring domain's links can then open on the Backlinks page, picked out. */
  siteId?: number;
  /** Keyword tables: something else to do with the ticked rows (e.g. add them to a list). */
  extraAction?: (rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent?: string | null }[], clear: () => void) => ReactNode;
  table: TableKey; domain?: string; keyword?: string; status: SeoStatus | undefined;
  onExplore?: (domain: string) => void;
  /** Keyword tables: track the ticked keywords (the page supplies the site). */
  /** Resolves when the keywords are tracked, rejects when they are not: the button waits for it, and only then are the ticks of the rows that were sent removed. */
  onTrack?: (rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null }[]) => Promise<unknown>;
  trackLabel?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const target = (domain ?? keyword ?? "").trim();
  // The address, as words (only when the filters live there). The same object for the same address, so effects settle.
  const search = useSearch();
  const address = useMemo<Record<string, string | undefined>>(() => (linked ? Object.fromEntries(new URLSearchParams(search)) : {}), [linked, search]);
  const arrived = useMemo(() => (linked ? filtersFromAddress(table, address, domain) : { filters: {} as Filters, scope: null as Scope | null }), [linked, table, address, domain]);
  const [sort, setSort] = useState(() => sortKeyOf(table, linked ? address.sort : null));
  const [draft, setDraft] = useState<Filters>(arrived.filters);
  const [filters, setFilters] = useState<Filters>(arrived.filters);
  /** The section or page the report is narrowed to: what is typed, and what was applied. */
  const [scopeDraft, setScopeDraft] = useState<{ text: string; exact: boolean }>({ text: arrived.scope?.path ?? "", exact: arrived.scope?.exact ?? false });
  const [scope, setScope] = useState<Scope | null>(arrived.scope);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState<25 | 50 | 100>(50);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** A tracking request is on its way: the button waits, and the ticks are cleared only when it has succeeded. */
  const [tracking, setTracking] = useState(false);
  // A different report or target starts clean — or, when the filters live in the address, as the address says. The
  // address also changes when a link is followed while this report is open, or the back button is pressed: the filters
  // follow it (nothing is set when they already match, so an "Apply filters" that wrote the address settles at once).
  const arrivedKey = JSON.stringify(arrived);
  // The order: the address's when the filters live there (a date cell links the list newest first), else the default.
  const addressSort = linked ? address.sort ?? null : null;
  useEffect(() => { setSort(sortKeyOf(table, addressSort)); }, [table, target, addressSort]);
  const chooseSort = (key: string) => { setSort(key); setOffset(0); if (linked) setParam("sort", key === SORT_LABELS[table][0][0] ? null : key); };
  useEffect(() => {
    setScopeError(null);
    const next = linked ? arrived : { filters: {} as Filters, scope: null as Scope | null };
    setFilters((f) => (JSON.stringify(f) === JSON.stringify(next.filters) ? f : next.filters));
    setDraft((d) => (JSON.stringify(d) === JSON.stringify(next.filters) ? d : next.filters));
    setScope((sc) => (JSON.stringify(sc) === JSON.stringify(next.scope) ? sc : next.scope));
    setScopeDraft((sd) => { const want = { text: next.scope?.path ?? "", exact: next.scope?.exact ?? false }; return sd.text === want.text && sd.exact === want.exact ? sd : want; });
    setOffset(0); setPicked(new Set());
  }, [table, target, linked, arrivedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const scoped = !!domain && SCOPED.has(table);
  // Belt and braces with the remount: a sort the report does not have is never sent.
  const sortKey = sortKeyOf(table, sort);
  const loc = market && BY_COUNTRY.has(table) ? market.locationCode : undefined, lang = market && BY_COUNTRY.has(table) ? market.languageCode : undefined;
  const body = useMemo(() => ({ ...(domain ? { domain } : { keyword }), table, sort: sortKey, filters, limit, offset, ...(loc ? { locationCode: loc, languageCode: lang } : {}), ...(scoped && scope ? { path: scope.path, exactPage: scope.exact } : {}) }), [domain, keyword, table, sortKey, filters, limit, offset, loc, lang, scoped, scope]);
  const queryKey = ["/api/seo/report", body];
  const saved = useQuery<{ page: Page } | null>({
    queryKey, enabled: !!target, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/report", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const rowsOf = saved.data?.page?.fetchedAt ?? null;
  const rowsRef = useRef(rowsOf);
  rowsRef.current = rowsOf;
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
    let nextScope = scope;
    if (scoped) {
      const typed = scopeDraft.text.trim();
      const parsed = typed ? scopePathOf(typed, domain!) : null;
      if (parsed && "error" in parsed) { setScopeError(parsed.error); return; }
      if (scopeDraft.exact && !parsed) { setScopeError("Say which page: a path such as /services/roofing."); return; }
      setScopeError(null);
      nextScope = parsed ? canonicalScope(parsed.path, scopeDraft.exact) : null;
      setScope(nextScope);
    }
    const next = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined && v !== "" && v !== false)) as Filters;
    setFilters(next); setOffset(0); setPicked(new Set());
    // A picked filter is the same thing as a link: it goes in the address (one step for the back button).
    if (linked) setParams(addressFromFilters(table, next, nextScope));
  };
  /** The scope goes, on the page and — when the filters live there — in the address. */
  const wholeSite = () => { setScope(null); setScopeDraft({ text: "", exact: false }); setOffset(0); setPicked(new Set()); if (linked) setParams({ path: null, section: null }); };
  /** Everything that narrows the list goes, on the page and in the address (a month picked on the chart with it). */
  const clearAll = () => {
    setFilters({}); setDraft({}); setScope(null); setScopeDraft({ text: "", exact: false }); setScopeError(null); setOffset(0); setPicked(new Set());
    if (linked) setParams({ ...addressFromFilters(table, {}, null), month: null });
  };
  /** What narrows the list, in words — the applied filters and scope, and what the address asks for that this list cannot be split by. */
  const words = filterWords(table, filters, scope, address, sortKey);
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
          <select className="g-input g-select !w-auto !py-1" value={sort} onChange={(e) => chooseSort(e.target.value)} data-testid="report-sort">
            {SORT_LABELS[table].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="g-text-2 flex items-center gap-1 text-[12px]">Rows
          <select className="g-input g-select !w-auto !py-1" value={limit} onChange={(e) => { setLimit(Number(e.target.value) as 25 | 50 | 100); setOffset(0); }} data-testid="report-limit">
            <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
        {(scoped || Object.keys(HAS).some((f) => has(f))) && <button type="submit" className="g-pill min-h-[44px]" data-testid="button-apply-filters">Apply filters</button>}
      </form>
      {words.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2" role="status">
          <span className="inline-flex min-h-[44px] max-w-full items-center rounded-full px-3 py-1 text-[13px] leading-5" style={{ color: "var(--g-blue)", background: "var(--g-accent-soft)" }} data-testid="active-filter">{words.join(" · ")}</span>
          <button type="button" className="g-pill min-h-[44px]" onClick={clearAll} aria-label="Clear the filters" data-testid="button-clear-filters"><X /> Clear</button>
        </div>
      )}
      {scopeError && <p id={`scope-error-${table}`} className="mb-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="scope-error">{scopeError}</p>}
      {scoped && scope && (
        <p className="g-text mb-2 text-[13px]" role="status" data-testid="text-scope">
          Narrowed to {scope.exact ? "the page" : "the section"} <b className="font-medium">{domain}{scope.path}</b>
          {scope.exact ? (scope.path.includes("?") ? " — that address exactly as written" : " — with or without its last slash") : ` — that page and everything under it (${scope.path}/…), not paths that merely begin the same`}, on {domain} with or without "www"; sub-domains are not included. A narrowed report is saved, and paid for, separately from the whole site's.{" "}
          <button type="button" className={FIG} onClick={wholeSite} data-testid="button-scope-clear">Show the whole site</button>
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
                  const sent = page.rows.filter((r) => picked.has(r.keyword)), sentKeys = new Set(sent.map((r) => r.keyword)), rowsThen = rowsOf;
                  setTracking(true);
                  // On success only the ticks that were SENT go — one ticked while it was on its way stays — and only if the
                  // rows on screen are still the ones they were sent from. On failure every tick stays for another try.
                  onTrack(sent).then(() => { if (rowsThen === rowsRef.current) setPicked((now) => new Set([...now].filter((k) => !sentKeys.has(k)))); }, () => {}).finally(() => setTracking(false));
                }}>{tracking ? "Tracking…" : `${trackLabel ?? "Track"} (${page.rows.filter((r) => picked.has(r.keyword)).length})`}</Button>
              )}
              <button type="button" className="g-pill min-h-[44px]" disabled={!page.rows.length} onClick={download} data-testid="button-export-csv"><Download /> Export CSV</button>
            </span>
          </div>
          {page.rows.length === 0 ? <Empty testId="report-empty">{scoped && scope ? <>Nothing {Object.keys(filters).length ? "matches these filters" : "was found"} for {scope.exact ? "the page" : "the section"} {domain}{scope.path}. <button type="button" className={FIG} onClick={wholeSite} data-testid="button-scope-clear-empty">Show the whole site</button></> : Object.keys(filters).length ? "Nothing matches. Try wider filters." : EMPTY_NOTE[table] ?? "Nothing was found for this site."}</Empty> : (
            <div className="overflow-x-auto">
              <table className="g-table" data-testid={`table-${table}`}>
                <thead><tr>{trackable && <th className="w-8"></th>}{cols.map((c) => <th key={c.key} className={c.num ? "num" : undefined}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {page.rows.map((r, i) => (
                    <tr key={`${r.keyword ?? r.url ?? r.domain ?? r.anchor}-${i}`}>
                      {trackable && <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>}
                      {cols.map((c, j) => <td key={c.key} className={c.num ? "num" : undefined} data-label={j ? c.label : undefined}>{c.cell(r, { target, onExplore, domain, table, market, siteId })}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <button type="button" className="g-pill min-h-[44px]" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-prev-page">← Previous</button>
            <button type="button" className="g-pill min-h-[44px]" disabled={(page.sourceRows ?? page.rows.length) < limit || (page.total != null && to >= page.total) || offset + limit > 9900} onClick={() => setOffset(offset + limit)} data-testid="button-next-page">Next →</button>
            <span className="g-text-2">{whole ? "Paging through these is free." : `A page you haven't opened yet costs about ${price}.`}</span>
          </div>
        </>
      )}
    </div>
  );
}
