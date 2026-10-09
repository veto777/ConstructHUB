/**
 * /seo/backlinks — the monthly backlink snapshot: a row of figures (each against the snapshot before, when there is
 * one), the links found gone since the last snapshot, the strongest linking pages, and "Refresh now".
 */
import { AddToPlan } from "./plan-button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, money, Empty, fmtDate, fmtNum, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { DeltaBadge, DistributionBar, MetricColumn, PALETTE } from "./viz";
import { CARD, Heading, MetricRow, PairBars } from "./viz-more";

type Summary = { rank: number | null; backlinks: number | null; referringDomains: number | null; referringPages: number | null; brokenBacklinks: number | null; newBacklinks: number | null; lostBacklinks: number | null; newReferringDomains: number | null; lostReferringDomains: number | null; spamScore: number | null; totalCount?: number | null };
type Backlink = { domainFrom: string | null; urlFrom: string | null; urlTo: string | null; anchor: string | null; dofollow: boolean; rank: number | null; domainRank: number | null; spamScore: number | null; firstSeen: string | null; isNew: boolean; isLost: boolean };
type Lost = { domain: string; authority: number | null; spam?: number | null; from: string | null; to: string | null; anchor: string | null; lastSeen: string | null; follow: boolean };
type Data = { configured: boolean; snapshot: { takenOn: string; summary: Summary; backlinks: Backlink[]; changes?: { since: string; lost: Lost[]; lostTotal: number | null; failed?: boolean } | null } | null; refreshCents?: number; previous: { takenOn: string; summary: Summary } | null; nextSnapshotAt: string | null };

/** "+12 new · −3 lost", or a plain "not available" when the snapshot carries neither count (never "+— new"). */
const flow = (added: number | null | undefined, lost: number | null | undefined, tail = "") =>
  added == null && lost == null ? "New and lost: not available" : `+${fmtNum(added)} new · −${fmtNum(lost)} lost${tail}`;

