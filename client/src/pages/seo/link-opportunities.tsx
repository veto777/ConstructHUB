/**
 * Site audit → Internal links to add (server/seo/link-opportunities.ts): pages of the site that use the words of a
 * keyword another page ranks for, without linking to that page. From the newest crawl and rank checks — free.
 *
 * Every figure is a link (links.ts): a page to its row on the pages tab, a keyword and its position to the rank
 * tracker, a volume to Keywords explorer, a count of what was left out to the closest view that holds it. `page` in
 * the address outlines the suggestions on or to that page and the chip says so (or that there are none).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { apiErrorMessage } from "@/lib/queryClient";
import { Empty, fmtDate, fmtNum, HIGHLIGHT, isNotRunYet, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";
import { seoLinks } from "./links";
import { ActiveFilter, COMPACT_TABLE, FIG, type AuditParams, type Foreign } from "./viz-audit";

type Item = { keywordId: number; keyword: string; volume: number | null; position: number | null; checkedOn: string | null; device: string | null; place: string | null; to: string; from: string; fromTitle: string | null; context: string; pair: string };
type Data = { jobId: string; scannedAt: string | null; checkedOn: string | null; linksMeasured: boolean; targets: number; boilerplate: number; notRanking: number; notCrawled: number; notUsable: number; tooShort: number; aliasesCut?: number; cutPages: number; items: Item[]; more: number };
const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`;
/** "position 8 on desktop, Oct 1, Bellingham, WA" — what a position rests on. */
const rankBasis = (i: Item) => [i.device, i.checkedOn ? fmtDate(i.checkedOn) : null, i.place].filter(Boolean).join(", ");
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
/** The path of a page of the site, as the pages tab names it. */
const pathOf = (u: string) => { try { const x = new URL(u); return (x.pathname || "/") + x.search; } catch { return u; } };
const device = (d: string | null) => (d === "desktop" || d === "mobile" ? d : undefined);

