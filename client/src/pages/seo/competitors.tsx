/**
 * /seo/competitors — keyword gap: what a competitor ranks for that this site does not.
 *
 * ?competitor= fills the box (links.ts seoLinks.competitors) — nothing is bought until "Find the gap" is pressed.
 * Every row opens somewhere: the keyword in Keywords explorer, the competitor's position in its Site explorer
 * keywords, the competitor itself in Site explorer and the rank tracker's competitors panel.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, canAfford, clearParams, Empty, fmtNum, kd, priceOf, SeoShell, useAddress, useSelectedSite, useSeoSites, useSeoStatus, useSiteMissing } from "./shell";
import { seoLinks, setParam } from "./links";
import { FIGURE_LINK, QUIET_LINK, TEXT_LINK } from "./viz-more";

type Gap = { keyword: string; searchVolume: number | null; cpc: number | null; difficulty: number | null; intent: string | null; competitorPosition: number | null; competitorUrl: string | null; etv: number | null };
type Result = { competitor: string; ours: string; items: Gap[]; totalCount: number | null };
const clean = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");

export default function SeoCompetitorsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const missing = useSiteMissing(sites.data);
  const params = useAddress();
  const wanted = params.get("competitor");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [competitor, setCompetitor] = useState(wanted ?? "");
  // A competitor named in the address fills the box, also when the address changes while the page is open.
  useEffect(() => { if (wanted !== null) setCompetitor(wanted); }, [wanted]);
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
      {missing && site && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="competitors-site-missing">The site this link is for isn't one of yours (or was removed). Showing {site.domain}.</p>}
      {/* Clearing drops the competitor from the address, empties the box and takes its results off the screen: nothing narrowed is left without its chip. */}
      {wanted && <ActiveFilter onClear={() => { clearParams(["competitor"], false); setCompetitor(""); gap.reset(); }} clearLabel="Clear">Competitor: {wanted}{r?.competitor === clean(wanted) ? "" : " — press Find the gap to compare (nothing is bought until then)"}</ActiveFilter>}
      {site && (
        <form className="mb-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (competitor.trim()) { setParam("competitor", clean(competitor)); gap.mutate(); } }} data-testid="form-competitor">
          <input className="g-input" placeholder="competitor.com" value={competitor} onChange={(e) => setCompetitor(e.target.value)} data-testid="input-competitor" />
          <Button type="submit" className="sm:w-auto" disabled={!configured || !competitor.trim() || gap.isPending || !canAfford(status.data, "competitorGap")} data-testid="button-find-gaps" title={!configured ? "Rank tracking is being switched on for your account" : undefined}>
            {gap.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Find the gap
          </Button>
        </form>
      )}
      {site && !r && <Empty testId="seo-gap-empty"><h3>Compare {site.domain} with a competitor</h3><p>One comparison ({priceOf(status.data, "competitorGap")} of your SEO data) returns up to 100 keywords where the competitor ranks in Google's organic results and {site.domain} does not, with their position, the search volume and the difficulty. Track the ones worth going after. The competitors the rank tracker already follows are in its <Link href={seoLinks.rankTracker(site.id, { panel: "competitors" })} className={TEXT_LINK} data-testid="link-competitors-panel">competitors panel</Link>.</p></Empty>}
      {!site && sites.isSuccess && <Empty testId="seo-empty-sites"><h3>No sites yet</h3><p>Add your own site above first; the gap is measured against it.</p></Empty>}
      {r && site && (
        <>
          {/* Both sites open in Site explorer; the competitor also in the rank tracker's competitors panel. */}
          <p className="g-text-2 mb-2 text-[13px]" data-testid="text-gap-meta"><Link href={seoLinks.explorer(r.ours, "contentGap")} className={QUIET_LINK} title="Site explorer's content gap: the keywords competitors rank for and this site does not (this page lists the first 100)" data-testid="link-gap-total">{r.totalCount != null ? `${fmtNum(r.totalCount)} keywords` : `${r.items.length} keywords`}</Link> <Link href={seoLinks.explorer(r.competitor, "keywords")} className={TEXT_LINK} data-testid="link-gap-competitor">{r.competitor}</Link> ranks for that <Link href={seoLinks.explorer(r.ours, "keywords")} className={TEXT_LINK}>{r.ours}</Link> doesn't · showing <Link href={seoLinks.explorer(r.ours, "contentGap")} className={QUIET_LINK}>{r.items.length}</Link> · <Link href={seoLinks.rankTracker(site.id, { panel: "competitors" })} className={TEXT_LINK}>compare in the rank tracker</Link></p>
          {r.items.length === 0 ? <Empty>No gap found — no organic rankings for <Link href={seoLinks.explorer(r.competitor, "keywords")} className={TEXT_LINK}>{r.competitor}</Link> that {r.ours} lacks.</Empty> : (
            <table className="g-table" data-testid="table-gap">
              <thead><tr><th>Keyword</th><th className="num">Their position</th><th className="num">Volume / mo</th><th className="num">Difficulty</th><th className="num">CPC</th><th>Their page</th><th aria-label="Track" /></tr></thead>
              {/* The keyword opens in Keywords explorer; the position in the competitor's Site explorer keywords; their page is the page itself. */}
              <tbody>
                {r.items.map((g) => (
                  <tr key={g.keyword}>
                    <td><Link href={seoLinks.keywords(g.keyword)} className={TEXT_LINK} data-testid={`link-gap-${g.keyword.replace(/\W+/g, "-")}`}>{g.keyword}</Link>{g.intent && <span className="g-text-2 text-[12px] capitalize"> · <Link href={seoLinks.explorer(r.competitor, "keywords", { intent: g.intent })} className={QUIET_LINK}>{g.intent}</Link></span>}</td>
                    <td className="num" data-label="Their position">{g.competitorPosition != null ? <Link href={seoLinks.explorer(r.competitor, "keywords", { contains: g.keyword })} className={FIGURE_LINK} title={`${r.competitor}'s keywords in Site explorer, narrowed to this one`}>{g.competitorPosition}</Link> : "—"}</td>
                    <td className="num" data-label="Volume / mo"><Link href={seoLinks.keywords(g.keyword, { section: "volume" })} className={FIGURE_LINK}>{fmtNum(g.searchVolume)}</Link></td>
                    <td className="num" data-label="Difficulty"><Link href={seoLinks.keywords(g.keyword)} className={FIGURE_LINK}>{kd(g.difficulty)}</Link></td>
                    <td className="num" data-label="CPC">{g.cpc == null ? "—" : <Link href={seoLinks.keywords(g.keyword, { section: "cpc" })} className={FIGURE_LINK} data-testid={`link-gap-cpc-${g.keyword.replace(/\W+/g, "-")}`}>{`$${g.cpc.toFixed(2)}`}</Link>}</td>
                    <td data-label="Their page" className="max-w-[260px] truncate">{g.competitorUrl ? <a href={g.competitorUrl} className={TEXT_LINK} target="_blank" rel="noreferrer">{g.competitorUrl.replace(/^https?:\/\/(www\.)?/, "")}</a> : "—"}</td>
                    <td className="num" data-label="Rank tracker"><button type="button" className="g-pill !min-h-11" disabled={track.isPending} onClick={() => track.mutate(g)} data-testid={`button-track-${g.keyword.replace(/\W+/g, "-")}`}>Track</button></td>
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