export default function SeoBacklinksPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const data = useQuery<Data>({ queryKey: [`/api/seo/sites/${site?.id}/backlinks`], enabled: !!site, refetchOnMount: "always", });
  const refresh = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/backlinks/refresh`),
    onSuccess: (r: { lostFailed?: boolean; reused?: boolean }) => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${site?.id}/backlinks`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      // One snapshot is kept per day: today's was already taken, so nothing was bought.
      if (r?.reused) { toast({ title: "Already refreshed today", description: "Nothing was bought — one snapshot is kept per day, and today's is shown. The next refresh can be made tomorrow (UTC)." }); return; }
      toast(r?.lostFailed ? { title: "Backlinks updated — except the lost links", description: "That part didn't load and was not charged. Refresh to try again." } : { title: "Backlinks updated" }); },
    onError: (e) => toast({ title: "Couldn't refresh", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const configured = !!status.data?.configured;
  // What a refresh can cost for THIS site (a first snapshot has one lookup fewer), and whether there is enough left for it.
  const refreshCents = data.data?.refreshCents ?? status.data?.prices?.backlinkRefresh ?? null;
  const credits = status.data?.credits;
  const canRefresh = refreshCents == null || !credits || credits.availableCents === -1 || credits.availableCents >= refreshCents;
  const d = data.data, s = d?.snapshot?.summary, p = d?.previous?.summary;
  // The move since the snapshot before: more is better, except for spam (`upIsBad`).
  const diff = (a: number | null | undefined, b: number | null | undefined, upIsBad = false) => a != null && b != null ? <DeltaBadge value={a - b} label={`Change since the snapshot of ${fmtDate(d?.previous?.takenOn)}`} upIsBad={upIsBad} /> : null;
  // Two snapshots side by side: the earlier one paler. Nothing is drawn without an earlier snapshot.
  const pair = (now: number | null | undefined, before: number | null | undefined) => d?.previous && now != null && before != null ? <PairBars before={before} now={now} beforeLabel={fmtDate(d.previous.takenOn)} nowLabel={fmtDate(d.snapshot?.takenOn)} /> : undefined;
  const listed = d?.snapshot?.backlinks ?? [], dofollow = listed.filter((b) => b.dofollow).length;
  return (
    <SeoShell title="Backlinks" description="Who links to your site: a fresh snapshot every month, refreshable any time." site={site} onSite={onSite} sites={sites} status={status}
      actions={site && d && <Button className="w-full sm:w-auto" disabled={!configured || refresh.isPending || !canRefresh} onClick={() => refresh.mutate()} data-testid="button-refresh-backlinks" title={!configured ? "Rank tracking is being switched on for your account" : !canRefresh ? "Not enough SEO data left — add credit above" : undefined}>{refresh.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh now{refreshCents != null ? ` — up to ${money(refreshCents)}` : ""}</Button>}>
      {!site && sites.isSuccess && <Empty testId="seo-empty-sites"><h3>No sites yet</h3><p>Add a site above to see its backlinks.</p></Empty>}
      {site && data.isLoading && <p className="g-text-2 text-[14px]" role="status">Loading backlinks…</p>}
      {site && data.isError && <div className="g-callout" role="alert" data-testid="seo-backlinks-error"><h3>Couldn't load the backlinks</h3><p>{apiErrorMessage(data.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void data.refetch()}>Try again</button></div>}
      {site && d && !d.snapshot && <Empty testId="seo-backlinks-empty"><h3>No snapshot for {site.domain} yet</h3><p>"Refresh now" pulls the summary and the top 100 linking pages; after that a new snapshot is taken every month on its own, and each one lists the backlinks found gone since the last.{refreshCents != null ? ` This first snapshot costs up to ${money(refreshCents)} of your SEO data.` : ""}</p></Empty>}
      {site && d?.snapshot && s && (
        <>
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-snapshot-meta">Snapshot from {fmtDate(d.snapshot.takenOn)}{p && d.previous ? ` · compared with ${fmtDate(d.previous.takenOn)}` : ""} · next automatic snapshot {fmtDate(d.nextSnapshotAt)}</p>
          {/* The snapshot's figures in one row, each with its move since the snapshot before (and both snapshots as bars). */}
          <div className="mb-5 rounded-xl border p-3 sm:p-4" style={CARD}>
            <MetricRow cols={5} testId="backlinks-summary">
              <MetricColumn label="Domain rank" testId="tile-rank" value={s.rank ?? "—"} delta={diff(s.rank, p?.rank)} foot="Link authority, 0–1000" chart={pair(s.rank, p?.rank)} />
              <MetricColumn label="Backlinks" testId="tile-backlinks" value={fmtNum(s.backlinks)} delta={diff(s.backlinks, p?.backlinks)} foot={flow(s.newBacklinks, s.lostBacklinks, " (30 days)")} chart={pair(s.backlinks, p?.backlinks)} />
              <MetricColumn label="Referring domains" testId="tile-domains" value={fmtNum(s.referringDomains)} delta={diff(s.referringDomains, p?.referringDomains)} foot={flow(s.newReferringDomains, s.lostReferringDomains)} chart={pair(s.referringDomains, p?.referringDomains)} />
              <MetricColumn label="Referring pages" testId="tile-pages" value={fmtNum(s.referringPages)} delta={diff(s.referringPages, p?.referringPages)} foot="Pages with at least one link to the site" chart={pair(s.referringPages, p?.referringPages)} />
              <MetricColumn label="Spam score" testId="tile-spam" value={s.spamScore ?? "—"} delta={diff(s.spamScore, p?.spamScore, true)} foot={`${fmtNum(s.brokenBacklinks)} broken backlinks`} chart={pair(s.spamScore, p?.spamScore)} />
            </MetricRow>
          </div>
          {d.snapshot.changes && (
            <section className="mb-5" data-testid="section-lost-links">
              <Heading className="!mb-1">Lost backlinks seen since {fmtDate(d.snapshot.changes.since)}</Heading>
              {d.snapshot.changes.failed ? <p className="text-[13px]" role="status" style={{ color: "var(--g-red)" }} data-testid="text-lost-links-failed">This part didn't load with this snapshot and was not charged. Refresh to try again.</p>
              : d.snapshot.changes.lost.length === 0 ? <p className="g-text-2 text-[13px]" data-testid="text-no-lost-links">None found — no backlink that was still being seen after {fmtDate(d.snapshot.changes.since)} is now marked lost.</p> : (
                <>
                  <p className="g-text-2 mb-2 text-[13px]">{d.snapshot.changes.lostTotal != null && d.snapshot.changes.lostTotal > d.snapshot.changes.lost.length ? `The ${d.snapshot.changes.lost.length} strongest of ${fmtNum(d.snapshot.changes.lostTotal)} sites with a lost link (only these ${d.snapshot.changes.lost.length} are kept).` : `${d.snapshot.changes.lost.length} site${d.snapshot.changes.lost.length === 1 ? "" : "s"} with a lost link.`} Each row is one link that was still being found after {fmtDate(d.snapshot.changes.since)} and is now gone — the page was removed, the link was taken off it, or the page could no longer be read. The site may still link to you from other pages. If the page still exists, a short note to its owner often gets the link back — worth doing for a real site with some authority; a lost link from a site with a high spam score is no loss.</p>
                  <div className="overflow-x-auto"><table className="g-table" data-testid="table-lost-links">
                    <thead><tr><th>Site</th><th className="num">Authority</th><th className="num" title="0–100: how much the linking site looks like spam">Spam</th><th>The page that linked</th><th>Linked to</th><th className="num">Last seen</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                    <tbody>{d.snapshot.changes.lost.map((l, i) => (
                      <tr key={`${l.domain}-${i}`}>
                        <td>{l.domain}{!l.follow && <span className="g-text-2 text-[12px]"> · nofollow</span>}</td>
                        <td className="num" data-label="Authority">{l.authority ?? "—"}</td>
                        <td className="num" data-label="Spam">{l.spam ?? "—"}</td>
                        <td data-label="The page that linked" className="max-w-[320px] truncate">{l.from ? <a href={l.from} className="g-link" target="_blank" rel="noreferrer" title={l.from}>{l.from.replace(/^https?:\/\/(www\.)?/, "")}</a> : "—"}</td>
                        <td data-label="Linked to" className="g-text-2 max-w-[220px] truncate">{l.to?.replace(/^https?:\/\/(www\.)?/, "") ?? "—"}</td>
                        <td className="num g-text-2" data-label="Last seen">{fmtDate(l.lastSeen)}</td>
                        <td className="num"><AddToPlan siteId={site.id} label="Plan" testId={`button-plan-${l.domain}`} tasks={[{ kind: "link_reclaim", title: `Win back the link from ${l.domain}`, target: l.from ?? l.domain, facts: { authority: l.authority, lastSeen: l.lastSeen }, source: `lost:${l.domain}` }]} /></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </>
              )}
            </section>
          )}
          {listed.length > 0 && (
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <Heading className="!mb-0">Strongest linking pages</Heading>
              {/* Of the pages listed here only — not of every backlink the site has. */}
              <div className="w-full max-w-xs" title={`Of the ${fmtNum(listed.length)} linking pages listed below`}>
                <DistributionBar testId="backlinks-follow" parts={[{ label: "dofollow", value: dofollow, color: PALETTE.backlinks }, { label: "nofollow", value: listed.length - dofollow, color: PALETTE.rest }]} />
                <p className="g-text-2 mt-0.5 text-[11px]">Of the {fmtNum(listed.length)} pages listed</p>
              </div>
            </div>
          )}
          {d.snapshot.backlinks.length === 0 ? <Empty>{(s as { listFailed?: boolean }).listFailed ? <>The list of linking pages didn't load for this snapshot — the totals above are still right. Refresh to try again.</> : <>No live backlinks were found for {site.domain}.</>}</Empty> : (
            <div className="overflow-x-auto"><table className="g-table" data-testid="table-backlinks">
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
            </table></div>
          )}
        </>
      )}
    </SeoShell>
  );
}
