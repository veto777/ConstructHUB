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
type Page = { marksUnavailable?: boolean; name: string; domain: string; rows: Row[]; total: number | null; linksChecked: boolean; linksCheckedAt?: string | null; linksPartial?: boolean; fetchedAt: string };
type Watch = { watch: boolean; nextAt: string | null; note?: string | null; checks?: number; chosen?: boolean; missing?: boolean; latest: { id: number; name?: string; since: string; takenAt: string; page: Page } | null };
type View = { name: string; places: string[]; page: Page | null; rows: number; watch?: Watch };
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const flatText = (t: string) => ` ${t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** Whether the words of `name` appear together, as whole words, in `text`. */
const flatHas = (text: string, name: string) => flatText(text).includes(flatText(name));
/** A page as the server compares verdicts (server/seo/audit-pages.ts sameUrlKey): host without www, path without a last slash, the query kept. */
const pageKey = (u: string) => { try { const x = new URL(u); return `${x.host.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`; } catch { return u.replace(/#.*$/, "").replace(/\/+$/, ""); } };
/** Every variant of a site's mentions view (with or without ?check=). */
const mentionsOf = (siteId: number) => (x: { queryKey: readonly unknown[] }) => typeof x.queryKey[0] === "string" && (x.queryKey[0] === `/api/seo/sites/${siteId}/mentions` || x.queryKey[0].startsWith(`/api/seo/sites/${siteId}/mentions?`));
const norm = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
/** A short, stable fingerprint (FNV-1a, 2 x 32 bits) for a task identity that must fit 200 characters. */
const fingerprint = (t: string) => { let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; } return a.toString(36) + b.toString(36); };
const linkWord = (v: boolean | null) => (v === true ? "Links to you" : v === false ? "No link found" : "Not known");

export function MentionsView({ siteId, domain, status, checkId }: { siteId: number; domain: string; status: SeoStatus | undefined; /** A watched check to show (an alert's), instead of the newest. */ checkId?: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${siteId}/mentions`;
  const q = useQuery<View>({ queryKey: [checkId ? `${key}?check=${checkId}` : key], refetchOnMount: "always" });
  const [name, setName] = useState("");
  const [placesText, setPlacesText] = useState("");
  // Every answer seen on this screen, by name — a purchase stays on screen even when it could not be saved, and going
  // back to an earlier name shows its answer again. Never replaced by "nothing saved".
  const [kept, setKept] = useState<Record<string, Page>>({});
  // Kept by freshness: an older answer (an earlier search, or the same search before its link check came back) never
  // replaces a newer one; the newest response's verdicts are taken either way.
  const keep = (p: Page) => setKept((m) => {
    const k = norm(p.name), had0 = m[k];
    // Verdicts that could not be read are not "no verdict": the ones known from an earlier answer are kept.
    if (p.marksUnavailable && had0) { const before = new Map(had0.rows.map((r) => [pageKey(r.url), r.mark])); p = { ...p, rows: p.rows.map((r) => ({ ...r, mark: before.get(pageKey(r.url)) ?? r.mark })) }; }
    const had = had0;
    const t = (x: Page) => [x.fetchedAt, x.linksChecked ? (x.linksCheckedAt ?? x.fetchedAt) : ""].join("|");
    if (!had || t(p) >= t(had)) return { ...m, [k]: p };
    if (p.marksUnavailable) return m;
    const marks = new Map(p.rows.map((r) => [pageKey(r.url), r.mark]));
    return { ...m, [k]: { ...had, rows: had.rows.map((r) => (marks.has(pageKey(r.url)) ? { ...r, mark: marks.get(pageKey(r.url)) } : r)) } };
  });
  const [filter, setFilter] = useState<"prospects" | "yours" | "unsure" | "linked" | "notMine" | "all">("prospects");
  // Verdicts given on this screen, per name and PAGE: shown at once as pending, one request at a time per page (its
  // buttons wait), confirmed when the server answers, and put back to what they were if it refuses.
  type Verdict = "mine" | "not_mine" | null;
  const [marking, setMarking] = useState<Record<string, { verdict: Verdict; pending: boolean }>>({});
  // What the server has said about each page's verdict, by name and page (as the server compares pages), from any
  // answer whose verdicts DID load — the ordinary check, a looked-up name, the watched check. An answer whose verdicts
  // could not be read changes nothing here, so a known verdict never disappears.
  // Each entry carries WHEN it became known: a verdict saved here is known at once, and an answer can replace it only
  // if that answer is newer than the save (an answer read before the save could still carry the old verdict).
  const [known, setKnown] = useState<Record<string, { v: Verdict; at: number }>>({});
  const learn = (p: Page | null | undefined, at: number) => {
    if (!p || p.marksUnavailable) return;
    setKnown((m) => { const next = { ...m }; for (const r of p.rows) { const k = `${norm(p.name)}|${pageKey(r.url)}`; if (!next[k] || next[k].at <= at) next[k] = { v: r.mark ?? null, at }; } return next; });
  };
  const mark = useMutation({
    mutationFn: (v: { siteId: number; name: string; url: string; verdict: Verdict; was: Verdict }) => api("POST", `/api/seo/sites/${v.siteId}/mentions/marks`, { name: v.name, url: v.url, verdict: v.verdict }),
    onMutate: (v) => setMarking((m) => ({ ...m, [`${norm(v.name)}|${pageKey(v.url)}`]: { verdict: v.verdict, pending: true } })),
    // Saved: the view is read again, and once that fresh answer is here it decides (see the effect below).
    onSuccess: (_d, v) => { const k = `${norm(v.name)}|${pageKey(v.url)}`; setKnown((m) => ({ ...m, [k]: { v: v.verdict, at: Date.now() } })); setMarking((m) => { const { [k]: _done, ...rest } = m; return rest; }); void qc.invalidateQueries({ predicate: mentionsOf(v.siteId) }); void qc.invalidateQueries({ queryKey: ["mentions-peek", v.siteId, norm(v.name)] }); toast({ title: v.verdict === "mine" ? "Marked: this page is about you" : v.verdict === "not_mine" ? "Marked: another business" : "Mark taken back" }); },
    // Refused: the choice shown while saving goes; what the server is known to hold is shown again.
    onError: (e, v) => { setMarking((m) => { const { [`${norm(v.name)}|${pageKey(v.url)}`]: _gone, ...rest } = m; return rest; }); toast({ title: "Couldn't save that", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  // The saved name and places of this site, whenever another site is opened or they load.
  // Fresh server data has every saved verdict: what was shown here for settled ones gives way to it (another tab's
  // change included). Ones still in flight stay until they are answered.
  // Every answer whose verdicts DID load teaches what the server holds (one saying they could not be read teaches nothing).
  useEffect(() => { learn(q.data?.page, q.dataUpdatedAt); learn(q.data?.watch?.latest?.page, q.dataUpdatedAt); }, [q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
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
    onSuccess: (_d, v) => void qc.invalidateQueries({ predicate: mentionsOf(v.siteId) }),
    onError: (e) => toast({ title: "Couldn't save the places", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const run = useMutation({
    // "Check again" names the answer it replaces, so a second click (or another tab) does not buy it twice.
    mutationFn: (v: { siteId: number; name: string; replaces?: string; retryMissing?: boolean }) => api("POST", `/api/seo/sites/${v.siteId}/mentions`, { name: v.name, ...(v.replaces ? { refresh: true, replaces: v.replaces } : {}), ...(v.retryMissing ? { retryMissing: true } : {}) }),
    onSuccess: (d: { page: Page; saved?: boolean }, v) => {
      if (v.siteId === siteId) keep(d.page);
      void qc.invalidateQueries({ predicate: mentionsOf(v.siteId) }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (d.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e, v) => { toast({ title: "Couldn't look for mentions", description: apiErrorMessage(e), variant: "destructive" }); if (v.retryMissing) void qc.invalidateQueries({ predicate: mentionsOf(v.siteId) }); },
  });
  // The figure set aside — also the most that can be charged. Without it nothing can be bought here.
  const price = status?.holds?.mentions ?? null, retryPrice = status?.holds?.mentionsRetry ?? null;
  const available = status?.credits ? status.credits.availableCents : -1;
  const canPay = (cents: number | null) => cents != null && (available === -1 || available >= cents);
  // Another name typed: its saved answer, if there is one, is looked up free before anything is offered for sale.
  const typed = norm(name), typedOk = /^[\p{L}\p{N}][\p{L}\p{N} &'’.,-]*$/u.test(name.trim()) && name.trim().length >= 3;
  const peek = useQuery<Page | null>({
    // Also for a name already on screen: after a verdict it is read again, so a name other than the saved one gets its fresh verdicts too.
    queryKey: ["mentions-peek", siteId, typed], enabled: typedOk, retry: false, staleTime: 60_000,
    queryFn: async () => { try { return (await api("POST", key, { name: name.trim(), peek: true })).page as Page; } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  useEffect(() => { if (peek.data) { keep(peek.data); learn(peek.data, peek.dataUpdatedAt); } }, [peek.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const peekFailed = peek.isError && !kept[typed];
  if (q.isLoading) return <p className="g-text-2 py-4 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <div className="g-callout" role="alert"><h3>Couldn't load mentions</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>;
  const page = kept[norm(name)] ?? null;
  // Rows are read for the places on the server when the check is loaded; edited places are read here the same way
  // (whole words in the title and the excerpt) until they are saved.
  // Always read for the places in the field now (whole words in the title and the excerpt, as the server does), so an
  // answer kept from earlier can never show a match for places that have since changed.
  const placeOf = (r: Row) => {
    const hay = ` ${`${r.title} ${r.snippet ?? ""}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    return places.find((p) => { const w = p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); return w.length >= 2 && hay.includes(` ${w} `); }) ?? null;
  };
  const rows = (page?.rows ?? []).map((r) => ({ ...r, place: placeOf(r) }));
  // The customer's verdict decides when there is one; otherwise the place match is a pointer to check, nothing more.
  const markKeyFor = (name: string, r: Row) => `${norm(name)}|${pageKey(r.url)}`;
  // Settled overlay, else what the server is known to have said, else what this row carries.
  const serverMark = (name: string, r: Row): Verdict => { const k = markKeyFor(name, r); return k in known ? known[k].v : r.mark ?? null; };
  const markOfFor = (name: string, r: Row): Verdict => { const o = marking[markKeyFor(name, r)]; return o && !o.pending ? o.verdict : serverMark(name, r); };
  const shownMarkFor = (name: string, r: Row): Verdict => { const o = marking[markKeyFor(name, r)]; return o ? o.verdict : serverMark(name, r); };
  const pendingFor = (name: string, r: Row) => !!marking[markKeyFor(name, r)]?.pending;
  // Groups use the settled verdict, so a row being marked stays where it is (and keeps focus) until the answer comes;
  // its buttons show the choice being saved.
  const markOf = (r: Row): Verdict => markOfFor(page?.name ?? "", r);
  const markPending = (r: Row) => pendingFor(page?.name ?? "", r);
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
    // Every row of the check (whatever tab is open), with the customer's own verdict and what the screen makes of it.
    const lines: (string | number | null)[][] = [["Searched name", "Website", "Page", "Title", "Excerpt", "Published", "Authority", "Name and place match (to verify)", "Your verdict on this page", "Shown as", "Link to your site (from any page of that website)", "Searched on", "Links checked on"],
      ...rows.map((r) => [page!.name, r.domain, r.url, r.title, r.snippet, r.published, r.authority, r.place ? `name and ${r.place}` : "name only",
        markOf(r) === "mine" ? "this is us" : markOf(r) === "not_mine" ? "not us" : "", markOf(r) === "not_mine" ? "not you" : likely(r) ? "likely you" : "name only - check it is you",
        linkWord(r.linksToYou), page!.fetchedAt.slice(0, 10), page!.linksCheckedAt?.slice(0, 10) ?? null])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${domain}-mentions.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const nameOk = typedOk;
  const tabs: [typeof filter, string, number][] = [["prospects", "Likely you, no link", groups.prospects.length], ["yours", "Likely you", groups.yours.length], ["unsure", "Name only — check it is you", groups.unsure.length], ["linked", "Website links to you", groups.linked.length], ["notMine", "Marked not you", groups.notMine.length], ["all", "All", groups.all.length]];
  return (
    <div data-testid="mentions">
      {q.data?.watch && <WatchPanel siteId={siteId} name={q.data.name} watch={q.data.watch} domain={domain} retryPrice={status?.holds?.mentionsRetry ?? null}
        verdict={{ of: shownMarkFor, pending: pendingFor, set: (n, r, v) => mark.mutate({ siteId, name: n, url: r.url, verdict: v, was: markOfFor(n, r) }) }} />}
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]">Pages on other websites that use your business's exact name, and whether those websites link to you. A website that writes about you without linking is the easiest link to ask for. Other businesses can share your name, so each page is read for your places: a page that names one of them is more likely to be about you — not certain (a directory can list several businesses, and two can share a name in one town), so check before you ask.</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col text-[13px]"><span className="g-text-2 mb-1">Business name, exactly as written</span>
          <input className="g-input w-72 max-w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alpine Exteriors" data-testid="input-mentions-name" /></label>
        <label className="flex min-w-0 flex-col text-[13px]"><span className="g-text-2 mb-1">Your places (towns, county), separated by commas</span>
          <input className="g-input w-80 max-w-full" value={placesText} onChange={(e) => setPlacesText(e.target.value)} placeholder="e.g. Bellingham, Whatcom, Lynden" data-testid="input-mentions-places" /></label>
        {placesChanged && <button type="button" className="g-pill g-pill--sm" disabled={savePlaces.isPending} onClick={() => savePlaces.mutate({ siteId, places })} data-testid="button-mentions-places">Save places (free)</button>}
        <button type="button" className="g-pill" disabled={!nameOk || run.isPending || peek.isFetching || peekFailed || !status?.configured || !canPay(price)} onClick={() => run.mutate({ siteId, name: name.trim(), replaces: page?.fetchedAt })} data-testid="button-mentions-run">
          {run.isPending ? <Loader2 className="animate-spin" /> : <Play />} {run.isPending ? "Looking…" : `${page ? "Check again" : "Look for mentions"}${price != null ? ` — up to ${money(price)}` : ""}`}
        </button>
      </div>
      {!nameOk && name.trim() && <p className="mb-2 text-[12px]" role="status" style={{ color: "var(--g-red)" }}>Use the business name only — letters, numbers, spaces and &amp; ' . , -</p>}
      {price == null && status && <p className="g-text-2 mb-2 text-[12px]">The price couldn't be loaded, so nothing can be bought yet — reload the page.</p>}
      {price != null && !canPay(price) && <p className="mb-2 text-[12px]" style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit on the SEO dashboard.</p>}
      {!page ? (
        <Empty testId="mentions-none"><h3>{peek.isFetching ? "Looking for a saved check of this name…" : peekFailed ? "Couldn't look for a saved check of this name" : Object.keys(kept).length ? "No check saved for this name" : "Not checked yet"}</h3>{peekFailed && <p role="alert">{apiErrorMessage(peek.error)} <button type="button" className="g-link" onClick={() => void peek.refetch()} data-testid="button-mentions-peek-retry">Look again (free)</button></p>}<p>One check lists up to {fmtNum(q.data?.rows ?? 50)} websites that use the name (one page each, your own site left out) and checks which of them link to you. Saved and free to reopen for a week.</p></Empty>
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
          {page.marksUnavailable && <p className="mb-2 text-[12px]" role="status" style={{ color: "#b06000" }}>Your "This is us / Not us" answers couldn't be loaded just now, so they aren't shown — they are still saved. Reload to see them.</p>}
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
                    <tr key={r.url}>
                      <td className="max-w-[16rem]" data-label="Website"><a href={r.url} target="_blank" rel="noreferrer" className="g-link block truncate" title={r.url}>{r.domain}</a><span className="g-text-2 block truncate text-[12px]" title={r.title}>{r.title}</span></td>
                      <td className="max-w-[26rem] !whitespace-normal text-[12px]" data-label="What it says">{r.snippet ?? "—"}<span className="g-text-2 block">{markOf(r) === "mine" ? "You confirmed this page is about you" : markOf(r) === "not_mine" ? "You marked this page as another business" : r.place ? `Names ${r.place} too — check it is about you` : "Names none of your places — check it is you"}{!flatHas(`${r.title} ${r.snippet ?? ""}`, page.name) ? " · the name is elsewhere on the page, not in this excerpt" : ""}</span></td>
                      <td className="num" data-label="Authority">{r.authority ?? "—"}</td>
                      <td data-label="Published">{r.published ? fmtDate(r.published) : "—"}</td>
                      <td data-label="Link to you">{linkWord(r.linksToYou)}</td>
                      <td className="whitespace-nowrap text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1" role="group" aria-label={`Is this page on ${r.domain} about you?`} aria-busy={markPending(r)}>
                          <button type="button" className="g-pill g-pill--sm" disabled={markPending(r)} aria-pressed={shownMarkFor(page!.name, r) === "mine"} onClick={() => mark.mutate({ siteId, name: page!.name, url: r.url, verdict: markOf(r) === "mine" ? null : "mine", was: markOf(r) })} data-testid={`button-mention-mine-${r.domain}`}>{shownMarkFor(page!.name, r) === "mine" ? "✓ This is us" : "This is us"}</button>
                          <button type="button" className="g-pill g-pill--sm" disabled={markPending(r)} aria-pressed={shownMarkFor(page!.name, r) === "not_mine"} onClick={() => mark.mutate({ siteId, name: page!.name, url: r.url, verdict: markOf(r) === "not_mine" ? null : "not_mine", was: markOf(r) })} data-testid={`button-mention-notmine-${r.domain}`}>{shownMarkFor(page!.name, r) === "not_mine" ? "✓ Not us" : "Not us"}</button>
                          {r.linksToYou !== true && markOf(r) !== "not_mine" && !markPending(r) && <AddToPlan siteId={siteId} label="Plan" testId={`button-plan-mention-${r.domain}`} tasks={[task(r)]} />}
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

type VerdictTools = { of: (name: string, r: Row) => "mine" | "not_mine" | null; pending: (name: string, r: Row) => boolean; set: (name: string, r: Row, v: "mine" | "not_mine" | null) => void };
/** The monthly watch: on or off, the next date, and every page of the newest watched check, with the same verdicts. */
const WATCH_NOTE: Record<string, string> = {
  bad_name: "The watch is waiting: the name it follows can't be searched as written (use letters, numbers, spaces and & ' . , -). Look for mentions with the name written that way, and it follows that.",
  no_allowance: "The watch is waiting: this month's included SEO data has run out. It tries again daily and is never charged to credit you bought.",
  not_included: "The watch is waiting: your plan doesn't include the SEO tools right now.",
  no_name: "The watch is waiting: it has no name to follow (the business name was cleared). Look for mentions of a name, or switch the watch off.",
};
function WatchPanel({ siteId, name, watch, domain, retryPrice, verdict }: { siteId: number; name: string; watch: Watch; domain: string; retryPrice: number | null; verdict: VerdictTools }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [all, setAll] = useState(false);
  const set = useMutation({
    mutationFn: (v: { siteId: number; watch: boolean }) => api("POST", `/api/seo/sites/${v.siteId}/mentions/watch`, { watch: v.watch }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ predicate: mentionsOf(v.siteId) }); toast({ title: v.watch ? "Mentions watch is on" : "Mentions watch is off", description: v.watch ? "Once a month, from your included SEO data, new pages that use the name are looked for; likely ones raise an alert." : "Checks already made are kept." }); },
    onError: (e) => toast({ title: "Couldn't change that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const retry = useMutation({
    mutationFn: (v: { siteId: number; checkId: number }) => api("POST", `/api/seo/sites/${v.siteId}/mentions/watch/${v.checkId}/links`, {}),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ predicate: mentionsOf(v.siteId) }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Couldn't check the links", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const l = watch.latest;
  const rows = l?.page.rows ?? [];
  const shown = all ? rows : rows.slice(0, 10);
  const exportCsv = () => {
    const lines: (string | number | null)[][] = [["Searched name", "Page", "Website", "Title", "Published", "Names one of your places", "Your verdict on this page", "Link to your site (from any page of that website)", "Window from", "Window to"],
      ...rows.map((r) => [l!.page.name, r.url, r.domain, r.title, r.published, r.place, verdict.of(l!.page.name, r) ?? "", linkWord(r.linksToYou), l!.since.slice(0, 10), l!.takenAt.slice(0, 10)])];
    const blob = new Blob([lines.map((x) => x.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${domain}-new-mentions.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--g-divider)" }} data-testid="mentions-watch">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={set.isPending && set.variables?.siteId === siteId ? set.variables.watch : watch.watch} disabled={set.isPending || (!name && !watch.watch)} onChange={(e) => set.mutate({ siteId, watch: e.target.checked })} data-testid="checkbox-mentions-watch" /><span className="g-text">Watch for new mentions every month</span></label>
        <span className="g-text-2">{!name ? "Look for mentions once first, so the watch knows which name to follow." : watch.watch ? `Following "${name}".${watch.nextAt ? ` Next: ${fmtDate(watch.nextAt)}.` : ""}` : "From your included SEO data only; when that has run out it waits, and is never charged to credit you bought."}</span>
      </div>
      {watch.watch && watch.note && <p className="mt-1 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="mentions-watch-note">{WATCH_NOTE[watch.note] ?? "The watch is waiting and will try again."}</p>}
      {watch.missing && <p className="mt-1 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="mentions-watch-missing">The check this link is for isn't available (it may belong to another site). {l ? "Showing the newest check instead." : ""}</p>}
      {watch.watch && !l && !watch.note && !watch.missing && <p className="g-text-2 mt-1 text-[13px]" data-testid="mentions-watch-first">No watched check yet{watch.nextAt ? ` — the first runs on or after ${fmtDate(watch.nextAt)}` : ""}. It looks at pages published in the month before it.</p>}
      {watch.chosen && <p className="mt-1 text-[13px]" role="status" data-testid="mentions-watch-chosen">Showing the check an alert was raised from{l?.name ? ` (for "${l.name}")` : ""}. <a href={`/seo/mentions?site=${siteId}`} className="g-link">Show the newest</a></p>}
      {l && (
        <div className="mt-2 text-[13px]" data-testid="mentions-watch-latest">
          <p className="g-text-2">Pages that use "{l.page.name}", published between {fmtDate(l.since)} and {fmtDate(l.takenAt)}: {fmtNum(rows.length)}{(l.page as Page & { complete?: boolean }).complete === false ? " — more were published in this window than one check reads; the next check reads on through the same window" : ""}. Read by publication date, oldest first: a page the source has no date for is not seen, and pages published at the same moment or added to the window between checks can shift places, so a page can occasionally be missed.
            {rows.length > 0 && <button type="button" className="g-link ml-2" onClick={exportCsv} data-testid="button-mentions-watch-export">Export</button>}</p>
          {l.page.marksUnavailable && <p className="mt-1 text-[12px]" role="status" style={{ color: "#b06000" }}>Your "This is us / Not us" answers couldn't be loaded just now, so they aren't shown here or in the export — they are still saved.</p>}

          {!l.page.linksChecked && rows.length > 0 && <p className="mt-1 text-[12px]" role="status">Whether these websites link to you did not load (not charged). <button type="button" className="g-pill g-pill--sm" disabled={retry.isPending || retryPrice == null} onClick={() => retry.mutate({ siteId, checkId: l.id })} data-testid="button-mentions-watch-retry">Check the links again{retryPrice != null ? ` — up to ${money(retryPrice)}` : ""}</button></p>}
          {rows.length > 0 && (
            <ul className="mt-1 space-y-1">
              {shown.map((r) => {
                const v = verdict.of(l.page.name, r), busy = verdict.pending(l.page.name, r);
                return (
                  <li key={r.url} className="flex flex-wrap items-center gap-x-2">
                    <a href={r.url} className="g-link" target="_blank" rel="noreferrer">{r.domain}</a>
                    <span className="g-text-2 min-w-0 flex-1">— {r.title}{v === "mine" ? " · you confirmed this page" : v === "not_mine" ? " · marked another business" : r.place ? ` · names ${r.place}` : " · names none of your places"}{r.linksToYou === true ? " · its website links to you" : r.linksToYou === null ? " · link not known" : " · no link found"}</span>
                    <span className="inline-flex gap-1" role="group" aria-label={`Is this page on ${r.domain} about you?`} aria-busy={busy}>
                      <button type="button" className="g-pill g-pill--sm" disabled={busy} aria-pressed={v === "mine"} onClick={() => verdict.set(l.page.name, r, v === "mine" ? null : "mine")}>{v === "mine" ? "✓ This is us" : "This is us"}</button>
                      <button type="button" className="g-pill g-pill--sm" disabled={busy} aria-pressed={v === "not_mine"} onClick={() => verdict.set(l.page.name, r, v === "not_mine" ? null : "not_mine")}>{v === "not_mine" ? "✓ Not us" : "Not us"}</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {rows.length > 10 && <button type="button" className="g-link mt-1 text-[13px]" aria-expanded={all} onClick={() => setAll(!all)} data-testid="button-mentions-watch-all">{all ? "Show the first 10" : `Show all ${fmtNum(rows.length)}`}</button>}
        </div>
      )}
    </div>
  );
}
