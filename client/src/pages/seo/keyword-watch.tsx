/**
 * Alerts → keyword watch (server/seo/keyword-watch.ts): a monthly snapshot of the searches the search data has a
 * site ranking for, compared with the one before — which it newly sees, and which it no longer sees. Off until
 * turned on; the monthly snapshot uses only the month's included data. Today's snapshot can also be taken now, at
 * the price on the button (one a day — asking again the same day shows the one there is).
 * The pair compared (`now`, `before`), the list shown (`watch` added | gone | pages) and "show all" (`watchAll`) are the
 * address (links.ts seoLinks.alerts), so an alert's "Open this comparison" is a link and the back button undoes a pick;
 * the chip (data-testid="active-filter") says what was picked. Every figure leads to its data: a search to the keywords
 * explorer in the snapshot's market, a position or visit estimate to the site's keywords in Site explorer, a page to its
 * keywords there, a count to the list it counts. Nothing is bought by arriving: the snapshot button is the one buyer.
 * On a phone the two snapshot pickers are 44 px tall and the tables become labelled cards (google.css, under 640 px)
 * rather than scrolling sideways.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { marketLabel } from "@shared/seo-markets";
import { api, fmtDate, fmtNum, money, useSeoStatus, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";
import { seoLinks } from "./links";
import { marketParams } from "./keyword-links";
import { hrefWith } from "./rank-params";
import { LINK, LINK_BLOCK } from "./viz-rank";

type Tab = "added" | "gone" | "pages";
const TAB_WORDS: Record<Tab, string> = { added: "the searches newly seen", gone: "the searches no longer seen", pages: "the changes by page" };

type Kw = { keyword: string; position: number | null; volume: number | null; traffic: number | null; path: string | null; was?: number | null };
type Side = { keywords: number; visits: number; unknown: number };
type PageChange = { id: string; path: string | null; url: string | null; cut: boolean; before: Side; after: Side; added: number; gone: number; movedIn: number; movedOut: number; pageNewlyGiven: number; pageNoLongerGiven: number };
type Comparison = { pages?: PageChange[]; since: string; takenOn: string; locationCode: number; languageCode: string; basis: "whole" | "top" | "unknown" | "none"; added: Kw[]; gone: Kw[]; now: { keywords: number; total: number | null }; before: { keywords: number; total: number | null } };
type Snap = { id: number; takenOn: string; keywords: number; total: number | null; whole: boolean | null; locationCode: number; languageCode: string };
export type KwPick = { siteId: number; now: number; before: number; /** Opened from an alert (a new number each time): focus moves to the comparison once it has loaded. */ fromAlert?: number };
type View = { pair: { nowId: number; beforeId: number; chosen: boolean; now: Snap; before: Snap } | null; snapshots: Snap[]; snapshotCount: number; watch: boolean; nextAt: string | null; rows: number; alertsOn: boolean; sameMarket: boolean; nextDayAt?: string; latest: { takenOn: string; keywords: number; total: number | null; whole: boolean | null; locationCode: number; languageCode: string; today: boolean } | null; comparison: Comparison | null };
const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };
/** The snapshot pickers: the 40 px select of these screens made 44 px tall (a thumb's size), never wider than the screen. */
const PICK = "g-input g-select !min-h-11 !w-auto min-w-0 max-w-full";

