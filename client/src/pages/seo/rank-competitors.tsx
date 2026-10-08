/**
 * Rank tracker → Competitors: how visible you are on your tracked keywords next
 * to the competitors you follow, the other sites Google shows most on those
 * keywords, and who leads the map pack. Read from the result pages the weekly
 * check already saved (GET /api/seo/sites/:id/voice) — free.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, fmtDate, fmtNum, type SeoSite } from "./shell";

type Row = { domain: string; isSite: boolean; visibility: number; top3: number; top10: number; ranked: number; averagePosition: number | null };
type Voice = { device: string; checkedOn: string | null; hasPages: boolean; max: number; keywords: number; competitors: string[]; domains: Row[];
  seenMost: { domain: string; keywords: number; bestPosition: number }[]; mapLeaders: { title: string; domain: string | null; keywords: number; isSite: boolean }[] };

const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };

export function CompetitorPanel({ site, onExplore }: { site: SeoSite; onExplore?: (domain: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const key = `/api/seo/sites/${site.id}/voice`;
  const q = useQuery<Voice>({ queryKey: [key], refetchOnMount: "always" });
  const done = () => { void qc.invalidateQueries({ queryKey: [key] }); };
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
  const v = q.data;
  if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading competitors…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't load competitors: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  if (!v || v.keywords === 0) return null;
  const full = v.competitors.length >= v.max;
  const top = Math.max(1, ...v.domains.map((d) => d.visibility));
  return (
    <section className="mb-5" data-testid="rank-competitors">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="g-text text-[16px] font-medium">Competitors</h2>
        <span className="g-text-2 text-[12px]">on your {fmtNum(v.keywords)} tracked keyword{v.keywords === 1 ? "" : "s"} · {v.device} · checked {fmtDate(v.checkedOn)}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4" style={card} data-testid="voice-share">
          <h3 className="g-text text-[14px] font-medium">Share of voice</h3>
          <p className="g-text-2 mb-3 text-[12px]">The share of clicks each site wins on these keywords. 100% would mean first place for all of them.</p>
          <ul className="space-y-2">
            {v.domains.map((d) => (
              <li key={d.domain} data-testid={`voice-${d.domain}`}>
                <div className="flex items-baseline gap-2 text-[13px]">
                  <span className={`min-w-0 flex-1 truncate ${d.isSite ? "g-text font-medium" : "g-text"}`}>{d.domain}{d.isSite && <span className="g-text-2 font-normal"> · you</span>}</span>
                  <span className="g-text-2 text-[12px] tabular-nums">{d.top10} in top 10{d.averagePosition != null ? ` · avg ${d.averagePosition}` : ""}</span>
                  <span className="g-text w-12 text-right tabular-nums">{d.visibility}%</span>
                  {!d.isSite && <button type="button" className="g-text-2" aria-label={`Stop following ${d.domain}`} disabled={remove.isPending} onClick={() => remove.mutate(d.domain)}><X className="h-3.5 w-3.5" /></button>}
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden><div className="h-full" style={{ width: `${(d.visibility / top) * 100}%`, background: d.isSite ? "var(--g-blue)" : "#9aa0a6" }} /></div>
              </li>
            ))}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (input.trim()) add.mutate(input.trim()); }} data-testid="form-follow-competitor">
            <label className="min-w-0 flex-1"><span className="sr-only">Competitor's website</span><input className="g-input w-full" value={input} onChange={(e) => setInput(e.target.value)} placeholder={full ? `You follow ${v.max} — remove one to add another` : "competitor.com"} disabled={full} data-testid="input-follow-competitor" /></label>
            <button type="submit" className="g-pill" disabled={full || !input.trim() || add.isPending}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Follow</button>
          </form>
          {!v.hasPages && <p className="g-text-2 mt-2 text-[12px]">Competitor positions fill in at the next check — checks made before today did not save the result page.</p>}
          {v.hasPages && v.competitors.length > 0 && <p className="g-text-2 mt-2 text-[12px]">A competitor you just followed is measured in the top ten right away, and at any position from the next check.</p>}
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border p-4" style={card} data-testid="voice-seen-most">
            <h3 className="g-text text-[14px] font-medium">Seen most on your keywords</h3>
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
            <div className="rounded-lg border p-4" style={card} data-testid="voice-map-leaders">
              <h3 className="g-text text-[14px] font-medium">Who is in the Google map pack</h3>
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
