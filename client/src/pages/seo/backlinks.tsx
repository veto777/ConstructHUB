/**
 * /seo/backlinks — the monthly backlink snapshot: a row of figures (each against the snapshot before, when there is
 * one), the links found gone since the last snapshot, the strongest linking pages, and "Refresh now".
 *
 * Every figure is a link to the Site explorer view that holds its rows (links.ts) — the change beside it too, and every
 * cell of both tables; a page of the site opens as that page (its query string kept). Where no view holds exactly the
 * figure (the site's spam score, the new and lost referring domains, a date), the link goes to the closest view and
 * its words say so. The address is honoured: `site` picks the site, `section` lost | strongest | new | all scrolls
 * to that list (new narrows the strongest list to links first seen in this snapshot), `domain` keeps only the links
 * from one site. What narrowed the page is a chip (data-testid="active-filter") with a clear. Arriving never refreshes
 * — the snapshot on file is shown; "Refresh now" is the only purchase.
 */
import { AddToPlan } from "./plan-button";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, money, Empty, fmtDate, fmtNum, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { DeltaBadge, DistributionBar, MetricColumn, PALETTE } from "./viz";
import { CARD, Heading, MetricRow, PairBars } from "./viz-more";
import { BLOCK_LINK, FIG_LINK, LINK_CUE, TAP, TEXT_LINK } from "./viz-keywords";
import { pathOfUrl } from "./explorer-filters";
import { seoLinks, setParam } from "./links";

type Summary = { rank: number | null; backlinks: number | null; referringDomains: number | null; referringPages: number | null; brokenBacklinks: number | null; newBacklinks: number | null; lostBacklinks: number | null; newReferringDomains: number | null; lostReferringDomains: number | null; spamScore: number | null; totalCount?: number | null };
type Backlink = { domainFrom: string | null; urlFrom: string | null; urlTo: string | null; anchor: string | null; dofollow: boolean; rank: number | null; domainRank: number | null; spamScore: number | null; firstSeen: string | null; isNew: boolean; isLost: boolean };
type Lost = { domain: string; authority: number | null; spam?: number | null; from: string | null; to: string | null; anchor: string | null; lastSeen: string | null; follow: boolean };
type Data = { configured: boolean; snapshot: { takenOn: string; summary: Summary; backlinks: Backlink[]; changes?: { since: string; lost: Lost[]; lostTotal: number | null; failed?: boolean } | null } | null; refreshCents?: number; previous: { takenOn: string; summary: Summary } | null; nextSnapshotAt: string | null };
type Section = "lost" | "strongest" | "new" | "all";
const SECTIONS: readonly Section[] = ["lost", "strongest", "new", "all"];

const strip = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");
/** A link in a cell whose words may be cut short: 44 px tall, the cut (`truncate`) on a span inside it, where it cannot clip the hit area. */
const CELL_LINK = `${BLOCK_LINK} max-w-full`;
const sameDomain = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase().replace(/^www\./, "") === b.toLowerCase().replace(/^www\./, "");

