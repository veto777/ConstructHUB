/**
 * Site audit → Rendering: the chosen pages fetched twice — as plain HTML and in a browser with JavaScript run — and
 * the two visits compared (server/seo/render-check.ts). It reports what those two visits saw; it does not measure
 * what Google renders or indexes, and says so. The price on the button is the most that can be charged; the check
 * runs in the background and this view asks for it until it is done.
 *
 * Every figure is a link (links.ts): a page to its row on the pages tab, a visit's figure to that row's details
 * (`page` in the address opens it), a count of results to the table narrowed to that result (`result`), a price or a
 * credit to Usage, the page limit to the note that explains it, and what a browser visit saw to the live page. On a
 * phone every cell carries its label.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, HIGHLIGHT, money, useSeoStatus, type SeoSite } from "./shell";
import { seoLinks } from "./links";
import { ActiveFilter, AMBER, CHEVRON, COMPACT_TABLE, DETAIL_CELL, FIG, type AuditParams, type Foreign } from "./viz-audit";

type Side = { status: number | null; finalUrl?: string | null; measured?: boolean; words: number | null; internalLinks: number | null; externalLinks: number | null; images: number | null; title: string | null; h1: string | null };
type Verdict = "same" | "more" | "less" | "unknown";
type Row = { url: string; plain: Side | null; rendered: Side | null; timing: { lcp: number | null; interactive: number | null; loaded: number | null } | null; problems: string[]; verdict: Verdict; why: string };
type Run = { id: number; status: "running" | "done" | "failed"; urls: string[]; result: { rows: Row[]; summary: { pages: number; more: number; less: number; same: number; unknown: number }; fetchedAt: string } | null; error: string | null; at: string };
type Data = { latest: Run | null; suggestions: string[]; max: number };

/** Amber for a page that differs once JavaScript runs (a warning), green for one that does not, grey when unknown. */
const VERDICT: Record<string, { label: string; color: string }> = {
  needs_js: { label: "More once JavaScript runs", color: AMBER },
  more: { label: "More once JavaScript runs", color: AMBER },
  less: { label: "Less once JavaScript runs", color: AMBER },
  same: { label: "Much the same", color: "var(--g-green)" },
  unknown: { label: "Could not be compared", color: "var(--g-text-2)" },
};
/** A verdict saved under a name this page does not know is said as that — never with the words of a real outcome. */
const verdictOf = (v: string) => (Object.prototype.hasOwnProperty.call(VERDICT, v) ? VERDICT[v] : { label: `Result not recognised (“${v}”)`, color: "var(--g-text-2)" });
/**
 * The results the table can be narrowed to (links.ts audit `result`), in the chip's words: "differ" is the summary's
 * "clearly different" (more or less), the others one result each. A check saved before the wording changed called
 * "more" needs_js.
 */
const RESULTS: Record<string, { words: string; test: (v: string) => boolean }> = {
  differ: { words: "Pages clearly different once JavaScript ran", test: (v) => v === "more" || v === "less" || v === "needs_js" },
  more: { words: "Pages with more once JavaScript ran", test: (v) => v === "more" || v === "needs_js" },
  less: { words: "Pages with less once JavaScript ran", test: (v) => v === "less" },
  same: { words: "Pages much the same", test: (v) => v === "same" },
  unknown: { words: "Pages that could not be compared", test: (v) => v === "unknown" },
};
const resultOf = (k: string | null) => (k && Object.prototype.hasOwnProperty.call(RESULTS, k) ? RESULTS[k] : null);
const n = (v: number | null | undefined) => (v == null ? "—" : fmtNum(v));
const secs = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
/** The path — with the host in front when the page is on a sub-domain, so two pages with the same path can be told apart. */
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
/** The path of a page of the site, as the pages tab names it. */
const pathOf = (u: string) => { try { const x = new URL(u); return (x.pathname || "/") + x.search; } catch { return u; } };
const noHash = (u: string) => { try { const x = new URL(u); x.hash = ""; return x.toString(); } catch { return u; } };
const said = (s: Side | null, what: "title" | "h1") => (!s ? "not fetched" : s.measured === false ? "not reported" : s[what] ?? "none");
/** "YYYY-MM" of a date, the month Usage lists a check's cost under. */
const monthOf = (iso: string) => iso.slice(0, 7);

