/**
 * The SEO tool's navigation: the tools of the rail / top bar and each tool's sub-navigation (components/tool/shell).
 *
 * Built ONLY from views that exist: every entry is a route of App.tsx plus query parameters the page already reads
 * (pages/seo/links.ts names them all; server/seo/tool-nav.test.ts checks each entry against the page's own lists —
 * the explorer's report menu, the audit's tabs, the alert kinds, the mentions tabs, the rank tracker's panels). No
 * entry is a placeholder. A page's chosen site (?site=), domain (?domain=), keyword (?keyword=) and search (?q=)
 * carry from the address the visitor is on.
 */
import { Activity, Bell, BookOpenText, Bot, ClipboardList, FileBarChart, Gauge, Globe, Grid3X3, KeyRound, LayoutDashboard, Stethoscope } from "lucide-react";
import type { ToolNavCtx, ToolShellConfig, ToolSubGroup } from "@/components/tool/shell";
import { seoLinks } from "@/pages/seo/links";

/** Each tool's plain address, from links.ts (the one place SEO addresses are written; no site in them). */
const HOME = {
  dashboard: seoLinks.dashboard(), explorer: seoLinks.explorer(""), keywords: seoLinks.keywords(""), content: seoLinks.content(""),
  rank: seoLinks.rankTrackerHome(), grid: seoLinks.localGridHome(), plan: seoLinks.planHome(), audit: seoLinks.auditHome(), ai: seoLinks.aiHome(),
  alerts: seoLinks.alerts(), reports: seoLinks.reportsHome(), backlinks: seoLinks.backlinksHome(), batch: seoLinks.batch(), usage: seoLinks.usage(),
  // No plain builder for these two: the route of a site's address, without the site.
  mentions: seoLinks.mentions(0).split("?")[0], competitors: seoLinks.competitors(0).split("?")[0],
} as const;

const q = (path: string, params: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `${path}?${s}` : path;
};
const site = (c: ToolNavCtx) => c.params.get("site");

/** Site explorer's reports, grouped; the keys are explorer.tsx's own `view` keys. */
export const EXPLORER_VIEWS: { key: string; label?: string; items: [string, string][] }[] = [
  { key: "main", items: [["overview", "Overview"], ["opportunities", "Opportunities"]] },
  { key: "backlinks", label: "Backlink profile", items: [["backlinks", "Backlinks"], ["newBacklinks", "New backlinks"], ["lostBacklinks", "Lost backlinks"], ["brokenBacklinks", "Broken backlinks"], ["referringDomains", "Referring domains"], ["anchors", "Anchors"], ["referringIps", "Referring IPs"], ["mentions", "Mentions"], ["directories", "Directories"]] },
  { key: "organic", label: "Organic search", items: [["keywords", "Organic keywords"], ["pages", "Top pages"], ["competitors", "Organic competitors"], ["subdomains", "Subdomains"]] },
  { key: "paid", label: "Paid search", items: [["paidKeywords", "Paid keywords"], ["ads", "Ads"]] },
  { key: "pages", label: "Pages", items: [["bestByLinks", "Best pages by links"]] },
  { key: "compare", label: "Competitive analysis", items: [["contentGap", "Content gap"], ["linkIntersect", "Link intersect"], ["linkCompetitors", "Sites with similar links"]] },
];
export const AUDIT_TABS: [string, string][] = [["issues", "Issues"], ["pages", "Pages"], ["links", "Internal links"], ["outgoing", "Outgoing links"], ["rendering", "Rendering"]];
export const AUDIT_PAGE_SHOWS: [string, string][] = [["errors", "Pages with errors"], ["redirected", "Redirected"], ["notIndexable", "Not indexable"], ["canonical", "Canonical elsewhere"], ["orphans", "Orphan pages"], ["deep", "Deep pages"], ["thin", "Thin pages"], ["noTitle", "No title"], ["noDescription", "No description"]];
export const RANK_PANELS: [string, string][] = [["keywords", "Keywords"], ["history", "History"], ["tags", "Tags"], ["competitors", "Competitors"], ["groups", "Results groups"], ["gsc", "Search Console"], ["competing", "Competing pages"]];
export const ALERT_KINDS: [string, string][] = [["rank_drop", "Rankings fell"], ["rank_gain", "Rankings improved"], ["links_lost", "Links lost"], ["links_gained", "Links gained"], ["grid_down", "Local grid worse"], ["grid_up", "Local grid better"], ["kw_new", "Searches newly seen"], ["kw_lost", "Searches no longer seen"], ["mention_new", "New mentions"]];
export const MENTION_TABS: [string, string][] = [["prospects", "Likely you, no link"], ["yours", "Likely you"], ["unsure", "Name only"], ["linked", "Links to you"], ["notMine", "Marked not you"], ["all", "All"]];
export const PLAN_KINDS: [string, string][] = [["keyword", "Keywords"], ["page", "New pages"], ["link_reclaim", "Win back a link"], ["link_prospect", "Ask for a link"], ["audit", "Site fixes"], ["other", "Other"]];
export const REPORT_SECTIONS: [string, string][] = [["rankings", "Rankings"], ["fixes", "What to fix first"], ["work", "Work done"], ["visibility", "Visibility by tag"], ["grid", "Local grid"]];
export const BACKLINK_SECTIONS: [string, string][] = [["lost", "Lost links"], ["new", "New links"], ["strongest", "Strongest links"], ["all", "All links"]];
export const KEYWORD_VIEWS: [string, string][] = [["bulk", "Many keywords"], ["area", "Service × town"], ["lists", "My lists"]];
export const KEYWORD_SECTIONS: [string, string][] = [["volume", "Searches by month"], ["serp", "Who ranks"], ["features", "On the results page"], ["ideas", "Keyword ideas"]];
export const DASHBOARD_SORTS: [string, string][] = [["traffic", "Most search traffic"], ["authority", "Highest authority"], ["keywords", "Most tracked keywords"], ["top10", "Most in the top 10"], ["tasks", "Most open tasks"], ["health", "Lowest health first"]];

