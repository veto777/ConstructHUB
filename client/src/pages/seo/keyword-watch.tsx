/**
 * Alerts → keyword watch (server/seo/keyword-watch.ts): a monthly snapshot of the searches a site ranks for, compared
 * with the one before — what it started to rank for and what it no longer ranks for, beyond the keywords it tracks.
 * Off until turned on; the monthly snapshot uses only the month's included data. A snapshot can also be taken now,
 * at the price on the button.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, fmtDate, fmtNum, money, useSeoStatus, type SeoSite } from "./shell";

type Kw = { keyword: string; position: number | null; volume: number | null; traffic: number | null; path: string | null; was?: number | null };
type Comparison = { since: string; takenOn: string; basis: "exact" | "top" | "none"; added: Kw[]; gone: Kw[]; now: { keywords: number; total: number | null }; before: { keywords: number; total: number | null } };
type View = { watch: boolean; nextAt: string | null; rows: number; latest: { takenOn: string; keywords: number; total: number | null; complete: boolean } | null; comparison: Comparison | null };
const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };

export function KeywordWatch({ site, onTrack }: { site: SeoSite; /** Track the ticked keywords in the rank tracker. */ onTrack?: (keywords: Kw[]) => void }) {
  const status = useSeoStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site.id}/keyword-watch`;
  const q = useQuery<View>({ queryKey: [key], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 30_000 });
  const [tab, setTab] = useState<"added" | "gone">("added");
  const done = () => { void qc.invalidateQueries({ queryKey: [key] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith("/api/seo/alerts") }); };
  const set = useMutation({
    mutationFn: (v: { siteId: number; watch: boolean }) => api("POST", `/api/seo/sites/${v.siteId}/keyword-watch`, { watch: v.watch }),
    onSuccess: (_d: unknown, v) => { done(); toast({ title: v.watch ? "Keyword watch is on" : "Keyword watch is off", description: v.watch ? "A snapshot is taken once a month from your included SEO data — the next date is shown here. Alerts start with the second snapshot." : "Snapshots already taken are kept." }); },
    onError: (e) => toast({ title: "Couldn't change that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const snap = useMutation({
    mutationFn: (v: { siteId: number }) => api("POST", `/api/seo/sites/${v.siteId}/keyword-watch/snapshot`),
    onSuccess: (d: { keywords: number }) => { done(); toast({ title: "Snapshot taken", description: `${fmtNum(d.keywords)} keyword${d.keywords === 1 ? "" : "s"} saved.` }); },
    onError: (e) => toast({ title: "Couldn't take the snapshot", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // The figure set aside, which is also the most that can be charged; without it nothing is bought here.
  const price = (status.data?.holds as Record<string, number | undefined> | undefined)?.keywordSnapshot ?? null;
  const available = status.data?.credits ? status.data.credits.availableCents : -1;
  const canPay = price != null && (available === -1 || available >= price);
  if (q.isLoading) return <p className="g-text-2 mb-4 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading the keyword watch…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't load the keyword watch: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  const d = q.data;
  if (!d) return null;
  const c = d.comparison, list = c ? (tab === "added" ? c.added : c.gone) : [];
  const exact = c?.basis === "exact";
  return (
    <section className="mb-6 rounded-lg border p-4" style={card} data-testid="keyword-watch">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="g-text text-[16px] font-medium">Searches {site.domain} starts or stops ranking for</h2>
          <p className="g-text-2 mt-1 max-w-3xl text-[13px]">Once a month, a snapshot of the searches the site ranks for — up to its {fmtNum(d.rows)} highest-traffic ones — is compared with the month before. It covers every search Google shows the site for, not only the keywords you track. The monthly snapshot uses your included SEO data only{price != null ? ` (up to ${money(price)} each)` : ""}; when that has run out it is skipped, never charged to credit you bought.</p>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-[13px]"><input type="checkbox" checked={set.isPending && set.variables ? set.variables.watch : d.watch} aria-busy={set.isPending} onChange={(e) => { if (!set.isPending) set.mutate({ siteId: site.id, watch: e.target.checked }); }} data-testid="checkbox-keyword-watch" /><span className="g-text">Watch every month</span></label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
        <span className="g-text-2" data-testid="text-keyword-watch-state">
          {d.latest ? `Last snapshot ${fmtDate(d.latest.takenOn)}: ${fmtNum(d.latest.keywords)} keyword${d.latest.keywords === 1 ? "" : "s"}${d.latest.total != null && d.latest.total > d.latest.keywords ? ` of the ${fmtNum(d.latest.total)} the site ranks for` : ""}.` : "No snapshot yet."}
          {d.watch && d.nextAt ? ` Next: ${fmtDate(d.nextAt)}.` : ""}
        </span>
        <button type="button" className="g-pill g-pill--sm" disabled={snap.isPending || !status.data?.configured || !canPay} onClick={() => snap.mutate({ siteId: site.id })} data-testid="button-keyword-snapshot">
          {snap.isPending ? <Loader2 className="animate-spin" /> : null} {snap.isPending ? "Taking it…" : `Take a snapshot now${price != null ? ` — up to ${money(price)}` : ""}`}
        </button>
        {price == null && status.isSuccess && <span className="g-text-2">The price couldn't be loaded, so a snapshot can't be bought yet — reload the page.</span>}
        {price != null && !canPay && <span style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit above.</span>}
      </div>
      {d.latest && !c && <p className="g-text-2 mt-3 text-[13px]" data-testid="keyword-watch-first">One snapshot so far, so there is nothing to compare yet. The next one shows what changed.</p>}
      {c && c.basis === "none" && <p className="g-text-2 mt-3 text-[13px]" role="status">The last two snapshots were taken for different countries or languages, so they are not compared.</p>}
      {c && c.basis !== "none" && (
        <div className="mt-3">
          <p className="g-text mb-2 text-[13px]" data-testid="text-keyword-watch-summary">
            Between {fmtDate(c.since)} and {fmtDate(c.takenOn)}: {exact
              ? <>the site started ranking for <b className="font-medium">{fmtNum(c.added.length)}</b> search{c.added.length === 1 ? "" : "es"} and no longer ranks for <b className="font-medium">{fmtNum(c.gone.length)}</b>.</>
              : <><b className="font-medium">{fmtNum(c.added.length)}</b> search{c.added.length === 1 ? "" : "es"} entered its {fmtNum(d.rows)} highest-traffic keywords and <b className="font-medium">{fmtNum(c.gone.length)}</b> left them. The site ranks for more keywords than a snapshot holds, so one that left may still rank lower down — no alert is sent on this.</>}
          </p>
          <nav className="g-tabs" aria-label="What changed">
            {([["added", exact ? `Started ranking (${c.added.length})` : `Entered the top (${c.added.length})`], ["gone", exact ? `No longer ranking (${c.gone.length})` : `Left the top (${c.gone.length})`]] as const).map(([k, label]) => <a key={k} href={`#${k}`} aria-current={tab === k ? "page" : undefined} onClick={(e) => { e.preventDefault(); setTab(k); }} data-testid={`tab-keyword-watch-${k}`}>{label}</a>)}
          </nav>
          {list.length === 0 ? <p className="g-text-2 text-[13px]">None.</p> : (
            <div className="overflow-x-auto">
              <table className="g-table w-full" data-testid={`table-keyword-watch-${tab}`}>
                <thead><tr><th>Keyword</th><th className="num">{tab === "added" ? "Position now" : "Position before"}</th><th className="num">Volume / mo</th><th className="num" title="Estimated visits a month from this search">Est. visits</th><th>Page</th>{tab === "added" && onTrack && <th><span className="sr-only">Track</span></th>}</tr></thead>
                <tbody>
                  {list.slice(0, 50).map((k) => (
                    <tr key={k.keyword}>
                      <td>{k.keyword}</td><td className="num">{(tab === "added" ? k.position : k.was) ?? "—"}</td><td className="num">{fmtNum(k.volume)}</td><td className="num">{k.traffic == null ? "—" : fmtNum(Math.round(k.traffic))}</td>
                      <td className="max-w-[16rem] truncate g-text-2" title={k.path ?? undefined}>{k.path ?? "—"}</td>
                      {tab === "added" && onTrack && <td className="num"><button type="button" className="g-pill g-pill--sm" onClick={() => onTrack([k])} aria-label={`Track ${k.keyword} in the rank tracker`}>Track</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.length > 50 && <p className="g-text-2 mt-1 text-[12px]">The first 50 of {fmtNum(list.length)}{list.length >= 100 ? " or more" : ""}.</p>}
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">Positions and visits are the source's estimates for the country this site is tracked in, at each snapshot. A search the site "no longer ranks for" may be one Google has stopped showing it for, or one the source no longer measures.</p>
        </div>
      )}
    </section>
  );
}