export function KeywordWatch({ site, onTrack, pick, onPick }: {
  site: SeoSite; /** Track a keyword in the rank tracker. */ onTrack?: (keywords: Kw[]) => void;
  /** Two snapshots to compare instead of the newest two (an alert opens its own); null = the newest two. */ pick?: KwPick | null; onPick?: (p: KwPick | null) => void;
}) {
  const status = useSeoStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site.id}/keyword-watch`;
  const mine = pick && pick.siteId === site.id ? pick : null;
  // Every variant of this site's view (the newest two, or a chosen pair) starts with `key`.
  const ofSite = (x: { queryKey: readonly unknown[] }) => typeof x.queryKey[0] === "string" && (x.queryKey[0] === key || x.queryKey[0].startsWith(`${key}?`));
  const q = useQuery<View>({
    queryKey: [mine ? `${key}?now=${mine.now}&before=${mine.before}` : key], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 30_000,
    // The previous figures stay up while another pair loads — for the same site only; actions wait for the real answer.
    placeholderData: (prev, prevQuery) => (prevQuery && ofSite(prevQuery) ? prev : undefined),
  });
  const placeholder = q.isPlaceholderData;
  // Opened from an alert: once that pair has loaded, keyboard and screen-reader focus moves to it (not on every pick —
  // choosing a snapshot in a select must leave focus in the select).
  const focusFor = mine?.fromAlert && q.data && !placeholder && q.data.pair?.nowId === mine.now && q.data.pair.beforeId === mine.before ? `${mine.now}-${mine.before}-${mine.fromAlert}` : null;
  useEffect(() => { if (focusFor) document.getElementById("keyword-watch-heading")?.focus({ preventScroll: true }); }, [focusFor]);
  // The list shown and "show all" are the address: a tab is a link, and the back button returns to the list before.
  const address = new URLSearchParams(useSearch());
  const watchParam = address.get("watch");
  const tab: Tab = watchParam === "gone" || watchParam === "pages" ? watchParam : "added";
  const watchAll = ["1", "true", "yes"].includes(address.get("watchAll") ?? "");
  const shown = watchAll ? Infinity : 50;
  const tabHref = (k: Tab) => hrefWith({ watch: k, watchAll: null });
  /** The newest two snapshots, the first list, the first rows: everything this panel reads from the address, cleared. */
  const newestHref = hrefWith({ now: null, before: null, watch: null, watchAll: null });
  // The day for snapshots changes at midnight UTC: when it does, what can be taken changes, so the panel asks again then.
  const boundary = q.data?.nextDayAt;
  useEffect(() => {
    if (!boundary) return;
    const ms = new Date(boundary).getTime() - Date.now();
    if (!(ms > 0) || ms > 36 * 3600_000) return;
    const t = setTimeout(() => void qc.invalidateQueries({ predicate: ofSite }), ms + 2000);
    return () => clearTimeout(t);
  }, [boundary, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const newDay = boundary ? new Date(boundary).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : null;
  // Refreshes the site the action was for (the screen may have moved to another site meanwhile).
  const done = (siteId = site.id) => { const k = `/api/seo/sites/${siteId}/keyword-watch`; void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && (x.queryKey[0] === k || x.queryKey[0].startsWith(`${k}?`)) }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith("/api/seo/alerts") }); };
  // A change of the watch setting in flight, per site: shown and guarded for its own site only, however many sites
  // have one going (the screen can move between sites while one is pending).
  const [pendingWatch, setPendingWatch] = useState<Record<number, boolean>>({});
  const set = useMutation({
    mutationFn: (v: { siteId: number; watch: boolean }) => api("POST", `/api/seo/sites/${v.siteId}/keyword-watch`, { watch: v.watch }),
    onMutate: (v) => setPendingWatch((m) => ({ ...m, [v.siteId]: v.watch })),
    onSettled: (_d, _e, v) => setPendingWatch((m) => { const { [v.siteId]: _gone, ...rest } = m; return rest; }),
    onSuccess: (_d: unknown, v) => { done(v.siteId); toast({ title: v.watch ? "Keyword watch is on" : "Keyword watch is off", description: v.watch ? "A snapshot is taken once a month from your included SEO data — the next date is shown here. From the second snapshot on, changes that qualify can raise an alert." : "Snapshots already taken are kept." }); },
    onError: (e) => toast({ title: "Couldn't change that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const snap = useMutation({
    mutationFn: (v: { siteId: number }) => api("POST", `/api/seo/sites/${v.siteId}/keyword-watch/snapshot`),
    onSuccess: (d: { keywords: number; reused?: boolean }, v) => { done(v.siteId); toast(d.reused ? { title: "Today's snapshot was already taken", description: "Showing that one — nothing was charged. One snapshot is kept per day." } : { title: "Snapshot taken", description: `${fmtNum(d.keywords)} keyword${d.keywords === 1 ? "" : "s"} saved.` }); },
    onError: (e, v) => { done(v.siteId); toast({ title: "Couldn't take the snapshot", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  // The figure set aside, which is also the most that can be charged; without it nothing is bought here.
  const price = (status.data?.holds as Record<string, number | undefined> | undefined)?.keywordSnapshot ?? null;
  const available = status.data?.credits ? status.data.credits.availableCents : -1;
  const canPay = price != null && (available === -1 || available >= price);
  if (q.isLoading) return <p className="g-text-2 mb-4 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading the keyword watch…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert" data-testid="keyword-watch-error">Couldn't load the keyword watch: {apiErrorMessage(q.error)} {mine && onPick ? <Link href={newestHref} className={LINK} data-testid="link-kw-newest">Show the newest two snapshots</Link> : <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button>}</p>;
  const d = q.data;
  if (!d) return null;
  const c = d.comparison, list = c && tab !== "pages" ? (tab === "added" ? c.added : c.gone) : [];
  const pages = c?.pages ?? [];
  // Visits: an estimate known for none of a page's keywords is "not known", not zero.
  const visits = (x: Side) => (x.keywords > 0 && x.unknown === x.keywords ? "—" : `${fmtNum(Math.round(x.visits))}${x.unknown > 0 ? "*" : ""}`);
  // Visits are compared only when every keyword on both sides has an estimate: a missing estimate is not a fall.
  const comparable = (p: PageChange) => p.before.unknown === 0 && p.after.unknown === 0;
  // A page that lost keywords — or, where they can be compared, visits — can go on the plan with what it rests on.
  // Its address must be known and fit a task; otherwise the row says why it cannot be planned.
  const declined = (p: PageChange) => p.after.keywords < p.before.keywords || (comparable(p) && p.after.visits < p.before.visits);
  // An address an older snapshot cut short may not be the page's real one: never planned as if it were.
  const plannable = (p: PageChange) => !!p.url && !p.cut && p.url.length <= 500;
  const words = c?.basis === "whole" ? { in: "newly seen", out: "no longer seen" } : c?.basis === "top" ? { in: `entered the top ${fmtNum(d.rows)}`, out: `left the top ${fmtNum(d.rows)}` } : { in: "in the newer snapshot only", out: "in the older snapshot only" };
  const pageTask = (p: PageChange): PlanTask => ({
    kind: "page", title: `Review ${p.path}: ${p.before.keywords} → ${p.after.keywords} keywords in the search data (${fmtDate(c!.since)} → ${fmtDate(c!.takenOn)})`.slice(0, 200),
    target: p.url,
    facts: {
      keywordsBefore: p.before.keywords, keywordsAfter: p.after.keywords,
      // Visits only where they can be compared; otherwise null, with how many keywords had no estimate.
      visitsBefore: comparable(p) ? Math.round(p.before.visits) : null, visitsAfter: comparable(p) ? Math.round(p.after.visits) : null, noEstimate: p.before.unknown + p.after.unknown,
      onlyInOlder: p.gone, nowAnotherPage: p.movedOut, since: c!.since, takenOn: c!.takenOn, basis: c!.basis, market: place(c!).slice(0, 60),
    },
    source: `kw-page:${d.pair?.beforeId}-${d.pair?.nowId}:${p.id}`,
  });
  const why = (p: PageChange) => [p.added && `${p.added} ${words.in}`, p.movedIn && `${p.movedIn} ${p.path === null ? "with no page given now" : "now with this page (another before)"}`, p.pageNewlyGiven && `${p.pageNewlyGiven} whose page was not given before`, p.gone && `${p.gone} ${words.out}`, p.movedOut && `${p.movedOut} ${p.path === null ? "with a page given now" : "now with another page"}`, p.pageNoLongerGiven && `${p.pageNoLongerGiven} whose page is not given now`].filter(Boolean).join(", ") || "same keywords";
  const whole = c?.basis === "whole";
  const place = (x: { locationCode: number; languageCode: string }) => marketLabel(x.locationCode, x.languageCode);
  const snapLabel = (x: Snap) => `${fmtDate(x.takenOn)} — ${fmtNum(x.keywords)} keyword${x.keywords === 1 ? "" : "s"}${x.whole === false ? " (cut at the limit)" : x.whole === null ? " (total not known)" : ""}`;
  // The pair shown, from the answer itself (it can be older than the listed snapshots); the lists gain them if missing.
  const nowSnap = d.pair?.now, beforeSnap = d.pair?.before;
  const withPair = (list: Snap[], extra?: Snap) => (extra && !list.some((x) => x.id === extra.id) ? [...list, extra].sort((a, b) => (a.takenOn < b.takenOn ? 1 : -1)) : list);
  const choose = (now: number, before: number) => onPick?.({ siteId: site.id, now, before });
  // Earlier snapshots that can be compared with the chosen "now" one: the same country and language only.
  const earlier = (n: Snap) => d.snapshots.filter((x) => x.takenOn < n.takenOn);
  // Where the figures lead. A snapshot is a copy of the data's keyword list for the site on its day; that list as it is
  // now is Site explorer's keywords view, and one keyword's row in it is the place of its position and visit estimate.
  const siteKeywords = (x: { locationCode: number }, extra: { contains?: string; path?: string } = {}) => seoLinks.explorer(site.domain, "keywords", { ...(x.locationCode === 2840 ? {} : { locationCode: x.locationCode }), ...extra });
  const sitePage = (path: string) => seoLinks.explorer(site.domain, "pages", { path });
  const kwHref = (k: Kw, x: { locationCode: number; languageCode: string }) => seoLinks.keywords(k.keyword, marketParams(x));
  // The chip: what the address picked here — a pair other than the newest two, a list other than the first, every row.
  const chip = [d.pair?.chosen && nowSnap && beforeSnap ? `the snapshots of ${fmtDate(nowSnap.takenOn)} and ${fmtDate(beforeSnap.takenOn)}` : "", watchParam && tab !== "added" ? TAB_WORDS[tab] : "", watchParam && !(watchParam === "gone" || watchParam === "pages" || watchParam === "added") ? `“${watchParam}” is not a list here, so the first is shown` : "", watchAll ? "every row" : ""].filter(Boolean).join(" · ");
  return (
    <section className="mb-6 rounded-lg border p-4" style={card} data-testid="keyword-watch">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="keyword-watch-heading" tabIndex={-1} className="g-text text-[16px] font-medium outline-none">Searches newly seen, and no longer seen, for {site.domain}</h2>
          <p className="g-text-2 mt-1 max-w-3xl text-[13px]">Once a month, a snapshot of the searches our search data has the site ranking for — up to its {fmtNum(d.rows)} highest-traffic ones — is compared with the snapshot before it. It goes beyond the keywords you track, but it is the data's view, not Google's own: a search can be "newly seen" because the data started measuring it, and "no longer seen" while the site still ranks. The monthly snapshot uses your included SEO data only{price != null ? ` (up to ${money(price)} each)` : ""}; when that has run out it is skipped, never charged to credit you bought.</p>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-[13px]"><input type="checkbox" checked={pendingWatch[site.id] ?? d.watch} aria-busy={pendingWatch[site.id] !== undefined} disabled={placeholder} onChange={(e) => { if (pendingWatch[site.id] === undefined && !placeholder) set.mutate({ siteId: site.id, watch: e.target.checked }); }} data-testid="checkbox-keyword-watch" /><span className="g-text">Watch every month</span></label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
        <span className="g-text-2" data-testid="text-keyword-watch-state">
          {d.latest ? <>Last snapshot <Link href={siteKeywords(d.latest)} className={LINK} title="The data's keyword list for the site as it is now, in Site explorer (a snapshot is a copy of it on its day)" data-testid="link-kw-latest-date">{fmtDate(d.latest.takenOn)}</Link> ({place(d.latest)}): <Link href={siteKeywords(d.latest)} className={LINK} title="The data's keyword list for the site as it is now, in Site explorer (a snapshot is a copy of it on its day)" data-testid="link-kw-latest">{fmtNum(d.latest.keywords)} keyword{d.latest.keywords === 1 ? "" : "s"}</Link>{d.latest.total != null && d.latest.whole === false ? <> of <Link href={siteKeywords(d.latest)} className={LINK} title="Every keyword the data has for the site, in Site explorer" data-testid="link-kw-total">the {fmtNum(d.latest.total)} the data has for the site</Link></> : ""}.</> : "No snapshot yet."}
          {d.watch && d.nextAt ? <> Next: <Link href={seoLinks.usage()} className={LINK} title="Usage and credit: the included data the monthly snapshot uses" data-testid="link-kw-next">{fmtDate(d.nextAt)}</Link>.</> : ""}
        </span>
        {d.latest?.today ? <span className="g-text-2" data-testid="text-keyword-snapshot-today">The snapshot for today has been taken (one a day; days change at midnight UTC{newDay ? ` — ${newDay} for you` : ""}).</span> : (
          <button type="button" className="g-pill g-pill--sm max-sm:!min-h-11" disabled={snap.isPending || placeholder || !status.data?.configured || !canPay} onClick={() => snap.mutate({ siteId: site.id })} data-testid="button-keyword-snapshot">
            {snap.isPending ? <Loader2 className="animate-spin" /> : null} {snap.isPending ? "Taking it…" : `Take a snapshot now${price != null ? ` — up to ${money(price)}` : ""}`}
          </button>
        )}
        {!d.latest?.today && price == null && status.isSuccess && <span className="g-text-2">The price couldn't be loaded, so a snapshot can't be bought yet — reload the page.</span>}
        {!d.latest?.today && price != null && !canPay && <span style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit above.</span>}
      </div>
      {!d.alertsOn && d.watch && <p className="g-text-2 mt-2 text-[13px]" role="status" data-testid="keyword-watch-alerts-off">Alerts are switched off for this site (Rank tracker → Tracking settings), so changes are shown here but not sent.</p>}
      {d.latest && !d.sameMarket && <p className="mt-2 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="keyword-watch-other-market">These snapshots were taken for {place(d.latest)}; the site is now tracked in another country or language. The next snapshot starts a new comparison.</p>}
      {d.snapshots.length >= 2 && onPick && nowSnap && beforeSnap && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="keyword-watch-pick" aria-busy={q.isFetching}>
          <label className="flex min-w-0 max-w-full items-center gap-1"><span className="g-text-2">Compare</span>
            <select className={PICK} value={nowSnap.id} data-testid="select-kw-now"
              onChange={(e) => { const n = d.snapshots.find((x) => x.id === Number(e.target.value))!; const b = earlier(n).find((x) => x.locationCode === n.locationCode && x.languageCode === n.languageCode) ?? earlier(n)[0]; if (b) choose(n.id, b.id); }}>
              {withPair(d.snapshots.filter((x) => earlier(x).length > 0), nowSnap).map((x) => <option key={x.id} value={x.id}>{snapLabel(x)}</option>)}
            </select></label>
          <label className="flex min-w-0 max-w-full items-center gap-1"><span className="g-text-2">with</span>
            <select className={PICK} value={beforeSnap.id} data-testid="select-kw-before" onChange={(e) => choose(nowSnap.id, Number(e.target.value))}>
              {withPair(earlier(nowSnap), beforeSnap).map((x) => <option key={x.id} value={x.id}>{snapLabel(x)}{x.locationCode !== nowSnap.locationCode || x.languageCode !== nowSnap.languageCode ? " · other country" : ""}</option>)}
            </select></label>
          {placeholder && <span className="sr-only" role="status">Loading the comparison…</span>}
          {q.isFetching && <span className="g-text-2 text-[12px]" role="status">Loading…</span>}
          <span className="g-text-2 w-full text-[12px]">{fmtNum(d.snapshotCount)} snapshot{d.snapshotCount === 1 ? "" : "s"} on record{d.snapshotCount > d.snapshots.length ? `; the newest ${fmtNum(d.snapshots.length)} can be chosen here` : ""}. Snapshots are never rewritten, so a comparison of two of them always shows the same thing.</span>
        </div>
      )}
      {chip && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px]" role="status" data-testid="active-filter">
          <span className="g-chip !min-h-8 !whitespace-normal py-1 font-normal [overflow-wrap:anywhere]" style={{ textTransform: "none" }}>Keyword watch: {chip}</span>
          <Link href={newestHref} className={`${LINK} font-medium`} title="The newest two snapshots, the first list" data-testid="link-kw-newest">Back to the newest two</Link>
        </p>
      )}
      {d.latest && !c && <p className="g-text-2 mt-3 text-[13px]" data-testid="keyword-watch-first">One snapshot so far, so there is nothing to compare yet. The next one shows what changed.</p>}
      {c && c.basis === "none" && <p className="g-text-2 mt-3 text-[13px]" role="status">{d.pair?.chosen ? "These two snapshots" : "The last two snapshots"} were taken for different countries or languages, so they are not compared.</p>}
      {c && c.basis !== "none" && (
        <div className="mt-3">
          <p className="g-text mb-2 text-[13px]" data-testid="text-keyword-watch-summary">
            {/* Each count is a link to the list it counts; a snapshot's date to the data's list for the site as it is now. */}
            Between <Link href={siteKeywords(c)} className={LINK} title="The data's keyword list for the site as it is now, in Site explorer (the older snapshot is a copy of it on its day)" data-testid="link-kw-since">{fmtDate(c.since)}</Link> and <Link href={siteKeywords(c)} className={LINK} title="The data's keyword list for the site as it is now, in Site explorer (the newer snapshot is a copy of it on its day)" data-testid="link-kw-taken">{fmtDate(c.takenOn)}</Link> ({place(c)}): {whole
              ? <>the data newly sees the site ranking for <Link href={tabHref("added")} className={`${LINK} font-medium`} title="The searches newly seen, listed" data-testid="link-kw-added">{fmtNum(c.added.length)}</Link> search{c.added.length === 1 ? "" : "es"} and no longer sees it for <Link href={tabHref("gone")} className={`${LINK} font-medium`} title="The searches no longer seen, listed" data-testid="link-kw-gone">{fmtNum(c.gone.length)}</Link>.</>
              : c.basis === "top"
                ? <><Link href={tabHref("added")} className={`${LINK} font-medium`} title="The searches that entered the top, listed" data-testid="link-kw-added">{fmtNum(c.added.length)}</Link> search{c.added.length === 1 ? "" : "es"} entered the site's <Link href={siteKeywords(c)} className={LINK} title="The site's keywords in Site explorer, as the data has them now" data-testid="link-kw-top-rows">{fmtNum(d.rows)} highest-traffic keywords</Link> and <Link href={tabHref("gone")} className={`${LINK} font-medium`} title="The searches that left the top, listed" data-testid="link-kw-gone">{fmtNum(c.gone.length)}</Link> left them. The data has more keywords for the site than a snapshot holds, so one that left may still be there lower down — no alert is sent on this.</>
                : <><Link href={tabHref("added")} className={`${LINK} font-medium`} title="The searches in the newer snapshot only, listed" data-testid="link-kw-added">{fmtNum(c.added.length)}</Link> search{c.added.length === 1 ? " is" : "es are"} in the newer snapshot only and <Link href={tabHref("gone")} className={`${LINK} font-medium`} title="The searches in the older snapshot only, listed" data-testid="link-kw-gone">{fmtNum(c.gone.length)}</Link> in the older only. The data did not say how many keywords it has for the site in all, so it is not known whether either snapshot is the whole of it — no alert is sent on this.</>}
          </p>
          {/* The tabs are addresses (?watch=): a tab is a link, so the back button returns to the list before. */}
          <nav className="g-tabs" aria-label="What changed">
            {([["added", whole ? `Newly seen (${c.added.length})` : c.basis === "top" ? `Entered the top (${c.added.length})` : `In the newer only (${c.added.length})`], ["gone", whole ? `No longer seen (${c.gone.length})` : c.basis === "top" ? `Left the top (${c.gone.length})` : `In the older only (${c.gone.length})`], ["pages", `By page (${pages.length})`]] as const).map(([k, label]) => <Link key={k} href={tabHref(k)} aria-current={tab === k ? "page" : undefined} className="max-sm:!min-h-11" data-testid={`tab-keyword-watch-${k}`}>{label}</Link>)}
          </nav>
          {/* Each table scrolls sideways only from 640 px; on a phone its rows are labelled cards (data-label), so nothing does. */}
          {tab === "pages" ? (pages.length === 0 ? <p className="g-text-2 text-[13px]">No pages in these snapshots.</p> : (
            <div className="sm:overflow-x-auto">
              <p className="g-text-2 mb-2 text-[12px]">Each page of the site with the keywords the data has it ranking for in each snapshot, and the visits those keywords are estimated to bring. Biggest change in visits first.{c.basis !== "whole" ? ` ${c.basis === "top" ? `Only the ${fmtNum(d.rows)} highest-traffic keywords of each snapshot are counted, so a page's smaller keywords may be missing on either side.` : "Whether either snapshot holds every keyword the data has for the site is not known."}` : ""}</p>
              <table className="g-table w-full" data-testid="table-keyword-watch-pages">
                <thead><tr><th>Page</th><th className="num">Keywords {fmtDate(c.since)}</th><th className="num">Keywords {fmtDate(c.takenOn)}</th><th className="num" title="Estimated visits a month">Est. visits {fmtDate(c.since)}</th><th className="num" title="Estimated visits a month">Est. visits {fmtDate(c.takenOn)}</th><th>What moved</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                <tbody>
                  {pages.slice(0, shown).map((p, n) => {
                    // A page with a path has a place: its row in Site explorer's pages view, and the site's keywords narrowed to it (where its figures live).
                    const kwOf = p.path ? siteKeywords(c, { path: p.path }) : null;
                    const fig = (body: React.ReactNode, id: string, title: string) => (kwOf ? <Link href={kwOf} className={LINK} title={title} data-testid={`link-kwpage-${id}-${n}`}>{body}</Link> : body);
                    return (
                    <tr key={p.id}>
                      <td className="max-w-[18rem] !whitespace-normal break-all" data-label="Page">{p.path ? <Link href={sitePage(p.path)} className={LINK_BLOCK} title={`${p.url ?? p.path} — this page in Site explorer`} data-testid={`link-kwpage-${n}`}>{p.path}</Link> : <span className="g-text-2">page not given</span>}{p.cut && <span className="g-text-2 block text-[11px]">address kept only to 300 characters in an older snapshot</span>}</td>
                      <td className="num" data-label={`Keywords ${fmtDate(c.since)}`}>{fig(fmtNum(p.before.keywords), "before", "The site's keywords for this page in the data now, in Site explorer")}</td><td className="num" data-label={`Keywords ${fmtDate(c.takenOn)}`}>{fig(fmtNum(p.after.keywords), "after", "The site's keywords for this page in the data now, in Site explorer")}</td>
                      <td className="num" data-label={`Est. visits ${fmtDate(c.since)}`}>{fig(visits(p.before), "visits-before", "The keywords these visits are estimated from, in Site explorer")}</td><td className="num" data-label={`Est. visits ${fmtDate(c.takenOn)}`}>{fig(visits(p.after), "visits-after", "The keywords these visits are estimated from, in Site explorer")}</td>
                      <td className="g-text-2 !whitespace-normal text-[12px]" data-label="What moved">{fig(why(p), "moved", "The site's keywords for this page in the data now, in Site explorer")}</td>
                      <td className="num">{declined(p) && (plannable(p) ? <AddToPlan siteId={site.id} label="Plan" testId={`button-plan-kwpage-${p.id}`} tasks={[pageTask(p)]} /> : <span className="g-text-2 text-[12px]">{p.cut ? "Address incomplete — not planned" : p.url ? "Address too long to plan" : "Page not known"}</span>)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {pages.length > shown && <Link href={hrefWith({ watchAll: true })} className={`${LINK} mt-1 text-[13px]`} data-testid="button-keyword-watch-pages-all">Show all {fmtNum(pages.length)}</Link>}
              {pages.some((p) => p.before.unknown + p.after.unknown > 0) && <p className="g-text-2 mt-1 text-[12px]">* Some of the page's keywords had no visit estimate; the figure adds up the ones that had. "—" = no estimate for any of them.</p>}
            </div>
          )) : list.length === 0 ? <p className="g-text-2 text-[13px]">None.</p> : (
            <div className="sm:overflow-x-auto">
              <table className="g-table w-full" data-testid={`table-keyword-watch-${tab}`}>
                <thead><tr><th>Keyword</th><th className="num">{tab === "added" ? `Position ${fmtDate(c.takenOn)}` : `Position ${fmtDate(c.since)}`}</th><th className="num">Volume / mo</th><th className="num" title="Estimated visits a month from this search">Est. visits</th><th>Page</th>{tab === "added" && onTrack && <th><span className="sr-only">Track</span></th>}</tr></thead>
                <tbody>
                  {list.slice(0, shown).map((k, n) => {
                    // The search opens in the keywords explorer in the snapshot's market; its position and visit estimate are its row among the site's keywords in Site explorer.
                    const row = siteKeywords(c, { contains: k.keyword }), pos = (tab === "added" ? k.position : k.was) ?? null;
                    return (
                    <tr key={k.keyword}>
                      <td><Link href={kwHref(k, c)} className={LINK} title="This search in the keywords explorer" data-testid={`link-kw-${tab}-${n}`}>{k.keyword}</Link></td>
                      <td className="num" data-label={tab === "added" ? `Position ${fmtDate(c.takenOn)}` : `Position ${fmtDate(c.since)}`}>{pos == null ? <span title="No position in that snapshot">—</span> : <Link href={row} className={LINK} title="This search among the site's keywords in Site explorer (the data's position now)" data-testid={`link-kw-${tab}-position-${n}`}>{pos}</Link>}</td>
                      <td className="num" data-label="Volume / mo"><Link href={kwHref(k, c)} className={LINK} title="This search in the keywords explorer" data-testid={`link-kw-${tab}-volume-${n}`}>{fmtNum(k.volume)}</Link></td>
                      <td className="num" data-label="Est. visits">{k.traffic == null ? <span title="No visit estimate in that snapshot">—</span> : <Link href={row} className={LINK} title="This search among the site's keywords in Site explorer (the data's estimate now)" data-testid={`link-kw-${tab}-visits-${n}`}>{fmtNum(Math.round(k.traffic))}</Link>}</td>
                      <td className="max-w-[16rem] truncate g-text-2" title={k.path ?? undefined} data-label="Page">{k.path ? <Link href={sitePage(k.path)} className={LINK_BLOCK} title={`${k.path} — this page in Site explorer`} data-testid={`link-kw-${tab}-page-${n}`}>{k.path}</Link> : "—"}</td>
                      {tab === "added" && onTrack && <td className="num"><button type="button" className="g-pill g-pill--sm max-sm:!min-h-11" onClick={() => onTrack([k])} aria-label={`Track ${k.keyword} in the rank tracker`}>Track</button></td>}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {list.length > shown && <Link href={hrefWith({ watchAll: true })} className={`${LINK} mt-1 text-[13px]`} data-testid="button-keyword-watch-all">Show all {fmtNum(list.length)}</Link>}
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">Positions and visits are the data's estimates at each snapshot. To know where the site stands on Google for a search, track it in the rank tracker — that checks Google itself.</p>
        </div>
      )}
    </section>
  );
}
