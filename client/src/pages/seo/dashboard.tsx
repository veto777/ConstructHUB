/**
 * /seo — Projects dashboard: one card per site with its authority, referring
 * domains, organic traffic and keywords (with their trend), and where its
 * tracked keywords rank. Everything shown is already saved, so opening this
 * page never spends SEO data; "Analyse" / "Refresh" on a card buys a new
 * Site Explorer report for that site.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { BarChart3, CheckCircle2, Circle, Loader2, RefreshCw, ScanSearch, Star, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { holdNote } from "./shell";
import { api, canAfford, Empty, fmtDate, fmtNum, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus, type SeoSite } from "./shell";
import { compact, DeltaBadge, DistributionBar, GradientSpark, MetricColumn, monthLabel, PALETTE, ScoreBadge, StatTile, TrendPanel } from "./viz";

type SortKey = "added" | "name" | "traffic" | "authority" | "top10" | "tasks" | "health";
const SORTS: [SortKey, string][] = [["added", "As added"], ["name", "Name"], ["traffic", "Most search traffic"], ["authority", "Highest authority"], ["top10", "Most keywords in the top 10"], ["tasks", "Most open tasks"], ["health", "Lowest site health first"]];
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

/**
 * Site health from the site's own crawls: the newest crawl's score, its move since the crawl just before it (only when
 * both have a score), and the last few crawls. Health is a share of the pages crawled, so a move can come from crawling
 * different pages — the sizes are said whenever they differ.
 */
function HealthTile({ audit, siteId }: { audit: Card["audit"]; siteId: number }) {
  const trend = audit?.trend ?? [];
  const prev = trend.length > 1 ? trend[trend.length - 2] : null;
  const move = audit?.health != null && prev?.health != null ? audit.health - prev.health : null;
  // Different page limits, or more than a tenth more or fewer pages scored (every crawl's size is in the list below).
  const sizesDiffer = !!audit && !!prev && prev.readable && audit.readable && (prev.pageCap !== audit.pageCap || Math.abs((prev.pages ?? 0) - (audit.pages ?? 0)) > 0.1 * Math.max(prev.pages ?? 0, audit.pages ?? 0));
  const hint = !audit ? "No crawl yet — run one in Site audit"
    : !audit.readable ? `The newest crawl (${fmtDate(audit.at)}) could not be read, so its score is not known`
    : audit.health === null ? `Crawled ${fmtDate(audit.at)} — no page could be scored`
    : `${fmtNum(audit.errorPages ?? 0)} of ${fmtNum(audit.pages ?? 0)} pages with errors · crawled ${fmtDate(audit.at)}`
      + (prev && move === null ? " · the crawl before has no score" : "")
      + (sizesDiffer ? ` · the crawl before scored ${fmtNum(prev!.pages ?? 0)} pages${prev!.pageCap !== audit.pageCap ? ` (limit ${fmtNum(prev!.pageCap ?? 0)}, now ${fmtNum(audit.pageCap ?? 0)})` : ""} — a move can come from crawling different pages, not only from fixes` : "");
  return (
    <MetricColumn label="Health score" testId={`metric-health-${siteId}`}
      value={<ScoreBadge value={audit?.health ?? null} label={audit?.health == null ? "No health score" : `Site health ${audit.health} out of 100`} />}
      delta={move ? <DeltaBadge value={move} label={`${move > 0 ? "Up" : "Down"} ${Math.abs(move)} since the crawl before`} /> : null}
      foot={hint}>
      {trend.length > 1 && (
        <details className="mt-1 text-[12px]" data-testid={`health-history-${siteId}`}>
          <summary className="g-link cursor-pointer">Last {trend.length} crawls</summary>
          <ul className="g-text-2 mt-1 space-y-0.5">{trend.slice().reverse().map((t) => <li key={t.jobId}>{fmtDate(t.at)}: {healthWords(t)}</li>)}</ul>
        </details>
      )}
    </MetricColumn>
  );
}

