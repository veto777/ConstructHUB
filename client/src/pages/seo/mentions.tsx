/**
 * Site Explorer -> Mentions (server/seo/mentions.ts): pages on other websites that use the business's exact name, and
 * whether those websites link to the site. A name is not a business — each mention is read for the customer's places
 * (towns), and the ones that don't name any are set apart as "same name — check it is you".
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, money, type SeoStatus } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Row = { url: string; domain: string; title: string; snippet: string | null; published: string | null; authority: number | null; linksToYou: boolean | null; place: string | null; /** The customer's own verdict on this website for this name. */ mark?: "mine" | "not_mine" | null };
type Page = { name: string; domain: string; rows: Row[]; total: number | null; linksChecked: boolean; linksCheckedAt?: string | null; linksPartial?: boolean; fetchedAt: string };
type View = { name: string; places: string[]; page: Page | null; rows: number };
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const flatText = (t: string) => ` ${t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** Whether the words of `name` appear together, as whole words, in `text`. */
const flatHas = (text: string, name: string) => flatText(text).includes(flatText(name));
const norm = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
/** A short, stable fingerprint (FNV-1a, 2 x 32 bits) for a task identity that must fit 200 characters. */
const fingerprint = (t: string) => { let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; } return a.toString(36) + b.toString(36); };
const linkWord = (v: boolean | null) => (v === true ? "Links to you" : v === false ? "No link found" : "Not known");

export function MentionsView({ siteId, domain, status }: { siteId: number; domain: string; status: SeoStatus | undefined }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${siteId}/mentions`;
  const q = useQuery<View>({ queryKey: [key], refetchOnMount: "always" });
  const [name, setName] = useState("");
  const [placesText, setPlacesText] = useState("");
  // Every answer seen on this screen, by name — a purchase stays on screen even when it could not be saved, and going
  // back to an earlier name shows its answer again. Never replaced by "nothing saved".
  const [kept, setKept] = useState<Record<string, Page>>({});
  const keep = (p: Page) => setKept((m) => ({ ...m, [norm(p.name)]: p }));
  const [filter, setFilter] = useState<"prospects" | "yours" | "unsure" | "linked" | "notMine" | "all">("prospects");
  // Verdicts just given on this screen (shown at once; the server keeps them per site, name and website).
  const [marking, setMarking] = useState<Record<string, "mine" | "not_mine" | null>>({});
  const mark = useMutation({
    mutationFn: (v: { siteId: number; name: string; domain: string; verdict: "mine" | "not_mine" | null }) => api("POST", `/api/seo/sites/${v.siteId}/mentions/marks`, { name: v.name, domain: v.domain, verdict: v.verdict }),
    onMutate: (v) => setMarking((m) => ({ ...m, [`${norm(v.name)}|${v.domain}`]: v.verdict })),
    onError: (e, v) => { setMarking((m) => { const { [`${norm(v.name)}|${v.domain}`]: _x, ...rest } = m; return rest; }); toast({ title: "Couldn't save that", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  // The saved name and places of this site, whenever another site is opened or they load.
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  useEffect(() => {
    if (!q.data) return;
    if (q.data.page) keep(q.data.page);
    // The name and places the site uses are filled in once per site, not over what is being typed.
    if (loadedFor !== siteId) { setName(q.data.name); setPlacesText(q.data.places.join(", ")); setLoadedFor(siteId); }
  }, [q.data, siteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const places = useMemo(() => [...new Set(placesText.split(",").map((p) => p.trim().replace(/\s+/g, " ")).filter((p) => p.length >= 2))].slice(0, 8), [placesText]);
  const placesChanged = !!q.data && places.join("|") !== q.data.places.join("|");
  const savePlaces = useMutation({
    mutationFn: (v: { siteId: number; places: string[] }) => api("POST", `/api/seo/sites/${v.siteId}/mentions/places`, { places: v.places }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/mentions`] }),
    onError: (e) => toast({ title: "Couldn't save the places", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const run = useMutation({
    // "Check again" names the answer it replaces, so a second click (or another tab) does not buy it twice.
    mutationFn: (v: { siteId: number; name: string; replaces?: string; retryMissing?: boolean }) => api("POST", `/api/seo/sites/${v.siteId}/mentions`, { name: v.name, ...(v.replaces ? { refresh: true, replaces: v.replaces } : {}), ...(v.retryMissing ? { retryMissing: true } : {}) }),
    onSuccess: (d: { page: Page; saved?: boolean }, v) => {
      if (v.siteId === siteId) keep(d.page);
      void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/mentions`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (d.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e, v) => { toast({ title: "Couldn't look for mentions", description: apiErrorMessage(e), variant: "destructive" }); if (v.retryMissing) void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/mentions`] }); },
  });
  // The figure set aside — also the most that can be charged. Without it nothing can be bought here.
  const price = status?.holds?.mentions ?? null, retryPrice = status?.holds?.mentionsRetry ?? null;
  const available = status?.credits ? status.credits.availableCents : -1;
  const canPay = (cents: number | null) => cents != null && (available === -1 || available >= cents);
  // Another name typed: its saved answer, if there is one, is looked up free before anything is offered for sale.
  const typed = norm(name), typedOk = /^[\p{L}\p{N}][\p{L}\p{N} &'’.,-]*$/u.test(name.trim()) && name.trim().length >= 3;
  const peek = useQuery<Page | null>({
    queryKey: ["mentions-peek", siteId, typed], enabled: typedOk && !kept[typed], retry: false, staleTime: 60_000,
    queryFn: async () => { try { return (await api("POST", key, { name: name.trim(), peek: true })).page as Page; } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  useEffect(() => { if (peek.data) keep(peek.data); }, [peek.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <p className="g-text-2 py-4 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <div className="g-callout" role="alert"><h3>Couldn't load mentions</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>;
  const page = kept[norm(name)] ?? null;
  // Rows are read for the places on the server when the check is loaded; edited places are read here the same way
  // (whole words in the title and the excerpt) until they are saved.
  const placeOf = (r: Row) => {
    if (!placesChanged) return r.place;
    const hay = ` ${`${r.title} ${r.snippet ?? ""}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    return places.find((p) => { const w = p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); return w.length >= 2 && hay.includes(` ${w} `); }) ?? null;
  };
  const rows = (page?.rows ?? []).map((r) => ({ ...r, place: placeOf(r) }));
  // The customer's verdict decides when there is one; otherwise the place match is a pointer to check, nothing more.
  const markOf = (r: Row) => { const k = `${norm(page?.name ?? "")}|${r.domain}`; return marking[k] !== undefined ? marking[k] : r.mark ?? null; };
  const likely = (r: Row & { place: string | null }) => markOf(r) === "mine" || (markOf(r) === null && !!r.place);
  const groups = {
    prospects: rows.filter((r) => likely(r) && r.linksToYou === false), yours: rows.filter(likely), unsure: rows.filter((r) => markOf(r) === null && !r.place),
    linked: rows.filter((r) => r.linksToYou === true && markOf(r) !== "not_mine"), notMine: rows.filter((r) => markOf(r) === "not_mine"), all: rows,
  };
  const list = groups[filter];
  // One task per name and page: another name, or another page of the same website, is another prospect. The evidence
  // goes with it, including what "link found" covers (any page of that website) and that the match is to be verified.
  const task = (r: Row & { place: string | null }): PlanTask => ({
    kind: "link_prospect", title: `Check that ${r.domain} is writing about you, then ask for a link — it mentions "${page!.name}"`.slice(0, 200), target: r.url,
    facts: {
      name: page!.name, website: r.domain, excerpt: (r.snippet ?? "").slice(0, 300), authority: r.authority, published: r.published,
      placeMatch: markOf(r) === "mine" ? "confirmed by you" : r.place ? `name and ${r.place} - verify` : "name only - verify", linkFound: r.linksToYou, linkScope: "any page of the website",
      searched: page!.fetchedAt.slice(0, 10), linksChecked: page!.linksCheckedAt?.slice(0, 10) ?? null,
    },
    source: `mention:${fingerprint(`${norm(page!.name)}\u0000${r.url}`)}`,
  });
  const exportCsv = () => {
    const lines: (string | number | null)[][] = [["Searched name", "Website", "Page", "Title", "Excerpt", "Published", "Authority", "Name and place match (to verify)", "Link to your site (from any page of that website)", "Searched on", "Links checked on"],
      ...rows.map((r) => [page!.name, r.domain, r.url, r.title, r.snippet, r.published, r.authority, r.place ? `name and ${r.place}` : "name only", linkWord(r.linksToYou), page!.fetchedAt.slice(0, 10), page!.linksCheckedAt?.slice(0, 10) ?? null])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${domain}-mentions.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const nameOk = typedOk;
  const tabs: [typeof filter, string, number][] = [["prospects", "Likely you, no link", groups.prospects.length], ["yours", "Likely you", groups.yours.length], ["unsure", "Name only — check it is you", groups.unsure.length], ["linked", "Website links to you", groups.linked.length], ["notMine", "Marked not you", groups.notMine.length], ["all", "All", groups.all.length]];
  return (
    <div data-testid="mentions">
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]">Pages on other websites that use your business's exact name, and whether those websites link to you. A website that writes about you without linking is the easiest link to ask for. Other businesses can share your name, so each page is read for your places: a page that names one of them is more likely to be about you — not certain (a directory can list several businesses, and two can share a name in one town), so check before you ask.</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col text-[13px]"><span className="g-text-2 mb-1">Business name, exactly as written</span>
          <input className="g-input w-72 max-w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alpine Exteriors" data-testid="input-mentions-name" /></label>
        <label className="flex min-w-0 flex-col text-[13px]"><span className="g-text-2 mb-1">Your places (towns, county), separated by commas</span>
          <input className="g-input w-80 max-w-full" value={placesText} onChange={(e) => setPlacesText(e.target.value)} placeholder="e.g. Bellingham, Whatcom, Lynden" data-testid="input-mentions-places" /></label>
        {placesChanged && <button type="button" className="g-pill g-pill--sm" disabled={savePlaces.isPending} onClick={() => savePlaces.mutate({ siteId, places })} data-testid="button-mentions-places">Save places (free)</button>}
        <button type="button" className="g-pill" disabled={!nameOk || run.isPending || peek.isFetching || !status?.configured || !canPay(price)} onClick={() => run.mutate({ siteId, name: name.trim(), replaces: page?.fetchedAt })} data-testid="button-mentions-run">
          {run.isPending ? <Loader2 className="animate-spin" /> : <Play />} {run.isPending ? "Looking…" : `${page ? "Check again" : "Look for mentions"}${price != null ? ` — up to ${money(price)}` : ""}`}
        </button>
      </div>
      {!nameOk && name.trim() && <p className="mb-2 text-[12px]" role="status" style={{ color: "var(--g-red)" }}>Use the business name only — letters, numbers, spaces and &amp; ' . , -</p>}
      {price == null && status && <p className="g-text-2 mb-2 text-[12px]">The price couldn't be loaded, so nothing can be bought yet — reload the page.</p>}
      {price != null && !canPay(price) && <p className="mb-2 text-[12px]" style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit on the SEO dashboard.</p>}
      {!page ? (
        <Empty testId="mentions-none"><h3>{peek.isFetching ? "Looking for a saved check of this name…" : Object.keys(kept).length ? "No check saved for this name" : "Not checked yet"}</h3><p>One check lists up to {fmtNum(q.data?.rows ?? 50)} websites that use the name (one page each, your own site left out) and checks which of them link to you. Saved and free to reopen for a week.</p></Empty>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="g-text-2" data-testid="text-mentions-meta">Searched {fmtDate(page.fetchedAt)}{page.linksCheckedAt && page.linksCheckedAt.slice(0, 10) !== page.fetchedAt.slice(0, 10) ? `, links checked ${fmtDate(page.linksCheckedAt)}` : ""}: {fmtNum(rows.length)} website{rows.length === 1 ? "" : "s"} using "{page.name}"{page.total != null && page.total > rows.length ? ` (the source has ${fmtNum(page.total)} pages with the name; one page per website is listed, the strongest websites first)` : ""}.{places.length === 0 ? " Add your places to set apart pages that are less likely to be about you." : ""}</span>
            <button type="button" className="g-pill g-pill--sm ml-auto" disabled={!rows.length} onClick={exportCsv} data-testid="button-mentions-export"><Download /> Export</button>
          </div>
          {!page.linksChecked && (
            <div className="g-callout mb-2" role="status" data-testid="mentions-links-missing"><p>The check of which websites link to you did not load, so that column is not known (it was not charged).</p>
              <button type="button" className="g-pill g-pill--sm mt-1" disabled={run.isPending || !canPay(retryPrice)} onClick={() => run.mutate({ siteId, name: page.name, retryMissing: true })} data-testid="button-mentions-retry">Check the links again{retryPrice != null ? ` — up to ${money(retryPrice)}` : ""}</button></div>
          )}
          {page.linksPartial && <p className="g-text-2 mb-2 text-[12px]">More of these websites link to you than one check returns; for the rest it is "not known", never "no link".</p>}
          <nav className="g-tabs" aria-label="Which mentions">
            {tabs.map(([k, label, n]) => <a key={k} href={`#${k}`} aria-current={filter === k ? "page" : undefined} onClick={(e) => { e.preventDefault(); setFilter(k); }} data-testid={`tab-mentions-${k}`}>{label} ({fmtNum(n)})</a>)}
          </nav>
          {list.length === 0 ? <p className="g-text-2 py-3 text-[13px]">None{filter === "prospects" && places.length === 0 ? " — add your places above to find which mentions are yours" : ""}.</p> : (
            <div className="overflow-x-auto">
              <table className="g-table w-full" data-testid="table-mentions">
                <thead><tr><th>Website and page</th><th>What it says</th><th className="num">Authority</th><th>Published</th><th>Link to you</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.domain}>
                      <td className="max-w-[16rem]" data-label="Website"><a href={r.url} target="_blank" rel="noreferrer" className="g-link block truncate" title={r.url}>{r.domain}</a><span className="g-text-2 block truncate text-[12px]" title={r.title}>{r.title}</span></td>
                      <td className="max-w-[26rem] !whitespace-normal text-[12px]" data-label="What it says">{r.snippet ?? "—"}<span className="g-text-2 block">{markOf(r) === "mine" ? "You confirmed this website writes about you" : markOf(r) === "not_mine" ? "You marked this as another business" : r.place ? `Names ${r.place} too — check it is about you` : "Names none of your places — check it is you"}{!flatHas(`${r.title} ${r.snippet ?? ""}`, page.name) ? " · the name is elsewhere on the page, not in this excerpt" : ""}</span></td>
                      <td className="num" data-label="Authority">{r.authority ?? "—"}</td>
                      <td data-label="Published">{r.published ? fmtDate(r.published) : "—"}</td>
                      <td data-label="Link to you">{linkWord(r.linksToYou)}</td>
                      <td className="whitespace-nowrap text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1" role="group" aria-label={`Is ${r.domain} writing about you?`}>
                          <button type="button" className="g-pill g-pill--sm" aria-pressed={markOf(r) === "mine"} onClick={() => mark.mutate({ siteId, name: page!.name, domain: r.domain, verdict: markOf(r) === "mine" ? null : "mine" })} data-testid={`button-mention-mine-${r.domain}`}>{markOf(r) === "mine" ? "✓ This is us" : "This is us"}</button>
                          <button type="button" className="g-pill g-pill--sm" aria-pressed={markOf(r) === "not_mine"} onClick={() => mark.mutate({ siteId, name: page!.name, domain: r.domain, verdict: markOf(r) === "not_mine" ? null : "not_mine" })} data-testid={`button-mention-notmine-${r.domain}`}>{markOf(r) === "not_mine" ? "✓ Not us" : "Not us"}</button>
                          {r.linksToYou !== true && markOf(r) !== "not_mine" && <AddToPlan siteId={siteId} label="Plan" testId={`button-plan-mention-${r.domain}`} tasks={[task(r)]} />}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">Read from each page's title and the excerpt the source returns, not the whole page — a page about you that doesn't name a town in its excerpt lands under "check it is you". "Links to you" means our link data has a link from that website to yours, from any of its pages; "no link found" can also be a link it hasn't crawled yet. Authority is the website's, 0-100.</p>
        </>
      )}
    </div>
  );
}
