/** /seo/rank-tracker — rank tracker: tiles, the positions table with movement, Search Console if connected, recent checks. */
import { GscBreakdownView } from "./gsc-breakdown";
import { SerpFeatureChips, hasFeature, ownsFeature } from "./serp-features";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, fmtUnit, money, Move, SeoShell, Tile, useSelectedSite, useSeoSites, useSeoStatus, type SeoSite } from "./shell";
import { KeywordHistory, RankHistoryPanel } from "./rank-history";
import { RankTagsPanel } from "./rank-tags";
import { CompetingPages } from "./competing";
import { SerpGroupsPanel } from "./serp-groups";
import { LocationPicker, type Place } from "./location-picker";
import { CompetitorPanel } from "./rank-competitors";

type Position = { position: number | null; url: string | null; checkedOn: string; previous: number | null; previousOn: string | null; features: string[]; local?: number | null; previousLocal?: number | null; pack?: { position: number; title: string; domain: string | null }[]; top?: { position: number; domain: string; url?: string | null; title?: string | null }[] } | null;
type Overview = {
  site: SeoSite; devices: ("desktop" | "mobile")[];
  summary: { tracked: number; checked: number; top3: number; top10: number; averagePosition: number | null; improved: number; declined: number; lastCheckedOn: string | null; inMapPack?: number; withMapPack?: number };
  rows: { id: number; keyword: string; location?: string | null; tags: string[]; searchVolume: number | null; cpc: number | null; difficulty: number | null; positions: Record<string, Position> }[];
  runs: { id: string; trigger: string; status: string; total: number; checked: number; error: string | null; created_at: string; finished_at: string | null }[];
  searchConsole: { property: string; clicks: number | null; impressions: number | null; position: number | null; previousClicks: number | null; previousImpressions: number | null; days?: number; previousDays?: number; through?: string | null; comparable?: boolean } | null;
  nextCheck: { serps: number; priceCents?: number; nextAt: string | null; perMonthCents?: Record<"weekly" | "twice_weekly" | "daily", number> };
};

const RUN_STATUS: Record<string, string> = { queued: "queued", running: "checking", done: "done", failed: "didn't finish" };
const RUN_TRIGGER: Record<string, string> = { weekly: "automatic check", manual: "run now" };

/** What the Search Console tile says under its number: the comparison when both 28-day windows are complete, otherwise how much of EACH is synced. */
function gscHint(g: { clicks: number | null; previousClicks: number | null; days?: number; previousDays?: number; through?: string | null; comparable?: boolean }): string {
  if (g.comparable) return `${fmtNum(g.previousClicks)} the 28 days before`;
  const now = g.days ?? 0, before = g.previousDays ?? 0;
  return `${now} of the last 28 days synced${g.through ? ` (to ${fmtDate(g.through)})` : ""}; ${before} of the 28 before — not compared`;
}