/**
 * The SEO tool shell's config. `domain` is the chosen site's domain: Site explorer opens on it when the address names
 * no domain of its own (the saved report shows; arriving never buys data).
 */
export function seoNav(chosen: { domain?: string | null } = {}): ToolShellConfig {
  const domain = (c: ToolNavCtx) => (c.path === HOME.explorer ? c.params.get("domain") : null) ?? chosen.domain ?? undefined;
  const explorer = (view?: string) => (c: ToolNavCtx) => q(HOME.explorer, { domain: domain(c), view: view === "overview" ? undefined : view, locationCode: c.path === HOME.explorer ? c.params.get("locationCode") : undefined, languageCode: c.path === HOME.explorer ? c.params.get("languageCode") : undefined });
  const audit = (p: Record<string, string | undefined> = {}) => (c: ToolNavCtx) => q(HOME.audit, { site: site(c), ...p });
  const rank = (p: Record<string, string | undefined> = {}) => (c: ToolNavCtx) => q(HOME.rank, { site: site(c), ...p });
  const keyword = (c: ToolNavCtx) => (c.path === HOME.keywords ? c.params.get("keyword") : null);
  const market = (c: ToolNavCtx) => (c.path === HOME.keywords ? { locationCode: c.params.get("locationCode"), languageCode: c.params.get("languageCode") } : {});
  const hasKeyword = (c: ToolNavCtx) => !!keyword(c) && !c.params.get("view");
  const explorerGroups: ToolSubGroup[] = EXPLORER_VIEWS.map((g) => ({ key: g.key, label: g.label, items: g.items.map(([view, label]) => ({ key: view, label, to: explorer(view), params: view === "overview" ? undefined : { view } })) }));
  // The tracked site's own backlink monitor and the batch tool are routes of their own; they belong with the explorer.
  explorerGroups.push({ key: "monitor", label: "Monitored backlinks", items: [{ key: "monitor", label: "This site's links", path: HOME.backlinks, to: (c) => q(HOME.backlinks, { site: site(c) }) }, ...BACKLINK_SECTIONS.map(([section, label]) => ({ key: `monitor-${section}`, label, path: HOME.backlinks, to: (c: ToolNavCtx) => q(HOME.backlinks, { site: site(c), section }), params: { section } }))] });
  explorerGroups.push({ key: "more", label: "More", items: [{ key: "batch", label: "Batch analysis", path: HOME.batch, to: () => HOME.batch }] });
  return {
    key: "seo", label: "SEO",
    tools: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: HOME.dashboard, to: () => HOME.dashboard, groups: [
        { key: "main", items: [{ key: "all", label: "All sites", to: () => HOME.dashboard }, { key: "analysed", label: "Analysed sites", to: () => `${HOME.dashboard}?filter=analysed`, params: { filter: "analysed" } }, { key: "crawled", label: "Crawled sites", to: () => `${HOME.dashboard}?filter=crawled`, params: { filter: "crawled" } }] },
        { key: "order", label: "Order by", items: DASHBOARD_SORTS.map(([sort, label]) => ({ key: `sort-${sort}`, label, to: (c: ToolNavCtx) => q(HOME.dashboard, { group: c.path === HOME.dashboard ? c.params.get("group") : undefined, sort }), params: { sort } })) },
      ] },
      { key: "explorer", label: "Site explorer", rail: "Site explorer", icon: Globe, path: HOME.explorer, paths: [HOME.backlinks, HOME.batch], to: explorer(), groups: explorerGroups },
      { key: "keywords", label: "Keywords explorer", rail: "Keywords", icon: KeyRound, path: HOME.keywords, to: () => HOME.keywords, groups: [
        { key: "main", items: [{ key: "one", label: "One keyword", to: (c) => q(HOME.keywords, { keyword: keyword(c), ...market(c) }) }, ...KEYWORD_VIEWS.map(([view, label]) => ({ key: view, label, to: (c: ToolNavCtx) => q(HOME.keywords, { keyword: keyword(c), view }), params: { view } }))] },
        { key: "sections", label: "This keyword", when: hasKeyword, items: KEYWORD_SECTIONS.map(([section, label]) => ({ key: `section-${section}`, label, to: (c: ToolNavCtx) => q(HOME.keywords, { keyword: keyword(c), ...market(c), section }), params: { section } })) },
      ] },
      { key: "content", label: "Content explorer", rail: "Content", icon: BookOpenText, path: HOME.content, to: () => HOME.content, groups: [] },
      { key: "rank", label: "Rank tracker", icon: Activity, path: HOME.rank, paths: [HOME.competitors], to: rank(), groups: [
        { key: "main", items: [{ key: "overview", label: "Overview", to: rank() }, ...RANK_PANELS.map(([panel, label]) => ({ key: panel, label, to: rank({ panel }), params: { panel } }))] },
        { key: "positions", label: "Positions", items: [{ key: "band-top3", label: "In the top 3", to: rank({ band: "top3" }), params: { band: "top3" } }, { key: "band-top10", label: "In the top 10", to: rank({ band: "top10" }), params: { band: "top10" } }, { key: "band-notFound", label: "Not found", to: rank({ band: "notFound" }), params: { band: "notFound" } }] },
        { key: "moves", label: "Since the last check", items: [{ key: "move-up", label: "Moved up", to: rank({ move: "up" }), params: { move: "up" } }, { key: "move-down", label: "Moved down", to: rank({ move: "down" }), params: { move: "down" } }, { key: "move-new", label: "Newly found", to: rank({ move: "new" }), params: { move: "new" } }, { key: "move-lost", label: "No longer found", to: rank({ move: "lost" }), params: { move: "lost" } }] },
        { key: "rivals", label: "Competitors", items: [{ key: "competitors-page", label: "Compare a competitor", path: HOME.competitors, to: (c) => q(HOME.competitors, { site: site(c) }) }] },
      ] },
      { key: "grid", label: "Local grid", icon: Grid3X3, path: HOME.grid, to: (c) => q(HOME.grid, { site: site(c) }), groups: [] },
      { key: "audit", label: "Site audit", icon: Stethoscope, path: HOME.audit, to: audit(), groups: [
        { key: "main", items: AUDIT_TABS.map(([tab, label]) => ({ key: tab, label, to: audit({ tab: tab === "issues" ? undefined : tab }), params: tab === "issues" ? undefined : { tab } })) },
        { key: "severity", label: "Issues by severity", items: [["error", "Errors"], ["warning", "Warnings"], ["notice", "Notices"]].map(([severity, label]) => ({ key: `severity-${severity}`, label, to: audit({ severity }), params: { severity } })) },
        { key: "status", label: "Pages by answer", items: [["2xx", "OK (2xx)"], ["3xx", "Redirects (3xx)"], ["4xx", "Broken (4xx)"], ["5xx", "Server errors (5xx)"]].map(([status, label]) => ({ key: `status-${status}`, label, to: audit({ tab: "pages", status }), params: { tab: "pages", status } })) },
        { key: "show", label: "Pages to look at", items: AUDIT_PAGE_SHOWS.map(([show, label]) => ({ key: `show-${show}`, label, to: audit({ tab: "pages", show }), params: { tab: "pages", show } })) },
      ] },
      { key: "ai", label: "AI visibility", rail: "AI visibility", icon: Bot, path: HOME.ai, to: (c) => q(HOME.ai, { site: site(c) }), groups: [
        { key: "main", items: [{ key: "all", label: "All answers", to: (c) => q(HOME.ai, { site: site(c) }) }, { key: "latest", label: "Newest answers", to: (c) => q(HOME.ai, { site: site(c), latest: "true" }), params: { latest: "true" } }, { key: "named", label: "Named the business", to: (c) => q(HOME.ai, { site: site(c), named: "true" }), params: { named: "true" } }, { key: "cited", label: "Used the website", to: (c) => q(HOME.ai, { site: site(c), cited: "true" }), params: { cited: "true" } }, { key: "first", label: "Named it first", to: (c) => q(HOME.ai, { site: site(c), first: "true" }), params: { first: "true" } }] },
      ] },
      { key: "plan", label: "Action plan", icon: ClipboardList, path: HOME.plan, to: (c) => q(HOME.plan, { site: site(c) }), groups: [
        { key: "main", items: [{ key: "open", label: "Open tasks", to: (c) => q(HOME.plan, { site: site(c) }) }, { key: "overdue", label: "Past due", to: (c) => q(HOME.plan, { site: site(c), status: "overdue" }), params: { status: "overdue" } }, { key: "soon", label: "Due this week", to: (c) => q(HOME.plan, { site: site(c), due: "soon" }), params: { due: "soon" } }, { key: "closed", label: "Done and dropped", to: (c) => q(HOME.plan, { site: site(c), status: "closed" }), params: { status: "closed" } }] },
        { key: "kind", label: "Kind of task", items: PLAN_KINDS.map(([kind, label]) => ({ key: `kind-${kind}`, label, to: (c: ToolNavCtx) => q(HOME.plan, { site: site(c), kind }), params: { kind } })) },
      ] },
      { key: "alerts", label: "Alerts", icon: Bell, path: HOME.alerts, paths: [HOME.mentions], to: () => HOME.alerts, groups: [
        { key: "main", items: [{ key: "all", label: "All alerts", to: (c) => q(HOME.alerts, { site: c.path === HOME.alerts ? site(c) : undefined }) }, ...ALERT_KINDS.map(([kind, label]) => ({ key: kind, label, to: (c: ToolNavCtx) => q(HOME.alerts, { site: c.path === HOME.alerts ? site(c) : undefined, kind }), params: { kind } }))] },
        { key: "mentions", label: "Mentions", items: MENTION_TABS.map(([tab, label]) => ({ key: `mentions-${tab}`, label, path: HOME.mentions, to: (c: ToolNavCtx) => q(HOME.mentions, { site: site(c), tab: tab === "prospects" ? undefined : tab }), params: tab === "prospects" ? undefined : { tab } })) },
      ] },
      { key: "reports", label: "Reports", icon: FileBarChart, path: HOME.reports, to: (c) => q(HOME.reports, { site: site(c) }), groups: [
        { key: "main", items: [{ key: "whole", label: "The whole report", to: (c) => q(HOME.reports, { site: site(c) }) }, ...REPORT_SECTIONS.map(([section, label]) => ({ key: section, label, to: (c: ToolNavCtx) => q(HOME.reports, { site: site(c), section }), params: { section } }))] },
      ] },
      { key: "usage", label: "Usage", rail: "Usage & credit", icon: Gauge, path: HOME.usage, foot: true, to: () => HOME.usage, groups: [] },
    ],
  };
}

/**
 * Tab rows on the pages that only repeat the sub-navigation. While the sub-navigation is open beside the page they
 * are hidden (styles/tool.css reads these `aria-label`s / test ids); with it collapsed, or as a drawer, they show.
 */
export const DUPLICATED_ROWS = ["Keywords explorer views", "Audit views"] as const;
