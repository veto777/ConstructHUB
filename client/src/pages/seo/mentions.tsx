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
import { api, Empty, fmtDate, fmtNum, money, type SeoStatus } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Row = { url: string; domain: string; title: string; snippet: string | null; published: string | null; authority: number | null; linksToYou: boolean | null; place: string | null };
type Page = { name: string; domain: string; rows: Row[]; total: number | null; linksChecked: boolean; linksPartial?: boolean; fetchedAt: string };
type View = { name: string; places: string[]; page: Page | null; rows: number };
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const flatText = (t: string) => ` ${t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** Whether the words of `name` appear together, as whole words, in `text`. */
const flatHas = (text: string, name: string) => flatText(text).includes(flatText(name));
const linkWord = (v: boolean | null) => (v === true ? "Links to you" : v === false ? "No link found" : "Not known");

export function MentionsView({ siteId, domain, status }: { siteId: number; domain: string; status: SeoStatus | undefined }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${siteId}/mentions`;
  const q = useQuery<View>({ queryKey: [key], refetchOnMount: "always" });
  const [name, setName] = useState("");
  const [placesText, setPlacesText] = useState("");
  const [shownPage, setShownPage] = useState<Page | null>(null);
  const [filter, setFilter] = useState<"prospects" | "yours" | "unsure" | "linked" | "all">("prospects");
  // The saved name and places of this site, whenever another site is opened or they load.
  useEffect(() => { if (q.data) { setName(q.data.name); setPlacesText(q.data.places.join(", ")); setShownPage(q.data.page); } }, [q.data, siteId]);
  const places = useMemo(() => [...new Set(placesText.split(",").map((p) => p.trim().replace(/\s+/g, " ")).filter((p) => p.length >= 2))].slice(0, 8), [placesText]);
  const placesChanged = !!q.data && places.join("|") !== q.data.places.join("|");
  const savePlaces = useMutation({
    mutationFn: (v: { siteId: number; places: string[] }) => api("POST", `/api/seo/sites/${v.siteId}/mentions/places`, { places: v.places }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/mentions`] }),
    onError: (e) => toast({ title: "Couldn't save the places", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const run = useMutation({
    mutationFn: (v: { siteId: number; name: string; refresh?: boolean; retryMissing?: boolean }) => api("POST", `/api/seo/sites/${v.siteId}/mentions`, { name: v.name, ...(v.refresh ? { refresh: true } : {}), ...(v.retryMissing ? { retryMissing: true } : {}) }),
    onSuccess: (d: { page: Page; saved?: boolean }, v) => {
      if (v.siteId === siteId) setShownPage(d.page);
      void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/mentions`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (d.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e, v) => { toast({ title: "Couldn't look for mentions", description: apiErrorMessage(e), variant: "destructive" }); if (v.retryMissing) void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/mentions`] }); },
  });
  // The figure set aside — also the most that can be charged. Without it nothing can be bought here.
  const price = status?.holds?.mentions ?? null, retryPrice = status?.holds?.mentionsRetry ?? null;
  const available = status?.credits ? status.credits.availableCents : -1;
  const canPay = (cents: number | null) => cents != null && (available === -1 || available >= cents);
  if (q.isLoading) return <p className="g-text-2 py-4 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <div className="g-callout" role="alert"><h3>Couldn't load mentions</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>;
  // A different name than the one shown: what is on screen is for that other name.
  const page = shownPage && shownPage.name.toLowerCase() === name.trim().replace(/\s+/g, " ").toLowerCase() ? shownPage : null;
  // Rows are read for the places on the server when the check is loaded; edited places are read here the same way
  // (whole words in the title and the excerpt) until they are saved.
  const placeOf = (r: Row) => {
    if (!placesChanged) return r.place;
    const hay = ` ${`${r.title} ${r.snippet ?? ""}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    return places.find((p) => { const w = p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); return w.length >= 2 && hay.includes(` ${w} `); }) ?? null;
  };
  const rows = (page?.rows ?? []).map((r) => ({ ...r, place: placeOf(r) }));
  const groups = {
    prospects: rows.filter((r) => r.place && r.linksToYou === false), yours: rows.filter((r) => r.place), unsure: rows.filter((r) => !r.place),
    linked: rows.filter((r) => r.linksToYou === true), all: rows,
  };
  const list = groups[filter];
  const task = (r: Row & { place: string | null }): PlanTask => ({
    kind: "link_prospect", title: `Ask ${r.domain} for a link — it mentions "${page!.name}"`.slice(0, 200), target: r.url,
    facts: { website: r.domain, authority: r.authority, published: r.published, placeNamed: r.place, linkFound: r.linksToYou, checked: page!.fetchedAt.slice(0, 10) },
    source: `mention:${r.domain}`,
  });
  const exportCsv = () => {
    const lines: (string | number | null)[][] = [["Website", "Page", "Title", "Excerpt", "Published", "Authority", "Names one of your places", "Link to your site", "Checked on"],
      ...rows.map((r) => [r.domain, r.url, r.title, r.snippet, r.published, r.authority, r.place, linkWord(r.linksToYou), page!.fetchedAt.slice(0, 10)])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${domain}-mentions.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const nameOk = /^[\p{L}\p{N}][\p{L}\p{N} &'’.,-]*$/u.test(name.trim()) && name.trim().length >= 3;
  const tabs: [typeof filter, string, number][] = [["prospects", "Mention you, no link", groups.prospects.length], ["yours", "Name one of your places", groups.yours.length], ["unsure", "Same name — check it is you", groups.unsure.length], ["linked", "Already link to you", groups.linked.length], ["all", "All", groups.all.length]];
  return (
    <div data-testid="mentions">
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]">Pages on other websites that use your business's exact name, and whether those websites link to you. A website that writes about you without linking is the easiest link to ask for. Other businesses can share your name, so each page is read for your places: the ones that don't name any are set apart for you to check.</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col text-[13px]"><span className="g-text-2 mb-1">Business name, exactly as written</span>
          <input className="g-input w-72 max-w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alpine Exteriors" data-testid="input-mentions-name" /></label>
        <label className="flex min-w-0 flex-col text-[13px]"><span className="g-text-2 mb-1">Your places (towns, county), separated by commas</span>
          <input className="g-input w-80 max-w-full" value={placesText} onChange={(e) => setPlacesText(e.target.value)} placeholder="e.g. Bellingham, Whatcom, Lynden" data-testid="input-mentions-places" /></label>
        {placesChanged && <button type="button" className="g-pill g-pill--sm" disabled={savePlaces.isPending} onClick={() => savePlaces.mutate({ siteId, places })} data-testid="button-mentions-places">Save places (free)</button>}
        <button type="button" className="g-pill" disabled={!nameOk || run.isPending || !status?.configured || !canPay(price)} onClick={() => run.mutate({ siteId, name: name.trim(), refresh: !!page })} data-testid="button-mentions-run">
          {run.isPending ? <Loader2 className="animate-spin" /> : <Play />} {run.isPending ? "Looking…" : `${page ? "Check again" : "Look for mentions"}${price != null ? ` — up to ${money(price)}` : ""}`}
        </button>
      </div>
      {!nameOk && name.trim() && <p className="mb-2 text-[12px]" role="status" style={{ color: "var(--g-red)" }}>Use the business name only — letters, numbers, spaces and &amp; ' . , -</p>}
      {price == null && status && <p className="g-text-2 mb-2 text-[12px]">The price couldn't be loaded, so nothing can be bought yet — reload the page.</p>}
      {price != null && !canPay(price) && <p className="mb-2 text-[12px]" style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit on the SEO dashboard.</p>}
      {!page ? (
        <Empty testId="mentions-none"><h3>{shownPage ? "No check saved for this name" : "Not checked yet"}</h3><p>One check lists up to {fmtNum(q.data?.rows ?? 50)} websites that use the name (one page each, your own site left out) and checks which of them link to you. Saved and free to reopen for a week.</p></Empty>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="g-text-2" data-testid="text-mentions-meta">Checked {fmtDate(page.fetchedAt)}: {fmtNum(rows.length)} website{rows.length === 1 ? "" : "s"} using "{page.name}"{page.total != null && page.total > rows.length ? ` (the source has ${fmtNum(page.total)} pages with the name; one page per website is listed, the strongest websites first)` : ""}.{places.length === 0 ? " Add your places to tell your mentions from other businesses with the name." : ""}</span>
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
                      <td className="max-w-[26rem] !whitespace-normal text-[12px]" data-label="What it says">{r.snippet ?? "—"}<span className="g-text-2 block">{r.place ? `Names ${r.place}` : "Names none of your places — check it is you"}{!flatHas(`${r.title} ${r.snippet ?? ""}`, page.name) ? " · the name is elsewhere on the page, not in this excerpt" : ""}</span></td>
                      <td className="num" data-label="Authority">{r.authority ?? "—"}</td>
                      <td data-label="Published">{r.published ? fmtDate(r.published) : "—"}</td>
                      <td data-label="Link to you">{linkWord(r.linksToYou)}</td>
                      <td className="num">{r.linksToYou !== true && <AddToPlan siteId={siteId} label="Plan" testId={`button-plan-mention-${r.domain}`} tasks={[task(r)]} />}</td>
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
