/**
 * /seo — Projects dashboard: one card per site with its authority, referring
 * domains, organic traffic and keywords (with their trend), and where its
 * tracked keywords rank. Everything shown is already saved, so opening this
 * page never spends SEO data; "Analyse" / "Refresh" on a card buys a new
 * Site Explorer report for that site.
 *
 * Every figure here — number, count, change, date, legend entry — is a link
 * to its data (links.ts): a figure on a card opens that site's explorer
 * report, audit or rank tracker narrowed to the figure; a figure in the
 * portfolio strip or the group line reorders or narrows the list below. The
 * order, group and filter live in the address (?sort, ?group, ?filter), so a
 * link from anywhere lands on the same list; a chip says what narrows it,
 * whether that came by address or was remembered from a visit before. Every
 * link is at least 44px tall and underlined without hover (the owner's phone).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { BarChart3, CheckCircle2, Circle, Loader2, RefreshCw, ScanSearch, Star, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { holdNote } from "./shell";
import { api, canAfford, Empty, fmtDate, fmtNum, money, SeoShell, useAddress, useHash, useSelectedSite, useSeoSites, useSeoStatus, type SeoSite } from "./shell";
import { seoLinks, setParam, type PositionBand } from "./links";
import { compact, DeltaBadge, DistributionBar, FigureLink, FOCUS, GradientSpark, LINK_CUE, MetricColumn, monthLabel, PALETTE, ScoreBadge, StatTile, TAP, TrendPanel, type TrendPoint } from "./viz";

type SortKey = "added" | "name" | "traffic" | "authority" | "keywords" | "top10" | "tasks" | "health";
const SORTS: [SortKey, string][] = [["added", "As added"], ["name", "Name"], ["traffic", "Most search traffic"], ["authority", "Highest authority"], ["keywords", "Most tracked keywords"], ["top10", "Most keywords in the top 10"], ["tasks", "Most open tasks"], ["health", "Lowest site health first"]];
const isSort = (v: unknown): v is SortKey => SORTS.some(([k]) => k === v);
/** ?filter= keeps only the sites with a saved report (analysed) or a finished crawl (crawled) — the words the chip shows. */
type Filter = "analysed" | "crawled";
const FILTER_WORDS: Record<Filter, string> = { analysed: "Analysed sites", crawled: "Crawled sites" };
const isFilter = (v: unknown): v is Filter => v === "analysed" || v === "crawled";
/** The group filter's key: "all", "none" (sites in no group) or "g:" + the group's name in lower case — a group's own name can never be mistaken for a choice, and "Roofing" and "roofing" are one group. */
const groupKey = (g: string) => `g:${g.toLowerCase()}`;
/** A pill that is a link, tall enough for a thumb. */
const PILL = `g-pill g-pill--sm !min-h-[44px] ${FOCUS}`;
type Card = {
  site: SeoSite;
  /** From the site's own crawls (Site audit): the newest finished crawl, and the newest few oldest first (gaps included). */
  audit: (HealthPoint & { trend: HealthPoint[] }) | null;
  /** null = the count could not be read just now. */
  openTasks?: number | null;
  /** Each keyword's newest check on ONE device (`device`), between `firstOn` and `checkedOn`. */
  rank: { top3: number; top10: number; ranked: number; checked: number; checkedOn: string | null; firstOn?: string | null; device?: "desktop" | "mobile" | null };
  report: {
    fetchedAt: string; authority: number | null; backlinks: number | null; referringDomains: number | null;
    organicKeywords: number | null; organicTraffic: number | null; trafficValue: number | null; top3: number | null; top10: number | null;
    history: { month: string; traffic: number; keywords: number }[] | null;
    linkHistory: { month: string; referringDomains: number; authority: number | null }[] | null;
  } | null;
};

/** A series' change from its first to its last point (null when there is no series to speak of). */
const change = (xs: (number | null | undefined)[] | undefined) => { const v = (xs ?? []).filter((x): x is number => typeof x === "number"); return v.length > 1 ? v[v.length - 1] - v[0] : null; };
/** One crawl's health; readable false = the crawl could not be read (score not known). pages = what the score is out of. */
type HealthPoint = { jobId: string; at: string | null; readable: boolean; health: number | null; pages: number | null; errorPages: number | null; pageCap: number | null };
const healthWords = (p: HealthPoint) => (!p.readable ? "could not be read" : p.health === null ? "no page scored" : `health ${p.health}, ${fmtNum(p.errorPages ?? 0)} of ${fmtNum(p.pages ?? 0)} pages with errors`);
/** A change badge as a link: beside the number, 44px tall, underlined like every link. */
const CHANGE_LINK = `flex min-h-[44px] items-end self-stretch rounded-sm ${LINK_CUE}`;

/** A figure's change over the months shown, as a link to the explorer from the first of those months (nothing when there is no change). */
function Change({ value, href, testId }: { value: number | null; href: string; testId: string }) {
  if (value == null || !Number.isFinite(value) || Math.round(value) === 0) return null;
  return <Link href={href} className={CHANGE_LINK} data-testid={testId}><DeltaBadge value={value} label="Change over the months shown" /></Link>;
}

