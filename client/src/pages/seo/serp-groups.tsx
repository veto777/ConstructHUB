/**
 * Rank tracker → searches Google answers with the same pages (server/seo/serp-groups.ts). Tracked keywords whose
 * first-page results largely coincide, from the result pages the last check saved — free. Groups where the site
 * ranks with different pages of its own come first.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Member = { keywordId: number; keyword: string; volume: number | null; position: number | null; page: string | null; shared: number; of: number };
type Group = { location: string | null; locationCode: number | null; members: Member[]; volume: number | null; measured: number; ownPages: string[]; unranked: number };
type Data = { groups: Group[]; compared: number; skipped: number; shared: number; device: string; checkedOn: string | null; oldest: string | null };
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
const town = (location: string | null) => (location ? location.split(",")[0] : null);

export function SerpGroupsPanel({ site }: { site: SeoSite }) {
  const [device, setDevice] = useState("");
  const key = `/api/seo/sites/${site.id}/serp-groups${device ? `?device=${device}` : ""}`;
  const q = useQuery<Data>({ queryKey: [key], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 30_000 });
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Comparing the result pages of your keywords…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't compare the result pages: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  const d = q.data;
  // Fewer than two keywords with saved result pages: nothing to compare, and nothing to say.
  if (!d || d.compared < 2) return null;
  const basis = `From the first-page results (up to ten) saved for ${fmtNum(d.compared)} keyword${d.compared === 1 ? "" : "s"} on ${d.device}${d.checkedOn ? (d.oldest && d.oldest !== d.checkedOn ? `, checked between ${fmtDate(d.oldest)} and ${fmtDate(d.checkedOn)}` : `, checked ${fmtDate(d.checkedOn)}`) : ""}`;
  const split = d.groups.filter((g) => g.ownPages.length > 1);
  const shown = all ? d.groups : d.groups.slice(0, 8);
  const task = (g: Group): PlanTask => ({
    kind: "page", title: `One page for "${g.members[0].keyword}" and ${g.members.length - 1} search${g.members.length === 2 ? "" : "es"} with the same results${town(g.location) ? ` (${town(g.location)})` : ""}`,
    target: g.ownPages[0] && g.ownPages[0].length <= 500 ? g.ownPages[0] : null,
    facts: {
      searches: g.members.slice(0, 8).map((m) => m.keyword).join(" · ").slice(0, 300), ...(g.members.length > 8 ? { moreSearches: g.members.length - 8 } : {}),
      ...Object.fromEntries(g.ownPages.slice(0, 3).map((p, n) => [`ownPage${n + 1}`, p.length <= 300 ? p : "(address too long to keep — see the rank tracker)"])),
      ...(g.ownPages.length > 3 ? { moreOwnPages: g.ownPages.length - 3 } : {}),
      basis: `first-page results (up to ten), ${d.device}, checked ${d.checkedOn ?? "?"}; at least ${d.shared} addresses shared with the first search`, where: g.location ?? "not set", unranked: g.unranked,
    }, source: `serp-group:${g.members[0].keywordId}`,
  });
  return (
    <section className="mb-5" data-testid="serp-groups">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h2 className="g-text text-[16px] font-medium">Searches Google answers with the same pages</h2>
        {site.devices === "both" && <span className="flex gap-1" role="group" aria-label="Device">{["desktop", "mobile"].map((v) => <button key={v} type="button" className="g-pill g-pill--sm" aria-pressed={d.device === v} style={d.device === v ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined} onClick={() => { setDevice(v); setOpen(null); }}>{v === "desktop" ? "Desktop" : "Mobile"}</button>)}</span>}
      </div>
      <p className="g-text-2 mb-2 max-w-3xl text-[13px]" data-testid="text-serp-groups-basis">
        {basis}. Keywords are put together when at least {d.shared} of their first-page results are the same addresses as the group's first keyword — a sign Google reads them as one question, which one good page can usually answer. It is one check, not a rule; keywords tracked in different towns are never compared.{d.skipped > 0 ? ` ${fmtNum(d.skipped)} keyword${d.skipped === 1 ? " has" : "s have"} no saved result page to compare.` : ""}
      </p>
      {d.groups.length === 0 ? <p className="g-text-2 text-[13px]" data-testid="serp-groups-none">No two of these keywords share that many results: at this check Google answered each with largely its own pages.</p> : (
        <>
          {split.length > 0 && <p className="g-text mb-2 text-[13px]" data-testid="text-serp-groups-split">In {fmtNum(split.length)} group{split.length === 1 ? "" : "s"}, different pages of yours rank for searches with the same results — worth checking whether those pages are doing the same job.</p>}
          <div className="overflow-x-auto">
            <table className="g-table w-full" data-testid="table-serp-groups">
              <thead><tr><th aria-label="Show the keywords" className="w-12" /><th>Group (its first keyword)</th><th className="num">Keywords</th><th className="num">Volume / mo</th><th>Your pages that rank</th><th><span className="sr-only">Action plan</span></th></tr></thead>
              {shown.map((g, gi) => {
                const isOpen = open === gi, head = g.members[0];
                return (
                  <tbody key={`${head.keywordId}`}>
                    <tr data-testid={`row-serp-group-${head.keywordId}`}>
                      <td><button type="button" className="g-pill !min-h-8 !px-2" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the ${g.members.length} keywords grouped with ${head.keyword}`} onClick={() => setOpen(isOpen ? null : gi)}>{isOpen ? <ChevronDown /> : <ChevronRight />}</button></td>
                      <th scope="rowgroup" className="text-left font-normal">{head.keyword}{town(g.location) && <span className="g-text-2 block text-[12px]">{town(g.location)}</span>}</th>
                      <td className="num">{g.members.length}</td>
                      <td className="num">{g.volume == null ? "—" : fmtNum(g.volume)}{g.volume != null && g.measured < g.members.length && <span className="g-text-2 block text-[12px]">for the {g.measured} with a figure</span>}</td>
                      <td className="max-w-[20rem]">
                        {g.ownPages.length === 0 ? <span className="g-text-2">None of yours ranks</span> : g.ownPages.length === 1 ? <span className="block truncate" title={g.ownPages[0]}>{nameOf(g.ownPages[0], site.domain)}</span> : <span style={{ color: "#b06000" }}>{g.ownPages.length} different pages</span>}
                        {g.unranked > 0 && g.ownPages.length > 0 && <span className="g-text-2 block text-[12px]">not ranking for {g.unranked} of them</span>}
                      </td>
                      <td className="num"><AddToPlan siteId={site.id} label="Plan" testId={`button-plan-serp-${head.keywordId}`} tasks={[task(g)]} /></td>
                    </tr>
                    {isOpen && g.members.map((m, n) => (
                      <tr key={m.keywordId}>
                        <td />
                        <td className="pl-4">{m.keyword}{n === 0 && <span className="g-text-2 text-[12px]"> · the first keyword</span>}</td>
                        <td className="num g-text-2 text-[12px]">{n === 0 ? "" : `${m.shared} of ${m.of} results shared`}</td>
                        <td className="num">{fmtNum(m.volume)}</td>
                        <td className="max-w-[20rem]">{m.position == null ? <span className="g-text-2">not in the results</span> : <><span className="tabular-nums">#{m.position}</span>{m.page && <span className="g-text-2 ml-2 inline-block max-w-[15rem] truncate align-bottom" title={m.page}>{nameOf(m.page, site.domain)}</span>}</>}</td>
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
