/**
 * Rank tracker → the page Google shows for a search (server/seo/competing-pages.ts): tracked keywords for which
 * Google has shown different pages of the site from one check to the next. Read from saved checks — free.
 * It reports what the checks saw and how many checks that rests on; what to make of it is left to a look at the pages.
 * Each keyword opens its row in the table (with its history), each volume the keywords explorer, each page the site
 * explorer's pages view for that address, each date that check in the history panel. The opened row (`competing`)
 * and the further lists (`competingShow`) are in the address; a `competing` that names none of the rows listed is
 * said in a chip (data-testid="active-filter") with a clear — never quietly ignored.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { ActiveFilter, fmtDate, fmtNum, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";
import { seoLinks, setParam } from "./links";
import { hrefWith, pageParts, useRankParams, type RankTo } from "./rank-params";
import { LINK, LINK_BLOCK, SectionTitle, TABLE, TAP } from "./viz-rank";

type Page = { url: string; times: number; best: number; lastSeen: string; lastPosition: number };
type Item = { keywordId: number; keyword: string; volume: number | null; location: string | null; device: string; kind: "alternating" | "changed" | "variants"; checks: number; firstRanked: string; lastRanked: string; lastRankedAny?: string; lastCheck: string; switches: number; pages: Page[]; variants?: string[][] };
type Data = { days: number; keywords: number; comparable: number; items: Item[] };
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
/** The path — with the host in front when the page is on a sub-domain, so two pages with the same path can be told apart. */
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
const town = (location: string | null) => (location ? location.split(",")[0] : null);
const DEVICE: Record<string, string> = { desktop: "desktop", mobile: "mobile" };
/** A page in Site explorer's pages view; an address that is not a URL has no such place and is written as it is. */
const PageLink = ({ url, domain, className, testId }: { url: string; domain: string; className: string; testId?: string }) => {
  const x = pageParts(url);
  return x ? <Link href={seoLinks.explorer(x.domain, "pages", { path: x.path })} className={`${LINK_BLOCK} ${className}`} title={`${url} — in Site explorer`} data-testid={testId}>{nameOf(url, domain)}</Link> : <span className={className} title={url}>{nameOf(url, domain)}</span>;
};

