/** /seo/keywords — research: seed keyword → suggestions with volume / CPC / difficulty, "Track" buttons. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtNum, fmtUsd, kd, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Idea = { keyword: string; searchVolume: number | null; cpc: number | null; difficulty: number | null; competition: number | null; intent: string | null };
type Research = { seed: string; items: Idea[]; costUsd: number };

export default function SeoKeywordsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [seed, setSeed] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const research = useMutation({
    mutationFn: () => api("POST", "/api/seo/keywords/research", { seed, locationCode: site?.locationCode ?? 2840, languageCode: site?.languageCode ?? "en" }) as Promise<Research>,
    onSuccess: () => { setPicked(new Set()); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Research failed", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const track = useMutation({
    mutationFn: (keywords: Idea[]) => api("POST", `/api/seo/sites/${site!.id}/keywords`, { keywords: keywords.map((k) => k.keyword), volumes: keywords.map((k) => ({ keyword: k.keyword, searchVolume: k.searchVolume, cpc: k.cpc, difficulty: k.difficulty })) }),
    onSuccess: (r: { added: number }) => { setPicked(new Set()); void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} now tracked for ${site!.domain}` }); },
    onError: (e) => toast({ title: "Couldn't track", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const volumes = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/keywords/volumes`),
    onSuccess: (r: { updated: number; costUsd: number }) => { void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); toast({ title: `Search volume updated for ${r.updated} keyword${r.updated === 1 ? "" : "s"}`, description: `${fmtUsd(r.costUsd)} of DataForSEO data.` }); },
    onError: (e) => toast({ title: "Couldn't fetch volumes", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const configured = !!status.data?.configured;
  const items = research.data?.items ?? [];
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <SeoShell title="Keyword research" description="Start from one keyword and get up to 50 related searches with monthly volume, cost per click and difficulty." site={site} onSite={onSite} sites={sites} status={status}
      actions={site && <button type="button" className="g-pill" disabled={!configured || volumes.isPending} onClick={() => volumes.mutate()} data-testid="button-fetch-volumes" title="Google Ads search volume for tracked keywords that have none yet (one request per 1,000 keywords)">{volumes.isPending ? <Loader2 className="animate-spin" /> : null} Get volumes for tracked keywords · ≈ $0.09</button>}>
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (seed.trim()) research.mutate(); }} data-testid="form-research">
        <input className="g-input" placeholder="e.g. roof repair" value={seed} onChange={(e) => setSeed(e.target.value)} data-testid="input-seed" />
        <Button type="submit" className="sm:w-auto" disabled={!configured || !seed.trim() || research.isPending} data-testid="button-research" title={!configured ? "Connect DataForSEO first" : undefined}>
          {research.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Find keywords · ≈ $0.018
        </Button>
      </form>
      {!research.data && <Empty testId="seo-research-empty"><h3>What people search for</h3><p>Each search is one DataForSEO Labs request: $0.012 plus $0.00012 per keyword returned (50 → about $0.018). Results show Google search volume (United States), average CPC, keyword difficulty (0–100) and intent. Tick the ones worth ranking for and track them on {site ? site.domain : "a site"}.</p></Empty>}
      {research.data && (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px] g-text-2">
            <span data-testid="text-research-meta">{items.length} suggestions for "{research.data.seed}" · {fmtUsd(research.data.costUsd)}</span>
            {site && picked.size > 0 && <Button size="sm" disabled={track.isPending} onClick={() => track.mutate(items.filter((i) => picked.has(i.keyword)))} data-testid="button-track-selected">{track.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Track ${picked.size} on ${site.domain}`}</Button>}
          </div>
          {items.length === 0 ? <Empty>No suggestions came back for that seed. Try a shorter or more common phrase.</Empty> : (
            <table className="g-table" data-testid="table-suggestions">
              <thead><tr><th>Keyword</th><th className="num">Volume / mo</th><th className="num">CPC</th><th className="num">Difficulty</th><th>Intent</th><th aria-label="Track" /></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.keyword}>
                    <td><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={picked.has(i.keyword)} onChange={() => toggle(i.keyword)} aria-label={`Select ${i.keyword}`} /> {i.keyword}</label></td>
                    <td className="num" data-label="Volume / mo">{fmtNum(i.searchVolume)}</td>
                    <td className="num" data-label="CPC">{i.cpc == null ? "—" : `$${i.cpc.toFixed(2)}`}</td>
                    <td className="num" data-label="Difficulty">{kd(i.difficulty)}</td>
                    <td data-label="Intent" className="capitalize">{i.intent ?? "—"}</td>
                    <td className="num">{site && <button type="button" className="g-pill !min-h-8" disabled={track.isPending} onClick={() => track.mutate([i])} data-testid={`button-track-${i.keyword.replace(/\W+/g, "-")}`}>Track</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </SeoShell>
  );
}
