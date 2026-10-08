/**
 * Site audit → Outgoing links (server/seo/outgoing-links.ts): the other websites the site links to, from the newest
 * crawl — and which of the links the crawl checked answered with an error. Free.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { Empty, fmtDate, fmtNum, isNotRunYet, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Domain = { domain: string; pages: number; links: number; examples: { from: string; to: string; anchor: string | null }[]; checked: number; broken: number };
type Answer = "gone" | "error" | "refused" | "inconclusive" | "no_content" | "redirect_unfollowed" | "no_answer" | "no_status";
type Broken = { to: string; status: number | null; answer: Answer; from: string[]; fromCount: number };
/** The status in words — what the check saw, not what the page holds (it does not read the page). */
const ANSWER: Record<Answer, string> = {
  gone: "gone (the address does not exist)", error: "server error", refused: "refused our check — many sites refuse automated checks; open it yourself",
  inconclusive: "answered with an error our check cannot judge; open it yourself", no_content: "answered with nothing to show",
  redirect_unfollowed: "sent the check on to an address it does not follow; open it yourself", no_answer: "no answer — it may have been slow or down at the time",
  no_status: "the check got no status, and this crawl did not record why (a newer crawl will); open it yourself",
};
const broken = (a: Answer) => a === "gone" || a === "error";
/** A short, stable fingerprint of a whole address, for a task identity that must fit 200 characters. */
const fingerprint = (t: string) => { let a = 0x811c9dc5, b = 0x5bd1e995; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; } return a.toString(36) + b.toString(36); };
type Data = { jobId: string; scannedAt: string | null; linksMeasured: boolean | null; pagesRead: number; domains: number; links: number; linkedDomains: Domain[]; more: number; broken: Broken[]; checkedAddresses: number; uncheckedLinks: number };
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const path = (u: string) => { try { const x = new URL(u); return (x.pathname + x.search) || "/"; } catch { return u; } };

