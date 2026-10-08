/**
 * Site audit → Internal links to add (server/seo/link-opportunities.ts): pages of the site that use the words of a
 * keyword another page ranks for, without linking to that page. From the newest crawl and rank checks — free.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { apiErrorMessage } from "@/lib/queryClient";
import { Empty, fmtDate, fmtNum, isNotRunYet, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Item = { keywordId: number; keyword: string; volume: number | null; position: number | null; to: string; from: string; fromTitle: string | null; context: string };
type Data = { jobId: string; scannedAt: string | null; checkedOn: string | null; linksMeasured: boolean; targets: number; boilerplate: number; notCrawled: number; items: Item[]; more: number };
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

export function LinkOpportunitiesView({ site }: { site: SeoSite }) {
  const q = useQuery<Data | null>({
    queryKey: [`/api/seo/sites/${site.id}/audit/link-opportunities`], refetchOnMount: "always", retry: false,
    queryFn: async ({ queryKey }) => { try { const r = await fetch(queryKey[0] as string, { credentials: "include" }); if (r.status === 404) return null; if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return await r.json(); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const [shown, setShown] = useState(50);
  const d = q.data;
  const byTarget = useMemo(() => { const m = new Map<string, number>(); for (const i of d?.items ?? []) m.set(i.to, (m.get(i.to) ?? 0) + 1); return m; }, [d]);
  if (q.isLoading) return <p className="g-text-2 py-6 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading the crawl…</p>;
  if (q.isError) return <div className="g-callout" role="alert"><h3>Couldn't work out the internal links</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>;
  if (!d) return <Empty testId="link-opps-no-crawl"><h3>No crawl yet</h3><p>Run a crawl first; this view is worked out from the pages it reads.</p></Empty>;
  const task = (i: Item): PlanTask => ({
    kind: "page", title: `Link from ${nameOf(i.from, site.domain)} to ${nameOf(i.to, site.domain)} on the words "${i.keyword}"`.slice(0, 200), target: i.from.length <= 500 ? i.from : null,
    facts: { linkTo: i.to.length <= 300 ? i.to : "(address too long to keep — see Site audit)", words: i.keyword, context: i.context.slice(0, 300), position: i.position, volume: i.volume, crawled: d.scannedAt?.slice(0, 10) ?? "?" },
    source: `link-opp:${i.keywordId}:${nameOf(i.from, site.domain)}`,
  });
  const exportCsv = () => {
    const rows: (string | number | null)[][] = [["Link from", "Link to", "Words to link", "Position", "Volume", "Context"], ...d.items.map((i) => [i.from, i.to, i.keyword, i.position, i.volume, i.context])];
    const blob = new Blob([rows.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${site.domain}-internal-links-to-add.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const basis = `From the crawl of ${d.scannedAt ? fmtDate(d.scannedAt) : "an unknown date"}${d.checkedOn ? ` and your rank checks up to ${fmtDate(d.checkedOn)}` : ""}`;
  return (
    <div data-testid="link-opps">
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]">Pages of your site that use the words of a keyword another of your pages ranks for, but don't link to it. A link there — on those words — points visitors and search engines at the page you want found for them. Whether it reads naturally is your call: the words around each mention are shown.</p>
      {!d.linksMeasured ? (
        <Empty testId="link-opps-unmeasured"><h3>The crawl can't see this site's links</h3><p>Most of its pages link nowhere in their HTML — usual when menus and links are added by JavaScript. Without knowing which links exist, nothing can be suggested here. The <b>Rendering</b> tab shows what a browser sees that the HTML does not.</p></Empty>
      ) : d.targets + d.notCrawled === 0 ? (
        <Empty testId="link-opps-no-keywords"><h3>Nothing to look for yet</h3><p>This uses the keywords you track that your site ranks for. Add keywords in the <Link href="/seo/rank-tracker" className="g-link">rank tracker</Link> and run a check; once a page of yours ranks, mentions of that keyword on your other pages are looked for.</p></Empty>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="g-text-2" data-testid="text-link-opps-meta">{basis}: {fmtNum(d.items.length + d.more)} place{d.items.length + d.more === 1 ? "" : "s"} for a link, to {fmtNum(byTarget.size)} page{byTarget.size === 1 ? "" : "s"}, from {fmtNum(d.targets)} ranking keyword{d.targets === 1 ? "" : "s"} looked for.{d.notCrawled > 0 ? ` ${fmtNum(d.notCrawled)} keyword${d.notCrawled === 1 ? " ranks" : "s rank"} with a page the crawl did not reach.` : ""}{d.boilerplate > 0 ? ` ${fmtNum(d.boilerplate)} ${d.boilerplate === 1 ? "is" : "are"} on most pages (menu or footer text) and left out.` : ""}</span>
            <span className="ml-auto flex flex-wrap gap-2">
              {d.items.length > 0 && <AddToPlan siteId={site.id} label={`Add the first ${Math.min(d.items.length, 50)} to the plan`} testId="button-link-opps-plan" tasks={d.items.slice(0, 50).map(task)} />}
              <button type="button" className="g-pill g-pill--sm" disabled={!d.items.length} onClick={exportCsv} data-testid="button-link-opps-export"><Download /> Export</button>
            </span>
          </div>
          {d.items.length === 0 ? <Empty testId="link-opps-none"><h3>No missing links found</h3><p>Where your other pages use the words of a keyword you rank for, they already link to the page that ranks — or they don't use those words at all.</p></Empty> : (
            <div className="overflow-x-auto">
              <table className="g-table w-full" data-testid="table-link-opps">
                <thead><tr><th>On this page…</th><th>…these words</th><th>…could link to</th><th className="num" title="Where the page being linked to ranks for these words">Position</th><th className="num">Volume / mo</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                <tbody>
                  {d.items.slice(0, shown).map((i) => (
                    <tr key={`${i.from}|${i.to}`}>
                      <td className="max-w-[16rem]"><a href={i.from} target="_blank" rel="noreferrer" className="g-link block truncate" title={i.from}>{nameOf(i.from, site.domain)}</a>{i.fromTitle && <span className="g-text-2 block truncate text-[12px]" title={i.fromTitle}>{i.fromTitle}</span>}</td>
                      <td className="max-w-[22rem] !whitespace-normal"><b className="font-medium">{i.keyword}</b>{i.context && <span className="g-text-2 block text-[12px]">{i.context}</span>}</td>
                      <td className="max-w-[14rem]"><a href={i.to} target="_blank" rel="noreferrer" className="g-link block truncate" title={i.to}>{nameOf(i.to, site.domain)}</a></td>
                      <td className="num">{i.position ?? "—"}</td><td className="num">{fmtNum(i.volume)}</td>
                      <td className="num"><AddToPlan siteId={site.id} label="Plan" testId={`button-plan-link-${i.keywordId}`} tasks={[task(i)]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.items.length > shown && <button type="button" className="g-link mt-2 text-[13px]" onClick={() => setShown(d.items.length)} data-testid="button-link-opps-all">Show all {fmtNum(d.items.length)}</button>}
              {d.more > 0 && <p className="g-text-2 mt-1 text-[12px]">{fmtNum(d.more)} more were found than are listed.</p>}
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">The crawl reads each page's HTML (links added by JavaScript are not seen, so a page may already link in a way this cannot see). A link written with http or https, with or without "www" or a last slash, counts as a link to the page. One suggestion per pair of pages, at most {10} pages for each ranking page.</p>
        </>
      )}
    </div>
  );
}
