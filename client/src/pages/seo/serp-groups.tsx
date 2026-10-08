/**
 * Rank tracker → searches with largely the same results (server/seo/serp-groups.ts). Tracked keywords whose saved
 * first-page results overlap heavily — candidates for one topic, to be looked at, not a verdict. Free. Groups in
 * which clearly different pages of the site rank come first.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Member = { keywordId: number; keyword: string; volume: number | null; position: number | null; page: string | null; shared: number; of: number; checkedOn?: string | null };
type Group = { location: string | null; locationCode: number | null; members: Member[]; volume: number | null; measured: number; ownPages: string[]; ownDistinct?: number; unranked: number; rankedNoPage?: number; from?: string | null; to?: string | null };
type Data = { groups: Group[]; compared: number; skipped: number; shared: number; device: string; checkedOn: string | null; oldest: string | null };
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
const town = (location: string | null) => (location ? location.split(",")[0] : null);
const days = (from?: string | null, to?: string | null) => (!to ? "date not recorded" : from && from !== to ? `${fmtDate(from)} – ${fmtDate(to)}` : fmtDate(to));

export function SerpGroupsPanel({ site }: { site: SeoSite }) {
  const [device, setDevice] = useState("");
  const key = `/api/seo/sites/${site.id}/serp-groups${device ? `?device=${device}` : ""}`;
  const q = useQuery<Data>({ queryKey: [key], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 30_000 });
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const d = q.data;
  // The heading and the device switch are always there, whatever this device has to show: a device with nothing must
  // not hide the way to the other one.
  const shownDevice = d?.device ?? (device || (site.devices === "mobile" ? "mobile" : "desktop"));
  const head = (
    <div className="mb-1 flex flex-wrap items-baseline gap-2">
      <h2 className="g-text text-[16px] font-medium">Searches with largely the same results</h2>
      {site.devices === "both" && <span className="flex gap-1" role="group" aria-label="Device">{["desktop", "mobile"].map((v) => <button key={v} type="button" className="g-pill g-pill--sm" aria-pressed={shownDevice === v} style={shownDevice === v ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined} onClick={() => { setDevice(v); setOpen(null); }} data-testid={`button-serp-device-${v}`}>{v === "desktop" ? "Desktop" : "Mobile"}</button>)}</span>}
    </div>
  );
  if (q.isLoading) return <section className="mb-5" data-testid="serp-groups">{head}<p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Comparing the result pages of your keywords…</p></section>;
  if (q.isError) return <section className="mb-5" data-testid="serp-groups">{head}<p className="g-text-2 text-[13px]" role="alert">Couldn't compare the result pages: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p></section>;
  if (!d) return null;
  // Nothing checked on any device yet: the rank tracker's own empty state covers it.
  if (d.compared + d.skipped === 0 && site.devices !== "both") return null;
  if (d.compared < 2) return (
    <section className="mb-5" data-testid="serp-groups">{head}
      <p className="g-text-2 text-[13px]" data-testid="serp-groups-too-few">Not enough to compare on {d.device}: {d.compared === 0 ? "no keyword" : "only one keyword"} has a saved first page of results from the last five weeks{d.skipped > 0 ? ` (${fmtNum(d.skipped)} ${d.skipped === 1 ? "was" : "were"} checked without one)` : ""}. It fills in after the next rank check.</p>
    </section>
  );
  const basis = `From the first-page results (up to ten) saved for ${fmtNum(d.compared)} keyword${d.compared === 1 ? "" : "s"} on ${d.device}${d.checkedOn ? (d.oldest && d.oldest !== d.checkedOn ? `, each at its own newest check between ${fmtDate(d.oldest)} and ${fmtDate(d.checkedOn)} — so results from different days can be compared` : `, checked ${fmtDate(d.checkedOn)}`) : ""}`;
  const distinct = (g: Group) => g.ownDistinct ?? g.ownPages.length;
  const split = d.groups.filter((g) => distinct(g) > 1);
  const shown = all ? d.groups : d.groups.slice(0, 8);
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
  return (
    <section className="mb-5" data-testid="serp-groups">
      {head}
      <p className="g-text-2 mb-2 max-w-3xl text-[13px]" data-testid="text-serp-groups-basis">
        {basis}. Keywords are put together when at least {d.shared} of their first-page results are the same addresses as the group's first keyword (the others are compared with it, not with each other). Heavy overlap suggests the searches are close in meaning — a prompt to look at whether one page or separate pages should serve them, not Google's own grouping. Keywords tracked in different towns are never compared.{d.skipped > 0 ? ` ${fmtNum(d.skipped)} keyword${d.skipped === 1 ? " has" : "s have"} no saved result page to compare.` : ""}
      </p>
      {d.groups.length === 0 ? <p className="g-text-2 text-[13px]" data-testid="serp-groups-none">No two of these keywords share that many results: their first pages were largely different.</p> : (
        <>
          {split.length > 0 && <p className="g-text mb-2 text-[13px]" data-testid="text-serp-groups-split">In {fmtNum(split.length)} group{split.length === 1 ? "" : "s"}, more than one address of yours ranks for searches with overlapping results — worth opening them to see whether they are different pages, and what each is for.</p>}
          <div className="overflow-x-auto">
            <table className="g-table w-full" data-testid="table-serp-groups">
              <thead><tr><th aria-label="Show the keywords" className="w-12" /><th>Group (its first keyword)</th><th className="num">Keywords</th><th className="num">Volume / mo</th><th>Your addresses that rank</th><th><span className="sr-only">Action plan</span></th></tr></thead>
              {shown.map((g, gi) => {
                const isOpen = open === gi, first = g.members[0], noPage = g.rankedNoPage ?? 0, ranked = g.members.length - g.unranked;
                return (
                  <tbody key={`${first.keywordId}`}>
                    <tr data-testid={`row-serp-group-${first.keywordId}`}>
                      <td><button type="button" className="g-pill !min-h-8 !px-2" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the ${g.members.length} keywords grouped with ${first.keyword}`} onClick={() => setOpen(isOpen ? null : gi)}>{isOpen ? <ChevronDown /> : <ChevronRight />}</button></td>
                      <th scope="rowgroup" className="text-left font-normal">{first.keyword}<span className="g-text-2 block text-[12px]">{[town(g.location), `checked ${days(g.from, g.to)}`].filter(Boolean).join(" · ")}</span></th>
                      <td className="num">{g.members.length}</td>
                      <td className="num">{g.volume == null ? "—" : fmtNum(g.volume)}{g.volume != null && g.measured < g.members.length && <span className="g-text-2 block text-[12px]">for the {g.measured} with a figure</span>}</td>
                      <td className="max-w-[20rem]">
                        {ranked === 0 ? <span className="g-text-2">Your site was not found for any of them</span>
                          : g.ownPages.length === 0 ? <span className="g-text-2">Ranks for {ranked}, page not recorded</span>
                          : distinct(g) > 1 ? <span><span style={{ color: "#b06000" }}>{distinct(g)} addresses</span><span className="g-text-2 block text-[12px]">{g.ownPages.length > distinct(g) ? `${g.ownPages.length} as recorded; ` : ""}whether they are different pages is not checked (one may redirect to another)</span></span>
                          : g.ownPages.length > 1 ? <span>{g.ownPages.length} addresses that may be one page<span className="g-text-2 block text-[12px]">they differ only by http/https, "www" or a last slash — not checked</span></span>
                          : <span className="block truncate" title={g.ownPages[0]}>{nameOf(g.ownPages[0], site.domain)}</span>}
                        {ranked > 0 && (g.unranked > 0 || (noPage > 0 && g.ownPages.length > 0)) && <span className="g-text-2 block text-[12px]">{[g.unranked > 0 ? `not found for ${g.unranked}` : "", noPage > 0 && g.ownPages.length > 0 ? `page not recorded for ${noPage}` : ""].filter(Boolean).join(" · ")}</span>}
                      </td>
                      <td className="num"><AddToPlan siteId={site.id} label="Plan" testId={`button-plan-serp-${first.keywordId}`} tasks={[task(g)]} /></td>
                    </tr>
                    {isOpen && g.members.map((m, n) => (
                      <tr key={m.keywordId}>
                        <td />
                        <td className="pl-4">{m.keyword}<span className="g-text-2 block text-[12px]">{n === 0 ? "the first keyword — the others are compared with it" : `${m.shared} of its ${m.of} results are also in the first keyword's`}{m.checkedOn ? ` · checked ${fmtDate(m.checkedOn)}` : ""}</span></td>
                        <td className="num"><span className="sr-only">one keyword</span></td>
                        <td className="num">{fmtNum(m.volume)}</td>
                        <td className="max-w-[20rem]">{m.position == null ? <span className="g-text-2">not found in the results</span> : <><span className="tabular-nums">#{m.position}</span>{m.page ? <span className="g-text-2 ml-2 inline-block max-w-[15rem] truncate align-bottom" title={m.page}>{nameOf(m.page, site.domain)}</span> : <span className="g-text-2 ml-2">page not recorded</span>}</>}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
          {d.groups.length > 8 && <button type="button" className="g-link mt-2 text-[13px]" onClick={() => setAll(!all)} data-testid="button-serp-groups-all">{all ? "Show the first 8" : `Show all ${d.groups.length} groups`}</button>}
        </>
      )}
    </section>
  );
}