/**
 * Site health from the site's own crawls: the newest crawl's score, its move since the crawl just before it (only when
 * both have a score), and the last few crawls. Health is a share of the pages crawled, so a move can come from crawling
 * different pages — the sizes are said whenever they differ. The score opens the audit's issues, the pages with errors
 * its pages, a crawl (its date, its row in the list, the crawl before) that crawl, and the move the audit comparing the
 * two crawls.
 */
function HealthTile({ audit, siteId, onPick }: { audit: Card["audit"]; siteId: number; /** The audit page keeps a chosen site: told which before a link is followed. */ onPick?: () => void }) {
  const trend = audit?.trend ?? [];
  const prev = trend.length > 1 ? trend[trend.length - 2] : null;
  const move = audit?.health != null && prev?.health != null ? audit.health - prev.health : null;
  // Different page limits, or more than a tenth more or fewer pages scored (every crawl's size is in the list below).
  const sizesDiffer = !!audit && !!prev && prev.readable && audit.readable && (prev.pageCap !== audit.pageCap || Math.abs((prev.pages ?? 0) - (audit.pages ?? 0)) > 0.1 * Math.max(prev.pages ?? 0, audit.pages ?? 0));
  const crawl = (jobId: string) => seoLinks.audit(siteId, { at: jobId });
  const hint: ReactNode = !audit ? <>No crawl yet — run one in <FigureLink href={seoLinks.audit(siteId)} onClick={onPick} testId={`link-health-audit-${siteId}`}>Site audit</FigureLink></>
    : !audit.readable ? <>The newest crawl (<FigureLink href={crawl(audit.jobId)} onClick={onPick} testId={`link-health-crawled-${siteId}`}>{fmtDate(audit.at)}</FigureLink>) could not be read, so its score is not known</>
    : audit.health === null ? <>Crawled <FigureLink href={crawl(audit.jobId)} onClick={onPick} testId={`link-health-crawled-${siteId}`}>{fmtDate(audit.at)}</FigureLink> — no page could be scored</>
    : <>
      <FigureLink href={seoLinks.audit(siteId, { tab: "pages" })} onClick={onPick} testId={`link-health-pages-${siteId}`}>{fmtNum(audit.errorPages ?? 0)} of {fmtNum(audit.pages ?? 0)} pages with errors</FigureLink>
      {" · "}<FigureLink href={crawl(audit.jobId)} onClick={onPick} testId={`link-health-crawled-${siteId}`}>crawled {fmtDate(audit.at)}</FigureLink>
      {prev && move === null ? <> · <FigureLink href={crawl(prev.jobId)} onClick={onPick} testId={`link-health-before-${siteId}`}>the crawl before has no score</FigureLink></> : null}
      {sizesDiffer ? <> · <FigureLink href={crawl(prev!.jobId)} onClick={onPick} testId={`link-health-before-${siteId}`}>the crawl before scored {fmtNum(prev!.pages ?? 0)} pages{prev!.pageCap !== audit.pageCap ? ` (limit ${fmtNum(prev!.pageCap ?? 0)}, now ${fmtNum(audit.pageCap ?? 0)})` : ""}</FigureLink> — a move can come from crawling different pages, not only from fixes</> : null}
    </>;
  return (
    <MetricColumn label="Health score" testId={`metric-health-${siteId}`} href={seoLinks.audit(siteId, { tab: "issues" })} onClick={onPick} linkTestId={`link-health-${siteId}`}
      value={<ScoreBadge value={audit?.health ?? null} label={audit?.health == null ? "No health score" : `Site health ${audit.health} out of 100`} />}
      delta={move && audit && prev ? <Link href={seoLinks.audit(siteId, { at: audit.jobId, vs: prev.jobId })} onClick={onPick} className={CHANGE_LINK} data-testid={`link-health-move-${siteId}`}><DeltaBadge value={move} label={`${move > 0 ? "Up" : "Down"} ${Math.abs(move)} since the crawl before`} /></Link> : null}
      foot={hint}>
      {trend.length > 1 && (
        <details className="mt-1 text-[12px]" data-testid={`health-history-${siteId}`}>
          <summary className={`${TAP} ${LINK_CUE} cursor-pointer rounded-sm`} style={{ color: "var(--g-accent-ink)" }}>Last {trend.length} crawls</summary>
          <ul className="g-text-2 mt-1">{trend.slice().reverse().map((t, i) => <li key={t.jobId}><FigureLink href={crawl(t.jobId)} onClick={onPick} testId={`link-crawl-${siteId}-${i}`}>{fmtDate(t.at)}: {healthWords(t)}</FigureLink></li>)}</ul>
        </details>
      )}
    </MetricColumn>
  );
}

/** One step of filling a site's card: numbered, with its icon, what it gives, and whether it is done. */
function StartStep({ n, done, icon, color, title, text, children }: { n: number; done: boolean; icon: ReactNode; color: string; title: string; text: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }}>
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }} aria-hidden>{icon}</span>
        <span className="g-text-2 text-[11px] font-medium uppercase tracking-wide">Step {n}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: done ? "var(--g-green)" : "var(--g-text-2)" }}>
          {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Circle className="h-4 w-4" aria-hidden />}{done ? "Done" : "Not yet"}
        </span>
      </div>
      <h3 className="text-[15px] font-semibold" style={{ color: "var(--g-blue)" }}>{title}</h3>
      <p className="g-text-2 text-[13px] leading-5">{text}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{children}</div>
    </div>
  );
}