/** A cell's label for screen readers (the phone layout hides the table header). */
const Label = ({ children }: { children: string }) => <span className="sr-only">{children}: </span>;
export function OutgoingLinksView({ site, crawlId }: { site: SeoSite; /** The newest finished crawl (part of the question). */ crawlId?: string | null }) {
  const q = useQuery<Data | null>({
    queryKey: [`/api/seo/sites/${site.id}/audit/outgoing`, crawlId ?? null], refetchOnMount: "always", retry: false,
    queryFn: async ({ queryKey, signal }) => { try { const r = await fetch(queryKey[0] as string, { credentials: "include", signal }); if (r.status === 404) return null; if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return await r.json(); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const [shown, setShown] = useState(50);
  if (q.isLoading) return <p className="g-text-2 py-6 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading the crawl…</p>;
  if (q.isError) return <div className="g-callout" role="alert"><h3>Couldn't read the outgoing links</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>;
  const d = q.data;
  if (!d) return <Empty testId="outgoing-no-crawl"><h3>No crawl yet</h3><p>Run a crawl first; this view is read from the pages it saves.</p></Empty>;
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
  return (
    <div data-testid="outgoing-links">
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]">The other websites your pages link to. Links to suppliers, associations and directories are normal; a link to a page that no longer answers is worth fixing, and a website you did not expect here is worth a look.</p>
      {d.linksMeasured === null && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="outgoing-no-pages">No page of this crawl loaded, so there are no links to read. Run a new crawl in Site audit.</p>}
      {d.linksMeasured === false && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="outgoing-unmeasured">Most pages that loaded have no web (http/https) links saved from their HTML — one possible reason is links added by JavaScript, which the crawl does not run. (Phone and email links are not counted.) What is listed is only what the HTML had.</p>}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="g-text-2" data-testid="text-outgoing-meta">From the crawl of {d.scannedAt ? fmtDate(d.scannedAt) : "an unknown date"}: {fmtNum(d.links)} link{d.links === 1 ? "" : "s"} to {fmtNum(d.domains)} other website{d.domains === 1 ? "" : "s"}, from {fmtNum(d.pagesRead)} page{d.pagesRead === 1 ? "" : "s"} that loaded.</span>
        <button type="button" className="g-pill g-pill--sm ml-auto" disabled={!d.linkedDomains.length} onClick={exportCsv} data-testid="button-outgoing-export"><Download /> Export</button>
      </div>
      <section className="mb-4" data-testid="outgoing-broken">
        <h3 className="g-text mb-1 text-[14px] font-medium">Checked links that did not answer normally ({fmtNum(d.broken.length)}{d.broken.some((b) => broken(b.answer)) ? `, ${fmtNum(d.broken.filter((b) => broken(b.answer)).length)} broken` : ""})</h3>
        <p className="g-text-2 mb-2 text-[12px]">The crawl checks a sample of the addresses it did not crawl itself: {fmtNum(d.checkedAddresses)} of these websites' addresses were checked; links to the others ({fmtNum(d.uncheckedLinks)} page link{d.uncheckedLinks === 1 ? "" : "s"}) were not checked, so nothing is said about them.</p>
        {d.checkedAddresses === 0 ? <p className="g-text-2 text-[13px]" data-testid="outgoing-none-checked">No outgoing addresses were checked in this crawl, so nothing is said about whether they work.</p> : d.broken.length === 0 ? <p className="g-text-2 text-[13px]">Every checked address gave an ordinary answer (the check looks at the answer, not at what the page says).</p> : (
          <ul className="space-y-1 text-[13px]">
            {d.broken.map((b) => (
              <li key={b.to} className="flex flex-wrap items-center gap-x-2 [overflow-wrap:anywhere]">
                <a href={b.to} target="_blank" rel="noreferrer" className="g-link">{b.to.replace(/^https?:\/\//, "")}</a>
                <span className="g-text-2">— {b.status === null ? "" : `${b.status}, `}{ANSWER[b.answer]} · linked from {b.from.map(path).join(", ")}{b.fromCount > b.from.length ? ` and ${b.fromCount - b.from.length} more` : ""}</span>
                {broken(b.answer) && <AddToPlan siteId={site.id} label="Plan" testId={`button-plan-outgoing-${b.to}`} tasks={[task(b)]} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {d.linkedDomains.length === 0 ? <Empty testId="outgoing-none"><h3>No links to other websites</h3><p>{d.linksMeasured === null ? "No page loaded." : d.linksMeasured ? "The HTML of the pages read has no web links to other websites." : "No web links were saved from the HTML (one possible reason: links added by JavaScript)."}</p></Empty> : (
        <div className="overflow-x-auto">
          <table className="g-table w-full" data-testid="table-outgoing">
            <thead><tr><th>Website</th><th className="num">Pages linking</th><th className="num">Links</th><th>For example</th><th className="num" title="Of its addresses the crawl checked: how many, and how many were gone or a server error">Checked / broken</th></tr></thead>
            <tbody>
              {d.linkedDomains.slice(0, shown).map((x) => (
                <tr key={x.domain}>
                  <td className="max-w-[14rem] truncate" data-label="Website" title={x.domain}><Label>Website</Label>{x.domain}</td>
                  <td className="num" data-label="Pages linking"><Label>Pages linking</Label>{fmtNum(x.pages)}</td><td className="num" data-label="Links"><Label>Links</Label>{fmtNum(x.links)}</td>
                  <td className="max-w-[24rem] !whitespace-normal text-[12px] [overflow-wrap:anywhere]" data-label="For example"><Label>For example</Label>{x.examples[0] ? <><span className="g-text-2">{path(x.examples[0].from)} →</span> <a href={x.examples[0].to} target="_blank" rel="noreferrer" className="g-link">{x.examples[0].to.replace(/^https?:\/\/(www\.)?/, "")}</a>{x.examples[0].anchor && x.examples[0].anchor !== "(no text)" ? <span className="g-text-2"> “{x.examples[0].anchor}”</span> : x.examples[0].anchor === "(no text)" ? <span className="g-text-2"> (no link text in the HTML)</span> : <span className="g-text-2"> (link text not saved by this crawl)</span>}</> : "—"}</td>
                  <td className="num" data-label="Checked / broken"><Label>Checked, broken</Label>{x.checked ? `${fmtNum(x.checked)} / ${fmtNum(x.broken)}` : "not checked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.linkedDomains.length > shown && <button type="button" className="g-link mt-2 text-[13px]" onClick={() => setShown(d.linkedDomains.length)} data-testid="button-outgoing-all">Show all {fmtNum(d.linkedDomains.length)}</button>}
          {d.more > 0 && <p className="g-text-2 mt-1 text-[12px]">{fmtNum(d.more)} more websites than are listed.</p>}
        </div>
      )}
      <p className="g-text-2 mt-2 text-[12px]">Read from each page's HTML (links added by JavaScript are not seen), up to 2,000 links a page. Whether a link is marked nofollow or sponsored is not recorded by the crawl. Your own sub-domains count as your site.</p>
    </div>
  );
}
