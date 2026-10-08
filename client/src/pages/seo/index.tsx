/** /seo/rank-tracker — rank tracker: tiles, the positions table with movement, Search Console if connected, recent checks. */
import { Fragment, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, fmtUnit, money, Move, SeoShell, Tile, useSelectedSite, useSeoSites, useSeoStatus, type SeoSite } from "./shell";
import { KeywordHistory, RankHistoryPanel } from "./rank-history";

type Position = { position: number | null; url: string | null; checkedOn: string; previous: number | null; previousOn: string | null; features: string[] } | null;
type Overview = {
  site: SeoSite; devices: ("desktop" | "mobile")[];
  summary: { tracked: number; checked: number; top3: number; top10: number; averagePosition: number | null; improved: number; declined: number; lastCheckedOn: string | null };
  rows: { id: number; keyword: string; tags: string[]; searchVolume: number | null; cpc: number | null; difficulty: number | null; positions: Record<string, Position> }[];
  runs: { id: string; trigger: string; status: string; total: number; checked: number; error: string | null; created_at: string; finished_at: string | null }[];
  searchConsole: { property: string; clicks: number; impressions: number; position: number | null; previousClicks: number; previousImpressions: number } | null;
  nextCheck: { serps: number; priceCents?: number; nextAt: string | null };
};

const RUN_STATUS: Record<string, string> = { queued: "queued", running: "checking", done: "done", failed: "didn't finish" };
const RUN_TRIGGER: Record<string, string> = { weekly: "weekly check", manual: "run now" };

