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
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Loader2, RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { holdNote } from "./shell";
import { api, canAfford, Empty, fmtDate, fmtNum, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus, type SeoSite } from "./shell";

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

const compact = (n: number | null | undefined) =>
  n == null ? "—" : Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(1)}K` : Math.round(n).toLocaleString("en-US");

/** Change from the first to the last point of a series: "+580" / "−24". */
function Delta({ series }: { series: number[] | undefined }) {
  if (!series || series.length < 2) return null;
  const d = Math.round(series[series.length - 1] - series[0]);
  if (!d) return null;
  return <span className={`g-move ${d > 0 ? "g-move--up" : "g-move--down"} ml-1`} aria-label={`${d > 0 ? "Up" : "Down"} ${Math.abs(d)} over the period`}>{d > 0 ? "+" : "−"}{compact(Math.abs(d))}</span>;
}

function Spark({ data, color }: { data: number[] | undefined; color: string }) {
  if (!data || data.length < 2) return <div className="h-10" />;
  return (
    <div className="h-10" aria-hidden>
      <ResponsiveContainer>
        <AreaChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Metric({ label, value, delta, spark, hint, testId }: { label: string; value: string; delta?: React.ReactNode; spark?: React.ReactNode; hint?: string; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="g-text-2 text-[12px]">{label}</div>
      <div className="g-text text-[24px] leading-8 tabular-nums">{value}{delta}</div>
      {spark}
      {hint && <div className="g-text-2 text-[12px]">{hint}</div>}
    </div>
  );
}

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
    <div className="min-w-0">
      <Metric label="Site health" value={audit?.health == null ? "—" : String(audit.health)} testId={`metric-health-${siteId}`}
        delta={move ? <span className={`g-move ${move > 0 ? "g-move--up" : "g-move--down"} ml-1`} aria-label={`${move > 0 ? "Up" : "Down"} ${Math.abs(move)} since the crawl before`}>{move > 0 ? "+" : "−"}{Math.abs(move)}</span> : null}
        spark={<Spark data={trend.filter((t) => t.health !== null).length === trend.length ? trend.map((t) => t.health as number) : undefined} color="#1e8e3e" />} hint={hint} />
      {trend.length > 1 && (
        <details className="mt-1 text-[12px]" data-testid={`health-history-${siteId}`}>
          <summary className="g-link cursor-pointer">Last {trend.length} crawls</summary>
          <ul className="g-text-2 mt-1 space-y-0.5">{trend.slice().reverse().map((t) => <li key={t.jobId}>{fmtDate(t.at)}: {healthWords(t)}</li>)}</ul>
        </details>
      )}
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
      <div className="space-y-4" data-testid="seo-dashboard">
        {activeGroup !== "all" && shownCards.length === 0 && <Empty testId="seo-dashboard-group-empty"><h3>No sites here</h3><p>Choose another group above, or <button type="button" className="g-link" onClick={() => chooseGroup("all")}>show all sites</button>.</p></Empty>}
        {shownCards.map(({ site: s, rank, report: r, audit, openTasks }) => {
          const busy = analyse.isPending && analyse.variables === s.domain;
          return (
            <section key={s.id} className="rounded-lg border p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={`card-site-${s.id}`}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button type="button" className="rounded p-1" aria-pressed={!!s.starred} aria-label={s.starred ? `Remove the star from ${s.domain}` : `Star ${s.domain} to keep it on top`} title={s.starred ? "Starred — stays on top" : "Star to keep on top"} disabled={star.isPending} onClick={() => star.mutate({ id: s.id, starred: !s.starred })} data-testid={`button-star-${s.id}`}>
                  <Star className="h-4 w-4" style={s.starred ? { fill: "#f9ab00", color: "#f9ab00" } : { color: "var(--g-text-2)" }} aria-hidden />
                </button>
                <h2 className="g-text text-[18px] font-medium"><Link href={`/seo/explorer?domain=${encodeURIComponent(s.domain)}`} className="g-link">{s.domain}</Link></h2>
                <span className="g-text-2 text-[12px]">{r ? `analysed ${fmtDate(r.fetchedAt)}` : "not analysed yet"}</span>
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
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4 xl:grid-cols-7">
                  <Metric label="Authority" value={r.authority == null ? "—" : String(r.authority)} delta={<Delta series={r.linkHistory?.map((h) => h.authority ?? 0)} />} spark={<Spark data={r.linkHistory?.map((h) => h.authority ?? 0)} color="#673ab7" />} testId={`metric-authority-${s.id}`} />
                  <Metric label="Referring domains" value={compact(r.referringDomains)} delta={<Delta series={r.linkHistory?.map((h) => h.referringDomains)} />} spark={<Spark data={r.linkHistory?.map((h) => h.referringDomains)} color="#1a73e8" />} />
                  <Metric label="Backlinks" value={compact(r.backlinks)} />
                  <Metric label="Organic traffic (estimate)" value={compact(r.organicTraffic)} delta={<Delta series={r.history?.map((h) => h.traffic)} />} spark={<Spark data={r.history?.map((h) => h.traffic)} color="#e8710a" />} hint={`Visits a month, estimated from rankings${r.trafficValue != null ? ` · worth $${Math.round(r.trafficValue).toLocaleString("en-US")} / mo as ads` : ""}`} />
                  <Metric label="Organic keywords" value={compact(r.organicKeywords)} delta={<Delta series={r.history?.map((h) => h.keywords)} />} spark={<Spark data={r.history?.map((h) => h.keywords)} color="#e8710a" />} hint={r.top10 != null ? `${fmtNum(r.top3)} in top 3 · ${fmtNum(r.top10)} in top 10` : undefined} />
                  <HealthTile audit={audit} siteId={s.id} />
                  <Metric label="Tracked keywords" value={fmtNum(s.keywordCount)} hint={rank.checked ? `${rank.top3} in top 3 · ${rank.top10} in top 10${rank.device ? ` on ${rank.device}` : ""} · ${rank.firstOn && rank.firstOn !== rank.checkedOn ? `checked ${fmtDate(rank.firstOn)} to ${fmtDate(rank.checkedOn)}` : `checked ${fmtDate(rank.checkedOn)}`}` : s.keywordCount ? `No check saved yet${s.nextRankCheckAt ? ` — the first automatic check is due ${fmtDate(s.nextRankCheckAt)}` : ""}; it is skipped while this month's included data is used up` : "None yet — add some in Rank tracker"} testId={`metric-tracked-${s.id}`} />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {audit && <div className="w-full max-w-[14rem]"><HealthTile audit={audit} siteId={s.id} /></div>}
                  <p className="g-text-2 text-[14px]">No search numbers for this site yet. <b className="g-text font-medium">Analyse</b> builds its report: authority, backlinks, estimated search traffic, keywords and competitors.</p>
                  <Button size="sm" disabled={busy || !configured || !affordable} onClick={() => analyse.mutate(s.domain)} data-testid={`button-analyse-empty-${s.id}`}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Analyse — about {price}</Button>
                  <span className="g-text-2 text-[13px]">Tracked keywords: {fmtNum(s.keywordCount)}</span>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </SeoShell>
  );
}