export default function SeoOverviewPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openKw, setOpenKw] = useState<number | null>(null);
  const overview = useQuery<Overview>({
    queryKey: [`/api/seo/sites/${site?.id}/overview`], enabled: !!site, refetchOnMount: "always", 
    refetchInterval: (q) => q.state.data?.runs.some((r) => r.status === "queued" || r.status === "running") ? 20_000 : false,
  });
  // The history charts (their keys carry the device/tag) and the dashboard change with every check and keyword edit.
  const refreshHistory = () => { void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0].startsWith(`/api/seo/sites/${site?.id}/rank-history`) || q.queryKey[0].startsWith(`/api/seo/sites/${site?.id}/rank-tags`) || q.queryKey[0] === `/api/seo/sites/${site?.id}/rank-competing` || q.queryKey[0].startsWith(`/api/seo/sites/${site?.id}/serp-groups`) || /^\/api\/seo\/keywords\/\d+\/history$/.test(q.queryKey[0])) }); void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); };
  const invalidate = () => { refreshHistory(); void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${site?.id}/overview`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); };
  const runNow = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/rank-check`),
    onSuccess: (r: { serps: number; reused: boolean }) => { invalidate(); toast({ title: r.reused ? "A check is already running" : "Rank check started", description: r.reused ? "Results arrive over the next few minutes." : `${r.serps} search result page${r.serps === 1 ? "" : "s"} queued. Results arrive over the next few minutes.` }); },
    onError: (e) => toast({ title: "Couldn't start the check", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const volumes = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/keywords/volumes`),
    onSuccess: (r: { updated: number }) => { invalidate(); toast({ title: r.updated ? `Search volume added for ${r.updated} keyword${r.updated === 1 ? "" : "s"}` : "No search volume found for these keywords" }); },
    onError: (e) => toast({ title: "Couldn't get search volumes", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api("DELETE", `/api/seo/keywords/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast({ title: "Couldn't remove the keyword", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const o = overview.data;
  const configured = !!status.data?.configured;
  const running = o?.runs.some((r) => r.status === "queued" || r.status === "running");
  // A check that just finished has new numbers for the history charts and the dashboard.
  const wasRunning = useRef(false);
  useEffect(() => { if (wasRunning.current && !running) refreshHistory(); wasRunning.current = !!running; }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
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
      {site && overview.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your rankings…</p>}
      {site && overview.isError && <div className="g-callout" role="alert" data-testid="rank-overview-error"><h3>Couldn't load your rankings</h3><p>{apiErrorMessage(overview.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void overview.refetch()}>Try again</button></div>}
      {site && o && (
        <>
          <div className="g-tiles mb-5">
            <Tile label="Tracked keywords" value={fmtNum(o.summary.tracked)} hint={o.summary.lastCheckedOn ? `Last checked ${fmtDate(o.summary.lastCheckedOn)}` : "Not checked yet"} testId="tile-tracked" />
            <Tile label="In the top 10" value={fmtNum(o.summary.top10)} hint={`${fmtNum(o.summary.top3)} in the top 3`} testId="tile-top10" />
            <Tile label="Average position" value={o.summary.averagePosition ?? "—"} hint={`${o.devices[0]}, ranked keywords only`} testId="tile-average" />
            {(o.summary.withMapPack ?? 0) > 0 && <Tile label="In the Google map pack" value={fmtNum(o.summary.inMapPack ?? 0)} hint={`of ${fmtNum(o.summary.withMapPack)} searches that show a map`} testId="tile-map-pack" />}
            <Tile label="Since last check" value={<><span className="g-move g-move--up text-[20px]">▲{o.summary.improved}</span> <span className="g-move g-move--down text-[20px]">▼{o.summary.declined}</span></>} hint="Keywords up / down" testId="tile-movement" />
            {o.searchConsole ? (
              <>
                <Tile label={o.searchConsole.through ? `Search Console clicks (28 days to ${fmtDate(o.searchConsole.through)})` : "Search Console clicks (28 days)"} value={fmtNum(o.searchConsole.clicks)} hint={gscHint(o.searchConsole)} testId="tile-gsc-clicks" />
                <Tile label="Impressions (28 days)" value={fmtNum(o.searchConsole.impressions)} hint={o.searchConsole.position != null ? `Average position ${o.searchConsole.position}` : o.searchConsole.property} testId="tile-gsc-impressions" />
              </>
            ) : (
              <Tile label="Search Console" value="—" hint={<Link href="/search-console" className="g-link">Connect the property for clicks and impressions</Link>} testId="tile-gsc-missing" />
            )}
            <Tile label="Next automatic check" value={configured ? fmtDate(o.nextCheck.nextAt) : "—"} hint={configured ? `${fmtNum(o.nextCheck.serps)} result page${o.nextCheck.serps === 1 ? "" : "s"} per check` : "Being switched on"} testId="tile-next-check" />
            {status.data && <Tile label="Keywords in your plan" value={fmtUnit(status.data.usage.keywords)} hint="Across all your sites" testId="tile-plan-keywords" />}
          </div>
          <RankHistoryPanel site={site} />
          <RankTagsPanel site={site} />
          <CompetingPages site={site} />
          <SerpGroupsPanel site={site} />
          {o?.searchConsole && <GscBreakdownView site={site} />}
          <CompetitorPanel site={site} onExplore={(d) => { window.location.href = `/seo/explorer?domain=${encodeURIComponent(d)}`; }} />
          <AddKeywords site={site} onAdded={invalidate} />
          {o.rows.some((r) => r.searchVolume == null) && (
            <p className="g-text-2 mb-4 flex flex-wrap items-center gap-2 text-[13px]" data-testid="volumes-missing">
              {o.rows.filter((r) => r.searchVolume == null).length} of your keywords have no monthly search volume yet.
              <button type="button" className="g-pill g-pill--sm" disabled={volumes.isPending || !configured} onClick={() => volumes.mutate()} data-testid="button-get-volumes">{volumes.isPending ? <Loader2 className="animate-spin" /> : null} Get search volumes{status.data?.prices?.searchVolumes ? ` · about ${money(status.data.prices.searchVolumes)}` : ""}</button>
            </p>
          )}
          <TrackingSettings site={site} onSaved={invalidate} perMonthCents={o?.nextCheck.perMonthCents} includedCents={status.data?.credits?.includedCents ?? null} />
          {o.rows.length === 0 ? (
            <Empty testId="seo-empty-keywords"><h3>No keywords tracked for {site.domain}</h3><p>Paste keywords above, or <Link href="/seo/keywords" className="g-link">research keywords</Link> and track the ones with volume.</p></Empty>
          ) : (
            <>
            {(() => {
              const firsts = o.rows.map((r) => r.positions[o.devices[0]]).filter((p): p is NonNullable<typeof p> => !!p);
              if (!firsts.length) return null;
              // A map pack is known three ways (the feature list, the saved pack, our own place in it): any of them counts.
              const maps = firsts.filter((p) => hasFeature(p.features, "local_pack") || (p.pack?.length ?? 0) > 0 || p.local != null);
              const count = (t: string) => firsts.filter((p) => hasFeature(p.features, t)).length;
              // "You are in it" is known only for checks made since it is looked at; older checks are counted apart, not as "no".
              const looked = (t: string) => firsts.filter((p) => hasFeature(p.features, t) && hasFeature(p.features, "own:checked"));
              const known = (t: string, verb: string) => {
                const l = looked(t), older = count(t) - l.length, yes = l.filter((p) => ownsFeature(p.features, t)).length;
                if (!l.length) return `whether ${verb} is not known for ${older === 1 ? "this older check" : "these older checks"}`;
                return `${verb} on ${yes}${older ? ` of the ${l.length} checked for it; not known for ${older} older check${older === 1 ? "" : "s"}` : ""}`;
              };
              const parts = [
                maps.length ? `a map pack on ${maps.length} (you are in ${maps.filter((p) => p.local != null).length})` : null,
                count("ai_overview") ? `an AI overview on ${count("ai_overview")} (${known("ai_overview", "it cites you")})` : null,
                count("featured_snippet") ? `a featured snippet on ${count("featured_snippet")} (${known("featured_snippet", "it is yours")})` : null,
                count("people_also_ask") ? `"people also ask" on ${count("people_also_ask")}` : null,
              ].filter(Boolean);
              return parts.length ? <p className="g-text-2 mb-2 text-[13px]" data-testid="text-serp-features">Of your {firsts.length} keyword{firsts.length === 1 ? "" : "s"} checked on {o.devices[0]}, Google shows {parts.join(", ")}.</p> : null;
            })()}
            <table className="g-table" data-testid="table-positions">
              <thead><tr><th>Keyword</th>{o.devices.map((d) => <th key={d} className="num">{d === "desktop" ? "Desktop" : "Mobile"}</th>)}<th className="num" title="Your place among the businesses Google shows on the map for this search">Map pack</th><th title="What else Google shows for this search; a green chip means you are in it">On the page</th><th className="num">Volume</th><th>Ranking page</th><th className="num">Checked</th><th aria-label="Remove" /></tr></thead>
              <tbody>
                {o.rows.map((r) => {
                  const first = r.positions[o.devices[0]];
                  return (
                    <Fragment key={r.id}>
                    <tr data-testid={`row-keyword-${r.id}`}>
                      <td><button type="button" className="g-link text-left" aria-expanded={openKw === r.id} onClick={() => setOpenKw(openKw === r.id ? null : r.id)} title="Show this keyword's history" data-testid={`button-history-${r.id}`}>{r.keyword}</button>{r.location && r.location !== "United States" && <span className="g-text-2 text-[12px]"> · {r.location}</span>}{r.tags.length > 0 && <span className="g-text-2 text-[12px]"> · {r.tags.join(", ")}</span>}</td>
                      {o.devices.map((d) => { const p = r.positions[d]; return <td key={d} className="num" data-label={d === "desktop" ? "Desktop" : "Mobile"}>{p ? <>{p.position ?? `>${site.serpDepth}`} <Move now={p.position} before={p.previous} hadBefore={!!p.previousOn} /></> : <span className="g-text-2">—</span>}</td>; })}
                      <td className="num" data-label="Map pack">{!first ? <span className="g-text-2">—</span> : first.local != null ? <>#{first.local} <Move now={first.local} before={first.previousLocal ?? null} hadBefore={!!first.previousOn} /></> : (first.pack?.length ?? 0) > 0 ? <span className="g-text-2" title={`In the map pack: ${first.pack!.map((p) => p.title).join(", ")}`}>not in it{first.previousLocal != null && <> <span className="g-move g-move--down">lost</span></>}</span> : <span className="g-text-2" title="Google showed no map for this search">no map</span>}</td>
                      <td data-label="On the page">{first ? <SerpFeatureChips features={(first.pack?.length ?? 0) > 0 || first.local != null ? [...new Set([...(first.features ?? []), "local_pack"])] : first.features} mapOwned={first.local != null} /> : <span className="g-text-2">—</span>}</td>
                      <td className="num" data-label="Volume">{fmtNum(r.searchVolume)}</td>
                      <td data-label="Page" className="max-w-[280px] truncate">{first?.url ? <a href={first.url} className="g-link" target="_blank" rel="noreferrer">{first.url.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="g-text-2">—</span>}</td>
                      <td className="num g-text-2" data-label="Checked">{first ? fmtDate(first.checkedOn) : "—"}</td>
                      <td className="num"><button type="button" className="g-pill g-pill--danger !min-h-8 !px-2" onClick={() => remove.mutate(r.id)} aria-label={`Remove ${r.keyword}`} data-testid={`button-remove-${r.id}`}><Trash2 /></button></td>
                    </tr>
                    {openKw === r.id && <tr data-testid={`row-history-${r.id}`}><td colSpan={o.devices.length + 6}>{(first?.pack?.length ?? 0) > 0 && <p className="g-text-2 mb-2 text-[13px]" data-testid={`pack-${r.id}`}>Google's map pack for this search ({fmtDate(first!.checkedOn)}): {first!.pack!.map((p) => `${p.position}. ${p.title}`).join(" · ")}</p>}<KeywordHistory id={r.id} devices={o.devices} />{(first?.top?.length ?? 0) > 0 && (
                      <div className="mt-3" data-testid={`serp-${r.id}`}>
                        <h4 className="g-text mb-1 text-[13px] font-medium">Google's first page for this search <span className="g-text-2 font-normal">· {fmtDate(first!.checkedOn)}</span></h4>
                        <ol className="space-y-0.5 text-[13px]">{first!.top!.map((t) => { const mine = t.domain === site.domain || t.domain.endsWith(`.${site.domain}`); return <li key={`${t.position}-${t.domain}`} className={mine ? "g-text font-medium" : "g-text-2"}><span className="inline-block w-6 tabular-nums">{t.position}.</span> {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="g-link">{t.domain}</a> : t.domain}{mine ? " · you" : ""}{t.title ? <span className="g-text-2 font-normal"> — {t.title}</span> : null}</li>; })}</ol>
                      </div>
                    )}</td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </>
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
  const [place, setPlace] = useState<Place | null>(null);
  const m = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site.id}/keywords`, { keywords: text.split(/\n|,/).map((s) => s.trim()).filter(Boolean).slice(0, 500), tags: tag.trim() ? [tag.trim()] : [], ...(place ? { locationCode: place.code } : {}) }),
    onSuccess: (r: { added: number }) => { setText(""); setTag(""); setPlace(null); setOpen(false); onAdded(); toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} added` }); },
    onError: (e) => toast({ title: "Couldn't add keywords", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!open) return <div className="mb-4"><button type="button" className="g-pill" onClick={() => setOpen(true)} data-testid="button-add-keywords"><Plus /> Add keywords</button></div>;
  return (
    <form className="g-callout mb-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} data-testid="form-add-keywords">
      <h3>Keywords to track for {site.domain}</h3>
      <p>One per line (or comma-separated). Each is checked on {site.devices === "both" ? "desktop and mobile" : site.devices} every week.</p>
      <textarea aria-label={`Keywords to track for ${site.domain}, one per line`} className="g-input mt-2 min-h-[120px] py-2" value={text} onChange={(e) => setText(e.target.value)} placeholder={"roofing contractor tampa\nroof repair near me"} data-testid="textarea-keywords" />
      <div className="mt-2 text-[13px]"><div className="g-text-2 mb-1">Where to check from (optional) — pick a city or ZIP code to see what customers there see, including the map</div>
        <div className="sm:max-w-sm"><LocationPicker value={place} onChange={setPlace} /></div>
      </div>
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

/** Per-site settings: the name on the Google Business Profile (to find the business in the map pack) and alerts. */
const FREQUENCY = { weekly: "Every week", twice_weekly: "Twice a week", daily: "Every day" } as const;
type Frequency = keyof typeof FREQUENCY;
function TrackingSettings({ site, onSaved, perMonthCents, includedCents }: { site: SeoSite; onSaved: () => void; /** A month of automatic checks at each frequency, at today's keywords. */ perMonthCents?: Record<Frequency, number>; includedCents: number | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(site.businessName ?? "");
  const [alerts, setAlerts] = useState(site.alertsEnabled !== false);
  const [drop, setDrop] = useState(site.alertDrop ?? 3);
  const [freq, setFreq] = useState<Frequency>(site.rankFrequency ?? "weekly");
  useEffect(() => { setName(site.businessName ?? ""); setAlerts(site.alertsEnabled !== false); setDrop(site.alertDrop ?? 3); setFreq(site.rankFrequency ?? "weekly"); }, [site.id, site.businessName, site.alertsEnabled, site.alertDrop, site.rankFrequency]);
  const m = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site.id}/settings`, { businessName: name.trim() || null, alertsEnabled: alerts, alertDrop: drop, rankFrequency: freq }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); onSaved(); toast({ title: "Tracking settings saved" }); },
    onError: (e) => toast({ title: "Couldn't save the settings", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <details className="mb-4 text-[13px]" data-testid="tracking-settings">
      <summary className="g-link cursor-pointer">Tracking settings{!site.businessName ? " — add your business name to track the Google map pack" : ""}</summary>
      <form className="g-callout mt-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <label className="block"><span className="g-text-2">Business name, exactly as on your Google Business Profile</span>
          <input className="g-input mt-1 sm:max-w-sm" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Alpine Exteriors" data-testid="input-business-name" />
        </label>
        <p className="g-text-2 mt-1 text-[12px]">Businesses on Google's map often show no website, so we find yours by its name as well as by {site.domain}.</p>
        <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} data-testid="checkbox-alerts" /> <span className="g-text">Alert me when rankings or links change</span></label>
        <label className="mt-2 flex flex-wrap items-center gap-2"><span className="g-text-2">A ranking counts as moved when it changes by at least</span>
          <select className="g-select" value={drop} onChange={(e) => setDrop(Number(e.target.value))} disabled={!alerts} data-testid="select-alert-drop">{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} position{n === 1 ? "" : "s"}</option>)}</select>
        </label>
        <label className="mt-3 flex flex-wrap items-center gap-2"><span className="g-text-2">Check rankings automatically</span>
          <select className="g-select" value={freq} onChange={(e) => setFreq(e.target.value as Frequency)} data-testid="select-rank-frequency">
            {(Object.keys(FREQUENCY) as Frequency[]).map((f) => <option key={f} value={f}>{FREQUENCY[f]}{perMonthCents ? ` — about ${money(perMonthCents[f])} a month` : ""}</option>)}
          </select>
        </label>
        <p className="g-text-2 mt-1 text-[12px]" data-testid="text-rank-frequency-note">
          {perMonthCents ? `At your ${fmtNum(site.keywordCount)} tracked keyword${site.keywordCount === 1 ? "" : "s"}, a month of checks ${FREQUENCY[freq].toLowerCase()} uses about ${money(perMonthCents[freq])} of SEO data` : "The cost of a month of checks shows here once keywords are tracked"}{includedCents != null && perMonthCents ? ` — your plan includes ${money(includedCents)} a month` : ""}. Automatic checks only use your included data; when it runs out they wait, and are never charged to credit you bought. A site already checked on a day (UTC) is not checked again automatically that day; "Run check now" always runs.
        </p>
        <div className="mt-3"><Button type="submit" disabled={m.isPending} aria-busy={m.isPending} data-testid="button-save-settings">{m.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> Saving settings…</> : "Save settings"}</Button></div>
      </form>
    </details>
  );
}
