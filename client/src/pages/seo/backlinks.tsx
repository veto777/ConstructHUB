/** /seo/backlinks — the monthly backlink snapshot (summary tiles + top backlinks), "Refresh now". */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, fmtUsd, Move, SeoShell, Tile, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Summary = { rank: number | null; backlinks: number | null; referringDomains: number | null; referringPages: number | null; brokenBacklinks: number | null; newBacklinks: number | null; lostBacklinks: number | null; newReferringDomains: number | null; lostReferringDomains: number | null; spamScore: number | null; totalCount?: number | null };
type Backlink = { domainFrom: string | null; urlFrom: string | null; urlTo: string | null; anchor: string | null; dofollow: boolean; rank: number | null; domainRank: number | null; spamScore: number | null; firstSeen: string | null; isNew: boolean; isLost: boolean };
type Data = { configured: boolean; snapshot: { takenOn: string; summary: Summary; backlinks: Backlink[]; costUsd: number } | null; previous: { takenOn: string; summary: Summary } | null; refreshEstimateUsd: number; nextSnapshotAt: string | null };

export default function SeoBacklinksPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const data = useQuery<Data>({ queryKey: [`/api/seo/sites/${site?.id}/backlinks`], enabled: !!site });
  const refresh = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/backlinks/refresh`),
    onSuccess: (r: { costUsd: number }) => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${site?.id}/backlinks`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); toast({ title: "Backlinks updated", description: `${fmtUsd(r.costUsd)} of DataForSEO data.` }); },
    onError: (e) => toast({ title: "Couldn't refresh", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const configured = !!status.data?.configured;
  const d = data.data, s = d?.snapshot?.summary, p = d?.previous?.summary;
  const diff = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && a !== b ? <Move now={-a} before={-b} /> : null;
  return (
    <SeoShell title="Backlinks" description="Who links to your site: a snapshot every month from DataForSEO's backlink index, refreshable any time." site={site} onSite={onSite} sites={sites} status={status}
      actions={site && d && <Button className="w-full sm:w-auto" disabled={!configured || refresh.isPending} onClick={() => refresh.mutate()} data-testid="button-refresh-backlinks" title={!configured ? "Connect DataForSEO first" : undefined}>{refresh.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh now · ≈ {fmtUsd(d.refreshEstimateUsd)}</Button>}>
      {!site && sites.isSuccess && <Empty testId="seo-empty-sites"><h3>No sites yet</h3><p>Add a site above to see its backlinks.</p></Empty>}
      {site && d && !d.snapshot && <Empty testId="seo-backlinks-empty"><h3>No snapshot for {site.domain} yet</h3><p>"Refresh now" buys the summary and the top 100 linking domains (about {fmtUsd(d.refreshEstimateUsd)}); after that a new snapshot is taken every month.</p></Empty>}
      {site && d?.snapshot && s && (
        <>
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-snapshot-meta">Snapshot from {fmtDate(d.snapshot.takenOn)}{p && d.previous ? ` · compared with ${fmtDate(d.previous.takenOn)}` : ""} · next automatic snapshot {fmtDate(d.nextSnapshotAt)}</p>
          <div className="g-tiles mb-5">
            <Tile label="Domain rank" value={s.rank ?? "—"} hint="DataForSEO rank, 0–1000" testId="tile-rank" />
            <Tile label="Backlinks" value={<>{fmtNum(s.backlinks)} {diff(s.backlinks, p?.backlinks)}</>} hint={`+${fmtNum(s.newBacklinks)} new · −${fmtNum(s.lostBacklinks)} lost (30 days)`} testId="tile-backlinks" />
            <Tile label="Referring domains" value={<>{fmtNum(s.referringDomains)} {diff(s.referringDomains, p?.referringDomains)}</>} hint={`+${fmtNum(s.newReferringDomains)} new · −${fmtNum(s.lostReferringDomains)} lost`} testId="tile-domains" />
            <Tile label="Spam score" value={s.spamScore ?? "—"} hint={`${fmtNum(s.brokenBacklinks)} broken backlinks`} testId="tile-spam" />
          </div>
          {d.snapshot.backlinks.length === 0 ? <Empty>The index has no live backlinks for {site.domain}.</Empty> : (
            <table className="g-table" data-testid="table-backlinks">
              <thead><tr><th>Linking page</th><th>Anchor</th><th>Links to</th><th className="num">Domain rank</th><th className="num">Spam</th><th>Follow</th><th className="num">First seen</th></tr></thead>
              <tbody>
                {d.snapshot.backlinks.map((b, i) => (
                  <tr key={`${b.urlFrom}-${i}`}>
                    <td className="max-w-[320px] truncate">{b.urlFrom ? <a href={b.urlFrom} className="g-link" target="_blank" rel="noreferrer">{b.domainFrom ?? b.urlFrom}</a> : b.domainFrom}{b.isNew && <span className="g-open text-[12px]"> · new</span>}</td>
                    <td data-label="Anchor" className="max-w-[200px] truncate">{b.anchor ?? <span className="g-text-2">(none)</span>}</td>
                    <td data-label="Links to" className="max-w-[220px] truncate g-text-2">{b.urlTo?.replace(/^https?:\/\/(www\.)?/, "") ?? "—"}</td>
                    <td className="num" data-label="Domain rank">{b.domainRank ?? "—"}</td>
                    <td className="num" data-label="Spam">{b.spamScore ?? "—"}</td>
                    <td data-label="Follow">{b.dofollow ? "dofollow" : "nofollow"}</td>
                    <td className="num g-text-2" data-label="First seen">{fmtDate(b.firstSeen?.slice(0, 10))}</td>
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
