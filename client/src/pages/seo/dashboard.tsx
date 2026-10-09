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
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, X } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { holdNote } from "./shell";
import { api, canAfford, Empty, fmtDate, fmtNum, money, SeoShell, useAddress, useHash, useSelectedSite, useSeoSites, useSeoStatus, type SeoSite } from "./shell";
import { seoLinks, setParam } from "./links";
import { compact, FigureLink, FOCUS, LINK_CUE, PALETTE, TAP } from "./viz";
import { MetricStrip, StatusBadge, scoreTone } from "@/components/tool";
import { PortfolioCell, ProjectRow, type SiteCard } from "@/components/seo-tool/project-row";

type SortKey = "added" | "name" | "traffic" | "authority" | "keywords" | "top10" | "tasks" | "health";
const SORTS: [SortKey, string][] = [["added", "As added"], ["name", "Name"], ["traffic", "Most search traffic"], ["authority", "Highest authority"], ["keywords", "Most tracked keywords"], ["top10", "Most keywords in the top 10"], ["tasks", "Most open tasks"], ["health", "Lowest site health first"]];
const isSort = (v: unknown): v is SortKey => SORTS.some(([k]) => k === v);
/** ?filter= keeps only the sites with a saved report (analysed) or a finished crawl (crawled) — the words the chip shows. */
type Filter = "analysed" | "crawled";
const FILTER_WORDS: Record<Filter, string> = { analysed: "Analysed sites", crawled: "Crawled sites" };
const isFilter = (v: unknown): v is Filter => v === "analysed" || v === "crawled";
/** The group filter's key: "all", "none" (sites in no group) or "g:" + the group's name in lower case — a group's own name can never be mistaken for a choice, and "Roofing" and "roofing" are one group. */
const groupKey = (g: string) => `g:${g.toLowerCase()}`;
/** A site's figures as the dashboard request returns them (the row's layout: components/seo-tool/project-row.tsx). */
type Card = SiteCard;

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
          <MetricStrip cols={[2, 4, 4]} boxed className="mb-4" testId="seo-portfolio">
            <PortfolioCell label="Sites" color={PALETTE.domains} value={fmtNum(shownCards.length)} testId="tile-sites" href={listAt({})} onClick={scrollToSites} linkTestId="link-sites"
              foot={<><FigureLink href={listAt({ filter: "analysed" })} onClick={scrollToSites} testId="link-sites-analysed">{fmtNum(analysed.length)} analysed</FigureLink> · <FigureLink href={listAt({ filter: "crawled" })} onClick={scrollToSites} testId="link-sites-crawled">{fmtNum(crawled.length)} crawled</FigureLink></>} />
            <PortfolioCell label="Average site health" color={PALETTE.health} value={avgHealth == null ? null : <StatusBadge tone={scoreTone(avgHealth)} size="lg">{avgHealth}</StatusBadge>} testId="tile-health" href={listAt({ sort: "health" })} onClick={scrollToSites} linkTestId="link-health-average"
              foot={scored.length ? <FigureLink href={listAt({ filter: "crawled", sort: "health" })} onClick={scrollToSites} testId="link-health-scored">Of the {fmtNum(scored.length)} crawled site{scored.length === 1 ? "" : "s"}{scored.length < crawled.length ? " with a score" : ""}</FigureLink>
                : crawled.length ? <FigureLink href={listAt({ filter: "crawled" })} onClick={scrollToSites} testId="link-health-scored">{fmtNum(crawled.length)} crawled, no score yet</FigureLink> : "No site crawled yet"} />
            <PortfolioCell label="Tracked keywords" color={PALETTE.tracked} value={fmtNum(totals.keywords)} testId="tile-tracked" href={listAt({ sort: "keywords" })} onClick={scrollToSites} linkTestId="link-tracked-total"
              foot={totals.checked ? <FigureLink href={listAt({ sort: "top10" })} onClick={scrollToSites} testId="link-top10-total">{fmtNum(totals.top10)} in the top 10 in the newest checks</FigureLink> : totals.keywords ? "No check saved yet" : "No keyword tracked yet"} />
            <PortfolioCell label="Organic traffic (estimate)" color={PALETTE.traffic} value={withTraffic.length ? compact(withTraffic.reduce((n, c) => n + (c.report!.organicTraffic as number), 0)) : "—"} testId="tile-traffic" href={listAt({ sort: "traffic" })} onClick={scrollToSites} linkTestId="link-traffic-total"
              foot={withTraffic.length ? <FigureLink href={listAt({ filter: "analysed", sort: "traffic" })} onClick={scrollToSites} testId="link-traffic-analysed">Visits a month, {fmtNum(withTraffic.length)} analysed site{withTraffic.length === 1 ? "" : "s"} added up</FigureLink>
                : analysed.length ? <FigureLink href={listAt({ filter: "analysed" })} onClick={scrollToSites} testId="link-traffic-analysed">{fmtNum(analysed.length)} analysed, no traffic figure yet</FigureLink> : "No site analysed yet"} />
          </MetricStrip>
        );
      })()}
      <div id="sites" className="scroll-mt-4 space-y-4" data-testid="seo-dashboard">
        {cards.length > 0 && shownCards.length === 0 && (filter || activeGroup !== "all") && <Empty testId="seo-dashboard-group-empty"><h3>No sites here</h3><p>{filter ? <>No {FILTER_WORDS[filter].toLowerCase()}{activeGroup !== "all" ? ` in ${groupLabel}` : ""} yet — </> : "Choose another group above, or "}<button type="button" className={`${TAP} ${LINK_CUE} rounded-sm`} style={{ color: "var(--g-accent-ink)" }} onClick={clearNarrowing}>show all sites</button>.</p></Empty>}
        {shownCards.map((card) => {
          const s = card.site;
          return (
            <ProjectRow key={s.id} card={card} busy={analyse.isPending && analyse.variables === s.domain} canAnalyse={configured && affordable} price={price} priceNote={holdNote(status.data, "explorerReport")}
              onAnalyse={() => analyse.mutate(s.domain)} onPick={() => onSite(s.id)}
              star={{ pending: star.isPending, onToggle: () => star.mutate({ id: s.id, starred: !s.starred }) }}
              group={{ editing: editing === s.id, draft: groupDraft, pending: setSiteGroup.isPending, onDraft: setGroupDraft, onEdit: () => { setEditing(s.id); setGroupDraft(s.group ?? ""); }, onSave: () => setSiteGroup.mutate({ id: s.id, group: groupDraft.trim() || null }), onCancel: () => setEditing(null) }} />
          );
        })}
      </div>
    </SeoShell>
  );
}