export default function SeoBacklinksPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  // The address: which site, which list, and whether only one linking site is shown.
  const search = useSearch();
  const address = useMemo(() => { const p = new URLSearchParams(search); const s = p.get("section"); return { site: Number(p.get("site")) || null, section: SECTIONS.find((x) => x === s) ?? null, domain: p.get("domain")?.trim().toLowerCase() || null }; }, [search]);
  // `site` in the address picks the site (when it is one of the account's); the picker writes it back.
  useEffect(() => { if (address.site && address.site !== site?.id && sites.data?.some((s) => s.id === address.site)) onSite(address.site); }, [address.site, sites.data, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The shell writes ?site= when a site is picked (one history entry); this page only follows it.
  const pickSite = (id: number) => onSite(id);
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
  /** The Site explorer view that holds a figure's rows. */
  const view = (v: string, extra: { followed?: boolean; path?: string; anchor?: string; contains?: string } = {}) => (site ? seoLinks.explorer(site.domain, v, extra) : "#");
  /** Where a linking site's own spam score is listed: its row among this site's referring domains (each with its spam score). */
  const spamOf = (domain: string) => view("referringDomains", { contains: domain });
  // The move since the snapshot before: more is better, except for spam (`upIsBad`). The earlier snapshot keeps only its
  // totals, so a change leads where its figure does — the list as it is now — and says so. Nothing when there is no change.
  const diff = (a: number | null | undefined, b: number | null | undefined, href: string, testId: string, upIsBad = false) =>
    a != null && b != null && Math.round(a - b) !== 0 ? <Link href={href} className={FIG_LINK} title={`Change since the snapshot of ${fmtDate(d?.previous?.takenOn)} — opens the list as it is now (the earlier snapshot keeps only its totals)`} data-testid={testId}><DeltaBadge value={a - b} label={`Change since the snapshot of ${fmtDate(d?.previous?.takenOn)}`} upIsBad={upIsBad} /></Link> : null;
  // Two snapshots side by side: the earlier one paler, the pair a link to the same view as its figure. Nothing is drawn without an earlier snapshot.
  const pair = (now: number | null | undefined, before: number | null | undefined, href: string, testId: string) => d?.previous && now != null && before != null ? <Link href={href} className={`${LINK_CUE} block min-h-11`} data-testid={testId}><PairBars before={before} now={now} beforeLabel={fmtDate(d.previous.takenOn)} nowLabel={fmtDate(d.snapshot?.takenOn)} /></Link> : undefined;
  /**
   * "+12 new · −3 lost", each a link to the list it counts — or, when no list holds just these, to the closest one, with
   * `tail` and `title` saying so; a plain "not available" when the snapshot carries neither count (never "+— new").
   */
  const flow = (added: number | null | undefined, lost: number | null | undefined, newHref: string, lostHref: string, testId: string, tail = "", title?: string): ReactNode =>
    added == null && lost == null ? "New and lost: not available" : <><Link href={newHref} className={TEXT_LINK} title={title} data-testid={`${testId}-new`}>+{fmtNum(added)} new</Link> · <Link href={lostHref} className={TEXT_LINK} title={title} data-testid={`${testId}-lost`}>−{fmtNum(lost)} lost</Link>{tail}</>;
  /** The Site explorer view of one page of the site (its query string kept, as explorer-filters reads a path) — the site's pages when the address is not one of them, and the title says so. */
  const pageView = (url: string) => { const path = site ? pathOfUrl(url, site.domain) : null; return path ? view("pages", { path }) : view("pages"); };
  const pageTitle = (url: string) => (site && pathOfUrl(url, site.domain) ? `This page of ${site.domain} in Site explorer` : `Not an address on ${site?.domain} as written — opens the site's pages in Site explorer`);

  // The lists, narrowed as the address says.
  const lostAll = d?.snapshot?.changes?.lost ?? [];
  const lost = address.domain ? lostAll.filter((l) => sameDomain(l.domain, address.domain!)) : lostAll;
  const listedAll = d?.snapshot?.backlinks ?? [], dofollow = listedAll.filter((b) => b.dofollow).length;
  const listed = listedAll.filter((b) => (!address.domain || sameDomain(b.domainFrom, address.domain)) && (address.section !== "new" || b.isNew));
  const newCount = listedAll.filter((b) => b.isNew).length;

  // Arriving at a list scrolls to it once the snapshot is on screen (once per address).
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!d?.snapshot || !address.section) { scrolledTo.current = null; return; }
    const key = `${site?.id}:${address.section}`;
    if (scrolledTo.current === key) return;
    scrolledTo.current = key;
    document.getElementById(address.section === "lost" ? "section-lost-links" : "section-strongest")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [d, address.section, site?.id]);

  /** What narrowed the page, in words, each with its clear. */
  const chips: { key: string; words: string; clear: () => void }[] = [];
  if (site && d?.snapshot) {
    if (address.domain) chips.push({ key: "domain", words: `Links from ${address.domain}`, clear: () => setParam("domain", null) });
    if (address.section === "new") chips.push({ key: "section", words: `New links in this snapshot (${fmtNum(newCount)})`, clear: () => setParam("section", null) });
    else if (address.section === "lost") chips.push({ key: "section", words: `Lost backlinks since ${fmtDate(d.snapshot.changes?.since ?? d.previous?.takenOn)}`, clear: () => setParam("section", null) });
    else if (address.section === "strongest") chips.push({ key: "section", words: "Strongest linking pages", clear: () => setParam("section", null) });
  }
  /** The address for only the links from one site. */
  const onlyFrom = (domain: string) => (site ? seoLinks.backlinks(site.id, { section: address.section ?? undefined, domain }) : "#");

  return (
    <SeoShell title="Backlinks" description="Who links to your site: a fresh snapshot every month, refreshable any time." site={site} onSite={pickSite} sites={sites} status={status}
      actions={site && d && <Button className="w-full sm:w-auto" disabled={!configured || refresh.isPending || !canRefresh} onClick={() => refresh.mutate()} data-testid="button-refresh-backlinks" title={!configured ? "Rank tracking is being switched on for your account" : !canRefresh ? "Not enough SEO data left — add credit above" : undefined}>{refresh.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh now{refreshCents != null ? ` — up to ${money(refreshCents)}` : ""}</Button>}>
      {!site && sites.isSuccess && <Empty testId="seo-empty-sites"><h3>No sites yet</h3><p>Add a site above to see its backlinks.</p></Empty>}
      {site && data.isLoading && <p className="g-text-2 text-[14px]" role="status">Loading backlinks…</p>}
      {site && data.isError && <div className="g-callout" role="alert" data-testid="seo-backlinks-error"><h3>Couldn't load the backlinks</h3><p>{apiErrorMessage(data.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void data.refetch()}>Try again</button></div>}
      {site && d && !d.snapshot && <Empty testId="seo-backlinks-empty"><h3>No snapshot for {site.domain} yet</h3><p>"Refresh now" pulls the summary and the top 100 linking pages; after that a new snapshot is taken every month on its own, and each one lists the backlinks found gone since the last.{refreshCents != null ? ` This first snapshot costs up to ${money(refreshCents)} of your SEO data.` : ""}</p></Empty>}
      {site && d?.snapshot && s && (
        <>
          {/* The snapshot's date opens its list (below); the snapshot it is compared with has no list of its own, so that date opens what changed since it (or, with no changes kept, the figures it is compared in). The next snapshot is a date with nothing behind it yet: the closest view is the Usage page, where it will show, and the title says so. */}
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-snapshot-meta">
            <Link href={seoLinks.backlinks(site.id, { section: "all" })} className={TEXT_LINK} title="The linking pages this snapshot lists, below" data-testid="link-snapshot-date">Snapshot from {fmtDate(d.snapshot.takenOn)}</Link>
            {p && d.previous && <>{" · "}{d.snapshot.changes ? <Link href={seoLinks.backlinks(site.id, { section: "lost" })} className={TEXT_LINK} title="What changed since that snapshot: the lost backlinks, below (the earlier snapshot itself keeps only its totals)" data-testid="link-snapshot-previous">compared with {fmtDate(d.previous.takenOn)}</Link> : <Link href={seoLinks.backlinks(site.id)} className={TEXT_LINK} title="The earlier snapshot keeps only its totals — the paler bars beside each figure above" data-testid="link-snapshot-previous">compared with {fmtDate(d.previous.takenOn)}</Link>}</>}
            {" · "}<Link href={seoLinks.usage()} className={TEXT_LINK} title="When the next snapshot is taken on its own — nothing lists it yet; once taken it shows among the lookups on the Usage page" data-testid="link-snapshot-next">next automatic snapshot {fmtDate(d.nextSnapshotAt)}</Link>
          </p>
          {chips.length > 0 && <div data-testid="backlinks-filters">{chips.map((c) => <ActiveFilter key={c.key} onClear={c.clear}>{c.words}</ActiveFilter>)}</div>}
          {/* The snapshot's figures in one row, each with its move since the snapshot before (and both snapshots as bars). Each is a link to the Site explorer view with its rows. */}
          <div className="mb-5 rounded-xl border p-3 sm:p-4" style={CARD}>
            <MetricRow cols={5} testId="backlinks-summary">
              <MetricColumn label="Domain rank" testId="tile-rank" value={<Link href={view("overview")} className={FIG_LINK} title={`${site.domain} in Site explorer`} data-testid="link-rank">{s.rank ?? "—"}</Link>} delta={diff(s.rank, p?.rank, view("overview"), "link-rank-delta")} foot="Link authority, 0–1000" chart={pair(s.rank, p?.rank, view("overview"), "link-rank-bars")} />
              <MetricColumn label="Backlinks" testId="tile-backlinks" value={<Link href={view("backlinks")} className={FIG_LINK} title="Every backlink, in Site explorer" data-testid="link-backlinks">{fmtNum(s.backlinks)}</Link>} delta={diff(s.backlinks, p?.backlinks, view("backlinks"), "link-backlinks-delta")} foot={flow(s.newBacklinks, s.lostBacklinks, view("newBacklinks"), view("lostBacklinks"), "link-backlinks", " (30 days)")} chart={pair(s.backlinks, p?.backlinks, view("backlinks"), "link-backlinks-bars")} />
              {/* No view lists the new or lost referring domains: both counts open every referring domain, and say so. */}
              <MetricColumn label="Referring domains" testId="tile-domains" value={<Link href={view("referringDomains")} className={FIG_LINK} title="Every referring domain, in Site explorer" data-testid="link-domains">{fmtNum(s.referringDomains)}</Link>} delta={diff(s.referringDomains, p?.referringDomains, view("referringDomains"), "link-domains-delta")} foot={flow(s.newReferringDomains, s.lostReferringDomains, view("referringDomains"), view("referringDomains"), "link-domains", " — no list holds just these; both open every referring domain", "No view lists the new or lost referring domains — this opens every referring domain in Site explorer")} chart={pair(s.referringDomains, p?.referringDomains, view("referringDomains"), "link-domains-bars")} />
              <MetricColumn label="Referring pages" testId="tile-pages" value={<Link href={view("backlinks")} className={FIG_LINK} title="The linking pages, in Site explorer" data-testid="link-pages">{fmtNum(s.referringPages)}</Link>} delta={diff(s.referringPages, p?.referringPages, view("backlinks"), "link-pages-delta")} foot="Pages with at least one link to the site" chart={pair(s.referringPages, p?.referringPages, view("backlinks"), "link-pages-bars")} />
              {/* The site's spam score has no view of its own (the broken backlinks hold no spam data): the closest is the referring domains, each with its own spam score. */}
              <MetricColumn label="Spam score" testId="tile-spam" value={<Link href={view("referringDomains")} className={FIG_LINK} title="The site's spam score has no view of its own — this opens its referring domains, each with its own spam score" data-testid="link-spam">{s.spamScore ?? "—"}</Link>} delta={diff(s.spamScore, p?.spamScore, view("referringDomains"), "link-spam-delta", true)} foot={<Link href={view("brokenBacklinks")} className={TEXT_LINK} title="The broken backlinks, in Site explorer" data-testid="link-broken">{fmtNum(s.brokenBacklinks)} broken backlinks</Link>} chart={pair(s.spamScore, p?.spamScore, view("referringDomains"), "link-spam-bars")} />
            </MetricRow>
          </div>
          {d.snapshot.changes && (
            <section className="mb-5 scroll-mt-4" id="section-lost-links" data-testid="section-lost-links">
              <Heading className="!mb-1">Lost backlinks seen since <Link href={seoLinks.backlinks(site.id, { section: "lost" })} className={TEXT_LINK} title="This list's own address" data-testid="link-lost-since">{fmtDate(d.snapshot.changes.since)}</Link></Heading>
              {d.snapshot.changes.failed ? <p className="text-[13px]" role="status" style={{ color: "var(--g-red)" }} data-testid="text-lost-links-failed">This part didn't load with this snapshot and was not charged. Refresh to try again.</p>
              : d.snapshot.changes.lost.length === 0 ? <p className="g-text-2 text-[13px]" data-testid="text-no-lost-links">None found — no backlink that was still being seen after {fmtDate(d.snapshot.changes.since)} is now marked lost.</p>
              : lost.length === 0 ? <p className="g-text-2 text-[13px]" data-testid="text-no-lost-links-from">No lost link from {address.domain} in this snapshot — <Link href={seoLinks.backlinks(site.id, { section: "lost" })} className={TEXT_LINK} title="Every lost link in this snapshot" data-testid="link-lost-others">{lostAll.length} other site{lostAll.length === 1 ? " has" : "s have"} one</Link>.</p> : (
                <>
                  <p className="g-text-2 mb-2 text-[13px]">{/* The rows kept open this list; the whole count opens every lost link in Site explorer (the snapshot keeps only the strongest). */}{d.snapshot.changes.lostTotal != null && d.snapshot.changes.lostTotal > d.snapshot.changes.lost.length
                    ? <>The <Link href={seoLinks.backlinks(site.id, { section: "lost" })} className={TEXT_LINK} title="This list — the lost links this snapshot keeps" data-testid="link-lost-kept">{d.snapshot.changes.lost.length} strongest</Link> of <Link href={view("lostBacklinks")} className={TEXT_LINK} title="Every lost link, in Site explorer (this snapshot keeps only the strongest)" data-testid="link-lost-total">{fmtNum(d.snapshot.changes.lostTotal)} sites with a lost link</Link> (only these {d.snapshot.changes.lost.length} are kept).</>
                    : <><Link href={seoLinks.backlinks(site.id, { section: "lost" })} className={TEXT_LINK} title="This list — every lost link in this snapshot" data-testid="link-lost-kept">{d.snapshot.changes.lost.length} site{d.snapshot.changes.lost.length === 1 ? "" : "s"} with a lost link</Link>.</>} Each row is one link that was still being found after {fmtDate(d.snapshot.changes.since)} and is now gone — the page was removed, the link was taken off it, or the page could no longer be read. The site may still link to you from other pages. If the page still exists, a short note to its owner often gets the link back — worth doing for a real site with some authority; a lost link from a site with a high spam score is no loss.</p>
                  <div className="overflow-x-auto"><table className="g-table" data-testid="table-lost-links">
                    <thead><tr><th>Site</th><th className="num">Authority</th><th className="num" title="0–100: how much the linking site looks like spam">Spam</th><th>The page that linked</th><th>Linked to</th><th className="num">Last seen</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                    <tbody>{lost.map((l, i) => (
                      <tr key={`${l.domain}-${i}`}>
                        <td><Link href={seoLinks.explorer(l.domain)} className={TEXT_LINK} title={`${l.domain} in Site explorer`} data-testid="link-lost-site">{l.domain}</Link>{!l.follow && <> <Link href={view("referringDomains", { followed: false })} className={`${TEXT_LINK} text-[12px]`} title="Referring domains whose links are not followed" data-testid="link-lost-nofollow">· nofollow</Link></>}{!address.domain && <> <Link href={onlyFrom(l.domain)} className={`${TEXT_LINK} text-[12px]`} title="Only the links from this site" data-testid="link-lost-only">only this site</Link></>}</td>
                        <td className="num" data-label="Authority"><Link href={seoLinks.explorer(l.domain, "referringDomains")} className={TEXT_LINK} title={`What links to ${l.domain}`} data-testid="link-lost-authority">{l.authority ?? "—"}</Link></td>
                        <td className="num" data-label="Spam"><Link href={spamOf(l.domain)} className={FIG_LINK} title={`How much ${l.domain} looks like spam, 0–100 — its row among ${site.domain}'s referring domains in Site explorer, with its spam score (listed there only while it still links to the site)`} data-testid="link-lost-spam">{l.spam ?? "—"}</Link></td>
                        <td data-label="The page that linked" className="max-w-[320px]">{l.from ? <a href={l.from} className={`${CELL_LINK} g-link`} target="_blank" rel="noreferrer" title={l.from}><span className="min-w-0 truncate">{strip(l.from)}</span></a> : "—"}</td>
                        <td data-label="Linked to" className="max-w-[220px]">{l.to ? <Link href={pageView(l.to)} className={`${CELL_LINK} g-link`} title={pageTitle(l.to)} data-testid="link-lost-to"><span className="min-w-0 truncate">{strip(l.to)}</span></Link> : <span className="g-text-2">—</span>}</td>
                        <td className="num" data-label="Last seen"><Link href={view("lostBacklinks")} className={`${FIG_LINK} g-text-2`} title="When this link was last seen — the site's lost backlinks in Site explorer, each with its date (that list is not split by site)" data-testid="link-lost-last-seen">{fmtDate(l.lastSeen)}</Link></td>
                        <td className="num"><AddToPlan siteId={site.id} label="Plan" testId={`button-plan-${l.domain}`} tasks={[{ kind: "link_reclaim", title: `Win back the link from ${l.domain}`, target: l.from ?? l.domain, facts: { authority: l.authority, lastSeen: l.lastSeen }, source: `lost:${l.domain}` }]} /></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </>
              )}
            </section>
          )}
          <div className="scroll-mt-4" id="section-strongest" data-testid="section-strongest">
          {listedAll.length > 0 && (
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <Heading className="!mb-0">{address.section === "new" ? "New linking pages" : "Strongest linking pages"}</Heading>
              {/* Of the pages listed here only — not of every backlink the site has. Each segment, its legend entry and the two words lead to the referring domains that follow, and those that don't. */}
              <div className="w-full max-w-xs" title={`Of the ${fmtNum(listedAll.length)} linking pages listed below`}>
                <DistributionBar testId="backlinks-follow" segmentHref={(k) => view("referringDomains", { followed: k === "dofollow" })} parts={[{ label: "dofollow", value: dofollow, color: PALETTE.backlinks }, { label: "nofollow", value: listedAll.length - dofollow, color: PALETTE.rest }]} />
                <p className="g-text-2 mt-0.5 text-[11px]">Of the <Link href={seoLinks.backlinks(site.id, { section: address.section ?? "all", domain: address.domain ?? undefined })} className={TEXT_LINK} title="The linking pages listed below" data-testid="link-listed-count">{fmtNum(listedAll.length)} pages listed</Link> · <Link href={view("referringDomains", { followed: true })} className={TEXT_LINK} title="Followed, of the pages listed — this opens every referring domain whose links are followed, in Site explorer (the list below isn't split by follow)" data-testid="link-dofollow">dofollow {fmtNum(dofollow)}</Link> · <Link href={view("referringDomains", { followed: false })} className={TEXT_LINK} title="Not followed, of the pages listed — this opens every referring domain whose links are not followed, in Site explorer (the list below isn't split by follow)" data-testid="link-nofollow">nofollow {fmtNum(listedAll.length - dofollow)}</Link></p>
              </div>
            </div>
          )}
          {listedAll.length === 0 ? <Empty>{(s as { listFailed?: boolean }).listFailed ? <>The list of linking pages didn't load for this snapshot — the totals above are still right. Refresh to try again.</> : <>No live backlinks were found for {site.domain}.</>}</Empty>
          : listed.length === 0 ? <Empty testId="backlinks-none-match">{address.section === "new" && address.domain ? <>No link from {address.domain} is new in this snapshot.</> : address.section === "new" ? <>No link in this snapshot is new since the one before.</> : <>No link from {address.domain} among the {fmtNum(listedAll.length)} strongest linking pages.</>}</Empty> : (
            <div className="overflow-x-auto"><table className="g-table" data-testid="table-backlinks">
              <thead><tr><th>Linking page</th><th>Anchor</th><th>Links to</th><th className="num">Domain rank</th><th className="num">Spam</th><th>Follow</th><th className="num">First seen</th></tr></thead>
              <tbody>
                {listed.map((b, i) => (
                  <tr key={`${b.urlFrom}-${i}`}>
                    <td className="max-w-[320px]">
                      {b.domainFrom ? <Link href={seoLinks.explorer(b.domainFrom)} className={TEXT_LINK} title={`${b.domainFrom} in Site explorer`} data-testid="link-page-site">{b.domainFrom}</Link> : <span className="g-text-2">—</span>}{b.isNew && <> <Link href={seoLinks.backlinks(site.id, { section: "new", domain: address.domain ?? undefined })} className={`g-open ${LINK_CUE} ${TAP} text-[12px]`} title="First seen in this snapshot — only the new links" data-testid="link-page-new">· new</Link></>}{b.domainFrom && !address.domain && <> <Link href={onlyFrom(b.domainFrom)} className={`${TEXT_LINK} text-[12px]`} title="Only the links from this site" data-testid="link-page-only">only this site</Link></>}
                      {b.urlFrom && <a href={b.urlFrom} className={`${CELL_LINK} g-link text-[12px]`} target="_blank" rel="noreferrer" title={b.urlFrom}><span className="min-w-0 truncate">{strip(b.urlFrom)}</span></a>}
                    </td>
                    <td data-label="Anchor" className="max-w-[200px]">{b.anchor ? <Link href={view("anchors", { anchor: b.anchor })} className={CELL_LINK} title="Every link with this anchor text — the site's anchors in Site explorer" data-testid="link-page-anchor"><span className="min-w-0 truncate">{b.anchor}</span></Link> : <Link href={view("anchors")} className={`${CELL_LINK} g-text-2`} title="This link has no anchor text — the site's anchor texts in Site explorer" data-testid="link-page-anchor">(none)</Link>}</td>
                    <td data-label="Links to" className="max-w-[220px]">{b.urlTo ? <Link href={pageView(b.urlTo)} className={`${CELL_LINK} g-link`} title={pageTitle(b.urlTo)} data-testid="link-page-to"><span className="min-w-0 truncate">{strip(b.urlTo)}</span></Link> : <span className="g-text-2">—</span>}</td>
                    <td className="num" data-label="Domain rank">{b.domainFrom ? <Link href={seoLinks.explorer(b.domainFrom, "referringDomains")} className={TEXT_LINK} title={`What links to ${b.domainFrom}`} data-testid="link-page-authority">{b.domainRank ?? "—"}</Link> : b.domainRank ?? "—"}</td>
                    <td className="num" data-label="Spam">{b.domainFrom ? <Link href={spamOf(b.domainFrom)} className={FIG_LINK} title={`How much ${b.domainFrom} looks like spam, 0–100 — its row among ${site.domain}'s referring domains in Site explorer, with its spam score`} data-testid="link-page-spam">{b.spamScore ?? "—"}</Link> : <Link href={view("referringDomains")} className={FIG_LINK} title="The linking site isn't named — the referring domains in Site explorer, each with its spam score" data-testid="link-page-spam">{b.spamScore ?? "—"}</Link>}</td>
                    <td data-label="Follow"><Link href={view("referringDomains", { followed: b.dofollow })} className={TEXT_LINK} title={b.dofollow ? "Referring domains whose links are followed" : "Referring domains whose links are not followed"} data-testid="link-page-follow">{b.dofollow ? "dofollow" : "nofollow"}</Link></td>
                    <td className="num" data-label="First seen"><Link href={view(b.isNew ? "newBacklinks" : "backlinks")} className={`${FIG_LINK} g-text-2`} title={`When this link was first seen — the site's ${b.isNew ? "new " : ""}backlinks in Site explorer, each with its date`} data-testid="link-page-first-seen">{fmtDate(b.firstSeen?.slice(0, 10))}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          </div>
        </>
      )}
    </SeoShell>
  );
}