/** One step of filling a site's card: numbered, with its icon, what it gives, and whether it is done. */
function StartStep({ n, done, icon, color, title, text, children }: { n: number; done: boolean; icon: React.ReactNode; color: string; title: string; text: string; children: React.ReactNode }) {
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
  const [sort, setSort] = useState<SortKey>(() => { try { const v = window.localStorage.getItem("seo.dashboard.sort"); return (SORTS.some(([k]) => k === v) ? v : "added") as SortKey; } catch { return "added"; } });
  const chooseSort = (k: SortKey) => { setSort(k); try { window.localStorage.setItem("seo.dashboard.sort", k); } catch { /* private window */ } };
  // Groups (a client, a region): the dashboard can show one group or all. Remembered on this computer.
  // The group filter: "all", "none" (sites in no group) or "g:" + a group's name in lower case — a group's own name can
  // never be mistaken for a choice, and "Roofing" and "roofing" are one group.
  const [group, setGroup] = useState<string>(() => { try { return window.localStorage.getItem("seo.dashboard.groupFilter") ?? "all"; } catch { return "all"; } });
  const chooseGroup = (g: string) => { setGroup(g); try { window.localStorage.setItem("seo.dashboard.groupFilter", g); } catch { /* private window */ } };
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
    const value = (c: Card): number | string | null => sort === "name" ? c.site.domain : sort === "traffic" ? c.report?.organicTraffic ?? null : sort === "authority" ? c.report?.authority ?? null : sort === "top10" ? (c.rank.checked ? c.rank.top10 : null) : sort === "tasks" ? c.openTasks ?? null : sort === "health" ? c.audit?.health ?? null : null;
    return [...(dash.data?.cards ?? [])].sort((a, b) => {
      if (!!a.site.starred !== !!b.site.starred) return a.site.starred ? -1 : 1;
      if (sort === "added") return 0;
      const x = value(a), y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return sort === "name" ? String(x).localeCompare(String(y)) : sort === "health" ? Number(x) - Number(y) : Number(y) - Number(x);
    });
  }, [dash.data, sort]);
  const groupKey = (g: string) => `g:${g.toLowerCase()}`;
  // Each group once (by name, any letter case), shown with the first spelling met.
  const groups = useMemo(() => { const m = new Map<string, string>(); for (const c of dash.data?.cards ?? []) if (c.site.group && !m.has(groupKey(c.site.group))) m.set(groupKey(c.site.group), c.site.group); return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])); }, [dash.data]);
  const anyUngrouped = (dash.data?.cards ?? []).some((c) => !c.site.group);
  // A remembered choice that matches nothing any more shows everything — and is forgotten once the sites have loaded,
  // so it cannot come back by itself later.
  const valid = group === "all" || (group === "none" && anyUngrouped) || groups.some(([k]) => k === group);
  useEffect(() => { if (dash.isSuccess && !valid) chooseGroup("all"); }, [dash.isSuccess, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeGroup = valid ? group : "all";
  const groupLabel = activeGroup === "none" ? "Not in a group" : groups.find(([k]) => k === activeGroup)?.[1] ?? "";
  const shownCards = activeGroup === "all" ? cards : cards.filter((c) => (activeGroup === "none" ? !c.site.group : !!c.site.group && groupKey(c.site.group) === activeGroup));
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

  return (
    <SeoShell title="SEO" description="Your sites at a glance: authority, backlinks, estimated search traffic and rankings." site={site} onSite={onSite} sites={sites} status={status}>
      {dash.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your sites…</p>}
      {dash.isError && <div className="g-callout mb-4" role="alert" data-testid="seo-dashboard-error"><h3>Couldn't load your sites</h3><p>{apiErrorMessage(dash.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void dash.refetch()}>Try again</button></div>}
      {dash.isSuccess && cards.length === 0 && !sites.isError && (
        <Empty testId="seo-dashboard-empty">
          <h3>Add your first site</h3>
          <p>Use <b>Add your first site</b> above to start a project. You'll get its authority, backlinks, estimated organic traffic and keywords here, and weekly rank tracking for the keywords you choose.</p>
          <p className="mt-2">Just want to look a domain up? Open <Link href="/seo/explorer" className="g-link">Site explorer</Link> — any site, yours or a competitor's.</p>
        </Empty>
      )}
      {(cards.length > 1 || activeGroup !== "all") && (
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
          <span className="g-text-2">Starred sites stay on top.</span>
        </div>
      )}
      {activeGroup !== "all" && (
        <p className="g-text mb-3 text-[13px] [overflow-wrap:anywhere]" data-testid="text-group-totals">
          <b className="font-medium">{groupLabel}</b>: {fmtNum(totals.sites)} site{totals.sites === 1 ? "" : "s"} · {fmtNum(totals.keywords)} tracked keywords{totals.checked ? ` · ${fmtNum(totals.top10)} in the top 10 — each keyword's newest check${totals.devices.length === 1 ? ` on ${totals.devices[0]}` : " (desktop for sites that track it, else mobile)"}, ${totals.from === totals.to ? fmtDate(totals.from) : `${fmtDate(totals.from)} to ${fmtDate(totals.to)}`}, ${totals.checked} site${totals.checked === 1 ? "" : "s"}` : ""} · {totals.openTasks == null ? "open tasks not known" : `${fmtNum(totals.openTasks)} open task${totals.openTasks === 1 ? "" : "s"}`}
        </p>
      )}
      <datalist id="seo-groups">{groups.map(([k, g]) => <option key={k} value={g} />)}</datalist>
      {shownCards.length >= 2 && (() => {
        // Totals across the sites shown, each from the sites that have the figure (and saying how many those are).
        const scored = shownCards.filter((c) => c.audit?.health != null), analysed = shownCards.filter((c) => c.report?.organicTraffic != null);
        const avgHealth = scored.length ? Math.round(scored.reduce((n, c) => n + (c.audit!.health as number), 0) / scored.length) : null;
        return (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="seo-portfolio">
            <StatTile label="Sites" color={PALETTE.domains} value={fmtNum(shownCards.length)} foot={`${fmtNum(analysed.length)} analysed · ${fmtNum(scored.length)} crawled`} />
            <StatTile label="Average site health" color={PALETTE.health} value={<ScoreBadge value={avgHealth} />} foot={scored.length ? `Of the ${fmtNum(scored.length)} site${scored.length === 1 ? "" : "s"} with a crawl` : "No site crawled yet"} />
            <StatTile label="Tracked keywords" color={PALETTE.tracked} value={fmtNum(totals.keywords)} foot={totals.checked ? `${fmtNum(totals.top10)} in the top 10 in the newest checks` : "No check saved yet"} />
            <StatTile label="Organic traffic (estimate)" color={PALETTE.traffic} value={analysed.length ? compact(analysed.reduce((n, c) => n + (c.report!.organicTraffic as number), 0)) : "—"} foot={analysed.length ? `Visits a month, ${fmtNum(analysed.length)} analysed site${analysed.length === 1 ? "" : "s"} added up` : "No site analysed yet"} />
          </div>
        );
      })()}
      <div className="space-y-4" data-testid="seo-dashboard">
        {activeGroup !== "all" && shownCards.length === 0 && <Empty testId="seo-dashboard-group-empty"><h3>No sites here</h3><p>Choose another group above, or <button type="button" className="g-link" onClick={() => chooseGroup("all")}>show all sites</button>.</p></Empty>}
        {shownCards.map(({ site: s, rank, report: r, audit, openTasks }) => {
          const busy = analyse.isPending && analyse.variables === s.domain;
          return (
            <section key={s.id} className="rounded-xl border p-3 shadow-sm sm:p-5" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={`card-site-${s.id}`}>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[16px] font-semibold uppercase" style={{ color: "var(--g-blue)", background: "var(--g-accent-soft)" }} aria-hidden>{s.domain.replace(/^www\./, "")[0]}</span>
                <button type="button" className="rounded p-1" aria-pressed={!!s.starred} aria-label={s.starred ? `Remove the star from ${s.domain}` : `Star ${s.domain} to keep it on top`} title={s.starred ? "Starred — stays on top" : "Star to keep on top"} disabled={star.isPending} onClick={() => star.mutate({ id: s.id, starred: !s.starred })} data-testid={`button-star-${s.id}`}>
                  <Star className="h-4 w-4" style={s.starred ? { fill: "#f9ab00", color: "#f9ab00" } : { color: "var(--g-text-2)" }} aria-hidden />
                </button>
                <div className="min-w-0">
                  <h2 className="g-text text-[18px] font-semibold leading-6 [overflow-wrap:anywhere]"><Link href={`/seo/explorer?domain=${encodeURIComponent(s.domain)}`} className="g-link">{s.domain}</Link></h2>
                  <span className="g-text-2 text-[12px]">{r ? `analysed ${fmtDate(r.fetchedAt)}` : "not analysed yet"}</span>
                </div>
                {editing === s.id ? (
                  <form className="flex w-full min-w-0 flex-wrap items-center gap-1 sm:w-auto" onSubmit={(e) => { e.preventDefault(); setSiteGroup.mutate({ id: s.id, group: groupDraft.trim() || null }); }} data-testid={`form-group-${s.id}`}>
                    <label className="sr-only" htmlFor={`group-${s.id}`}>Group for {s.domain}</label>
                    <input id={`group-${s.id}`} className="g-input !h-8 w-40 min-w-0 max-w-full flex-1 !py-1 text-[13px] sm:flex-none" list="seo-groups" maxLength={40} value={groupDraft} onChange={(e) => setGroupDraft(e.target.value)} placeholder="e.g. Smith Roofing" autoFocus data-testid={`input-group-${s.id}`} />
                    <button type="submit" className="g-pill g-pill--sm" disabled={setSiteGroup.isPending}>Save</button>
                    <button type="button" className="g-pill g-pill--sm" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" className="g-chip g-chip--sm max-w-full !whitespace-normal text-left !normal-case [overflow-wrap:anywhere]" onClick={() => { setEditing(s.id); setGroupDraft(s.group ?? ""); }} aria-label={s.group ? `Group: ${s.group} — change` : `Put ${s.domain} in a group`} data-testid={`button-group-${s.id}`}>{s.group ? s.group : "+ Group"}</button>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                  <Link href={`/seo/explorer?domain=${encodeURIComponent(s.domain)}`} className="g-pill g-pill--sm" data-testid={`link-explore-${s.id}`}>Site explorer</Link>
                  <Link href="/seo/rank-tracker" className="g-pill g-pill--sm" onClick={() => onSite(s.id)} data-testid={`link-rank-${s.id}`}>Rank tracker</Link>
                  <Link href="/seo/audit" className="g-pill g-pill--sm" onClick={() => onSite(s.id)} data-testid={`link-audit-${s.id}`}>Site audit{audit?.health != null ? ` · health ${audit.health}` : ""}</Link>
                  <Link href="/seo/plan" className="g-pill g-pill--sm" onClick={() => onSite(s.id)} data-testid={`link-plan-${s.id}`}>Action plan{openTasks == null ? " · count unavailable" : openTasks ? ` · ${openTasks} open` : ""}</Link>
                  <button type="button" className="g-pill g-pill--sm" disabled={busy || !configured || !affordable} onClick={() => analyse.mutate(s.domain)} data-testid={`button-analyse-${s.id}`} title={`A new report costs about ${price} of your SEO data.${holdNote(status.data, "explorerReport")}`}>
                    {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {r ? "Refresh" : "Analyse"} · {price}
                  </button>
                </div>
              </div>
              {r ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-4 md:grid-cols-3 xl:grid-cols-6" style={{ borderColor: "var(--g-divider)" }}>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><HealthTile audit={audit} siteId={s.id} /></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Authority" testId={`metric-authority-${s.id}`} value={r.authority == null ? "—" : String(r.authority)}
                      delta={<DeltaBadge value={change(r.linkHistory?.map((h) => h.authority))} label="Change over the months shown" />}
                      foot="0–100, from the sites linking to it"
                      chart={<GradientSpark range height={48} points={r.linkHistory?.filter((h) => h.authority != null).map((h) => ({ label: monthLabel(h.month), value: h.authority as number }))} color={PALETTE.authority} />} /></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Referring domains" value={compact(r.referringDomains)}
                      delta={<DeltaBadge value={change(r.linkHistory?.map((h) => h.referringDomains))} label="Change over the months shown" />}
                      foot={`${compact(r.backlinks)} backlinks`}
                      chart={<GradientSpark range height={48} points={r.linkHistory?.map((h) => ({ label: monthLabel(h.month), value: h.referringDomains }))} color={PALETTE.domains} />} /></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Organic traffic (est.)" value={compact(r.organicTraffic)}
                      delta={<DeltaBadge value={change(r.history?.map((h) => h.traffic))} label="Change over the months shown" />}
                      foot={`Visits a month, estimated from rankings${r.trafficValue != null ? ` · value $${Math.round(r.trafficValue).toLocaleString("en-US")} / mo` : ""}`}
                      chart={<GradientSpark range height={48} points={r.history?.map((h) => ({ label: monthLabel(h.month), value: h.traffic }))} color={PALETTE.traffic} />} /></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Organic keywords" value={compact(r.organicKeywords)}
                      delta={<DeltaBadge value={change(r.history?.map((h) => h.keywords))} label="Change over the months shown" />}
                      chart={<GradientSpark range height={48} points={r.history?.map((h) => ({ label: monthLabel(h.month), value: h.keywords }))} color={PALETTE.keywords} />}>
                      {r.top10 != null && r.top3 != null && r.organicKeywords != null && <div className="mt-1.5"><DistributionBar parts={[{ label: "Top 3", value: r.top3, color: PALETTE.top3 }, { label: "4–10", value: Math.max(0, r.top10 - r.top3), color: PALETTE.top10 }, { label: "11+", value: Math.max(0, r.organicKeywords - r.top10), color: PALETTE.rest }]} /></div>}
                    </MetricColumn></div>
                    <div className="min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l"><MetricColumn label="Tracked keywords" testId={`metric-tracked-${s.id}`} value={fmtNum(s.keywordCount)}
                      foot={rank.checked ? `${rank.device ? `On ${rank.device}` : "Newest checks"} · ${rank.firstOn && rank.firstOn !== rank.checkedOn ? `checked ${fmtDate(rank.firstOn)} to ${fmtDate(rank.checkedOn)}` : `checked ${fmtDate(rank.checkedOn)}`}` : s.keywordCount ? `No check saved yet${s.nextRankCheckAt ? ` — the first automatic check is due ${fmtDate(s.nextRankCheckAt)}` : ""}; it is skipped while this month's included data is used up` : "None yet"}>
                      {rank.checked > 0 ? <div className="mt-1.5"><DistributionBar parts={[{ label: "Top 3", value: rank.top3, color: PALETTE.top3 }, { label: "4–10", value: Math.max(0, rank.top10 - rank.top3), color: PALETTE.top10 }, { label: "Below 10 or not found", value: Math.max(0, rank.checked - rank.top10), color: PALETTE.rest }]} /></div>
                        : !s.keywordCount && <Link href="/seo/rank-tracker" className="g-pill g-pill--sm mt-2 self-start" onClick={() => onSite(s.id)}>Add keywords</Link>}
                    </MetricColumn></div>
                  </div>
                  <TrendPanel title="Over time" testId={`trend-${s.id}`} note="Monthly. Traffic and keywords are estimates from the keyword database; referring domains and authority come from the backlink index."
                    series={[
                      { key: "traffic", label: "Organic traffic (estimate)", color: PALETTE.traffic, points: (r.history ?? []).map((h) => ({ label: monthLabel(h.month), value: h.traffic })) },
                      { key: "keywords", label: "Organic keywords", color: PALETTE.keywords, points: (r.history ?? []).map((h) => ({ label: monthLabel(h.month), value: h.keywords })) },
                      { key: "domains", label: "Referring domains", color: PALETTE.domains, points: (r.linkHistory ?? []).map((h) => ({ label: monthLabel(h.month), value: h.referringDomains })) },
                      { key: "authority", label: "Authority", color: PALETTE.authority, points: (r.linkHistory ?? []).filter((h) => h.authority != null).map((h) => ({ label: monthLabel(h.month), value: h.authority as number })) },
                    ]} />
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3" data-testid={`start-${s.id}`}>
                  {/* Three steps to fill this card; each says whether it is done. Nothing here is a figure until a step has run. */}
                  <StartStep n={1} done={false} icon={<BarChart3 className="h-5 w-5" />} color={PALETTE.traffic} title="Analyse the site"
                    text="Authority, backlinks, estimated search traffic, keywords and competitors — with two years of monthly history.">
                    <Button size="sm" disabled={busy || !configured || !affordable} onClick={() => analyse.mutate(s.domain)} data-testid={`button-analyse-empty-${s.id}`}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Analyse — about {price}</Button>
                  </StartStep>
                  <StartStep n={2} done={(s.keywordCount ?? 0) > 0} icon={<Target className="h-5 w-5" />} color={PALETTE.traffic} title="Track your keywords"
                    text={(s.keywordCount ?? 0) > 0 ? `${fmtNum(s.keywordCount)} tracked — checked every week by default.` : "Your services and towns: where the site is found in Google and the map pack, every week."}>
                    <Link href="/seo/rank-tracker" className="g-pill g-pill--sm" onClick={() => onSite(s.id)}>Open Rank tracker</Link>
                  </StartStep>
                  <StartStep n={3} done={!!audit} icon={<ScanSearch className="h-5 w-5" />} color={PALETTE.traffic} title="Crawl the site"
                    text={audit ? "Crawled — the health score and its issues are in Site audit." : "Broken pages, redirects, titles, speed and what a crawler can read."}>
                    {audit ? <div className="w-full border-t pt-2" style={{ borderColor: "var(--g-divider)" }}><HealthTile audit={audit} siteId={s.id} /></div> : <Link href="/seo/audit" className="g-pill g-pill--sm" onClick={() => onSite(s.id)}>Open Site audit</Link>}
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
