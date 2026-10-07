/** /seo/competitors — keyword gap: what a competitor ranks for that this site does not. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtNum, fmtUnit, kd, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Gap = { keyword: string; searchVolume: number | null; cpc: number | null; difficulty: number | null; intent: string | null; competitorPosition: number | null; competitorUrl: string | null; etv: number | null };
type Result = { competitor: string; ours: string; items: Gap[]; totalCount: number | null };

export default function SeoCompetitorsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [competitor, setCompetitor] = useState("");
  const gap = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/competitors`, { competitor }) as Promise<Result>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }),
    onError: (e) => toast({ title: "Couldn't compare", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const track = useMutation({
    mutationFn: (g: Gap) => api("POST", `/api/seo/sites/${site!.id}/keywords`, { keywords: [g.keyword], tags: [gap.data?.competitor ?? "competitor"], volumes: [{ keyword: g.keyword, searchVolume: g.searchVolume, cpc: g.cpc, difficulty: g.difficulty }] }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); toast({ title: `Tracking it on ${site!.domain}` }); },
    onError: (e) => toast({ title: "Couldn't track", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const configured = !!status.data?.configured;
  const r = gap.data;
  return (
    <SeoShell title="Competitors" description="Keywords a competitor ranks for on Google that your site does not — the gap to close." site={site} onSite={onSite} sites={sites} status={status}>
      {!site && sites.isSuccess && <Empty testId="seo-empty-sites"><h3>No sites yet</h3><p>Add your own site above first; the gap is measured against it.</p></Empty>}
      {site && (
        <form className="mb-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (competitor.trim()) gap.mutate(); }} data-testid="form-competitor">
          <input className="g-input" placeholder="competitor.com" value={competitor} onChange={(e) => setCompetitor(e.target.value)} data-testid="input-competitor" />
          <Button type="submit" className="sm:w-auto" disabled={!configured || !competitor.trim() || gap.isPending} data-testid="button-find-gaps" title={!configured ? "Rank tracking is being switched on for your account" : undefined}>
            {gap.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Find the gap
          </Button>
        </form>
      )}
      {site && !r && <Empty testId="seo-gap-empty"><h3>Compare {site.domain} with a competitor</h3><p>One comparison (it counts as one keyword search) returns up to 100 keywords where the competitor ranks in Google's organic results and {site.domain} does not, with their position, the search volume and the difficulty. Track the ones worth going after.{status.data ? ` Keyword searches this month: ${fmtUnit(status.data.usage.research)}.` : ""}</p></Empty>}
      {r && (
        <>
          <p className="g-text-2 mb-2 text-[13px]" data-testid="text-gap-meta">{r.totalCount != null ? `${fmtNum(r.totalCount)} keywords` : `${r.items.length} keywords`} {r.competitor} ranks for that {r.ours} doesn't · showing {r.items.length}</p>
          {r.items.length === 0 ? <Empty>No gap found — no organic rankings for {r.competitor} that {r.ours} lacks.</Empty> : (
            <table className="g-table" data-testid="table-gap">
              <thead><tr><th>Keyword</th><th className="num">Their position</th><th className="num">Volume / mo</th><th className="num">Difficulty</th><th className="num">CPC</th><th>Their page</th><th aria-label="Track" /></tr></thead>
              <tbody>
                {r.items.map((g) => (
                  <tr key={g.keyword}>
                    <td>{g.keyword}{g.intent && <span className="g-text-2 text-[12px] capitalize"> · {g.intent}</span>}</td>
                    <td className="num" data-label="Their position">{g.competitorPosition ?? "—"}</td>
                    <td className="num" data-label="Volume / mo">{fmtNum(g.searchVolume)}</td>
                    <td className="num" data-label="Difficulty">{kd(g.difficulty)}</td>
                    <td className="num" data-label="CPC">{g.cpc == null ? "—" : `$${g.cpc.toFixed(2)}`}</td>
                    <td data-label="Their page" className="max-w-[260px] truncate">{g.competitorUrl ? <a href={g.competitorUrl} className="g-link" target="_blank" rel="noreferrer">{g.competitorUrl.replace(/^https?:\/\/(www\.)?/, "")}</a> : "—"}</td>
                    <td className="num"><button type="button" className="g-pill !min-h-8" disabled={track.isPending} onClick={() => track.mutate(g)} data-testid={`button-track-${g.keyword.replace(/\W+/g, "-")}`}>Track</button></td>
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
