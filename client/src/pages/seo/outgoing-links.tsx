/**
 * Site audit → Outgoing links (server/seo/outgoing-links.ts): the other websites the site links to, from the newest
 * crawl — and which of the links the crawl checked answered with an error. Free.
 *
 * Every figure is a link (links.ts): a website to Site explorer, a page of the site to its row on the pages tab, a
 * checked address to the live address (the check's words say "open it yourself"), a count to the list that holds it.
 * `page` in the address outlines the rows that start on that page and the chip says so (or that there are none);
 * `all` lists every website, not the first 50 ("Show all" is a link to it).
 */
import { Fragment, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { apiErrorMessage } from "@/lib/queryClient";
import { Empty, fmtDate, fmtNum, HIGHLIGHT, isNotRunYet, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";
import { seoLinks } from "./links";
import { ActiveFilter, COMPACT_TABLE, FIG, type AuditParams, type Foreign } from "./viz-audit";

type Domain = { domain: string; pages: number; links: number; examples: { from: string; to: string; anchor: string | null }[]; checked: number; broken: number };
type Answer = "gone" | "error" | "refused" | "inconclusive" | "no_content" | "redirect_unfollowed" | "no_answer" | "no_status" | "unusual";
type Broken = { to: string; status: number | null; answer: Answer; from: string[]; fromCount: number };
/** The status in words — what the check saw, not what the page holds (it does not read the page). */
const ANSWER: Record<Answer, string> = {
  gone: "gone (the address does not exist)", error: "server error", refused: "refused our check — many sites refuse automated checks; open it yourself",
  inconclusive: "answered with an error our check cannot judge; open it yourself", no_content: "answered with nothing to show",
  redirect_unfollowed: "sent the check on to an address it does not follow; open it yourself", no_answer: "no answer — it may have been slow or down at the time",
  no_status: "the check got no status, and this crawl did not record why (a newer crawl will); open it yourself",
  unusual: "answered with a status outside the usual ones; open it yourself",
};
const broken = (a: Answer) => a === "gone" || a === "error";
/** A short, stable fingerprint of a whole address, for a task identity that must fit 200 characters. */
const fingerprint = (t: string) => { let a = 0x811c9dc5, b = 0x5bd1e995; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; } return a.toString(36) + b.toString(36); };
type Data = { jobId: string; scannedAt: string | null; linksMeasured: boolean | null; pagesRead: number; domains: number; links: number; linkedDomains: Domain[]; more: number; broken: Broken[]; checkedAddresses: number; uncheckedLinks: number };
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const path = (u: string) => { try { const x = new URL(u); return (x.pathname + x.search) || "/"; } catch { return u; } };
/** The website an address is on, as Site explorer names it (no "www."). */
const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return u; } };

