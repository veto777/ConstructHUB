/**
 * Rank tracker → searches with largely the same results (server/seo/serp-groups.ts). Tracked keywords whose saved
 * first-page results overlap heavily — candidates for one topic, to be looked at, not a verdict. Free. Groups in
 * which clearly different pages of the site rank come first. The device is the page's (the address); the opened
 * group (`group`) and "all groups" (`groupsAll`) are in the address too. Each keyword opens its row in the table,
 * each volume the keywords explorer, each address of yours the site explorer's pages. A `group` that names none of
 * these groups is said in a chip (data-testid="active-filter") with a clear — never quietly ignored.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { ActiveFilter, fmtDate, fmtNum, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";
import { seoLinks, setParam, setParams } from "./links";
import { hrefWith, pageParts, useRankParams, type RankTo } from "./rank-params";
import { LINK, LINK_BLOCK, SectionTitle, TABLE, TAP } from "./viz-rank";

type Member = { keywordId: number; keyword: string; volume: number | null; position: number | null; page: string | null; shared: number; of: number; checkedOn?: string | null };
type Group = { location: string | null; locationCode: number | null; members: Member[]; volume: number | null; measured: number; ownPages: string[]; ownDistinct?: number; unranked: number; rankedNoPage?: number; from?: string | null; to?: string | null };
type Data = { groups: Group[]; compared: number; skipped: number; shared: number; device: string; checkedOn: string | null; oldest: string | null };
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
const town = (location: string | null) => (location ? location.split(",")[0] : null);
const days = (from?: string | null, to?: string | null) => (!to ? "date not recorded" : from && from !== to ? `${fmtDate(from)} – ${fmtDate(to)}` : fmtDate(to));

export function SerpGroupsPanel({ site }: { site: SeoSite }) {
  const p = useRankParams();
  // The page's device, when this site tracks it.
  const device = p.device && (site.devices === "both" || site.devices === p.device) ? p.device : "";
  const key = `/api/seo/sites/${site.id}/serp-groups${device ? `?device=${device}` : ""}`;
  const q = useQuery<Data>({ queryKey: [key], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 30_000 });
  // The opened group and "all groups" live in the address (a reveal is a pick like any other).
  const open = p.group, all = p.groupsAll;
  const d = q.data;
  // The heading and the device switch are always there, whatever this device has to show: a device with nothing must
  // not hide the way to the other one.
  const shownDevice = d?.device ?? (device || (site.devices === "mobile" ? "mobile" : "desktop"));
  const head = (
    <div className="mb-1 flex flex-wrap items-baseline gap-2">
      <SectionTitle>Searches with largely the same results</SectionTitle>
      {site.devices === "both" && <span className="flex gap-1" role="group" aria-label="Device">{["desktop", "mobile"].map((v) => <button key={v} type="button" className="g-pill g-pill--sm max-sm:!min-h-11" aria-pressed={shownDevice === v} style={shownDevice === v ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined} onClick={() => setParams({ device: v, group: null })} data-testid={`button-serp-device-${v}`}>{v === "desktop" ? "Desktop" : "Mobile"}</button>)}</span>}
    </div>
  );
  if (q.isLoading) return <section className="mb-5 scroll-mt-16" data-testid="serp-groups">{head}<p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Comparing the result pages of your keywords…</p></section>;
  if (q.isError) return <section className="mb-5 scroll-mt-16" data-testid="serp-groups">{head}<p className="g-text-2 text-[13px]" role="alert">Couldn't compare the result pages: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p></section>;
  if (!d) return null;
  // Nothing checked on any device yet: the rank tracker's own empty state covers it.
  if (d.compared + d.skipped === 0 && site.devices !== "both") return null;
  // Where a count of keywords leads: the table on the device these groups were read on.
  const scope: RankTo = site.devices === "both" ? { device: d.device as "desktop" | "mobile" } : {};
  const to = (x: RankTo = {}) => seoLinks.rankTracker(site.id, { ...scope, ...x });
  // A group the address opens that is not among these (the keywords or their results changed since the link was made, or another device): said, with a clear.
  const missing = open != null && !d.groups.some((g) => g.members[0].keywordId === open)
    ? <ActiveFilter onClear={() => setParam("group", null)} clearLabel="Clear">The results group the address opens is not among these groups on {d.device} — the keywords or their results may have changed since the link was made — so none is opened</ActiveFilter> : null;
  if (d.compared < 2) return (
    <section className="mb-5 scroll-mt-16" data-testid="serp-groups">{head}{missing}
      <p className="g-text-2 text-[13px]" data-testid="serp-groups-too-few">Not enough to compare on {d.device}: {d.compared === 0 ? "no keyword" : "only one keyword"} has a saved first page of results from the last five weeks{d.skipped > 0 ? <> (<Link href={to({ checked: true })} className={LINK} title="The keywords with a saved check" data-testid="link-serp-skipped">{fmtNum(d.skipped)}</Link> {d.skipped === 1 ? "was" : "were"} checked without one)</> : ""}. It fills in after the next rank check.</p>
    </section>
  );
  const distinct = (g: Group) => g.ownDistinct ?? g.ownPages.length;
  const split = d.groups.filter((g) => distinct(g) > 1);
  // The first eight, or all; a group opened by the address is shown even when it is further down the list.
  const shown = all ? d.groups : d.groups.filter((g, n) => n < 8 || g.members[0].keywordId === open);
  // Where a keyword leads: its row in the table (opened, highlighted), on the device these groups were read on.
  const toKeyword = (keyword: string) => to({ keyword });
  const toPage = (u: string) => { const x = pageParts(u); return x ? seoLinks.explorer(x.domain, "pages", { path: x.path }) : null; };
  const toggle = (id: number, isOpen: boolean) => setParam("group", isOpen ? null : id);
  const task = (g: Group): PlanTask => ({
    kind: "page", title: `Review "${g.members[0].keyword}" and ${g.members.length - 1} search${g.members.length === 2 ? "" : "es"} with overlapping results${town(g.location) ? ` (${town(g.location)})` : ""} — one page, or separate ones?`,
    target: g.ownPages[0] && g.ownPages[0].length <= 500 ? g.ownPages[0] : null,
    facts: {
      searches: g.members.slice(0, 8).map((m) => m.keyword).join(" · ").slice(0, 300), ...(g.members.length > 8 ? { moreSearches: g.members.length - 8 } : {}),
      ...Object.fromEntries(g.ownPages.slice(0, 3).map((p, n) => [`ownAddress${n + 1}`, p.length <= 300 ? p : "(address too long to keep — see the rank tracker)"])),
      ...(g.ownPages.length > 3 ? { moreOwnAddresses: g.ownPages.length - 3 } : {}),
      overlap: g.members.slice(1, 6).map((m) => `${m.shared} of ${m.of}`).join(", ").slice(0, 300),
      basis: `overlap of first-page results (at least ${d.shared} addresses shared with the first search); not Google's own grouping — compare intent and content before merging pages`.slice(0, 300),
      checked: `${d.device}, ${days(g.from, g.to)}`, where: g.location ?? "not set", notFound: g.unranked,
    }, source: `serp-group:${d.device}:${g.members[0].keywordId}`,
  });
  const dateLink = (date: string | null | undefined, testId: string) => (date ? <Link href={to({ panel: "history", date })} className={LINK} title="This check in the history panel" data-testid={testId}>{fmtDate(date)}</Link> : null);
  // "checked <from> – <to>": each date a link to that check; "date not recorded" stays words.
  const checkedWords = (g: Group, id: number) => (!g.to ? "checked, date not recorded" : g.from && g.from !== g.to ? <>checked {dateLink(g.from, `link-group-from-${id}`)} – {dateLink(g.to, `link-group-to-${id}`)}</> : <>checked {dateLink(g.to, `link-group-to-${id}`)}</>);
  return (
    <section className="mb-5 scroll-mt-16" data-testid="serp-groups">
      {head}
      {missing}
      <p className="g-text-2 mb-2 max-w-3xl text-[13px]" data-testid="text-serp-groups-basis">
        From the first-page results (up to ten) saved for <Link href={to({ checked: true })} className={LINK} title="The keywords with a saved check" data-testid="link-serp-compared">{fmtNum(d.compared)} keyword{d.compared === 1 ? "" : "s"}</Link> on {d.device}{d.checkedOn ? (d.oldest && d.oldest !== d.checkedOn ? <>, each at its own newest check between {dateLink(d.oldest, "link-serp-oldest")} and {dateLink(d.checkedOn, "link-serp-newest")} — so results from different days can be compared</> : <>, checked {dateLink(d.checkedOn, "link-serp-newest")}</>) : ""}. Keywords are put together when at least {d.shared} of their first-page results are the same addresses as the group's first keyword (the others are compared with it, not with each other). Heavy overlap suggests the searches are close in meaning — a prompt to look at whether one page or separate pages should serve them, not Google's own grouping. Keywords tracked in different towns are never compared.{d.skipped > 0 ? <> <Link href={to({ checked: true })} className={LINK} title="The keywords with a saved check (a saved first page is not kept for every one)" data-testid="link-serp-skipped">{fmtNum(d.skipped)} keyword{d.skipped === 1 ? " has" : "s have"}</Link> no saved result page to compare.</> : ""} A keyword opens its row in the table above; an address of yours opens in Site explorer.
      </p>
      {d.groups.length === 0 ? <p className="g-text-2 text-[13px]" data-testid="serp-groups-none">No two of these keywords share that many results: their first pages were largely different.</p> : (
        <>
          {split.length > 0 && <p className="g-text mb-2 text-[13px]" data-testid="text-serp-groups-split">In <Link href={hrefWith({ group: split[0].members[0].keywordId })} className={LINK} title="Opens the first of these groups" data-testid="link-serp-split">{fmtNum(split.length)} group{split.length === 1 ? "" : "s"}</Link>, more than one address of yours ranks for searches with overlapping results — worth opening them to see whether they are different pages, and what each is for.</p>}
          <div className="overflow-x-auto">
            <table className={TABLE} data-testid="table-serp-groups">
              <thead><tr><th aria-label="Show the keywords" className="w-12" /><th>Group (its first keyword)</th><th className="num">Keywords</th><th className="num">Volume / mo</th><th>Your addresses that rank</th><th><span className="sr-only">Action plan</span></th></tr></thead>
              {shown.map((g) => {
                const first = g.members[0], id = first.keywordId, isOpen = open === id, noPage = g.rankedNoPage ?? 0, ranked = g.members.length - g.unranked;
                const ownHref = g.ownPages.length === 1 ? toPage(g.ownPages[0]) : null;
                // A count that opens (or closes) the group is a link to the same address with `group` set (or cleared).
                const reveal = (label: string, testId: string, extra = "") => <Link href={hrefWith({ group: isOpen ? null : id })} className={`${LINK} ${TAP} inline-flex items-center ${extra}`} aria-expanded={isOpen} title={`${isOpen ? "Hide" : "Show"} each keyword in this group with the address that ranks for it`} data-testid={testId}>{label}</Link>;
                return (
                  <tbody key={`${id}`}>
                    <tr data-testid={`row-serp-group-${id}`} className="scroll-mt-16" style={isOpen ? { background: "var(--g-accent-soft)" } : undefined}>
                      <td><button type="button" className="g-pill !min-h-8 !px-2 max-sm:!min-h-11" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the ${g.members.length} keywords grouped with ${first.keyword}`} onClick={() => toggle(id, isOpen)}>{isOpen ? <ChevronDown /> : <ChevronRight />}</button></td>
                      <th scope="rowgroup" className="text-left font-normal"><Link href={toKeyword(first.keyword)} className={LINK} title="This keyword in the table" data-testid={`link-group-${id}`}>{first.keyword}</Link><span className="g-text-2 block text-[12px]">{town(g.location) ? <><Link href={to({ location: g.location! })} className={LINK} title={`The keywords checked from ${g.location}`} data-testid={`link-group-location-${id}`}>{town(g.location)}</Link> · </> : null}{checkedWords(g, id)}</span></th>
                      <td className="num">{reveal(String(g.members.length), `button-group-count-${id}`)}</td>
                      <td className="num">{g.volume == null ? "—" : <Link href={seoLinks.keywords(first.keyword)} className={LINK} title="The first keyword in the keywords explorer" data-testid={`link-group-volume-${id}`}>{fmtNum(g.volume)}</Link>}{g.volume != null && g.measured < g.members.length && <span className="g-text-2 block text-[12px]">for the {reveal(String(g.measured), `button-group-measured-${id}`)} with a figure</span>}</td>
                      <td className="max-w-[20rem]">
                        {ranked === 0 ? <Link href={to({ band: "notFound" })} className={`${LINK} g-text-2`} title="The keywords not found in the pages read" data-testid={`link-group-unranked-${id}`}>Your site was not found for any of them</Link>
                          : g.ownPages.length === 0 ? <span className="g-text-2">Ranks for {reveal(String(ranked), `button-group-ranked-${id}`)}, page not recorded</span>
                          : distinct(g) > 1 ? <span>{reveal(`${distinct(g)} addresses`, `button-group-pages-${id}`, "font-medium")}<span className="g-text-2 block text-[12px]">{g.ownPages.length > distinct(g) ? <>{reveal(`${g.ownPages.length} as recorded`, `button-group-recorded-${id}`)}; </> : ""}whether they are different pages is not checked (one may redirect to another)</span></span>
                          : g.ownPages.length > 1 ? <span>{reveal(`${g.ownPages.length} addresses that may be one page`, `button-group-pages-${id}`)}<span className="g-text-2 block text-[12px]">they differ only by http/https, "www" or a last slash — not checked</span></span>
                          : ownHref ? <Link href={ownHref} className={`${LINK_BLOCK} block truncate`} title={`${g.ownPages[0]} — in Site explorer`} data-testid={`link-group-page-${id}`}>{nameOf(g.ownPages[0], site.domain)}</Link> : <span className="block truncate" title={g.ownPages[0]}>{nameOf(g.ownPages[0], site.domain)}</span>}
                        {ranked > 0 && (g.unranked > 0 || (noPage > 0 && g.ownPages.length > 0)) && <span className="g-text-2 block text-[12px]">{g.unranked > 0 && <Link href={to({ band: "notFound" })} className={LINK} title="The keywords not found in the pages read (all of them; this group's are among them)" data-testid={`link-group-notfound-${id}`}>not found for {g.unranked}</Link>}{g.unranked > 0 && noPage > 0 && g.ownPages.length > 0 ? " · " : ""}{noPage > 0 && g.ownPages.length > 0 && reveal(`page not recorded for ${noPage}`, `button-group-nopage-${id}`)}</span>}
                      </td>
                      <td className="num"><AddToPlan siteId={site.id} label="Plan" testId={`button-plan-serp-${id}`} tasks={[task(g)]} /></td>
                    </tr>
                    {isOpen && g.members.map((m, n) => {
                      const pageHref = m.page ? toPage(m.page) : null;
                      return (
                        <tr key={m.keywordId}>
                          <td />
                          <td className="pl-4"><Link href={toKeyword(m.keyword)} className={LINK} title="This keyword in the table" data-testid={`link-group-member-${m.keywordId}`}>{m.keyword}</Link><span className="g-text-2 block text-[12px]">{n === 0 ? "the first keyword — the others are compared with it" : <><Link href={toKeyword(m.keyword)} className={LINK} title="This keyword in the table, with Google's first page as saved" data-testid={`link-group-member-shared-${m.keywordId}`}>{m.shared} of its {m.of} results</Link> are also in the first keyword's</>}{m.checkedOn ? <> · checked {dateLink(m.checkedOn, `link-group-member-date-${m.keywordId}`)}</> : ""}</span></td>
                          <td className="num"><span className="sr-only">one keyword</span></td>
                          <td className="num">{m.volume == null ? "—" : <Link href={seoLinks.keywords(m.keyword)} className={LINK} title="This keyword in the keywords explorer" data-testid={`link-group-member-volume-${m.keywordId}`}>{fmtNum(m.volume)}</Link>}</td>
                          <td className="max-w-[20rem]">{m.position == null ? <Link href={toKeyword(m.keyword)} className={`${LINK} g-text-2`} title="This keyword's history, in the table" data-testid={`link-group-member-position-${m.keywordId}`}>not found in the results</Link> : <><Link href={toKeyword(m.keyword)} className={`${LINK} tabular-nums`} title="This keyword's history, in the table" data-testid={`link-group-member-position-${m.keywordId}`}>#{m.position}</Link>{m.page ? (pageHref ? <Link href={pageHref} className={`${LINK_BLOCK} ml-2 inline-block max-w-[15rem] truncate align-bottom`} title={`${m.page} — in Site explorer`} data-testid={`link-group-member-page-${m.keywordId}`}>{nameOf(m.page, site.domain)}</Link> : <span className="g-text-2 ml-2 inline-block max-w-[15rem] truncate align-bottom" title={m.page}>{nameOf(m.page, site.domain)}</span>) : <span className="g-text-2 ml-2">page not recorded</span>}</>}</td>
                          <td />
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>
          {d.groups.length > 8 && <Link href={hrefWith({ groupsAll: all ? null : true })} className={`${LINK} mt-2 text-[13px]`} data-testid="button-serp-groups-all">{all ? "Show the first 8" : `Show all ${d.groups.length} groups`}</Link>}
        </>
      )}
    </section>
  );
}