/** Scrolls to the site list (the portfolio strip's links end in #sites; a pushState never scrolls by itself). */
const scrollToSites = () => requestAnimationFrame(() => document.getElementById("sites")?.scrollIntoView({ behavior: "smooth", block: "start" }));

export default function SeoDashboardPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const dash = useQuery<{ cards: Card[] }>({ queryKey: ["/api/seo/dashboard"], refetchOnMount: "always", });
  const analyse = useMutation({
    mutationFn: (domain: string) => { const s = dash.data?.cards.find((c) => c.site.domain === domain)?.site; return api("POST", "/api/seo/explorer", { domain, refresh: true, locationCode: s?.locationCode, languageCode: s?.languageCode }); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/explorer/recent"] }); },
    onError: (e) => toast({ title: "Couldn't analyse that site", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // The address names the order, the group and the filter (links.ts `dashboard`): a link to "/seo?sort=traffic" lands
  // on the list in that order, the pickers write the same address (so the back button undoes a choice), and the
  // parameters are re-read whenever the address changes — a link on this page, a picker, or the back button.
  const address = useAddress();
  const url = { sort: address.get("sort"), group: address.get("group"), filter: address.get("filter") };
  // The order and the group are also remembered on this computer, for a visit with a bare address.
  const [savedSort, setSavedSort] = useState<SortKey>(() => { try { const v = window.localStorage.getItem("seo.dashboard.sort"); return isSort(v) ? v : "added"; } catch { return "added"; } });
  const sort: SortKey = isSort(url.sort) ? url.sort : savedSort;
  const chooseSort = (k: SortKey, replace = false) => { setSavedSort(k); try { window.localStorage.setItem("seo.dashboard.sort", k); } catch { /* private window */ } setParam("sort", k === "added" ? null : k, replace); };
  // Groups (a client, a region): the dashboard can show one group or all. ?group= is the group's name, or "none".
  const [savedGroup, setSavedGroup] = useState<string>(() => { try { return window.localStorage.getItem("seo.dashboard.groupFilter") ?? "all"; } catch { return "all"; } });
  const group = url.group ? (url.group === "none" ? "none" : groupKey(url.group)) : savedGroup;
  const filter: Filter | null = isFilter(url.filter) ? url.filter : null;
  const [editing, setEditing] = useState<number | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const setSiteGroup = useMutation({
    mutationFn: (v: { id: number; group: string | null }) => api("POST", `/api/seo/sites/${v.id}/settings`, { group: v.group }),
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); },
    onError: (e) => toast({ title: "Couldn't change the group", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const star = useMutation({
    mutationFn: (v: { id: number; starred: boolean }) => api("POST", `/api/seo/sites/${v.id}/star`, { starred: v.starred }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); },
    onError: (e) => toast({ title: "Couldn't change that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // Starred sites first, always; then the chosen order. A site with no number for that order goes last.
  const cards = useMemo(() => {
    const value = (c: Card): number | string | null => sort === "name" ? c.site.domain : sort === "traffic" ? c.report?.organicTraffic ?? null : sort === "authority" ? c.report?.authority ?? null : sort === "keywords" ? c.site.keywordCount ?? null : sort === "top10" ? (c.rank.checked ? c.rank.top10 : null) : sort === "tasks" ? c.openTasks ?? null : sort === "health" ? c.audit?.health ?? null : null;
    return [...(dash.data?.cards ?? [])].sort((a, b) => {
      if (!!a.site.starred !== !!b.site.starred) return a.site.starred ? -1 : 1;
      if (sort === "added") return 0;
      const x = value(a), y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return sort === "name" ? String(x).localeCompare(String(y)) : sort === "health" ? Number(x) - Number(y) : Number(y) - Number(x);
    });
  }, [dash.data, sort]);
  // Each group once (by name, any letter case), shown with the first spelling met.
  const groups = useMemo(() => { const m = new Map<string, string>(); for (const c of dash.data?.cards ?? []) if (c.site.group && !m.has(groupKey(c.site.group))) m.set(groupKey(c.site.group), c.site.group); return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])); }, [dash.data]);
  const anyUngrouped = (dash.data?.cards ?? []).some((c) => !c.site.group);
  const chooseGroup = (g: string, replace = false) => {
    setSavedGroup(g); try { window.localStorage.setItem("seo.dashboard.groupFilter", g); } catch { /* private window */ }
    setParam("group", g === "all" ? null : g === "none" ? "none" : groups.find(([k]) => k === g)?.[1] ?? g.replace(/^g:/, ""), replace);
  };
  // A choice (remembered or linked) that matches nothing any more shows everything — and is forgotten once the sites
  // have loaded, so it cannot come back by itself later.
  const valid = group === "all" || (group === "none" && anyUngrouped) || groups.some(([k]) => k === group);
  useEffect(() => { if (dash.isSuccess && !valid) chooseGroup("all", true); }, [dash.isSuccess, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeGroup = valid ? group : "all";
  const groupLabel = activeGroup === "none" ? "Not in a group" : groups.find(([k]) => k === activeGroup)?.[1] ?? "";
  const grouped = activeGroup === "all" ? cards : cards.filter((c) => (activeGroup === "none" ? !c.site.group : !!c.site.group && groupKey(c.site.group) === activeGroup));
  const shownCards = filter === "analysed" ? grouped.filter((c) => !!c.report) : filter === "crawled" ? grouped.filter((c) => !!c.audit) : grouped;
  // The group's totals, from the same numbers as its cards (tracked keywords checked, open tasks known).
  const totals = useMemo(() => {
    const checked = shownCards.filter((c) => c.rank.checked);
    const dates = checked.flatMap((c) => [c.rank.firstOn ?? c.rank.checkedOn, c.rank.checkedOn]).filter((d): d is string => !!d).sort();
    const devices = [...new Set(checked.map((c) => c.rank.device).filter(Boolean))];
    return { sites: shownCards.length, keywords: shownCards.reduce((n, c) => n + (c.site.keywordCount ?? 0), 0), top10: checked.reduce((n, c) => n + c.rank.top10, 0), checked: checked.length,
      from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, devices,
      openTasks: shownCards.some((c) => c.openTasks == null) ? null : shownCards.reduce((n, c) => n + (c.openTasks ?? 0), 0) };
  }, [shownCards]);
  const price = status.data?.prices ? money(status.data.prices.explorerReport) : "";
  const affordable = canAfford(status.data, "explorerReport");
  const configured = !!status.data?.configured;
  // Where a figure of the portfolio strip or the group line leads: this list, in another order or narrowed, the group kept.
  const groupParam = activeGroup === "all" ? undefined : activeGroup === "none" ? "none" : groupLabel;
  const listAt = (p: { sort?: SortKey; filter?: Filter }) => { const s = p.sort ?? sort, f = p.filter ?? filter ?? undefined; return seoLinks.dashboardSites({ group: groupParam, sort: s === "added" ? undefined : s, filter: f }); };
  // Open tasks are per site: one site's count opens its plan, a group's count orders the list by open tasks.
  const tasksAt = shownCards.length === 1 ? { href: seoLinks.plan(shownCards[0].site.id, { status: "open" }), onClick: () => onSite(shownCards[0].site.id) } : { href: listAt({ sort: "tasks" }), onClick: scrollToSites };
  // What narrows the list in the visitor's words — the effective narrowing, whether it came by address or was
  // remembered from a visit before — with one control that clears it all.
  const chip = [activeGroup !== "all" ? `Group: ${groupLabel}` : null, filter ? FILTER_WORDS[filter] : null, sort !== "added" ? `Order: ${SORTS.find(([k]) => k === sort)![1].replace(/^./, (c) => c.toLowerCase())}` : null].filter((x): x is string => !!x);
  const clearNarrowing = () => { setParam("filter", null); chooseSort("added", true); chooseGroup("all", true); };
  // Arriving at #sites (a link from the strip, from another page, or the back button) lands on the list once it is there.
  const hash = useHash();
  useEffect(() => { if (dash.isSuccess && hash === "sites") scrollToSites(); }, [dash.isSuccess, hash]);

  return (
    <SeoShell title="SEO" description="Your sites at a glance: authority, backlinks, estimated search traffic and rankings." site={site} onSite={onSite} sites={sites} status={status}>
      {dash.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your sites…</p>}
      {dash.isError && <div className="g-callout mb-4" role="alert" data-testid="seo-dashboard-error"><h3>Couldn't load your sites</h3><p>{apiErrorMessage(dash.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void dash.refetch()}>Try again</button></div>}
      {dash.isSuccess && cards.length === 0 && !sites.isError && (
        <Empty testId="seo-dashboard-empty">
          <h3>Add your first site</h3>
          <p>Use <b>Add your first site</b> above to start a project. You'll get its authority, backlinks, estimated organic traffic and keywords here, and weekly rank tracking for the keywords you choose.</p>
          <p className="mt-2">Just want to look a domain up? Open <FigureLink href={seoLinks.explorer("")} testId="link-explorer-empty">Site explorer</FigureLink> — any site, yours or a competitor's.</p>
        </Empty>
      )}
      {(cards.length > 1 || activeGroup !== "all" || chip.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <label className="g-text-2 flex items-center gap-2">Order
            <select className="g-input g-select !w-auto !py-1" value={sort} onChange={(e) => chooseSort(e.target.value as SortKey)} data-testid="select-dashboard-sort">
              {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          {groups.length > 0 && (
            <label className="g-text-2 flex min-w-0 max-w-full items-center gap-2">Group
              <select className="g-input g-select !w-auto min-w-0 max-w-[16rem] !py-1" value={activeGroup} onChange={(e) => chooseGroup(e.target.value)} data-testid="select-dashboard-group">
                <option value="all">All sites</option>
                {groups.map(([k, g]) => <option key={k} value={k}>{g}</option>)}
                {anyUngrouped && <option value="none">Not in a group</option>}
              </select>
            </label>
          )}
          {chip.length > 0 && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-3 pr-0.5 text-[12px] [overflow-wrap:anywhere]" style={{ borderColor: "var(--g-blue)", color: "var(--g-blue)", background: "var(--g-accent-soft)" }} role="status" data-testid="active-filter">
              {chip.join(" · ")}
              <button type="button" className={`grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-[color:var(--g-chip)] ${FOCUS}`} aria-label="Clear — all sites, as added" title="Clear — all sites, as added" onClick={clearNarrowing} data-testid="button-clear-filter"><X className="h-4 w-4" aria-hidden /></button>
            </span>
          )}
          <span className="g-text-2">Starred sites stay on top.</span>
        </div>
      )}
      {activeGroup !== "all" && (
        <p className="g-text mb-3 text-[13px] [overflow-wrap:anywhere]" data-testid="text-group-totals">
          <b className="font-medium">{groupLabel}</b>: <FigureLink href={listAt({})} onClick={scrollToSites} testId="link-totals-sites">{fmtNum(totals.sites)} site{totals.sites === 1 ? "" : "s"}</FigureLink>
          {" · "}<FigureLink href={listAt({ sort: "keywords" })} onClick={scrollToSites} testId="link-totals-keywords">{fmtNum(totals.keywords)} tracked keywords</FigureLink>
          {totals.checked ? <> · <FigureLink href={listAt({ sort: "top10" })} onClick={scrollToSites} testId="link-totals-top10">{fmtNum(totals.top10)} in the top 10 — each keyword's newest check{totals.devices.length === 1 ? ` on ${totals.devices[0]}` : " (desktop for sites that track it, else mobile)"}, {totals.from === totals.to ? fmtDate(totals.from) : `${fmtDate(totals.from)} to ${fmtDate(totals.to)}`}, {totals.checked} site{totals.checked === 1 ? "" : "s"}</FigureLink></> : null}
          {" · "}{totals.openTasks == null ? "open tasks not known" : <FigureLink href={tasksAt.href} onClick={tasksAt.onClick} testId="link-totals-tasks">{fmtNum(totals.openTasks)} open task{totals.openTasks === 1 ? "" : "s"}</FigureLink>}
        </p>
      )}
      <datalist id="seo-groups">{groups.map(([k, g]) => <option key={k} value={g} />)}</datalist>
      {shownCards.length >= 2 && (() => {
        // Totals across the sites shown, each from the sites that have the figure (and saying how many those are).
        // Each tile leads to the list below: in that figure's order, or narrowed to the sites it was made from. A foot
        // says "none yet" only when its own count is zero, never against the count beside it.
        const crawled = shownCards.filter((c) => !!c.audit), scored = shownCards.filter((c) => c.audit?.health != null);
        const analysed = shownCards.filter((c) => !!c.report), withTraffic = shownCards.filter((c) => c.report?.organicTraffic != null);
        const avgHealth = scored.length ? Math.round(scored.reduce((n, c) => n + (c.audit!.health as number), 0) / scored.length) : null;
        return (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="seo-portfolio">
            <StatTile label="Sites" color={PALETTE.domains} value={fmtNum(shownCards.length)} testId="tile-sites" href={listAt({})} onClick={scrollToSites} linkTestId="link-sites"
              foot={<><FigureLink href={listAt({ filter: "analysed" })} onClick={scrollToSites} testId="link-sites-analysed">{fmtNum(analysed.length)} analysed</FigureLink> · <FigureLink href={listAt({ filter: "crawled" })} onClick={scrollToSites} testId="link-sites-crawled">{fmtNum(crawled.length)} crawled</FigureLink></>} />
            <StatTile label="Average site health" color={PALETTE.health} value={<ScoreBadge value={avgHealth} />} testId="tile-health" href={listAt({ sort: "health" })} onClick={scrollToSites} linkTestId="link-health-average"
              foot={scored.length ? <FigureLink href={listAt({ filter: "crawled", sort: "health" })} onClick={scrollToSites} testId="link-health-scored">Of the {fmtNum(scored.length)} crawled site{scored.length === 1 ? "" : "s"}{scored.length < crawled.length ? " with a score" : ""}</FigureLink>
                : crawled.length ? <FigureLink href={listAt({ filter: "crawled" })} onClick={scrollToSites} testId="link-health-scored">{fmtNum(crawled.length)} crawled, no score yet</FigureLink> : "No site crawled yet"} />
            <StatTile label="Tracked keywords" color={PALETTE.tracked} value={fmtNum(totals.keywords)} testId="tile-tracked" href={listAt({ sort: "keywords" })} onClick={scrollToSites} linkTestId="link-tracked-total"
              foot={totals.checked ? <FigureLink href={listAt({ sort: "top10" })} onClick={scrollToSites} testId="link-top10-total">{fmtNum(totals.top10)} in the top 10 in the newest checks</FigureLink> : totals.keywords ? "No check saved yet" : "No keyword tracked yet"} />
            <StatTile label="Organic traffic (estimate)" color={PALETTE.traffic} value={withTraffic.length ? compact(withTraffic.reduce((n, c) => n + (c.report!.organicTraffic as number), 0)) : "—"} testId="tile-traffic" href={listAt({ sort: "traffic" })} onClick={scrollToSites} linkTestId="link-traffic-total"
              foot={withTraffic.length ? <FigureLink href={listAt({ filter: "analysed", sort: "traffic" })} onClick={scrollToSites} testId="link-traffic-analysed">Visits a month, {fmtNum(withTraffic.length)} analysed site{withTraffic.length === 1 ? "" : "s"} added up</FigureLink>
                : analysed.length ? <FigureLink href={listAt({ filter: "analysed" })} onClick={scrollToSites} testId="link-traffic-analysed">{fmtNum(analysed.length)} analysed, no traffic figure yet</FigureLink> : "No site analysed yet"} />
          </div>
        );
      })()}
      <div id="sites" className="scroll-mt-4 space-y-4" data-testid="seo-dashboard">
        {cards.length > 0 && shownCards.length === 0 && (filter || activeGroup !== "all") && <Empty testId="seo-dashboard-group-empty"><h3>No sites here</h3><p>{filter ? <>No {FILTER_WORDS[filter].toLowerCase()}{activeGroup !== "all" ? ` in ${groupLabel}` : ""} yet — </> : "Choose another group above, or "}<button type="button" className={`${TAP} ${LINK_CUE} rounded-sm`} style={{ color: "var(--g-accent-ink)" }} onClick={clearNarrowing}>show all sites</button>.</p></Empty>}
        {shownCards.map(({ site: s, rank, report: r, audit, openTasks }) => {
          const busy = analyse.isPending && analyse.variables === s.domain;
          // Where this site's figures lead. Arriving by any of these never buys data: the explorer shows the saved
          // report (or an Analyse button), the audit and the rank tracker what is stored.
          const ex = (view?: string, p?: { band?: PositionBand; month?: string }) => seoLinks.explorer(s.domain, view, p);
          const pick = () => onSite(s.id); // the audit, rank tracker and plan keep a chosen site: a link to one site's page also makes it the chosen site
          const pts = (xs: { month: string; value: number | null }[]): TrendPoint[] => xs.filter((h) => h.value != null).map((h) => ({ label: monthLabel(h.month), value: h.value as number, key: h.month }));
          const trafficPts = pts((r?.history ?? []).map((h) => ({ month: h.month, value: h.traffic })));
          const keywordPts = pts((r?.history ?? []).map((h) => ({ month: h.month, value: h.keywords })));
          const domainPts = pts((r?.linkHistory ?? []).map((h) => ({ month: h.month, value: h.referringDomains })));
          const authorityPts = pts((r?.linkHistory ?? []).map((h) => ({ month: h.month, value: h.authority })));
          const atMonth = (view: string) => (p: TrendPoint) => ex(view, { month: p.key });
          const since = (view: string, xs: TrendPoint[]) => ex(view, { month: xs[0]?.key });
          return (
            <section key={s.id} className="rounded-xl border p-3 shadow-sm sm:p-5" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={`card-site-${s.id}`}>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[16px] font-semibold uppercase" style={{ color: "var(--g-blue)", background: "var(--g-accent-soft)" }} aria-hidden>{s.domain.replace(/^www\./, "")[0]}</span>
                <button type="button" className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${FOCUS}`} aria-pressed={!!s.starred} aria-label={s.starred ? `Remove the star from ${s.domain}` : `Star ${s.domain} to keep it on top`} title={s.starred ? "Starred — stays on top" : "Star to keep on top"} disabled={star.isPending} onClick={() => star.mutate({ id: s.id, starred: !s.starred })} data-testid={`button-star-${s.id}`}>
                  <Star className="h-4 w-4" style={s.starred ? { fill: "#f9ab00", color: "#f9ab00" } : { color: "var(--g-text-2)" }} aria-hidden />
                </button>
                <div className="min-w-0">
                  <h2 className="g-text text-[18px] font-semibold leading-6 [overflow-wrap:anywhere]"><FigureLink href={ex()} testId={`link-domain-${s.id}`}>{s.domain}</FigureLink></h2>
                  <span className="g-text-2 text-[12px]">{r ? <FigureLink href={ex()} testId={`link-analysed-${s.id}`}>analysed {fmtDate(r.fetchedAt)}</FigureLink> : "not analysed yet"}</span>
                </div>
                {editing === s.id ? (
                  <form className="flex w-full min-w-0 flex-wrap items-center gap-1 sm:w-auto" onSubmit={(e) => { e.preventDefault(); setSiteGroup.mutate({ id: s.id, group: groupDraft.trim() || null }); }} data-testid={`form-group-${s.id}`}>
                    <label className="sr-only" htmlFor={`group-${s.id}`}>Group for {s.domain}</label>
                    <input id={`group-${s.id}`} className="g-input !h-11 w-40 min-w-0 max-w-full flex-1 !py-1 text-[13px] sm:flex-none" list="seo-groups" maxLength={40} value={groupDraft} onChange={(e) => setGroupDraft(e.target.value)} placeholder="e.g. Smith Roofing" autoFocus data-testid={`input-group-${s.id}`} />
                    <button type="submit" className={PILL} disabled={setSiteGroup.isPending}>Save</button>
                    <button type="button" className={PILL} onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" className={`g-chip g-chip--sm !min-h-[44px] max-w-full !whitespace-normal text-left !normal-case [overflow-wrap:anywhere] ${FOCUS}`} onClick={() => { setEditing(s.id); setGroupDraft(s.group ?? ""); }} aria-label={s.group ? `Group: ${s.group} — change` : `Put ${s.domain} in a group`} data-testid={`button-group-${s.id}`}>{s.group ? s.group : "+ Group"}</button>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                  <Link href={ex()} className={PILL} data-testid={`link-explore-${s.id}`}>Site explorer</Link>
                  <Link href={seoLinks.rankTracker(s.id)} className={PILL} onClick={pick} data-testid={`link-rank-${s.id}`}>Rank tracker</Link>
                  <Link href={seoLinks.audit(s.id)} className={PILL} onClick={pick} data-testid={`link-audit-${s.id}`}>Site audit{audit?.health != null ? ` · health ${audit.health}` : ""}</Link>
                  <Link href={seoLinks.plan(s.id)} className={PILL} onClick={pick} data-testid={`link-plan-${s.id}`}>Action plan{openTasks == null ? " · count unavailable" : openTasks ? ` · ${openTasks} open` : ""}</Link>
                  <button type="button" className={PILL} disabled={busy || !configured || !affordable} onClick={() => analyse.mutate(s.domain)} data-testid={`button-analyse-${s.id}`} title={`A new report costs about ${price} of your SEO data.${holdNote(status.data, "explorerReport")}`}>
                    {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {r ? "Refresh" : "Analyse"} · {price}
                  </button>
                </div>
              </div>
              {r ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-4 md:grid-cols-3 xl:grid-cols-6" style={{ borderColor: "var(--g-divider)" }}>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><HealthTile audit={audit} siteId={s.id} onPick={pick} /></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Authority" testId={`metric-authority-${s.id}`} href={ex()} linkTestId={`link-authority-${s.id}`} value={r.authority == null ? "—" : String(r.authority)}
                      delta={<Change value={change(authorityPts.map((p) => p.value))} href={since("overview", authorityPts)} testId={`link-authority-change-${s.id}`} />}
                      foot={<FigureLink href={ex("referringDomains")} testId={`link-authority-foot-${s.id}`}>0–100, from the sites linking to it</FigureLink>}
                      chart={<GradientSpark range height={48} points={authorityPts} color={PALETTE.authority} pointHref={atMonth("overview")} testId={`spark-authority-${s.id}`} />} /></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Referring domains" testId={`metric-domains-${s.id}`} href={ex("referringDomains")} linkTestId={`link-domains-${s.id}`} value={compact(r.referringDomains)}
                      delta={<Change value={change(domainPts.map((p) => p.value))} href={since("referringDomains", domainPts)} testId={`link-domains-change-${s.id}`} />}
                      foot={<FigureLink href={ex("backlinks")} testId={`link-backlinks-${s.id}`}>{compact(r.backlinks)} backlinks</FigureLink>}
                      chart={<GradientSpark range height={48} points={domainPts} color={PALETTE.domains} pointHref={atMonth("referringDomains")} testId={`spark-domains-${s.id}`} />} /></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Organic traffic (est.)" testId={`metric-traffic-${s.id}`} href={ex()} linkTestId={`link-traffic-${s.id}`} value={compact(r.organicTraffic)}
                      delta={<Change value={change(trafficPts.map((p) => p.value))} href={since("overview", trafficPts)} testId={`link-traffic-change-${s.id}`} />}
                      foot={<FigureLink href={ex("keywords")} testId={`link-traffic-value-${s.id}`}>Visits a month, estimated from rankings{r.trafficValue != null ? ` · value $${Math.round(r.trafficValue).toLocaleString("en-US")} / mo` : ""}</FigureLink>}
                      chart={<GradientSpark range height={48} points={trafficPts} color={PALETTE.traffic} pointHref={atMonth("overview")} testId={`spark-traffic-${s.id}`} />} /></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Organic keywords" testId={`metric-keywords-${s.id}`} href={ex("keywords")} linkTestId={`link-keywords-${s.id}`} value={compact(r.organicKeywords)}
                      delta={<Change value={change(keywordPts.map((p) => p.value))} href={since("keywords", keywordPts)} testId={`link-keywords-change-${s.id}`} />}
                      chart={<GradientSpark range height={48} points={keywordPts} color={PALETTE.keywords} pointHref={atMonth("keywords")} testId={`spark-keywords-${s.id}`} />}>
                      {r.top10 != null && r.top3 != null && r.organicKeywords != null && <div className="mt-1.5"><DistributionBar testId={`dist-keywords-${s.id}`} parts={[{ key: "top3", label: "Top 3", value: r.top3, color: PALETTE.top3 }, { key: "top10", label: "4–10", value: Math.max(0, r.top10 - r.top3), color: PALETTE.top10 }, { key: "rest", label: "11+", value: Math.max(0, r.organicKeywords - r.top10), color: PALETTE.rest }]} segmentHref={(k) => ex("keywords", { band: k as PositionBand })} /></div>}
                    </MetricColumn></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Tracked keywords" testId={`metric-tracked-${s.id}`} href={seoLinks.rankTracker(s.id)} onClick={pick} linkTestId={`link-tracked-${s.id}`} value={fmtNum(s.keywordCount)}
                      foot={rank.checked ? <FigureLink href={seoLinks.rankTracker(s.id, { device: rank.device ?? undefined })} onClick={pick} testId={`link-tracked-checked-${s.id}`}>{rank.device ? `On ${rank.device}` : "Newest checks"} · {rank.firstOn && rank.firstOn !== rank.checkedOn ? `checked ${fmtDate(rank.firstOn)} to ${fmtDate(rank.checkedOn)}` : `checked ${fmtDate(rank.checkedOn)}`}</FigureLink>
                        : s.keywordCount ? <FigureLink href={seoLinks.rankTracker(s.id)} onClick={pick} testId={`link-tracked-due-${s.id}`}>No check saved yet{s.nextRankCheckAt ? ` — the first automatic check is due ${fmtDate(s.nextRankCheckAt)}` : ""}; it is skipped while this month's included data is used up</FigureLink> : "None yet"}>
                      {rank.checked > 0 ? <div className="mt-1.5"><DistributionBar testId={`dist-tracked-${s.id}`} parts={[{ key: "top3", label: "Top 3", value: rank.top3, color: PALETTE.top3 }, { key: "top10", label: "4–10", value: Math.max(0, rank.top10 - rank.top3), color: PALETTE.top10 }, { key: "rest", label: "Below 10 or not found", value: Math.max(0, rank.checked - rank.top10), color: PALETTE.rest }]} segmentHref={(k) => seoLinks.rankTracker(s.id, { band: k as PositionBand })} onSegment={pick} /></div>
                        : !s.keywordCount && <Link href={seoLinks.rankTracker(s.id)} className={`${PILL} mt-2 self-start`} onClick={pick} data-testid={`link-add-keywords-${s.id}`}>Add keywords</Link>}
                    </MetricColumn></div>
                  </div>
                  <TrendPanel title="Over time" testId={`trend-${s.id}`} note="Monthly. Traffic and keywords are estimates from the keyword database; referring domains and authority come from the backlink index. A point, or a month in the list, opens that month in Site explorer."
                    series={[
                      { key: "traffic", label: "Organic traffic (estimate)", color: PALETTE.traffic, points: trafficPts },
                      { key: "keywords", label: "Organic keywords", color: PALETTE.keywords, points: keywordPts },
                      { key: "domains", label: "Referring domains", color: PALETTE.domains, points: domainPts },
                      { key: "authority", label: "Authority", color: PALETTE.authority, points: authorityPts },
                    ]} pointHref={(_k, p) => ex("overview", { month: p.key })} />
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3" data-testid={`start-${s.id}`}>
                  {/* Three steps to fill this card; each says whether it is done. Nothing here is a figure until a step has run. */}
                  <StartStep n={1} done={false} icon={<BarChart3 className="h-5 w-5" />} color={PALETTE.traffic} title="Analyse the site"
                    text="Authority, backlinks, estimated search traffic, keywords and competitors — with two years of monthly history.">
                    <Button size="sm" className="min-h-[44px]" disabled={busy || !configured || !affordable} onClick={() => analyse.mutate(s.domain)} data-testid={`button-analyse-empty-${s.id}`}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Analyse — about {price}</Button>
                  </StartStep>
                  <StartStep n={2} done={(s.keywordCount ?? 0) > 0} icon={<Target className="h-5 w-5" />} color={PALETTE.traffic} title="Track your keywords"
                    text={(s.keywordCount ?? 0) > 0 ? <><FigureLink href={seoLinks.rankTracker(s.id)} onClick={pick} testId={`link-start-tracked-${s.id}`}>{fmtNum(s.keywordCount)} tracked</FigureLink> — checked every week by default.</> : "Your services and towns: where the site is found in Google and the map pack, every week."}>
                    <Link href={seoLinks.rankTracker(s.id)} className={PILL} onClick={pick} data-testid={`link-start-rank-${s.id}`}>Open Rank tracker</Link>
                  </StartStep>
                  <StartStep n={3} done={!!audit} icon={<ScanSearch className="h-5 w-5" />} color={PALETTE.traffic} title="Crawl the site"
                    text={audit ? <>Crawled — the health score and its issues are in <FigureLink href={seoLinks.audit(s.id)} onClick={pick} testId={`link-start-audit-${s.id}`}>Site audit</FigureLink>.</> : "Broken pages, redirects, titles, speed and what a crawler can read."}>
                    {audit ? <div className="w-full border-t pt-2" style={{ borderColor: "var(--g-divider)" }}><HealthTile audit={audit} siteId={s.id} onPick={pick} /></div> : <Link href={seoLinks.audit(s.id)} className={PILL} onClick={pick} data-testid={`link-start-audit-${s.id}`}>Open Site audit</Link>}
                  </StartStep>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </SeoShell>
  );
}