/** A cell's label for screen readers (the phone layout hides the table header). */
const Label = ({ children }: { children: string }) => <span className="sr-only">{children}: </span>;
export function OutgoingLinksView({ site, crawlId, pageHref, pageParam, here, go, foreign, all = false }: {
  site: SeoSite;
  /** The newest finished crawl (part of the question). */
  crawlId?: string | null;
  /** A page of the site, its row opened on the pages tab (links.ts: audit `page`). */
  pageHref: (path: string) => string;
  /** The page the address names on this tab: the rows that start on it are outlined. */
  pageParam: string | null;
  /** The current address with one narrowing changed. */
  here: (p: AuditParams) => string;
  /** An address on the audit for this site, keeping the crawl shown. */
  go: (p: AuditParams) => string;
  foreign?: Foreign;
  /** Every row listed, not the first 50 (the address's `all`, links.ts audit). */
  all?: boolean;
}) {
  const q = useQuery<Data | null>({
    queryKey: [`/api/seo/sites/${site.id}/audit/outgoing`, crawlId ?? null], refetchOnMount: "always", retry: false,
    queryFn: async ({ queryKey, signal }) => { try { const r = await fetch(queryKey[0] as string, { credentials: "include", signal }); if (r.status === 404) return null; if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return await r.json(); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const firstRef = useRef<HTMLElement>(null);
  // The newest crawl could not be read: said (the server never answers with an older crawl instead).
  const unreadable = q.data && typeof q.data === "object" && "unreadable" in (q.data as object) ? (q.data as unknown as { scannedAt: string | null }) : null;
  const d = unreadable ? null : q.data;
  const brokenOnPage = (b: Broken) => !!pageParam && b.from.some((f) => path(f) === pageParam);
  const rowOnPage = (x: Domain) => !!pageParam && x.examples.some((e) => path(e.from) === pageParam);
  const hitsBroken = d ? d.broken.filter(brokenOnPage).length : 0, hitsRows = d ? d.linkedDomains.filter(rowOnPage).length : 0;
  const firstRow = d && pageParam && !hitsBroken ? d.linkedDomains.findIndex(rowOnPage) : -1;
  // The rows listed: every one with `all`, else the first 50 — and always as far as the first row from the page asked for.
  const shown = all ? Infinity : Math.max(50, firstRow + 1);
  useEffect(() => { if (hitsBroken || (firstRow >= 0 && firstRow < shown)) firstRef.current?.scrollIntoView({ block: "nearest" }); }, [hitsBroken, firstRow, shown, pageParam]);
  // What narrowed the view, said from the address at once (also while the crawl is read), and whether any listed link
  // starts on the page once it is.
  const hits = hitsBroken + hitsRows;
  const words: string[] = [];
  if (pageParam) words.push(!d ? `Page ${pageParam}` : hits ? `Page ${pageParam} — its ${hits === 1 ? "link is" : "links are"} outlined` : `Page ${pageParam} — no listed link starts on it`);
  if (foreign) words.push(foreign.words);
  const chip = words.length > 0 && <ActiveFilter words={words.join(" · ")} clearHref={here({ page: undefined })} extra={foreign ? { href: foreign.href, label: foreign.label, testId: "link-foreign-tab" } : undefined}>{d && pageParam && !hits ? `Only one example page is kept for each website and the first few pages for each checked address, so a link from ${pageParam} may exist without being listed.` : null}</ActiveFilter>;
  if (q.isLoading) return <>{chip}<p className="g-text-2 py-6 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading the crawl…</p></>;
  if (q.isError) return <>{chip}<div className="g-callout" role="alert"><h3>Couldn't read the outgoing links</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div></>;
  if (unreadable) return <>{chip}<Empty testId="outgoing-unreadable"><h3>The newest crawl could not be read</h3><p>The crawl that finished {fmtDate(unreadable.scannedAt)} was not saved in a form we can read, so nothing is shown from it (and no older crawl in its place). Run a new crawl.</p></Empty></>;
  if (!d) return <>{chip}<Empty testId="outgoing-no-crawl"><h3>No crawl yet</h3><p>Run a crawl first; this view is read from the pages it saves.</p></Empty></>;
  const task = (b: Broken): PlanTask => ({
    kind: "page", title: `Fix or remove the link to ${b.to.replace(/^https?:\/\/(www\.)?/, "")} (${b.status === null ? "no answer" : `answered ${b.status}`}) on ${b.fromCount} page${b.fromCount === 1 ? "" : "s"}`.slice(0, 200),
    target: b.from[0] ?? null, facts: { linkTo: b.to.slice(0, 300), answered: b.status, pages: b.fromCount, crawled: d.scannedAt?.slice(0, 10) ?? null },
    // The whole address decides the task (two long addresses that start alike are two tasks).
    source: `outgoing:${fingerprint(b.to)}`,
  });
  const exportCsv = () => {
    const rows: (string | number | null)[][] = [["Website linked to", "Pages linking", "Links", "Checked addresses", "Answered an error", "Example page", "Example link", "Link text", "Crawled on"],
      ...d.linkedDomains.map((x) => [x.domain, x.pages, x.links, x.checked, x.broken, x.examples[0]?.from ?? null, x.examples[0]?.to ?? null, x.examples[0]?.anchor ?? null, d.scannedAt?.slice(0, 10) ?? null]),
      ...(d.more > 0 ? [[`The first ${d.linkedDomains.length} of ${d.domains} websites; the rest are not in this file.`]] : [])];
    const blob = new Blob([rows.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${site.domain}-outgoing-links.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const table = `${here({})}#table-outgoing`, brokenList = `${here({})}#outgoing-broken`, pages = go({ tab: "pages" });
  const nBroken = d.broken.filter((b) => broken(b.answer)).length;
  return (
    <div data-testid="outgoing-links">
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]">The other websites your pages link to. Links to suppliers, associations and directories are normal; a link to a page that no longer answers is worth fixing, and a website you did not expect here is worth a look.</p>
      {chip}
      {/* Said in a plain callout rather than a colour of its own: the page's words carry the caution. */}
      {d.linksMeasured === null && <p className="g-callout g-text mb-3 text-[13px]" role="status" data-testid="outgoing-no-pages">No page of this crawl loaded, so there are no links to read. Run a new crawl in Site audit.</p>}
      {d.linksMeasured === false && <p className="g-callout g-text mb-3 text-[13px]" role="status" data-testid="outgoing-unmeasured">Most pages that loaded have no web (http/https) links saved from their HTML — one possible reason is links added by JavaScript, which the crawl does not run. (Phone and email links are not counted.) What is listed is only what the HTML had.</p>}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="g-text-2" data-testid="text-outgoing-meta">From <Link href={pages} className={`g-text-2 ${FIG}`} title="The pages that crawl read" data-testid="link-outgoing-crawl">the crawl of {d.scannedAt ? fmtDate(d.scannedAt) : "an unknown date"}</Link>: <Link href={table} className={`g-text-2 ${FIG}`} title="Counted by website, in the table below" data-testid="link-outgoing-links">{fmtNum(d.links)} link{d.links === 1 ? "" : "s"}</Link> to <Link href={table} className={`g-text-2 ${FIG}`} title="The websites, listed below" data-testid="link-outgoing-domains">{fmtNum(d.domains)} other website{d.domains === 1 ? "" : "s"}</Link>, from <Link href={pages} className={`g-text-2 ${FIG}`} title="Every crawled page; the Status column says which loaded" data-testid="link-outgoing-pages">{fmtNum(d.pagesRead)} page{d.pagesRead === 1 ? "" : "s"} that loaded</Link>.</span>
        <button type="button" className="g-pill g-pill--sm ml-auto max-sm:!min-h-11" disabled={!d.linkedDomains.length} onClick={exportCsv} data-testid="button-outgoing-export"><Download /> Export</button>
      </div>
      <section id="outgoing-broken" className="mb-4" data-testid="outgoing-broken">
        <h3 className="mb-1 text-[14px] font-medium" style={{ color: "var(--g-blue)" }}>Checked links that did not answer normally (<Link href={brokenList} className={FIG} title="Listed below" data-testid="link-outgoing-broken-count">{fmtNum(d.broken.length)}</Link>{nBroken ? <>, <Link href={brokenList} className={FIG} title="The ones that are gone or a server error, listed below" data-testid="link-outgoing-broken-broken">{fmtNum(nBroken)} broken</Link></> : ""})</h3>
        <p className="g-text-2 mb-2 text-[12px]">The crawl checks a sample of the addresses it did not crawl itself: <Link href={table} className={`g-text-2 ${FIG}`} title="How many of each website's addresses were checked is the table's last column" data-testid="link-outgoing-checked">{fmtNum(d.checkedAddresses)} of these websites' addresses were checked</Link>; links to the others (<Link href={table} className={`g-text-2 ${FIG}`} title="The websites whose addresses were not checked say so in the table's last column" data-testid="link-outgoing-unchecked">{fmtNum(d.uncheckedLinks)} page link{d.uncheckedLinks === 1 ? "" : "s"}</Link>) were not checked, so nothing is said about them.</p>
        {d.checkedAddresses === 0 ? <p className="g-text-2 text-[13px]" data-testid="outgoing-none-checked">No outgoing addresses were checked in this crawl, so nothing is said about whether they work.</p> : d.broken.length === 0 ? <p className="g-text-2 text-[13px]">Every checked address gave an ordinary answer (the check looks at the answer, not at what the page says).</p> : (
          <ul className="space-y-1 text-[13px]">
            {d.broken.map((b, n) => (
              <li key={b.to} className="flex flex-wrap items-center gap-x-2 [overflow-wrap:anywhere]" data-testid={`row-outgoing-broken-${b.to}`} ref={brokenOnPage(b) && d.broken.findIndex(brokenOnPage) === n ? (firstRef as React.RefObject<HTMLLIElement>) : undefined} style={brokenOnPage(b) ? HIGHLIGHT : undefined}>
                <Link href={seoLinks.explorer(hostOf(b.to))} className={`g-link ${FIG}`} title={`${hostOf(b.to)} in Site explorer`} data-testid={`link-outgoing-broken-${b.to}`}>{b.to.replace(/^https?:\/\//, "")}</Link>
                <a href={b.to} target="_blank" rel="noreferrer" className={`g-link ${FIG} min-w-11 text-center`} aria-label={`Open ${b.to} in a new tab`} data-testid={`link-outgoing-open-${b.to}`}>↗</a>
                <span className="g-text-2">— <a href={b.to} target="_blank" rel="noreferrer" className={`g-text-2 ${FIG}`} title="What the check saw; open the address yourself to see what it does now" data-testid={`link-outgoing-answer-${b.to}`}>{b.status === null ? "" : `${b.status}, `}{ANSWER[b.answer]}</a> · linked from {b.from.map((f, i) => <Fragment key={f}>{i > 0 ? ", " : ""}<Link href={pageHref(path(f))} className={`g-link ${FIG}`} title={`${f} — its row on the pages tab`} data-testid={`link-outgoing-from-${path(f)}`}>{path(f)}</Link></Fragment>)}{b.fromCount > b.from.length ? <> and <Link href={pages} className={`g-text-2 ${FIG}`} title="The crawled pages; which of the rest link here is not kept by the crawl" data-testid={`link-outgoing-from-more-${b.to}`}>{fmtNum(b.fromCount - b.from.length)} more</Link></> : ""}</span>
                {broken(b.answer) && <AddToPlan siteId={site.id} label="Plan" testId={`button-plan-outgoing-${b.to}`} tasks={[task(b)]} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {d.linkedDomains.length === 0 ? <Empty testId="outgoing-none"><h3>No links to other websites</h3><p>{d.linksMeasured === null ? "No page loaded." : d.linksMeasured ? "The HTML of the pages read has no web links to other websites." : "No web links were saved from the HTML (one possible reason: links added by JavaScript)."}</p></Empty> : (
        <div className="overflow-x-auto">
          <table id="table-outgoing" className={COMPACT_TABLE} data-testid="table-outgoing">
            <thead><tr><th>Website</th><th className="num">Pages linking</th><th className="num">Links</th><th>For example</th><th className="num" title="Of its addresses the crawl checked: how many, and how many were gone or a server error">Checked / broken</th></tr></thead>
            <tbody>
              {d.linkedDomains.slice(0, shown).map((x, n) => { const ex = x.examples[0]; return (
                <tr key={x.domain} data-testid={`row-outgoing-${x.domain}`} ref={n === firstRow ? (firstRef as React.RefObject<HTMLTableRowElement>) : undefined} style={rowOnPage(x) ? HIGHLIGHT : undefined}>
                  <td className="max-w-[14rem] truncate" data-label="Website" title={x.domain}><Label>Website</Label><Link href={seoLinks.explorer(x.domain)} className={`g-link ${FIG}`} title={`${x.domain} in Site explorer`} data-testid={`link-outgoing-domain-${x.domain}`}>{x.domain}</Link></td>
                  <td className="num" data-label="Pages linking"><Label>Pages linking</Label>{ex ? <Link href={pageHref(path(ex.from))} className={FIG} title={`One of them, ${path(ex.from)} — its row on the pages tab (the crawl keeps one example)`} data-testid={`link-outgoing-pages-${x.domain}`}>{fmtNum(x.pages)}</Link> : <Link href={pages} className={FIG} title="The crawled pages (the crawl kept no example of which link here)" data-testid={`link-outgoing-pages-${x.domain}`}>{fmtNum(x.pages)}</Link>}</td><td className="num" data-label="Links"><Label>Links</Label><Link href={seoLinks.explorer(x.domain, "backlinks")} className={FIG} title={`Links to ${x.domain} as Site explorer knows them (yours among them if its data has them)`} data-testid={`link-outgoing-count-${x.domain}`}>{fmtNum(x.links)}</Link></td>
                  <td className="max-w-[24rem] !whitespace-normal text-[12px] [overflow-wrap:anywhere]" data-label="For example"><Label>For example</Label>{ex ? <><Link href={pageHref(path(ex.from))} className={`g-link ${FIG}`} title={`${ex.from} — its row on the pages tab`} data-testid={`link-outgoing-example-from-${x.domain}`}>{path(ex.from)}</Link><span className="g-text-2"> →</span> <a href={ex.to} target="_blank" rel="noreferrer" className={`g-link ${FIG}`} title="Open the linked address in a new tab" data-testid={`link-outgoing-example-to-${x.domain}`}>{ex.to.replace(/^https?:\/\/(www\.)?/, "")}</a>{ex.anchor && ex.anchor !== "(no text)" ? <Link href={pageHref(path(ex.from))} className={`g-text-2 ${FIG}`} title="The link's text, on the page it is on — its row on the pages tab" data-testid={`link-outgoing-anchor-${x.domain}`}> “{ex.anchor}”</Link> : ex.anchor === "(no text)" ? <Link href={pageHref(path(ex.from))} className={`g-text-2 ${FIG}`} title="The page the link is on — its row on the pages tab" data-testid={`link-outgoing-anchor-${x.domain}`}> (no link text in the HTML)</Link> : <Link href={pageHref(path(ex.from))} className={`g-text-2 ${FIG}`} title="The page the link is on — its row on the pages tab" data-testid={`link-outgoing-anchor-${x.domain}`}> (link text not saved by this crawl)</Link>}</> : "—"}</td>
                  <td className="num" data-label="Checked / broken"><Label>Checked, broken</Label>{x.checked ? <Link href={brokenList} className={FIG} title={x.broken ? "Its broken addresses are in the list above" : "The list above holds every checked address that did not answer normally; none of this website's did"} data-testid={`link-outgoing-checked-${x.domain}`}>{fmtNum(x.checked)} / {fmtNum(x.broken)}</Link> : <Link href={brokenList} className={`g-text-2 ${FIG}`} title="None of its addresses was in the sample the crawl checked" data-testid={`link-outgoing-checked-${x.domain}`}>not checked</Link>}</td>
                </tr>
              ); })}
            </tbody>
          </table>
          {d.linkedDomains.length > shown && <Link href={here({ all: true })} className={`g-link ${FIG} mt-2 text-[13px]`} data-testid="button-outgoing-all">Show all {fmtNum(d.linkedDomains.length)}</Link>}
          {d.more > 0 && <p className="g-text-2 mt-1 text-[12px]"><Link href={pages} className={`g-text-2 ${FIG}`} title="The crawled pages these links are on; the websites beyond the ones listed are only in the count" data-testid="link-outgoing-more">{fmtNum(d.more)} more websites than are listed</Link>.</p>}
        </div>
      )}
      <p className="g-text-2 mt-2 text-[12px]">Read from each page's HTML (links added by JavaScript are not seen), up to 2,000 links a page. Whether a link is marked nofollow or sponsored is not recorded by the crawl. Your own sub-domains count as your site.</p>
    </div>
  );
}