export function RenderCheck({ site, pageHref, pageParam = null, resultParam = null, here, go, explain, foreign }: {
  site: SeoSite;
  /** A page of the site, its row opened on the pages tab (links.ts: audit `page`); absent when there is no crawl to open. */
  pageHref?: (path: string) => string;
  /** The page the address names on this tab: its visit's details are opened. */
  pageParam?: string | null;
  /** The result the address narrows the table to (links.ts: audit `result`). */
  resultParam?: string | null;
  /** The current address with one narrowing changed (the rendering tab's `page` opens a row's details, `result` narrows the table). */
  here: (p: AuditParams) => string;
  /** An address on the audit for this site (the outgoing-links tab, for the "links to other sites" figures). */
  go?: (p: AuditParams) => string;
  /** Arrived from "Performance: not measured" on the By-area card (links.ts: audit `area` Performance on this tab). */
  explain?: boolean;
  foreign?: Foreign;
}) {
  const status = useSeoStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site.id}/render`;
  const [activeId, setActiveId] = useState<number | null>(null);
  // The newest check is asked for again while one is going, every half minute otherwise, and when the window is looked
  // at again — so a check started in another tab, or one that finished meanwhile, is noticed without reloading.
  const q = useQuery<Data>({ queryKey: [key], refetchOnMount: "always", refetchOnWindowFocus: true, refetchInterval: (query) => (query.state.data?.latest?.status === "running" || activeId != null ? 5000 : 30_000) });
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  // The row whose details are open is the page the address names, so a link and a click are the same thing.
  const openRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => { setPicked([]); setExtra(""); setActiveId(null); }, [site.id]);
  // Nothing chosen yet: start with the first few pages offered (the home page first).
  useEffect(() => { if (q.data && !picked.length) setPicked(q.data.suggestions.slice(0, 3)); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const max = q.data?.max ?? 10;
  const typed = useMemo(() => extra.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean), [extra]);
  // Counted the way the server counts: a page once, whatever #part of it was pasted.
  const urls = useMemo(() => Array.from(new Set([...picked, ...typed].map(noHash))), [picked, typed]);
  // The server's own figure for exactly this many pages: what is set aside, and the most that can be charged.
  const price = urls.length ? status.data?.quotes?.render?.[urls.length - 1] ?? null : null;
  const available = status.data?.credits ? status.data.credits.availableCents : -1;
  const short = price != null && available !== -1 && available < price;

  const start = useMutation({
    mutationFn: (v: { siteId: number; urls: string[] }) => api("POST", `/api/seo/sites/${v.siteId}/render`, { urls: v.urls }),
    onSuccess: (d: { id: number; reused?: boolean }, v) => {
      if (v.siteId !== site.id) return;
      setActiveId(d.id); void qc.invalidateQueries({ queryKey: [key] });
      if (d.reused) toast({ title: "A check is already running for this site", description: "Showing that one. Start another when it finishes." });
    },
    onError: (e) => toast({ title: "Couldn't start the check", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // What the server says is the newest check decides what is on screen and whether one is running; the check this page
  // started is followed only until the server's answer includes it.
  const latest = q.data?.latest ?? null;
  useEffect(() => {
    if (activeId == null || !latest) return;
    if (latest.id > activeId || (latest.id === activeId && latest.status !== "running")) { setActiveId(null); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); }
  }, [latest?.id, latest?.status, activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const wasRunning = latest?.status === "running";
  useEffect(() => { if (!wasRunning) void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); }, [wasRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Running" is only what is known: this page's own request in flight, a check it started that the server has not
  // reported back yet, or the server saying one is running. When the server cannot be asked, that is said instead.
  // After a failed ask, the last answer is no longer evidence that a check is running: the form is given back (the
  // server refuses a second check while one really is running, and returns that one).
  const running = start.isPending || (!q.isError && (latest?.status === "running" || activeId != null));
  const run: Run | null = !running && latest && latest.status !== "running" ? latest : null;
  const toggle = (u: string) => setPicked((p) => (p.includes(u) ? p.filter((x) => x !== u) : [...p, u]));
  const configured = !!status.data?.configured;
  const rows = run?.status === "done" && run.result ? run.result.rows : [];
  const openRow = rows.find((r) => pathOf(r.url) === pageParam) ?? null;
  const pageInCheck = !!openRow;
  const result = resultOf(resultParam);
  // The table narrowed to the result the address names; the page it opens is always listed, whatever the result.
  const shownRows = resultParam ? rows.filter((r) => (result ? result.test(r.verdict) : false) || r === openRow) : rows;
  useEffect(() => { if (pageParam && openRow) openRef.current?.scrollIntoView({ block: "nearest" }); }, [pageParam, openRow?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Where a row's figures lead: the row's details, by the address. */
  const rowHref = (r: Row) => here({ page: openRow?.url === r.url ? undefined : pathOf(r.url) });
  const usage = seoLinks.usage();

  // What narrowed the view, said from the address at once (also while the check is read).
  const known = !q.isLoading && !(q.isError && !q.data);
  const words: string[] = [];
  if (explain) words.push("Why performance was not measured");
  if (resultParam) words.push(result ? result.words : `a result this check doesn't know (“${resultParam}”)`);
  if (pageParam) words.push(!known ? `Page ${pageParam}` : pageInCheck ? `Page ${pageParam} — its visits below` : `Page ${pageParam} — not in this check`);
  if (foreign) words.push(foreign.words);
  const clearHref = here({ page: undefined, area: undefined, result: undefined });
  const chip = words.length > 0 && (
    <ActiveFilter words={words.join(" · ")} clearHref={clearHref} extra={foreign ? { href: foreign.href, label: foreign.label, testId: "link-foreign-tab" } : undefined}>
      {explain ? <p>The crawl's speed check (PageSpeed, run on one page of the crawl) gave no score for this crawl, so the Performance area has no rating. The check below times one browser visit to each page you pick — when its main content was painted and when it finished loading. That is a measurement of those visits, not a score, and not what Google measures.</p> : null}
      {known && pageParam && !pageInCheck ? <p>{rows.length ? `The newest check did not visit ${pageParam}. Tick it (or paste its address) above and run a check to see it here.` : `There is no finished check to look in. Tick ${pageParam} (or paste its address) above and run one.`}</p> : null}
      {known && resultParam && !rows.length ? <p>There is no finished check to narrow.</p> : null}
    </ActiveFilter>
  );
  if (q.isLoading) return <>{chip}<p className="g-text-2 py-6 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p></>;
  if (q.isError && !q.data) return <>{chip}<div className="g-callout" role="alert"><h3>Couldn't load the rendering check</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div></>;

  return (
    <div data-testid="render-check">
      {chip}
      <section className="mb-4 rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }}>
        <h2 className="text-[14px] font-medium" style={{ color: "var(--g-blue)" }}>Your pages with and without JavaScript</h2>
        <p className="g-text-2 mt-1 max-w-3xl text-[13px]">Each page is fetched twice: once as plain HTML, which is all a simple crawler and many AI assistants read, and once in a browser with JavaScript run. If words or links only show up in the second visit, anything that reads the HTML alone misses them. This compares two visits made for you just now — it does not measure what Google itself renders or indexes.</p>
        <fieldset className="mt-3" disabled={running}>
          <legend className="g-text text-[13px] font-medium">Pages to check <span className="g-text-2 font-normal">(up to <Link href={`${here({})}#render-limit`} className={`g-text-2 ${FIG}`} title="Why there is a limit, in the note below" data-testid="link-render-max">{max}</Link>)</span></legend>
          <ul className="mt-1 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
            {(q.data?.suggestions ?? []).map((u) => (
              <li key={u} className="flex items-center gap-2"><label className="flex min-h-11 min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={picked.includes(u)} onChange={() => toggle(u)} data-testid={`check-render-${nameOf(u, site.domain)}`} /><span className="truncate" title={u}>{nameOf(u, site.domain)}</span></label>{pageHref && <Link href={pageHref(pathOf(u))} className={`g-link ${FIG} shrink-0 text-[12px]`} title={`${u} — its row on the pages tab`} data-testid={`link-render-pick-${nameOf(u, site.domain)}`}>its row</Link>}</li>
            ))}
          </ul>
          <label className="mt-2 block text-[13px]"><span className="g-text-2">Other pages of this site (full addresses, one per line)</span>
            <textarea className="g-input mt-1 block w-full max-w-xl" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={`https://${site.domain}/services`} data-testid="input-render-urls" />
          </label>
        </fieldset>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" disabled={running || !configured || !urls.length || urls.length > max || short || price == null} onClick={() => start.mutate({ siteId: site.id, urls })} data-testid="button-render-run">
            {running ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Checking…</> : `Check ${urls.length} page${urls.length === 1 ? "" : "s"}${price != null ? ` — up to ${money(price)}` : ""}`}
          </Button>
          {!running && price != null && <Link href={usage} className={`g-text-2 ${FIG} text-[13px]`} title="Prices, your credit and what each check cost, on Usage" data-testid="link-render-price">up to {money(price)}: the price and your credit</Link>}
          {running && <span className="g-text-2 text-[13px]" role="status">This takes about half a minute. You can leave this page; the result is kept.</span>}
          {!running && urls.length > max && <span className="text-[13px]" style={{ color: "var(--g-red)" }} role="alert">Choose <Link href={`${here({})}#render-limit`} className={FIG} title="Why there is a limit, in the note below" data-testid="link-render-max-alert">{max}</Link> pages or fewer.</span>}
          {!running && urls.length > 0 && urls.length <= max && price == null && configured && <span className="g-text-2 text-[13px]" role="status">{status.isLoading ? "Getting the price…" : "The price couldn't be loaded, so this can't be bought yet — reload the page."}</span>}
          {!running && short && urls.length <= max && <span className="text-[13px]" style={{ color: "var(--g-red)" }} role="alert">This needs <Link href={seoLinks.usage({ credits: "add" })} className={FIG} title="Add credit, on Usage" data-testid="link-render-needs">{money(price!)}</Link> of SEO data available and you have <Link href={usage} className={FIG} title="Your credit, on Usage" data-testid="link-render-have">{money(available)}</Link>.</span>}
          {!configured && status.isSuccess && <span className="g-text-2 text-[13px]">Lookups are not switched on for this account yet.</span>}
        </div>
        <p id="render-limit" className="g-text-2 mt-2 text-[12px]" data-testid="render-limit">A check visits at most {max} pages: each page is visited twice, once in a real browser, and the price is set by the number of pages (what each check cost is on <Link href={usage} className={`g-link ${FIG}`} data-testid="link-render-limit-usage">Usage</Link>).</p>
        {q.isError && <p className="mt-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="render-progress-error">Couldn't ask whether a check is running: {apiErrorMessage(q.error)} What is below may be out of date. <button type="button" className={`g-link ${FIG}`} onClick={() => { setActiveId(null); void q.refetch(); }}>Ask again</button></p>}
      </section>

      {run?.status === "failed" && <div className="g-callout g-callout--error mb-4" role="alert" data-testid="render-failed">{run.error ?? "The check could not be completed."}</div>}
      {run?.status === "done" && run.result && (() => {
        // A check saved before the wording changed counted "needs JavaScript" pages under another name.
        const s = run.result.summary, differ = (s.more ?? (s as { needsJs?: number }).needsJs ?? 0) + (s.less ?? 0);
        /** The table, narrowed to one result (or to none: every page checked), scrolled to. */
        const table = (result?: string) => `${here({ result })}#table-render`;
        return (
        <section data-testid="render-result">
          <p className="g-text mb-2 text-[13px]" data-testid="render-summary">
            Checked <Link href={seoLinks.usage({ month: monthOf(run.result.fetchedAt) })} className={FIG} title="This check and what it cost, on Usage" data-testid="link-render-checked">{fmtDate(run.result.fetchedAt)}</Link>: <Link href={table("differ")} className={`${FIG} font-semibold`} title="Only these pages, in the table below" data-testid="link-render-differ">{fmtNum(differ)}</Link> of <Link href={table()} className={FIG} title="Every page checked, listed below" data-testid="link-render-pages">{fmtNum(s.pages)} page{s.pages === 1 ? "" : "s"}</Link> {differ === 1 ? "was" : "were"} clearly different once JavaScript had run, <Link href={table("same")} className={FIG} title="Only these pages, in the table below" data-testid="link-render-same">{fmtNum(s.same)} much the same</Link>{s.unknown ? <>, <Link href={table("unknown")} className={FIG} title="Only these pages, in the table below" data-testid="link-render-unknown">{fmtNum(s.unknown)} could not be compared</Link></> : ""}.
          </p>
          <div className="overflow-x-auto">
            <table id="table-render" className={COMPACT_TABLE} data-testid="table-render">
              <thead>
                <tr><th rowSpan={2} aria-label="Show details" className="w-12" /><th rowSpan={2}>Page</th><th rowSpan={2}>Result</th><th colSpan={2} className="num">Words</th><th colSpan={2} className="num">Links to your own pages</th><th rowSpan={2} className="num" title="When the biggest thing on screen was painted, in the browser visit">Main content painted</th><th rowSpan={2} className="num" title="When the page finished loading, in the browser visit">Loaded</th></tr>
                <tr><th className="num">HTML</th><th className="num">Browser</th><th className="num">HTML</th><th className="num">Browser</th></tr>
              </thead>
              <tbody>
                {shownRows.length === 0 && <tr data-testid="render-none"><td /><td colSpan={8} className="g-text-2 !whitespace-normal">{result ? "No page of this check had this result." : "Nothing to show for a result this check doesn't know."} <Link href={table()} className={`g-link ${FIG}`} data-testid="link-render-all">Show every page checked</Link></td></tr>}
                {shownRows.map((r) => {
                  const isOpen = openRow?.url === r.url, name = nameOf(r.url, site.domain), href = rowHref(r), v = verdictOf(r.verdict);
                  const fig = (label: string, value: string, testId: string, title: string) => <td className="num" data-label={label}><Link href={href} className={FIG} title={title} data-testid={`${testId}-${name}`}>{value}</Link></td>;
                  return [
                    <tr key={r.url} data-testid={`row-render-${name}`} ref={isOpen ? openRef : undefined} style={isOpen ? HIGHLIGHT : undefined}>
                      <td><Link href={href} className={CHEVRON} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${name}`} data-testid={`button-render-${name}`}>{isOpen ? <ChevronDown /> : <ChevronRight />}</Link></td>
                      <td className="max-w-[18rem]" data-label="Page">{pageHref ? <Link href={pageHref(pathOf(r.url))} className={`g-link ${FIG} block truncate`} title={`${r.url} — its row on the pages tab`} data-testid={`link-render-page-${name}`}>{name}</Link> : <a href={r.url} className={`g-link ${FIG} block truncate`} target="_blank" rel="noreferrer" title={r.url} data-testid={`link-render-page-${name}`}>{name}</a>}</td>
                      <td data-label="Result"><span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: v.color }} aria-hidden /><Link href={href} className={FIG} title="Why, in the row's details" data-testid={`link-render-verdict-${name}`}>{v.label}</Link></td>
                      {fig("Words (HTML)", n(r.plain?.words), "link-render-words-html", "Words in the HTML visit — the row's details")}
                      {fig("Words (browser)", n(r.rendered?.words), "link-render-words-browser", "Words in the browser visit — the row's details")}
                      {fig("Own-page links (HTML)", n(r.plain?.internalLinks), "link-render-links-html", "Links to your own pages in the HTML visit — the row's details")}
                      {fig("Own-page links (browser)", n(r.rendered?.internalLinks), "link-render-links-browser", "Links to your own pages in the browser visit — the row's details")}
                      {fig("Main content painted", secs(r.timing?.lcp), "link-render-lcp", "From the one browser visit — the row's details")}
                      {fig("Loaded", secs(r.timing?.loaded), "link-render-loaded", "From the one browser visit — the row's details")}
                    </tr>,
                    isOpen && (
                      <tr key={`${r.url}-more`} data-testid={`detail-render-${name}`}><td /><td colSpan={8} className={`${DETAIL_CELL} !whitespace-normal`} data-label="Details">
                        <p className="g-text text-[13px]">{r.why}</p>
                        <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                          <div><dt className="g-text-2">Answer (HTML / browser)</dt><dd className="g-text"><a href={r.url} className={FIG} target="_blank" rel="noreferrer" title="What the page answers now, in a new tab" data-testid={`link-render-status-${name}`}>{r.plain?.status ?? "—"} / {r.rendered?.status ?? "—"}</a></dd></div>
                          <div><dt className="g-text-2">Where the browser visit ended</dt><dd className="g-text break-all">{r.rendered?.finalUrl ? <a href={r.rendered.finalUrl} className={`g-link ${FIG}`} target="_blank" rel="noreferrer" data-testid={`link-render-final-${name}`}>{r.rendered.finalUrl}</a> : "not reported"}</dd></div>
                          <div><dt className="g-text-2">Title in the HTML</dt><dd className="g-text">{pageHref ? <Link href={pageHref(pathOf(r.url))} className={FIG} title="The crawl's reading of this page — its row on the pages tab" data-testid={`link-render-title-html-${name}`}>{said(r.plain, "title")}</Link> : <a href={r.url} className={FIG} target="_blank" rel="noreferrer" data-testid={`link-render-title-html-${name}`}>{said(r.plain, "title")}</a>}</dd></div>
                          <div><dt className="g-text-2">Title in the browser visit</dt><dd className="g-text"><a href={r.rendered?.finalUrl ?? r.url} className={FIG} target="_blank" rel="noreferrer" title="The page as a browser shows it, in a new tab" data-testid={`link-render-title-browser-${name}`}>{said(r.rendered, "title")}</a></dd></div>
                          <div><dt className="g-text-2">Main heading in the HTML</dt><dd className="g-text">{pageHref ? <Link href={pageHref(pathOf(r.url))} className={FIG} title="The crawl's reading of this page — its row on the pages tab" data-testid={`link-render-h1-html-${name}`}>{said(r.plain, "h1")}</Link> : <a href={r.url} className={FIG} target="_blank" rel="noreferrer" data-testid={`link-render-h1-html-${name}`}>{said(r.plain, "h1")}</a>}</dd></div>
                          <div><dt className="g-text-2">Main heading in the browser visit</dt><dd className="g-text"><a href={r.rendered?.finalUrl ?? r.url} className={FIG} target="_blank" rel="noreferrer" title="The page as a browser shows it, in a new tab" data-testid={`link-render-h1-browser-${name}`}>{said(r.rendered, "h1")}</a></dd></div>
                          <div><dt className="g-text-2">Links to other sites (HTML / browser)</dt><dd className="g-text">{go ? <Link href={go({ tab: "outgoing" })} className={FIG} title="The other websites your pages link to, from the crawl's HTML" data-testid={`link-render-external-${name}`}>{n(r.plain?.externalLinks)} / {n(r.rendered?.externalLinks)}</Link> : <a href={r.url} className={FIG} target="_blank" rel="noreferrer" data-testid={`link-render-external-${name}`}>{n(r.plain?.externalLinks)} / {n(r.rendered?.externalLinks)}</a>}</dd></div>
                          <div><dt className="g-text-2">Images (HTML / browser)</dt><dd className="g-text">{pageHref ? <Link href={pageHref(pathOf(r.url))} className={FIG} title="The crawl's count for this page — its row on the pages tab" data-testid={`link-render-images-${name}`}>{n(r.plain?.images)} / {n(r.rendered?.images)}</Link> : <a href={r.url} className={FIG} target="_blank" rel="noreferrer" data-testid={`link-render-images-${name}`}>{n(r.plain?.images)} / {n(r.rendered?.images)}</a>}</dd></div>
                          <div><dt className="g-text-2">Usable after</dt><dd className="g-text"><a href={r.rendered?.finalUrl ?? r.url} className={FIG} target="_blank" rel="noreferrer" title="From the one browser visit; open the page to feel it yourself" data-testid={`link-render-interactive-${name}`}>{secs(r.timing?.interactive)}</a></dd></div>
                        </dl>
                        {r.problems.length > 0 && <p className="g-text mt-2 text-[13px]"><span className="g-text-2">Found in the browser visit:</span> <a href={r.rendered?.finalUrl ?? r.url} className={FIG} target="_blank" rel="noreferrer" title="On the page, in a new tab" data-testid={`link-render-problems-${name}`}>{r.problems.join(" · ")}</a></p>}
                      </td></tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="g-text-2 mt-2 text-[12px]">One visit each way, from a data centre, at the time shown — not Googlebot, and not your visitors. A page is only compared when both visits were answered normally and ended on the same page. "More" or "less" means at least half as many words or own-site links again one way or the other, or a title or main heading in one visit only. Timings are from that single browser visit.</p>
        </section>
        );
      })()}
      {!run && !running && <Empty testId="render-empty"><h3>No rendering check yet</h3><p>Choose the pages above and run the check.</p></Empty>}
    </div>
  );
}
