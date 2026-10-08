/** /seo/backlinks — the monthly backlink snapshot (summary tiles + top backlinks), "Refresh now". */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, Move, priceOf, SeoShell, Tile, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Summary = { rank: number | null; backlinks: number | null; referringDomains: number | null; referringPages: number | null; brokenBacklinks: number | null; newBacklinks: number | null; lostBacklinks: number | null; newReferringDomains: number | null; lostReferringDomains: number | null; spamScore: number | null; totalCount?: number | null };
type Backlink = { domainFrom: string | null; urlFrom: string | null; urlTo: string | null; anchor: string | null; dofollow: boolean; rank: number | null; domainRank: number | null; spamScore: number | null; firstSeen: string | null; isNew: boolean; isLost: boolean };
type Lost = { domain: string; authority: number | null; from: string | null; to: string | null; anchor: string | null; lastSeen: string | null; follow: boolean };
type Data = { configured: boolean; snapshot: { takenOn: string; summary: Summary; backlinks: Backlink[]; changes?: { since: string; lost: Lost[]; lostTotal: number | null } | null } | null; previous: { takenOn: string; summary: Summary } | null; nextSnapshotAt: string | null };

export default function SeoBacklinksPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const data = useQuery<Data>({ queryKey: [`/api/seo/sites/${site?.id}/backlinks`], enabled: !!site, refetchOnMount: "always", });
  const refresh = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/backlinks/refresh`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${site?.id}/backlinks`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); toast({ title: "Backlinks updated" }); },
    onError: (e) => toast({ title: "Couldn't refresh", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const configured = !!status.data?.configured;
  const d = data.data, s = d?.snapshot?.summary, p = d?.previous?.summary;
  const diff = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && a !== b ? <Move now={-a} before={-b} /> : null;
  return (
    <SeoShell title="Backlinks" description="Who links to your site: a fresh snapshot every month, refreshable any time." site={site} onSite={onSite} sites={sites} status={status}
      actions={site && d && <Button className="w-full sm:w-auto" disabled={!configured || refresh.isPending || !canAfford(status.data, "backlinkRefresh")} onClick={() => refresh.mutate()} data-testid="button-refresh-backlinks" title={!configured ? "Rank tracking is being switched on for your account" : status.data ? `A refresh costs ${priceOf(status.data, "backlinkRefresh")} of your SEO data` : undefined}>{refresh.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh now</Button>}>
      {!site && sites.isSuccess && <Empty testId="seo-empty-sites"><h3>No sites yet</h3><p>Add a site above to see its backlinks.</p></Empty>}
      {site && data.isLoading && <p className="g-text-2 text-[14px]" role="status">Loading backlinks…</p>}
      {site && data.isError && <div className="g-callout" role="alert" data-testid="seo-backlinks-error"><h3>Couldn't load the backlinks</h3><p>{apiErrorMessage(data.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void data.refetch()}>Try again</button></div>}
      {site && d && !d.snapshot && <Empty testId="seo-backlinks-empty"><h3>No snapshot for {site.domain} yet</h3><p>"Refresh now" pulls the summary and the top 100 linking pages; after that a new snapshot is taken every month on its own, and each one names the sites that stopped linking since the last.{status.data ? ` A refresh costs ${priceOf(status.data, "backlinkRefresh")} of your SEO data.` : ""}</p></Empty>}
      {site && d?.snapshot && s && (
        <>
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-snapshot-meta">Snapshot from {fmtDate(d.snapshot.takenOn)}{p && d.previous ? ` · compared with ${fmtDate(d.previous.takenOn)}` : ""} · next automatic snapshot {fmtDate(d.nextSnapshotAt)}</p>
          <div className="g-tiles mb-5">
            <Tile label="Domain rank" value={s.rank ?? "—"} hint="Link authority, 0–1000" testId="tile-rank" />
            <Tile label="Backlinks" value={<>{fmtNum(s.backlinks)} {diff(s.backlinks, p?.backlinks)}</>} hint={`+${fmtNum(s.newBacklinks)} new · −${fmtNum(s.lostBacklinks)} lost (30 days)`} testId="tile-backlinks" />
            <Tile label="Referring domains" value={<>{fmtNum(s.referringDomains)} {diff(s.referringDomains, p?.referringDomains)}</>} hint={`+${fmtNum(s.newReferringDomains)} new · −${fmtNum(s.lostReferringDomains)} lost`} testId="tile-domains" />
            <Tile label="Spam score" value={s.spamScore ?? "—"} hint={`${fmtNum(s.brokenBacklinks)} broken backlinks`} testId="tile-spam" />
          </div>
          {d.snapshot.changes && (
            <section className="mb-5" data-testid="section-lost-links">
              <h2 className="g-text mb-1 text-[15px] font-medium">Sites that stopped linking since {fmtDate(d.snapshot.changes.since)}</h2>
              {d.snapshot.changes.lost.length === 0 ? <p className="g-text-2 text-[13px]" data-testid="text-no-lost-links">None — no linking site has been lost since the last snapshot.</p> : (
                <>
                  <p className="g-text-2 mb-2 text-[13px]">{d.snapshot.changes.lostTotal != null && d.snapshot.changes.lostTotal > d.snapshot.changes.lost.length ? `The ${d.snapshot.changes.lost.length} strongest of ${fmtNum(d.snapshot.changes.lostTotal)}.` : `${d.snapshot.changes.lost.length} site${d.snapshot.changes.lost.length === 1 ? "" : "s"}.`} A link is "lost" when the page was removed, the link was taken off it, or the page could no longer be read. If the page still exists, a short note to its owner often gets the link back.</p>
                  <div className="overflow-x-auto"><table className="g-table" data-testid="table-lost-links">
                    <thead><tr><th>Site</th><th className="num">Authority</th><th>The page that linked</th><th>Linked to</th><th className="num">Last seen</th></tr></thead>
                    <tbody>{d.snapshot.changes.lost.map((l, i) => (
                      <tr key={`${l.domain}-${i}`}>
                        <td>{l.domain}{!l.follow && <span className="g-text-2 text-[12px]"> · nofollow</span>}</td>
                        <td className="num" data-label="Authority">{l.authority ?? "—"}</td>
                        <td data-label="The page that linked" className="max-w-[320px] truncate">{l.from ? <a href={l.from} className="g-link" target="_blank" rel="noreferrer" title={l.from}>{l.from.replace(/^https?:\/\/(www\.)?/, "")}</a> : "—"}</td>
                        <td data-label="Linked to" className="g-text-2 max-w-[220px] truncate">{l.to?.replace(/^https?:\/\/(www\.)?/, "") ?? "—"}</td>
                        <td className="num g-text-2" data-label="Last seen">{fmtDate(l.lastSeen)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </>
              )}
            </section>
          )}
          {d.snapshot.backlinks.length > 0 && <h2 className="g-text mb-2 text-[15px] font-medium">Strongest linking pages</h2>}
          {d.snapshot.backlinks.length === 0 ? <Empty>{(s as { listFailed?: boolean }).listFailed ? <>The list of linking pages didn't load for this snapshot — the totals above are still right. Refresh to try again.</> : <>No live backlinks were found for {site.domain}.</>}</Empty> : (
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
