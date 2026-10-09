/**
 * Rank tracker → Competitors: how visible you are on your tracked keywords next
 * to the competitors you follow, the other sites Google shows most on those
 * keywords, and who leads the map pack. Read from the result pages the weekly
 * check already saved (GET /api/seo/sites/:id/voice) — free.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, fmtDate, fmtNum, type SeoSite } from "./shell";
import { ORANGE, PALETTE } from "./viz";
import { CARD, PanelTitle, SectionTitle } from "./viz-rank";

type Row = { domain: string; isSite: boolean; visibility: number; top3: number; top10: number; ranked: number; averagePosition: number | null; observed?: number };
type Voice = { device: string; devices?: string[]; tracked?: number; checkedOn: string | null; hasPages: boolean; max: number; keywords: number; competitors: string[]; domains: Row[];
  seenMost: { domain: string; keywords: number; bestPosition: number }[]; mapLeaders: { title: string; domain: string | null; keywords: number; isSite: boolean }[] };

export function CompetitorPanel({ site, onExplore }: { site: SeoSite; onExplore?: (domain: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [device, setDevice] = useState("");
  // One tag's keywords only (a service, a town), or all of them.
  const [tag, setTag] = useState("");
  useEffect(() => { setDevice(""); setTag(""); }, [site.id]);
  const params = new URLSearchParams({ ...(device ? { device } : {}), ...(tag ? { tag } : {}) }).toString();
  const key = `/api/seo/sites/${site.id}/voice${params ? `?${params}` : ""}`;
  // The answer for the previous choice stays on screen (marked as loading) while another tag loads, so the choice keeps its focus.
  const q = useQuery<Voice & { tag?: string | null; tags?: string[] }>({ queryKey: [key], refetchOnMount: "always",
    // Not kept forever: read again after a minute when looked at again (a check run elsewhere shows up).
    staleTime: 60_000, refetchOnWindowFocus: true,
    // Only this site's earlier answer may stand in (never another site's while it loads).
    placeholderData: (prev, prevQuery) => (typeof prevQuery?.queryKey[0] === "string" && prevQuery.queryKey[0].startsWith(`/api/seo/sites/${site.id}/voice`) ? prev : undefined) });
  // Following or dropping a competitor changes every tag's view, so all of them are read again.
  const done = () => { void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith(`/api/seo/sites/${site.id}/voice`) }); };
  const add = useMutation({
    mutationFn: (domain: string) => api("POST", `/api/seo/sites/${site.id}/tracked-competitors`, { domain }),
    onSuccess: () => { setInput(""); done(); },
    onError: (e) => toast({ title: "Couldn't follow that competitor", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (domain: string) => api("DELETE", `/api/seo/sites/${site.id}/tracked-competitors/${encodeURIComponent(domain)}`),
    onSuccess: done,
    onError: (e) => toast({ title: "Couldn't remove that competitor", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // The last answer keeps the heading and choices on screen when a choice fails, so another can be picked (focus kept).
  const [last, setLast] = useState<(Voice & { tag?: string | null; tags?: string[] }) | null>(null);
  useEffect(() => { if (q.data && !q.isPlaceholderData) setLast(q.data); }, [q.data, q.isPlaceholderData]);
  // A tag that no longer exists (removed elsewhere) goes back to all keywords.
  // (Learned either from a newer answer's tag list or from the server refusing the tag.)
  useEffect(() => {
    if (!tag || q.isFetching) return;
    if ((last?.tags && !last.tags.includes(tag)) || (q.isError && /no keywords with that tag/i.test(apiErrorMessage(q.error)))) setTag("");
  }, [last, tag, q.isFetching, q.isError, q.error]);
  const v = q.data ?? last;
  if (!v) {
    if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading competitors…</p>;
    if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't load competitors: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
    return null;
  }
  // Shown figures belong to the choice made only when they were read for it.
  const stale = !q.data || q.isError;
  // None of the chosen keywords was in the newest check: nothing measured (never "0%").
  const unmeasured = v.keywords === 0;
  const full = v.competitors.length >= v.max;
  const top = Math.max(1, ...v.domains.map((d) => d.visibility));
  return (
    <section className="mb-5" data-testid="rank-competitors">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <SectionTitle>Competitors</SectionTitle>
        {(v.tags?.length ?? 0) > 0 && (
          <label className="flex items-center gap-1 text-[12px]"><span className="g-text-2">Keywords</span>
            <select className="g-select min-w-0 max-w-[12rem]" value={tag} onChange={(e) => setTag(e.target.value)} aria-describedby={q.isPlaceholderData ? `voice-loading-${site.id}` : undefined} data-testid="select-voice-tag">
              <option value="">All</option>
              {v.tags!.map((t) => <option key={t} value={t}>Tagged {t}</option>)}
            </select></label>
        )}
        {q.isError && <span className="text-[12px]" role="alert" data-testid="text-voice-error">Couldn't load {tag ? `"${tag}"` : "these keywords"}: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button>{tag && <> · <button type="button" className="g-link" onClick={() => setTag("")}>All keywords</button></>}{stale ? " — what is shown below is the earlier answer." : ""}</span>}
        {q.isPlaceholderData && <span id={`voice-loading-${site.id}`} className="g-text-2 text-[12px]" role="status"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Loading {tag ? `"${tag}"` : "all keywords"}…</span>}
        {v.keywords > 0 && <span className="g-text-2 text-[12px]" data-testid="text-voice-coverage">{fmtNum(v.keywords)}{v.tracked != null && v.tracked > v.keywords ? ` of your ${fmtNum(v.tracked)}` : ""} tracked keyword{v.keywords === 1 ? "" : "s"}, checked {fmtDate(v.checkedOn)}</span>}
        {(v.devices?.length ?? 0) > 1 && <span className="flex gap-1" role="group" aria-label="Device">{v.devices!.map((d) => <button key={d} type="button" className="g-pill g-pill--sm" aria-pressed={v.device === d} style={v.device === d ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined} onClick={() => setDevice(d)}>{d === "desktop" ? "Desktop" : "Mobile"}</button>)}</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border p-3 sm:p-4" style={CARD} data-testid="voice-share">
          <PanelTitle>Share of voice</PanelTitle>
          <p className="g-text-2 mb-3 text-[12px]">A visibility index from where each site ranks on these keywords — not a count of real clicks: 100% would mean first place for all of them.{v.keywords === 0 ? (tag ? ` None of the keywords tagged "${tag}" was in the newest check yet; the figures appear after the next check.` : " Follow your competitors now; the figures appear after the next check.") : ""}</p>
          <ul className="space-y-2">
            {v.domains.map((d) => (
              <li key={d.domain} data-testid={`voice-${d.domain}`}>
                <div className="flex items-center gap-2 text-[13px]">
                  <span className={`min-w-0 flex-1 truncate ${d.isSite ? "g-text font-medium" : "g-text"}`}>{d.domain}{d.isSite && <span className="g-text-2 font-normal"> · you</span>}</span>
                  {unmeasured || (!d.isSite && d.observed === 0) ? <span className="g-text-2 text-[12px]">not measured{!unmeasured ? " — no check saved its place yet" : ""}</span> : <>
                  {!d.isSite && d.observed != null && d.observed < v.keywords && <span className="g-text-2 text-[11px]">on {fmtNum(d.observed)} of {fmtNum(v.keywords)}</span>}
                  <span className="g-text-2 text-[12px] tabular-nums">{d.top10} in top 10{d.averagePosition != null ? ` · avg ${d.averagePosition}` : ""}</span>
                  <span className="g-text w-12 text-right tabular-nums">{d.visibility}%</span></>}
                  {!d.isSite && <button type="button" className="g-text-2" aria-label={`Stop following ${d.domain}`} disabled={remove.isPending} onClick={() => remove.mutate(d.domain)}><X className="h-3.5 w-3.5" /></button>}
                </div>
                {/* Bars in orange like every chart: your site in the full shade, the sites you follow in the lighter one. */}
                {!unmeasured && (d.isSite || d.observed !== 0) && <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden><div className="h-full rounded-full" style={{ width: `${(d.visibility / top) * 100}%`, background: d.isSite ? ORANGE : PALETTE.top10 }} /></div>}
              </li>
            ))}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (input.trim()) add.mutate(input.trim()); }} data-testid="form-follow-competitor">
            <label className="min-w-0 flex-1"><span className="sr-only">Competitor's website</span><input className="g-input w-full" value={input} onChange={(e) => setInput(e.target.value)} placeholder={full ? `You follow ${v.max} — remove one to add another` : "competitor.com"} disabled={full} data-testid="input-follow-competitor" /></label>
            <button type="submit" className="g-pill" disabled={full || !input.trim() || add.isPending}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Follow</button>
          </form>
          {!v.hasPages && !unmeasured && <p className="g-text-2 mt-2 text-[12px]">Competitor positions fill in at the next check — the checks shown did not save the result page.</p>}
          {v.hasPages && v.competitors.length > 0 && <p className="g-text-2 mt-2 text-[12px]">A competitor you just followed is measured in the top ten right away, and further down from the next check. A check reads Google's results only as far as the page your own site is on, so a competitor ranking below you may show as not found.</p>}
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border p-3 sm:p-4" style={CARD} data-testid="voice-seen-most">
            <PanelTitle>Seen most on your keywords</PanelTitle>
            <p className="g-text-2 mb-2 text-[12px]">Other sites in Google's top ten for the most of your keywords — your real competition for these searches.</p>
            {v.seenMost.length === 0 ? <p className="g-text-2 text-[13px]">{v.hasPages ? "No other site is in the top ten for these keywords." : "This fills in at the next check."}</p> : (
              <ul className="space-y-1 text-[13px]">
                {v.seenMost.slice(0, 8).map((s) => (
                  <li key={s.domain} className="flex items-center gap-2">
                    {onExplore ? <button type="button" className="g-link min-w-0 flex-1 truncate text-left" onClick={() => onExplore(s.domain)} title={`Analyse ${s.domain}`}>{s.domain}</button> : <span className="g-text min-w-0 flex-1 truncate">{s.domain}</span>}
                    <span className="g-text-2 text-[12px] tabular-nums">{s.keywords} keyword{s.keywords === 1 ? "" : "s"} · best #{s.bestPosition}</span>
                    <button type="button" className="g-pill g-pill--sm" disabled={full || add.isPending} onClick={() => add.mutate(s.domain)} aria-label={`Follow ${s.domain}`} data-testid={`button-follow-${s.domain}`}><Plus /> Follow</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {v.mapLeaders.length > 0 && (
            <div className="rounded-xl border p-3 sm:p-4" style={CARD} data-testid="voice-map-leaders">
              <PanelTitle>Who is in the Google map pack</PanelTitle>
              <p className="g-text-2 mb-2 text-[12px]">Businesses Google shows on the map for your keywords, by how many keywords they appear on.</p>
              <ul className="space-y-1 text-[13px]">
                {v.mapLeaders.slice(0, 8).map((l) => <li key={`${l.title}|${l.domain}`} className="flex items-baseline gap-2"><span className={`min-w-0 flex-1 truncate ${l.isSite ? "g-text font-medium" : "g-text"}`}>{l.title}{l.isSite && <span className="g-text-2 font-normal"> · you</span>}</span><span className="g-text-2 text-[12px] tabular-nums">{l.keywords} keyword{l.keywords === 1 ? "" : "s"}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