export function LinkOpportunitiesView({ site, crawlId, pageHref, pageParam, here, go, foreign }: {
  site: SeoSite;
  /** The newest finished crawl (part of the question). */
  crawlId?: string | null;
  /** A page of the site, its row opened on the pages tab (links.ts: audit `page`). */
  pageHref: (path: string) => string;
  /** The page the address names on this tab: its suggestions are outlined. */
  pageParam: string | null;
  /** The current address with one narrowing changed. */
  here: (p: AuditParams) => string;
  /** An address on the audit for this site, keeping the crawl shown. */
  go: (p: AuditParams) => string;
  foreign?: Foreign;
}) {
  const q = useQuery<Data | null>({
    queryKey: [`/api/seo/sites/${site.id}/audit/link-opportunities`, crawlId ?? null], refetchOnMount: "always", retry: false,
    queryFn: async ({ queryKey, signal }) => { try { const r = await fetch(queryKey[0] as string, { credentials: "include", signal }); if (r.status === 404) return null; if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return await r.json(); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const [shown, setShown] = useState(50);
  const firstRef = useRef<HTMLTableRowElement>(null);
  // The newest crawl could not be read: said (the server never answers with an older crawl instead).
  const unreadable = q.data && typeof q.data === "object" && "unreadable" in (q.data as object) ? (q.data as unknown as { scannedAt: string | null }) : null;
  const d = unreadable ? null : q.data;
  const byTarget = useMemo(() => { const m = new Map<string, number>(); for (const i of d?.items ?? []) m.set(i.to, (m.get(i.to) ?? 0) + 1); return m; }, [d]);
  const onPage = (i: Item) => !!pageParam && (pathOf(i.from) === pageParam || pathOf(i.to) === pageParam);
  const hits = d ? d.items.filter(onPage).length : 0;
  const firstHit = d && pageParam ? d.items.findIndex(onPage) : -1;
  useEffect(() => { if (firstHit >= shown) setShown(firstHit + 1); }, [firstHit, shown]);
  useEffect(() => { if (firstHit >= 0 && firstHit < shown) firstRef.current?.scrollIntoView({ block: "nearest" }); }, [firstHit, shown, pageParam]);
  // What narrowed the view, said from the address at once (also while the crawl is read), and whether the page is in
  // any suggestion once it is.
  const words: string[] = [];
  if (pageParam) words.push(!d ? `Page ${pageParam}` : hits ? `Page ${pageParam} — its ${plural(hits, "suggestion is", "suggestions are")} outlined` : `Page ${pageParam} — in none of these suggestions`);
  if (foreign) words.push(foreign.words);
  const chip = words.length > 0 && <ActiveFilter words={words.join(" · ")} clearHref={here({ page: undefined })} extra={foreign ? { href: foreign.href, label: foreign.label, testId: "link-foreign-tab" } : undefined}>{d && pageParam && !hits ? `No suggestion starts on or points to ${pageParam}: either it already links where it could, or it does not use the words of a keyword another page ranks for.` : null}</ActiveFilter>;
  if (q.isLoading) return <>{chip}<p className="g-text-2 py-6 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading the crawl…</p></>;
  if (q.isError) return <>{chip}<div className="g-callout" role="alert"><h3>Couldn't work out the internal links</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div></>;
  if (unreadable) return <>{chip}<Empty testId="link-opps-unreadable"><h3>The newest crawl could not be read</h3><p>The crawl that finished {fmtDate(unreadable.scannedAt)} was not saved in a form we can read, so nothing is shown from it (and no older crawl in its place). Run a new crawl.</p></Empty></>;
  if (!d) return <>{chip}<Empty testId="link-opps-no-crawl"><h3>No crawl yet</h3><p>Run a crawl first; this view is worked out from the pages it reads.</p></Empty></>;
  // A task is the link itself — from this page to that one — whichever keyword found it. Both addresses are kept whole,
  // so a suggestion whose addresses are too long to keep is not offered for the plan (the row says why).
  const plannable = (i: Item) => i.from.length <= 500 && i.to.length <= 300;
  const task = (i: Item): PlanTask => ({
    kind: "page", title: `Link from ${nameOf(i.from, site.domain)} to ${nameOf(i.to, site.domain)} on the words "${i.keyword}"`.slice(0, 200), target: i.from,
    facts: { linkTo: i.to, words: i.keyword, context: i.context.slice(0, 300), position: i.position, volume: i.volume, device: i.device, rankCheckedOn: i.checkedOn, place: i.place, crawled: d.scannedAt?.slice(0, 10) ?? null },
    source: `link-pair:${i.pair}`,
  });
  const exportCsv = () => {
    const rows: (string | number | null)[][] = [
      ["Link from", "Link to", "Words to link", "Position", "Device", "Rank checked on", "Place", "Volume", "Context", "Crawled on"],
      ...d.items.map((i) => [i.from, i.to, i.keyword, i.position, i.device, i.checkedOn, i.place, i.volume, i.context, d.scannedAt?.slice(0, 10) ?? null]),
      ...(d.more > 0 ? [[`The first ${d.items.length} of ${d.items.length + d.more} found; the rest are not in this file.`]] : []),
    ];
    const blob = new Blob([rows.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${site.domain}-internal-links-to-add.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const tracker = seoLinks.rankTracker(site.id), table = `${here({})}#table-link-opps`;
  const kw = (i: Item) => seoLinks.rankTracker(site.id, { keyword: i.keyword, device: device(i.device) });
  return (
    <div data-testid="link-opps">
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]">Pages of your site that use the words of a keyword another of your pages ranks for, but don't link to it. A link there — on those words — points visitors and search engines at the page you want found for them. Whether it reads naturally is your call: the words around each mention are shown.</p>
      {chip}
      {!d.linksMeasured ? (
        <Empty testId="link-opps-unmeasured"><h3>The crawl can't see this site's links</h3><p>Most of its pages link nowhere in their HTML — usual when menus and links are added by JavaScript. Without knowing which links exist, nothing can be suggested here. The <Link href={go({ tab: "rendering" })} className={`g-link ${FIG} font-medium`} data-testid="link-link-opps-rendering">Rendering</Link> tab shows what a browser sees that the HTML does not.</p></Empty>
      ) : d.targets + d.notCrawled + d.notRanking + d.notUsable + d.tooShort + d.boilerplate + (d.aliasesCut ?? 0) === 0 ? (
        <Empty testId="link-opps-no-keywords"><h3>Nothing to look for yet</h3><p>This uses the keywords you track that your site ranks for. Add keywords in the <Link href={tracker} className={`g-link ${FIG}`} data-testid="link-link-opps-tracker">rank tracker</Link> and run a check; once a page of yours ranks, mentions of that keyword on your other pages are looked for.</p></Empty>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="g-text-2" data-testid="text-link-opps-meta">From <Link href={go({ tab: "pages" })} className={`g-text-2 ${FIG}`} title="The pages that crawl read" data-testid="link-link-opps-crawl">the crawl of {d.scannedAt ? fmtDate(d.scannedAt) : "an unknown date"}</Link>{d.checkedOn ? <> and <Link href={tracker} className={`g-text-2 ${FIG}`} title="Your rank checks" data-testid="link-link-opps-checks">your rank checks up to {fmtDate(d.checkedOn)}</Link></> : ""}: <Link href={table} className={`g-text-2 ${FIG}`} title="The suggestions, listed below" data-testid="link-link-opps-places">{plural(d.items.length + d.more, "place", "places")} for a link</Link>{d.more > 0 ? <> (<Link href={table} className={`g-text-2 ${FIG}`} data-testid="link-link-opps-listed">the first {fmtNum(d.items.length)} listed</Link>, to <Link href={table} className={`g-text-2 ${FIG}`} title="The pages linked to, in the table's third column" data-testid="link-link-opps-targets">{plural(byTarget.size, "page", "pages")}</Link>)</> : <>, to <Link href={table} className={`g-text-2 ${FIG}`} title="The pages linked to, in the table's third column" data-testid="link-link-opps-targets">{plural(byTarget.size, "page", "pages")}</Link></>}, from <Link href={tracker} className={`g-text-2 ${FIG}`} title="Your tracked keywords, in the rank tracker (the ones that rank are the ones looked for)" data-testid="link-link-opps-keywords">{plural(d.targets, "ranking keyword", "ranking keywords")}</Link> looked for.</span>
            <span className="ml-auto flex flex-wrap gap-2">
              {d.items.some(plannable) && <AddToPlan siteId={site.id} label={`Add the first ${Math.min(d.items.filter(plannable).length, 50)} to the plan`} testId="button-link-opps-plan" tasks={d.items.filter(plannable).slice(0, 50).map(task)} />}
              <button type="button" className="g-pill g-pill--sm max-sm:!min-h-11" disabled={!d.items.length} onClick={exportCsv} data-testid="button-link-opps-export"><Download /> Export</button>
            </span>
          </div>
          {(d.notRanking + d.notCrawled + d.notUsable + d.tooShort + d.boilerplate + (d.aliasesCut ?? 0)) > 0 && (
            <ul className="g-text-2 mb-2 list-disc pl-5 text-[12px]" data-testid="list-link-opps-left-out">
              {d.notRanking > 0 && <li><Link href={seoLinks.rankTracker(site.id, { band: "notFound" })} className={`g-text-2 ${FIG}`} title="The keywords not found in their newest check" data-testid="link-left-out-not-ranking">{plural(d.notRanking, "keyword did", "keywords did")} not rank</Link> in {d.notRanking === 1 ? "its" : "their"} newest check, so there is no page to link to.</li>}
              {d.notCrawled > 0 && <li><Link href={tracker} className={`g-text-2 ${FIG}`} title="Your tracked keywords (which page ranks is in each row); the crawl has no row for a page it did not reach" data-testid="link-left-out-not-crawled">{plural(d.notCrawled, "keyword ranks", "keywords rank")} with a page the crawl did not reach</Link>.</li>}
              {d.notUsable > 0 && <li><Link href={go({ tab: "pages", show: "notIndexable" })} className={`g-text-2 ${FIG}`} title="The crawled pages that answered an error or a redirect, or are marked noindex" data-testid="link-left-out-not-usable">{plural(d.notUsable, "keyword ranks", "keywords rank")} with a page that, in the crawl, answered an error or a redirect or is marked noindex</Link>.</li>}
              {(d.aliasesCut ?? 0) > 0 && <li><Link href={go({ tab: "pages", show: "redirected" })} className={`g-text-2 ${FIG}`} title="The crawled addresses that redirect" data-testid="link-left-out-aliases">{plural(d.aliasesCut!, "keyword ranks", "keywords rank")} with a page more addresses redirect to than the crawl kept</Link>, so a page could already link to it through one of them — nothing is suggested for {d.aliasesCut === 1 ? "it" : "them"}.</li>}
              {d.tooShort > 0 && <li><Link href={tracker} className={`g-text-2 ${FIG}`} title="Your tracked keywords, in the rank tracker" data-testid="link-left-out-too-short">{plural(d.tooShort, "keyword is", "keywords are")} too short to look for</Link> (fewer than 6 letters match too much).</li>}
              {d.boilerplate > 0 && <li><Link href={tracker} className={`g-text-2 ${FIG}`} title="Your tracked keywords, in the rank tracker" data-testid="link-left-out-boilerplate">{plural(d.boilerplate, "keyword is", "keywords are")} on more than half of the other pages</Link> and taken to be menu or footer text — a rule of thumb (the crawl does not keep which part of a page words came from), applied when there are at least 5 other pages.</li>}
            </ul>
          )}
          {d.items.length === 0 ? <Empty testId="link-opps-none"><h3>No suggestions from these checks</h3><p>{d.targets === 0 ? "No keyword could be looked for (see above)." : "Where the pages read use the words of the keywords looked for, they already link to the page that ranks — as far as the crawl's HTML shows."}</p></Empty> : (
            <div className="overflow-x-auto">
              <table id="table-link-opps" className={COMPACT_TABLE} data-testid="table-link-opps">
                <thead><tr><th>On this page…</th><th>…these words</th><th>…could link to</th><th className="num" title="Where the page being linked to ranks for these words">Position</th><th className="num">Volume / mo</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                <tbody>
                  {d.items.slice(0, shown).map((i, n) => (
                    <tr key={`${i.from}|${i.to}`} data-testid={`row-link-opp-${i.pair}`} ref={n === firstHit ? firstRef : undefined} style={onPage(i) ? HIGHLIGHT : undefined}>
                      <td className="max-w-[16rem]" data-label="On this page"><Link href={pageHref(pathOf(i.from))} className={`g-link ${FIG} block truncate`} title={`${i.from} — its row on the pages tab`} data-testid={`link-link-opp-from-${i.pair}`}>{nameOf(i.from, site.domain)}</Link>{i.fromTitle && <Link href={seoLinks.explorer(site.domain, "pages", { path: pathOf(i.from) })} className={`g-text-2 ${FIG} block truncate text-[12px]`} title={`${i.fromTitle} — this page in Site explorer`} data-testid={`link-link-opp-from-title-${i.pair}`}>{i.fromTitle}</Link>}</td>
                      <td className="max-w-[22rem] !whitespace-normal" data-label="These words"><Link href={kw(i)} className={`g-link ${FIG} font-medium`} title="This keyword in the rank tracker" data-testid={`link-link-opp-keyword-${i.pair}`}>{i.keyword}</Link>{i.context && <Link href={pageHref(pathOf(i.from))} className={`g-text-2 ${FIG} block text-[12px]`} title="The words around the mention, on the page they are on — its row on the pages tab" data-testid={`link-link-opp-context-${i.pair}`}>{i.context}</Link>}</td>
                      <td className="max-w-[14rem]" data-label="Could link to"><Link href={pageHref(pathOf(i.to))} className={`g-link ${FIG} block truncate`} title={`${i.to} — its row on the pages tab`} data-testid={`link-link-opp-to-${i.pair}`}>{nameOf(i.to, site.domain)}</Link></td>
                      <td className="num" data-label="Position"><Link href={kw(i)} className={FIG} title={rankBasis(i) ? `${rankBasis(i)} — in the rank tracker` : "In the rank tracker"} data-testid={`link-link-opp-position-${i.pair}`}>{i.position ?? "—"}</Link>{rankBasis(i) && <Link href={kw(i)} className={`g-text-2 ${FIG} block whitespace-nowrap text-[11px]`} title="The check this position comes from, in the rank tracker" data-testid={`link-link-opp-basis-${i.pair}`}>{rankBasis(i)}</Link>}</td><td className="num" data-label="Volume / mo"><Link href={seoLinks.keywords(i.keyword)} className={FIG} title="This keyword in Keywords explorer" data-testid={`link-link-opp-volume-${i.pair}`}>{fmtNum(i.volume)}</Link></td>
                      <td className="num">{plannable(i) ? <AddToPlan siteId={site.id} label="Plan" testId={`button-plan-link-${i.pair}`} tasks={[task(i)]} /> : <span className="g-text-2 text-[12px]">Address too long to plan</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.items.length > shown && <button type="button" className={`g-link ${FIG} mt-2 text-[13px]`} onClick={() => setShown(d.items.length)} data-testid="button-link-opps-all">Show all {fmtNum(d.items.length)}</button>}
              {d.more > 0 && <p className="g-text-2 mt-1 text-[12px]"><Link href={tracker} className={`g-text-2 ${FIG}`} title="The keywords they come from, in the rank tracker; the list here stops at the first found" data-testid="link-link-opps-more">{fmtNum(d.more)} more were found than are listed</Link>.</p>}
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">The crawl reads each page's HTML (links added by JavaScript are not seen, so a page may already link in a way this cannot see). A link written with http or https, with or without "www" or a last slash, counts as a link to the page — and so does a link to an address the crawl saw redirect to it, or to a page whose canonical names it. Words must match whole (a plural or another spelling is not matched). Each keyword's position is from its newest rank check, on the device where it ranked better. One suggestion per pair of pages, at most 10 pages for each ranking page.{d.cutPages > 0 ? <> <Link href={go({ tab: "pages" })} className={`g-text-2 ${FIG}`} title="The crawled pages (which of them were cut is not recorded; the Size column is a guide)" data-testid="link-link-opps-cut">{plural(d.cutPages, "page is", "pages are")} cut</Link> where the crawl stops saving a page's text (its first 16,000 characters); a mention further down is not seen.</> : ""}</p>
        </>
      )}
    </div>
  );
}