export function CompetingPages({ site }: { site: SeoSite }) {
  // Looked at again when the window is, and whenever the rank tracker says its checks or keywords changed (index.tsx).
  const q = useQuery<Data>({ queryKey: [`/api/seo/sites/${site.id}/rank-competing`], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 30_000 });
  const p = useRankParams();
  const open = p.competing;
  if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Comparing the pages Google has shown…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't compare the pages Google has shown: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  const d = q.data;
  if (!d || d.keywords === 0) return null;   // no checks yet: the rank tracker's own empty state covers it
  const by = (k: Item["kind"]) => d.items.filter((i) => i.kind === k);
  const alternating = by("alternating"), changed = by("changed"), variants = by("variants");
  // The further list named by the address; a row opened by the address in a further list opens that list too.
  const more = p.competingShow ?? (changed.some((i) => i.keywordId === open) ? "changed" : variants.some((i) => i.keywordId === open) ? "variants" : null);
  const to = (x: RankTo = {}) => seoLinks.rankTracker(site.id, x);
  // A row the address opens that is not listed here (its pages stopped changing, or the keyword was removed): said, with a clear.
  const missing = open != null && !d.items.some((i) => i.keywordId === open)
    ? <ActiveFilter onClear={() => setParam("competing", null)} clearLabel="Clear">The keyword the address opens is not among those listed here — Google may no longer be showing different pages for it, or it is no longer tracked — so no row is opened</ActiveFilter> : null;
  // What can be said rests on keywords that ranked in at least two checks; that number is always given.
  const basis = <><Link href={to({ checked: true })} className={LINK} title="The keywords with a saved check" data-testid="link-competing-comparable">{fmtNum(d.comparable)} of your {fmtNum(d.keywords)} checked keyword{d.keywords === 1 ? "" : "s"}</Link> ranked, with the page recorded, in two or more checks in the last <Link href={to({ panel: "history" })} className={LINK} title="The checks of these days, in the history panel" data-testid="link-competing-days">{d.days} days</Link></>;
  if (!d.items.length) return (
    <>{missing}<p className="g-text-2 mb-5 text-[13px]" data-testid="competing-none">
      {d.comparable === 0 ? <>Not enough checks yet to say whether Google switches between your pages: none of your <Link href={to({ checked: true })} className={LINK} title="The keywords with a saved check" data-testid="link-competing-comparable">{fmtNum(d.keywords)} checked keyword{d.keywords === 1 ? "" : "s"}</Link> has ranked in two checks.</> : <>No change of address seen: {basis}, and for each of them the checks recorded the same address every time.</>}
    </p></>
  );
  // Where a keyword leads: its row in the table, opened on its history, on the device the line was read on; a date, that check in the history panel.
  const scopeOfItem = (i: Item): RankTo => (site.devices === "both" && (i.device === "desktop" || i.device === "mobile") ? { device: i.device } : {});
  const toKeyword = (i: Item) => to({ ...scopeOfItem(i), keyword: i.keyword });
  const toDate = (i: Item, date: string) => to({ ...scopeOfItem(i), keyword: i.keyword, panel: "history", date });
  const dateLink = (i: Item, date: string, testId: string) => <Link href={toDate(i, date)} className={LINK} title="This check in the history panel" data-testid={testId}>{fmtDate(date)}</Link>;
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
      <table className={TABLE} data-testid={testId}>
        <thead><tr><th aria-label="Show the pages" className="w-12" /><th>Keyword</th><th className="num">Volume / mo</th><th className="num" title="Checks in which your site ranked, and when">Ranked checks</th><th className="num" title="Times the page shown was not the one from the ranked check before">Page changes</th><th>Last shown</th><th><span className="sr-only">Action plan</span></th></tr></thead>
        <tbody>
          {items.map((i) => {
            const isOpen = open === i.keywordId, rankedAny = i.lastRankedAny ?? i.lastRanked;
            const toggle = () => setParam("competing", isOpen ? null : i.keywordId);
            // Said only when it is known: not found in a later check, or ranked later with the page not recorded.
            const since = i.lastCheck > rankedAny ? <> · not found in the check of {dateLink(i, i.lastCheck, `link-competing-lastcheck-${i.keywordId}`)}</> : rankedAny > i.lastRanked ? <> · ranked again on {dateLink(i, rankedAny, `link-competing-rankedany-${i.keywordId}`)}, page not recorded</> : null;
            return [
              <tr key={i.keywordId} data-testid={`row-competing-${i.keywordId}`} className="scroll-mt-16" style={isOpen ? { background: "var(--g-accent-soft)" } : undefined}>
                <td><button type="button" className="g-pill !min-h-8 !px-2 max-sm:!min-h-11" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the pages shown for ${i.keyword}`} onClick={toggle}>{isOpen ? <ChevronDown /> : <ChevronRight />}</button></td>
                <td><Link href={toKeyword(i)} className={LINK} title="This keyword in the table, with its history" data-testid={`link-competing-${i.keywordId}`}>{i.keyword}</Link><span className="g-text-2 block text-[12px]">{town(i.location) ? <><Link href={to({ ...scopeOfItem(i), location: i.location! })} className={LINK} title={`The keywords checked from ${i.location}`} data-testid={`link-competing-location-${i.keywordId}`}>{town(i.location)}</Link> · </> : null}{i.device === "desktop" || i.device === "mobile" ? <Link href={to({ device: i.device })} className={LINK} title={`The keywords on ${i.device}`} data-testid={`link-competing-device-${i.keywordId}`}>{DEVICE[i.device]}</Link> : i.device}</span></td>
                <td className="num" data-label="Volume / mo">{i.volume == null ? "—" : <Link href={seoLinks.keywords(i.keyword)} className={LINK} title="This keyword in the keywords explorer" data-testid={`link-competing-volume-${i.keywordId}`}>{fmtNum(i.volume)}</Link>}</td>
                <td className="num" data-label="Ranked checks"><Link href={toKeyword(i)} className={LINK} title="This keyword's history, in the table" data-testid={`link-competing-checks-${i.keywordId}`}>{i.checks}</Link><span className="g-text-2 block text-[12px]">{dateLink(i, i.firstRanked, `link-competing-first-${i.keywordId}`)} – {dateLink(i, i.lastRanked, `link-competing-last-${i.keywordId}`)}</span></td>
                <td className="num" data-label="Page changes"><Link href={hrefWith({ competing: isOpen ? null : i.keywordId })} className={`${LINK} ${TAP} inline-flex items-center`} aria-expanded={isOpen} title={`${isOpen ? "Hide" : "Show"} the pages shown`} data-testid={`button-competing-switches-${i.keywordId}`}>{i.switches}</Link></td>
                <td className="max-w-[22rem]" data-label="Last shown"><PageLink url={i.pages[0].url} domain={site.domain} className="block truncate" testId={`link-competing-page-${i.keywordId}`} /><span className="g-text-2 block text-[12px]">position <Link href={toKeyword(i)} className={LINK} title="This keyword's history, in the table" data-testid={`link-competing-lastposition-${i.keywordId}`}>{i.pages[0].lastPosition}</Link> on {dateLink(i, i.pages[0].lastSeen, `link-competing-lastseen-${i.keywordId}`)}{since}</span></td>
                <td className="num">{<AddToPlan siteId={site.id} label="Plan" testId={`button-plan-competing-${i.keywordId}`} tasks={[task(i)]} />}</td>
              </tr>,
              isOpen && (
                <tr key={`${i.keywordId}-pages`}><td /><td colSpan={6} className="!whitespace-normal">
                  <ul className="space-y-1 text-[13px]">
                    {i.pages.map((p, n) => (
                      <li key={p.url}><PageLink url={p.url} domain={site.domain} className="break-all" testId={`link-competing-page-${i.keywordId}-${n}`} /> <span className="g-text-2">— shown in <Link href={toKeyword(i)} className={LINK} title="This keyword's history, in the table" data-testid={`link-competing-times-${i.keywordId}-${n}`}>{p.times} of the {i.checks} ranked checks</Link>, best position <Link href={toKeyword(i)} className={LINK} title="This keyword's history, in the table" data-testid={`link-competing-best-${i.keywordId}-${n}`}>{p.best}</Link>, last on {dateLink(i, p.lastSeen, `link-competing-pageseen-${i.keywordId}-${n}`)} at position <Link href={toDate(i, p.lastSeen)} className={LINK} title="This check in the history panel" data-testid={`link-competing-pageposition-${i.keywordId}-${n}`}>{p.lastPosition}</Link></span>
                      </li>
                    ))}
                  </ul>
                  {i.variants?.map((g, v) => <p key={g.join()} className="g-text-2 mt-1 text-[12px]">These differ only by http/https, "www" or a last slash, and may be one page: {g.map((u, n) => <span key={u}>{n ? " , " : ""}<PageLink url={u} domain={site.domain} className="break-all" testId={`link-competing-variant-${i.keywordId}-${v}-${n}`} /></span>)}</p>)}
                </td></tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="mb-5 scroll-mt-16" data-testid="rank-competing">
      <SectionTitle>The page Google shows for each search</SectionTitle>
      {missing}
      <p className="g-text-2 mb-2 text-[12px]" data-testid="text-competing-basis">{basis}. One page is recorded per check per device. A keyword opens its row in the table; a page opens in Site explorer; a date opens that check in the history panel.</p>
      {alternating.length > 0 ? (
        <>
          <p className="g-text-2 mb-2 max-w-3xl text-[13px]">For {alternating.length === 1 ? "this keyword" : <>these <Link href={hrefWith({ panel: "competing" })} className={LINK} title="These keywords, in the table below" data-testid="link-competing-alternating">{alternating.length} keywords</Link></>} Google went from one of your pages to another and back. That is worth a look: it can mean two pages are competing for the same search — compare what each is about, and whether one should link to the other or cover the topic alone. The checks alone don't prove it.</p>
          {table(alternating, "table-competing")}
        </>
      ) : <p className="g-text-2 mb-2 text-[13px]" data-testid="competing-no-alternating">No keyword was seen going back and forth between two pages.</p>}
      {([["changed", changed, "where the page changed and has not changed back", "That is normal after a page is moved, replaced or improved — worth a look only if the page shown now is not the one you want found."],
         ["variants", variants, "shown under addresses that differ only slightly", "Addresses that differ only by http/https, \"www\" or a last slash. They may be one page reached two ways, or two pages — this has not been checked. It depends on whether one redirects to the other, on the canonical tag each carries, and in the end on which address Google itself chooses; URL Inspection in Search Console shows that choice."]] as const).map(([k, list, what, note]) => list.length > 0 && (
        <div className="mt-2" key={k}>
          <Link href={hrefWith({ competingShow: more === k ? null : k, ...(more === k && list.some((i) => i.keywordId === open) ? { competing: null } : {}) })} className={`${LINK} text-[13px]`} aria-expanded={more === k} data-testid={`button-competing-${k}`}>{more === k ? "Hide" : "Show"} {list.length} keyword{list.length === 1 ? "" : "s"} {what}</Link>
          {more === k && (<><p className="g-text-2 my-2 max-w-3xl text-[13px]">{note}</p>{table(list, `table-competing-${k}`)}</>)}
        </div>
      ))}
      <p className="g-text-2 mt-2 text-[12px]">From your saved checks only. Every address is kept as Google showed it; "back and forth" and "changed" are said only between addresses that are clearly different pages. A check in which your site did not rank says nothing about which page; when both desktop and mobile are checked, the line shows the device where more was seen. Click-tracking parts of an address are ignored.</p>
    </section>
  );
}
