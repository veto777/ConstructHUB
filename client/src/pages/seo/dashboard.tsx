/**
 * /seo — Projects dashboard: one card per site with its authority, referring
 * domains, organic traffic and keywords (with their trend), and where its
 * tracked keywords rank. Everything shown is already saved, so opening this
 * page never spends SEO data; "Analyse" / "Refresh" on a card buys a new
 * Site Explorer report for that site.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Loader2, RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { holdNote } from "./shell";
import { api, canAfford, Empty, fmtDate, fmtNum, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus, type SeoSite } from "./shell";

type SortKey = "added" | "name" | "traffic" | "authority" | "top10" | "tasks";
const SORTS: [SortKey, string][] = [["added", "As added"], ["name", "Name"], ["traffic", "Most search traffic"], ["authority", "Highest authority"], ["top10", "Most keywords in the top 10"], ["tasks", "Most open tasks"]];
type Card = {
  site: SeoSite;
  audit: { health: number | null; errors: number; scannedAt: string | null } | null;
  /** null = the count could not be read just now. */
  openTasks?: number | null;
  rank: { top3: number; top10: number; ranked: number; checked: number; checkedOn: string | null };
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
  const star = useMutation({
    mutationFn: (v: { id: number; starred: boolean }) => api("POST", `/api/seo/sites/${v.id}/star`, { starred: v.starred }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); },
    onError: (e) => toast({ title: "Couldn't change that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // Starred sites first, always; then the chosen order. A site with no number for that order goes last.
  const cards = useMemo(() => {
    const value = (c: Card): number | string | null => sort === "name" ? c.site.domain : sort === "traffic" ? c.report?.organicTraffic ?? null : sort === "authority" ? c.report?.authority ?? null : sort === "top10" ? (c.rank.checked ? c.rank.top10 : null) : sort === "tasks" ? c.openTasks ?? null : null;
    return [...(dash.data?.cards ?? [])].sort((a, b) => {
      if (!!a.site.starred !== !!b.site.starred) return a.site.starred ? -1 : 1;
      if (sort === "added") return 0;
      const x = value(a), y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return sort === "name" ? String(x).localeCompare(String(y)) : Number(y) - Number(x);
    });
  }, [dash.data, sort]);
  const price = status.data?.prices ? money(status.data.prices.explorerReport) : "";
  const affordable = canAfford(status.data, "explorerReport");
  const configured = !!status.data?.configured;

  return (
    <SeoShell title="SEO" description="Your sites at a glance: authority, backlinks, search traffic and rankings." site={site} onSite={onSite} sites={sites} status={status}>
      {dash.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your sites…</p>}
      {dash.isError && <div className="g-callout mb-4" role="alert" data-testid="seo-dashboard-error"><h3>Couldn't load your sites</h3><p>{apiErrorMessage(dash.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void dash.refetch()}>Try again</button></div>}
      {dash.isSuccess && cards.length === 0 && !sites.isError && (
        <Empty testId="seo-dashboard-empty">
          <h3>Add your first site</h3>
          <p>Use <b>Add your first site</b> above to start a project. You'll get its authority, backlinks, organic traffic and keywords here, and weekly rank tracking for the keywords you choose.</p>
          <p className="mt-2">Just want to look a domain up? Open <Link href="/seo/explorer" className="g-link">Site explorer</Link> — any site, yours or a competitor's.</p>
        </Empty>
      )}
      {cards.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <label className="g-text-2 flex items-center gap-2">Order
            <select className="g-input g-select !w-auto !py-1" value={sort} onChange={(e) => chooseSort(e.target.value as SortKey)} data-testid="select-dashboard-sort">
              {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <span className="g-text-2">Starred sites stay on top.</span>
        </div>
      )}
      <div className="space-y-4" data-testid="seo-dashboard">
        {cards.map(({ site: s, rank, report: r, audit, openTasks }) => {
          const busy = analyse.isPending && analyse.variables === s.domain;
          return (
            <section key={s.id} className="rounded-lg border p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={`card-site-${s.id}`}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button type="button" className="rounded p-1" aria-pressed={!!s.starred} aria-label={s.starred ? `Remove the star from ${s.domain}` : `Star ${s.domain} to keep it on top`} title={s.starred ? "Starred — stays on top" : "Star to keep on top"} disabled={star.isPending} onClick={() => star.mutate({ id: s.id, starred: !s.starred })} data-testid={`button-star-${s.id}`}>
                  <Star className="h-4 w-4" style={s.starred ? { fill: "#f9ab00", color: "#f9ab00" } : { color: "var(--g-text-2)" }} aria-hidden />
                </button>
                <h2 className="g-text text-[18px] font-medium"><Link href={`/seo/explorer?domain=${encodeURIComponent(s.domain)}`} className="g-link">{s.domain}</Link></h2>
                <span className="g-text-2 text-[12px]">{r ? `analysed ${fmtDate(r.fetchedAt)}` : "not analysed yet"}</span>
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
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
                  <Metric label="Authority" value={r.authority == null ? "—" : String(r.authority)} delta={<Delta series={r.linkHistory?.map((h) => h.authority ?? 0)} />} spark={<Spark data={r.linkHistory?.map((h) => h.authority ?? 0)} color="#673ab7" />} testId={`metric-authority-${s.id}`} />
                  <Metric label="Referring domains" value={compact(r.referringDomains)} delta={<Delta series={r.linkHistory?.map((h) => h.referringDomains)} />} spark={<Spark data={r.linkHistory?.map((h) => h.referringDomains)} color="#1a73e8" />} />
                  <Metric label="Backlinks" value={compact(r.backlinks)} />
                  <Metric label="Organic traffic" value={compact(r.organicTraffic)} delta={<Delta series={r.history?.map((h) => h.traffic)} />} spark={<Spark data={r.history?.map((h) => h.traffic)} color="#e8710a" />} hint={r.trafficValue != null ? `Value $${Math.round(r.trafficValue).toLocaleString("en-US")} / mo` : undefined} />
                  <Metric label="Organic keywords" value={compact(r.organicKeywords)} delta={<Delta series={r.history?.map((h) => h.keywords)} />} spark={<Spark data={r.history?.map((h) => h.keywords)} color="#e8710a" />} hint={r.top10 != null ? `${fmtNum(r.top3)} in top 3 · ${fmtNum(r.top10)} in top 10` : undefined} />
                  <Metric label="Tracked keywords" value={fmtNum(s.keywordCount)} hint={rank.checked ? `${rank.top3} in top 3 · ${rank.top10} in top 10 · checked ${fmtDate(rank.checkedOn)}` : s.keywordCount ? "First check runs this week" : "None yet — add some in Rank tracker"} testId={`metric-tracked-${s.id}`} />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="g-text-2 text-[14px]">No numbers for this site yet. <b className="g-text font-medium">Analyse</b> builds its report: authority, backlinks, search traffic, keywords and competitors.</p>
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
