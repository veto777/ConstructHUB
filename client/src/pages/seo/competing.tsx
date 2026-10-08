/**
 * Rank tracker → pages competing for the same search (server/seo/competing-pages.ts): tracked keywords for which
 * Google has shown different pages of the site from one check to the next. Read from saved checks — free.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Page = { url: string; times: number; best: number; lastSeen: string; lastPosition: number };
type Item = { keywordId: number; keyword: string; volume: number | null; device: string; kind: "alternating" | "changed"; checks: number; switches: number; pages: Page[] };
type Data = { days: number; keywords: number; items: Item[] };
const pathOf = (u: string) => { try { const x = new URL(u); return (x.pathname + x.search) || "/"; } catch { return u; } };

export function CompetingPages({ site }: { site: SeoSite }) {
  const q = useQuery<Data>({ queryKey: [`/api/seo/sites/${site.id}/rank-competing`], refetchOnMount: "always" });
  const [open, setOpen] = useState<number | null>(null);
  const [showChanged, setShowChanged] = useState(false);
  if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Looking for pages that compete…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't look for competing pages: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  const d = q.data;
  // Nothing to say until there are checks; and nothing found is one quiet line, not a panel.
  if (!d || d.keywords === 0) return null;
  const alternating = d.items.filter((i) => i.kind === "alternating"), changed = d.items.filter((i) => i.kind === "changed");
  if (!d.items.length) return <p className="g-text-2 mb-5 text-[13px]" data-testid="competing-none">Google has shown the same page of yours for each tracked keyword over the last {d.days} days — no pages competing with each other.</p>;
  const task = (i: Item): PlanTask => ({ kind: "page", title: `Decide which page should rank for "${i.keyword}"`, target: i.pages[0]?.url ?? null, facts: { pages: i.pages.map((p) => pathOf(p.url)).join(", "), switches: i.switches, checks: i.checks }, source: `competing:${i.keywordId}` });
  const table = (items: Item[], testId: string) => (
    <div className="overflow-x-auto">
      <table className="g-table w-full" data-testid={testId}>
        <thead><tr><th aria-label="Show the pages" className="w-12" /><th>Keyword</th><th className="num">Volume / mo</th><th className="num" title="Checks in which your site ranked">Checks</th><th className="num" title="Times the page shown was not the one from the check before">Page changes</th><th>Shown now</th><th><span className="sr-only">Action plan</span></th></tr></thead>
        <tbody>
          {items.map((i) => {
            const isOpen = open === i.keywordId;
            return [
              <tr key={i.keywordId} data-testid={`row-competing-${i.keywordId}`}>
                <td><button type="button" className="g-pill !min-h-8 !px-2" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the pages shown for ${i.keyword}`} onClick={() => setOpen(isOpen ? null : i.keywordId)}>{isOpen ? <ChevronDown /> : <ChevronRight />}</button></td>
                <td>{i.keyword}{i.device === "mobile" && <span className="g-text-2 text-[12px]"> · mobile</span>}</td>
                <td className="num" data-label="Volume / mo">{fmtNum(i.volume)}</td>
                <td className="num" data-label="Checks">{i.checks}</td>
                <td className="num" data-label="Page changes">{i.switches}</td>
                <td className="max-w-[20rem] truncate" data-label="Shown now" title={i.pages[0].url}>{pathOf(i.pages[0].url)} <span className="g-text-2 text-[12px]">· position {i.pages[0].lastPosition}</span></td>
                <td className="num"><AddToPlan siteId={site.id} label="Plan" testId={`button-plan-competing-${i.keywordId}`} tasks={[task(i)]} /></td>
              </tr>,
              isOpen && (
                <tr key={`${i.keywordId}-pages`}><td /><td colSpan={6} className="!whitespace-normal">
                  <ul className="space-y-1 text-[13px]">
                    {i.pages.map((p) => <li key={p.url}><a href={p.url} target="_blank" rel="noreferrer" className="g-link">{pathOf(p.url)}</a> <span className="g-text-2">— shown in {p.times} of {i.checks} checks, best position {p.best}, last on {fmtDate(p.lastSeen)} at position {p.lastPosition}</span></li>)}
                  </ul>
                </td></tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="mb-5" data-testid="rank-competing">
      <h2 className="g-text text-[16px] font-medium">Pages competing for the same search</h2>
      {alternating.length > 0 ? (
        <>
          <p className="g-text-2 mb-2 max-w-3xl text-[13px]">For {alternating.length === 1 ? "this keyword" : `these ${alternating.length} keywords`} Google has gone back and forth between two or more of your pages over the last {d.days} days. That usually means the pages are competing: one page that clearly owns the topic — with the other linking to it, or folded into it — tends to rank better than two that share it.</p>
          {table(alternating, "table-competing")}
        </>
      ) : <p className="g-text-2 mb-2 text-[13px]" data-testid="competing-no-alternating">No keyword has gone back and forth between pages in the last {d.days} days.</p>}
      {changed.length > 0 && (
        <div className="mt-2">
          <button type="button" className="g-link text-[13px]" aria-expanded={showChanged} onClick={() => setShowChanged(!showChanged)} data-testid="button-competing-changed">{showChanged ? "Hide" : "Show"} {changed.length} keyword{changed.length === 1 ? "" : "s"} where the page changed without going back</button>
          {showChanged && (<><p className="g-text-2 my-2 max-w-3xl text-[13px]">The page Google shows changed and has not changed back. That is normal after a page is moved, replaced or improved — worth a look only if the new page is not the one you want found.</p>{table(changed, "table-competing-changed")}</>)}
        </div>
      )}
      <p className="g-text-2 mt-2 text-[12px]">From your saved checks only (one page per check per device); a keyword your site did not rank for in a check says nothing here. An address with or without "www", "https" or a last slash counts as one page.</p>
    </section>
  );
}