export default function SeoOverviewPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openKw, setOpenKw] = useState<number | null>(null);
  const overview = useQuery<Overview>({
    queryKey: [`/api/seo/sites/${site?.id}/overview`], enabled: !!site,
    refetchInterval: (q) => q.state.data?.runs.some((r) => r.status === "queued" || r.status === "running") ? 20_000 : false,
  });
  const invalidate = () => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${site?.id}/overview`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); };
  const runNow = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/rank-check`),
    onSuccess: (r: { serps: number; reused: boolean }) => { invalidate(); toast({ title: r.reused ? "A check is already running" : "Rank check started", description: r.reused ? "Results arrive over the next few minutes." : `${r.serps} search result page${r.serps === 1 ? "" : "s"} queued. Results arrive over the next few minutes.` }); },
    onError: (e) => toast({ title: "Couldn't start the check", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api("DELETE", `/api/seo/keywords/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast({ title: "Couldn't remove the keyword", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const o = overview.data;
  const configured = !!status.data?.configured;
  const running = o?.runs.some((r) => r.status === "queued" || r.status === "running");
  return (
    <SeoShell
      title="Rank tracker" description="Where your site ranks on Google for the keywords you chose, checked every week." site={site} onSite={onSite} sites={sites} status={status}
      actions={site && (
        <Button className="w-full sm:w-auto" disabled={!configured || !o || !o.rows.length || runNow.isPending || running} onClick={() => runNow.mutate()} data-testid="button-run-rank-check" title={!configured ? "Rank tracking is being switched on for your account" : undefined}>
          {runNow.isPending || running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {running ? "Checking…" : `Run check now${o?.nextCheck.priceCents ? ` · about ${money(o.nextCheck.priceCents)}` : ""}`}
        </Button>
      )}
    >
      {!site && sites.isSuccess && <Empty testId="seo-empty-sites"><h3>No sites yet</h3><p>Add the domain you want to track. Then add the keywords you care about, and the first check runs on the next weekly tick — or straight away with "Run check now".</p></Empty>}
      {site && o && (
        <>
          <div className="g-tiles mb-5">
            <Tile label="Tracked keywords" value={fmtNum(o.summary.tracked)} hint={o.summary.lastCheckedOn ? `Last checked ${fmtDate(o.summary.lastCheckedOn)}` : "Not checked yet"} testId="tile-tracked" />
            <Tile label="In the top 10" value={fmtNum(o.summary.top10)} hint={`${fmtNum(o.summary.top3)} in the top 3`} testId="tile-top10" />
            <Tile label="Average position" value={o.summary.averagePosition ?? "—"} hint={`${o.devices[0]}, ranked keywords only`} testId="tile-average" />
            <Tile label="Since last check" value={<><span className="g-move g-move--up text-[20px]">▲{o.summary.improved}</span> <span className="g-move g-move--down text-[20px]">▼{o.summary.declined}</span></>} hint="Keywords up / down" testId="tile-movement" />
            {o.searchConsole ? (
              <>
                <Tile label="Search Console clicks (28 days)" value={fmtNum(o.searchConsole.clicks)} hint={`${fmtNum(o.searchConsole.previousClicks)} the 28 days before`} testId="tile-gsc-clicks" />
                <Tile label="Impressions (28 days)" value={fmtNum(o.searchConsole.impressions)} hint={o.searchConsole.position != null ? `Average position ${o.searchConsole.position}` : o.searchConsole.property} testId="tile-gsc-impressions" />
              </>
            ) : (
              <Tile label="Search Console" value="—" hint={<Link href="/search-console" className="g-link">Connect the property for clicks and impressions</Link>} testId="tile-gsc-missing" />
            )}
            <Tile label="Next weekly check" value={configured ? fmtDate(o.nextCheck.nextAt) : "—"} hint={configured ? `${fmtNum(o.nextCheck.serps)} result page${o.nextCheck.serps === 1 ? "" : "s"} per check` : "Being switched on"} testId="tile-next-check" />
            {status.data && <Tile label="Keywords in your plan" value={fmtUnit(status.data.usage.keywords)} hint="Across all your sites" testId="tile-plan-keywords" />}
          </div>
          <RankHistoryPanel site={site} />
          <AddKeywords site={site} onAdded={invalidate} />
          {o.rows.length === 0 ? (
            <Empty testId="seo-empty-keywords"><h3>No keywords tracked for {site.domain}</h3><p>Paste keywords above, or <Link href="/seo/keywords" className="g-link">research keywords</Link> and track the ones with volume.</p></Empty>
          ) : (
            <table className="g-table" data-testid="table-positions">
              <thead><tr><th>Keyword</th>{o.devices.map((d) => <th key={d} className="num">{d === "desktop" ? "Desktop" : "Mobile"}</th>)}<th className="num">Volume</th><th>Ranking page</th><th className="num">Checked</th><th aria-label="Remove" /></tr></thead>
              <tbody>
                {o.rows.map((r) => {
                  const first = r.positions[o.devices[0]];
                  return (
                    <Fragment key={r.id}>
                    <tr data-testid={`row-keyword-${r.id}`}>
                      <td><button type="button" className="g-link text-left" aria-expanded={openKw === r.id} onClick={() => setOpenKw(openKw === r.id ? null : r.id)} title="Show this keyword's history" data-testid={`button-history-${r.id}`}>{r.keyword}</button>{r.tags.length > 0 && <span className="g-text-2 text-[12px]"> · {r.tags.join(", ")}</span>}</td>
                      {o.devices.map((d) => { const p = r.positions[d]; return <td key={d} className="num" data-label={d === "desktop" ? "Desktop" : "Mobile"}>{p ? <>{p.position ?? `>${site.serpDepth}`} <Move now={p.position} before={p.previous} hadBefore={!!p.previousOn} /></> : <span className="g-text-2">—</span>}</td>; })}
                      <td className="num" data-label="Volume">{fmtNum(r.searchVolume)}</td>
                      <td data-label="Page" className="max-w-[280px] truncate">{first?.url ? <a href={first.url} className="g-link" target="_blank" rel="noreferrer">{first.url.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="g-text-2">—</span>}</td>
                      <td className="num g-text-2" data-label="Checked">{first ? fmtDate(first.checkedOn) : "—"}</td>
                      <td className="num"><button type="button" className="g-pill g-pill--danger !min-h-8 !px-2" onClick={() => remove.mutate(r.id)} aria-label={`Remove ${r.keyword}`} data-testid={`button-remove-${r.id}`}><Trash2 /></button></td>
                    </tr>
                    {openKw === r.id && <tr data-testid={`row-history-${r.id}`}><td colSpan={o.devices.length + 5}><KeywordHistory id={r.id} devices={o.devices} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          {o.runs.length > 0 && (
            <section className="mt-6">
              <h2 className="g-text mb-2 text-[16px] font-medium">Recent checks</h2>
              <ul className="g-text-2 space-y-1 text-[13px]" data-testid="list-runs">
                {o.runs.map((r) => <li key={r.id}>{fmtDate(r.created_at)} · {RUN_TRIGGER[r.trigger] ?? r.trigger} · {RUN_STATUS[r.status] ?? r.status}{r.total ? ` · ${r.checked}/${r.total} checks` : ""}{r.error ? <span className="g-closed"> · {r.error}</span> : null}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </SeoShell>
  );
}

function AddKeywords({ site, onAdded }: { site: SeoSite; onAdded: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");
  const m = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site.id}/keywords`, { keywords: text.split(/\n|,/).map((s) => s.trim()).filter(Boolean).slice(0, 500), tags: tag.trim() ? [tag.trim()] : [] }),
    onSuccess: (r: { added: number }) => { setText(""); setTag(""); setOpen(false); onAdded(); toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} added` }); },
    onError: (e) => toast({ title: "Couldn't add keywords", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!open) return <div className="mb-4"><button type="button" className="g-pill" onClick={() => setOpen(true)} data-testid="button-add-keywords"><Plus /> Add keywords</button></div>;
  return (
    <form className="g-callout mb-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} data-testid="form-add-keywords">
      <h3>Keywords to track for {site.domain}</h3>
      <p>One per line (or comma-separated). Each is checked on {site.devices === "both" ? "desktop and mobile" : site.devices} every week.</p>
      <textarea className="g-input mt-2 min-h-[120px] py-2" value={text} onChange={(e) => setText(e.target.value)} placeholder={"roofing contractor tampa\nroof repair near me"} data-testid="textarea-keywords" />
      <label className="mt-2 block text-[13px]"><span className="g-text-2">Tag (optional) — group these keywords, e.g. a service or a city</span>
        <input className="g-input mt-1" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} placeholder="roofing" data-testid="input-keyword-tag" />
      </label>
      <div className="mt-2 flex gap-2">
        <Button type="submit" disabled={m.isPending || !text.trim()} data-testid="button-save-keywords">{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Track these"}</Button>
        <button type="button" className="g-pill" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
