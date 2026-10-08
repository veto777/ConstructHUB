/**
 * Rank tracker → the page Google shows for a search (server/seo/competing-pages.ts): tracked keywords for which
 * Google has shown different pages of the site from one check to the next. Read from saved checks — free.
 * It reports what the checks saw and how many checks that rests on; what to make of it is left to a look at the pages.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Page = { url: string; times: number; best: number; lastSeen: string; lastPosition: number };
type Item = { keywordId: number; keyword: string; volume: number | null; location: string | null; device: string; kind: "alternating" | "changed" | "variants"; checks: number; firstRanked: string; lastRanked: string; lastRankedAny?: string; lastCheck: string; switches: number; pages: Page[]; variants?: string[][] };
type Data = { days: number; keywords: number; comparable: number; items: Item[] };
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
/** The path — with the host in front when the page is on a sub-domain, so two pages with the same path can be told apart. */
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
const town = (location: string | null) => (location ? location.split(",")[0] : null);
const DEVICE: Record<string, string> = { desktop: "desktop", mobile: "mobile" };

export function CompetingPages({ site }: { site: SeoSite }) {
  // Looked at again when the window is, and whenever the rank tracker says its checks or keywords changed (index.tsx).
  const q = useQuery<Data>({ queryKey: [`/api/seo/sites/${site.id}/rank-competing`], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 30_000 });
  const [open, setOpen] = useState<number | null>(null);
  const [more, setMore] = useState<"changed" | "variants" | null>(null);
  if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Comparing the pages Google has shown…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't compare the pages Google has shown: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  const d = q.data;
  if (!d || d.keywords === 0) return null;   // no checks yet: the rank tracker's own empty state covers it
  const by = (k: Item["kind"]) => d.items.filter((i) => i.kind === k);
  const alternating = by("alternating"), changed = by("changed"), variants = by("variants");
  // What can be said rests on keywords that ranked in at least two checks; that number is always given.
  const basis = `${fmtNum(d.comparable)} of your ${fmtNum(d.keywords)} checked keyword${d.keywords === 1 ? "" : "s"} ranked, with the page recorded, in two or more checks in the last ${d.days} days`;
  if (!d.items.length) return (
    <p className="g-text-2 mb-5 text-[13px]" data-testid="competing-none">
      {d.comparable === 0 ? `Not enough checks yet to say whether Google switches between your pages: none of your ${fmtNum(d.keywords)} checked keyword${d.keywords === 1 ? "" : "s"} has ranked in two checks.` : `No change of address seen: ${basis}, and for each of them the checks recorded the same address every time.`}
    </p>
  );
  // What the task keeps (12 facts of 300 characters at most, plain names — server/seo/tasks.ts): the three addresses shown
  // most recently, each as its own fact and each with its evidence as another, so neither is cut to fit the other. An
  // address too long for a fact is not shortened into what would look like another address — its site and the
  // beginning of its path are given, marked as cut.
  const fitUrl = (u: string) => { if (u.length <= 300) return u; try { const x = new URL(u); return `${x.origin}${x.pathname.slice(0, 120)}… (address too long to keep whole — see the rank tracker)`; } catch { return "(address too long to keep — see the rank tracker)"; } };
  const task = (i: Item): PlanTask => {
    const rankedAny = i.lastRankedAny ?? i.lastRanked;
    return {
      kind: "page", title: `Look at which page should rank for "${i.keyword}"${town(i.location) ? ` (${town(i.location)})` : ""}`, target: i.pages[0]?.url && i.pages[0].url.length <= 500 ? i.pages[0].url : null,
      facts: {
        ...Object.fromEntries(i.pages.slice(0, 3).flatMap((p, n) => [[`page${n + 1}`, fitUrl(p.url)], [`page${n + 1}Seen`, `${p.times} of ${i.checks} ranked checks, last ${p.lastSeen} at position ${p.lastPosition}, best ${p.best}`]])),
        ...(i.pages.length > 3 ? { morePages: i.pages.length - 3 } : {}),
        ...(i.variants?.length ? { variants: `${i.variants.length} group${i.variants.length === 1 ? "" : "s"} of addresses differing only by http/https, www or a last slash — not checked whether they are one page` } : {}),
        where: `${i.device}${i.location ? ` · ${i.location}` : ""}`, checks: `${i.checks} ranked checks from ${i.firstRanked} to ${i.lastRanked}, ${i.switches} change${i.switches === 1 ? "" : "s"} of address`,
        latest: i.lastCheck > rankedAny ? `${i.lastCheck}: not found` : rankedAny > i.lastRanked ? `${rankedAny}: ranked, page not recorded` : `${i.lastRanked}: ranked, page recorded`,
      }, source: `competing:${i.keywordId}`,
    };
  };
  const table = (items: Item[], testId: string) => (
    <div className="overflow-x-auto">
      <table className="g-table w-full" data-testid={testId}>
        <thead><tr><th aria-label="Show the pages" className="w-12" /><th>Keyword</th><th className="num">Volume / mo</th><th className="num" title="Checks in which your site ranked, and when">Ranked checks</th><th className="num" title="Times the page shown was not the one from the ranked check before">Page changes</th><th>Last shown</th><th><span className="sr-only">Action plan</span></th></tr></thead>
        <tbody>
          {items.map((i) => {
            const isOpen = open === i.keywordId, rankedAny = i.lastRankedAny ?? i.lastRanked;
            // Said only when it is known: not found in a later check, or ranked later with the page not recorded.
            const since = i.lastCheck > rankedAny ? ` · not found in the check of ${fmtDate(i.lastCheck)}` : rankedAny > i.lastRanked ? ` · ranked again on ${fmtDate(rankedAny)}, page not recorded` : "";
            return [
              <tr key={i.keywordId} data-testid={`row-competing-${i.keywordId}`}>
                <td><button type="button" className="g-pill !min-h-8 !px-2" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the pages shown for ${i.keyword}`} onClick={() => setOpen(isOpen ? null : i.keywordId)}>{isOpen ? <ChevronDown /> : <ChevronRight />}</button></td>
                <td>{i.keyword}<span className="g-text-2 block text-[12px]">{[town(i.location), DEVICE[i.device] ?? i.device].filter(Boolean).join(" · ")}</span></td>
                <td className="num" data-label="Volume / mo">{fmtNum(i.volume)}</td>
                <td className="num" data-label="Ranked checks">{i.checks}<span className="g-text-2 block text-[12px]">{fmtDate(i.firstRanked)} – {fmtDate(i.lastRanked)}</span></td>
                <td className="num" data-label="Page changes">{i.switches}</td>
                <td className="max-w-[22rem]" data-label="Last shown"><span className="block truncate" title={i.pages[0].url}>{nameOf(i.pages[0].url, site.domain)}</span><span className="g-text-2 block text-[12px]">position {i.pages[0].lastPosition} on {fmtDate(i.pages[0].lastSeen)}{since}</span></td>
                <td className="num">{<AddToPlan siteId={site.id} label="Plan" testId={`button-plan-competing-${i.keywordId}`} tasks={[task(i)]} />}</td>
              </tr>,
              isOpen && (
                <tr key={`${i.keywordId}-pages`}><td /><td colSpan={6} className="!whitespace-normal">
                  <ul className="space-y-1 text-[13px]">
                    {i.pages.map((p) => (
                      <li key={p.url}><a href={p.url} target="_blank" rel="noreferrer" className="g-link break-all">{nameOf(p.url, site.domain)}</a> <span className="g-text-2">— shown in {p.times} of the {i.checks} ranked checks, best position {p.best}, last on {fmtDate(p.lastSeen)} at position {p.lastPosition}</span>
                      </li>
                    ))}
                  </ul>
                  {i.variants?.map((g) => <p key={g.join()} className="g-text-2 mt-1 text-[12px]">These differ only by http/https, "www" or a last slash, and may be one page: <span className="break-all">{g.join(" , ")}</span></p>)}
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
      <h2 className="g-text text-[16px] font-medium">The page Google shows for each search</h2>
      <p className="g-text-2 mb-2 text-[12px]" data-testid="text-competing-basis">{basis}. One page is recorded per check per device.</p>
      {alternating.length > 0 ? (
        <>
          <p className="g-text-2 mb-2 max-w-3xl text-[13px]">For {alternating.length === 1 ? "this keyword" : `these ${alternating.length} keywords`} Google went from one of your pages to another and back. That is worth a look: it can mean two pages are competing for the same search — compare what each is about, and whether one should link to the other or cover the topic alone. The checks alone don't prove it.</p>
          {table(alternating, "table-competing")}
        </>
      ) : <p className="g-text-2 mb-2 text-[13px]" data-testid="competing-no-alternating">No keyword was seen going back and forth between two pages.</p>}
      {([["changed", changed, "where the page changed and has not changed back", "That is normal after a page is moved, replaced or improved — worth a look only if the page shown now is not the one you want found."],
         ["variants", variants, "shown under addresses that differ only slightly", "Addresses that differ only by http/https, \"www\" or a last slash. They may be one page reached two ways, or two pages — this has not been checked. It depends on whether one redirects to the other, on the canonical tag each carries, and in the end on which address Google itself chooses; URL Inspection in Search Console shows that choice."]] as const).map(([k, list, what, note]) => list.length > 0 && (
        <div className="mt-2" key={k}>
          <button type="button" className="g-link text-[13px]" aria-expanded={more === k} onClick={() => setMore(more === k ? null : k)} data-testid={`button-competing-${k}`}>{more === k ? "Hide" : "Show"} {list.length} keyword{list.length === 1 ? "" : "s"} {what}</button>
          {more === k && (<><p className="g-text-2 my-2 max-w-3xl text-[13px]">{note}</p>{table(list, `table-competing-${k}`)}</>)}
        </div>
      ))}
      <p className="g-text-2 mt-2 text-[12px]">From your saved checks only. Every address is kept as Google showed it; "back and forth" and "changed" are said only between addresses that are clearly different pages. A check in which your site did not rank says nothing about which page; when both desktop and mobile are checked, the line shows the device where more was seen. Click-tracking parts of an address are ignored.</p>
    </section>
  );
}
