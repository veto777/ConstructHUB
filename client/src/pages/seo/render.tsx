/**
 * Site audit → Rendering: the chosen pages fetched twice — as plain HTML and in a browser with JavaScript run — and
 * the two visits compared (server/seo/render-check.ts). It reports what those two visits saw; it does not measure
 * what Google renders or indexes, and says so. The price on the button is the most that can be charged; the check
 * runs in the background and this view asks for it until it is done.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, money, useSeoStatus, type SeoSite } from "./shell";

type Side = { status: number | null; finalUrl?: string | null; measured?: boolean; words: number | null; internalLinks: number | null; externalLinks: number | null; images: number | null; title: string | null; h1: string | null };
type Verdict = "same" | "more" | "less" | "unknown";
type Row = { url: string; plain: Side | null; rendered: Side | null; timing: { lcp: number | null; interactive: number | null; loaded: number | null } | null; problems: string[]; verdict: Verdict; why: string };
type Run = { id: number; status: "running" | "done" | "failed"; urls: string[]; result: { rows: Row[]; summary: { pages: number; more: number; less: number; same: number; unknown: number }; fetchedAt: string } | null; error: string | null; at: string };
type Data = { latest: Run | null; suggestions: string[]; max: number };

const VERDICT: Record<string, { label: string; color: string }> = {
  needs_js: { label: "More once JavaScript runs", color: "#e8710a" },
  more: { label: "More once JavaScript runs", color: "#e8710a" },
  less: { label: "Less once JavaScript runs", color: "#e8710a" },
  same: { label: "Much the same", color: "var(--g-green)" },
  unknown: { label: "Could not be compared", color: "var(--g-text-2)" },
};
const n = (v: number | null | undefined) => (v == null ? "—" : fmtNum(v));
const secs = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
/** The path — with the host in front when the page is on a sub-domain, so two pages with the same path can be told apart. */
const nameOf = (u: string, domain: string) => { try { const x = new URL(u); const path = (x.pathname + x.search) || "/"; return bare(x.hostname) === bare(domain) ? path : `${x.hostname}${path}`; } catch { return u; } };
const noHash = (u: string) => { try { const x = new URL(u); x.hash = ""; return x.toString(); } catch { return u; } };
const said = (s: Side | null, what: "title" | "h1") => (!s ? "not fetched" : s.measured === false ? "not reported" : s[what] ?? "none");

export function RenderCheck({ site }: { site: SeoSite }) {
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
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setPicked([]); setExtra(""); setActiveId(null); setOpen(null); }, [site.id]);
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
  const running = start.isPending || latest?.status === "running" || (activeId != null && !q.isError);
  const run: Run | null = !running && latest && latest.status !== "running" ? latest : null;
  const toggle = (u: string) => setPicked((p) => (p.includes(u) ? p.filter((x) => x !== u) : [...p, u]));
  const configured = !!status.data?.configured;

  if (q.isLoading) return <p className="g-text-2 py-6 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError && !q.data) return <div className="g-callout" role="alert"><h3>Couldn't load the rendering check</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>;

  return (
    <div data-testid="render-check">
      <section className="mb-4 rounded-lg border p-4" style={{ borderColor: "var(--g-divider)" }}>
        <h2 className="g-text text-[16px] font-medium">Your pages with and without JavaScript</h2>
        <p className="g-text-2 mt-1 max-w-3xl text-[13px]">Each page is fetched twice: once as plain HTML, which is all a simple crawler and many AI assistants read, and once in a browser with JavaScript run. If words or links only show up in the second visit, anything that reads the HTML alone misses them. This compares two visits made for you just now — it does not measure what Google itself renders or indexes.</p>
        <fieldset className="mt-3" disabled={running}>
          <legend className="g-text text-[13px] font-medium">Pages to check <span className="g-text-2 font-normal">(up to {max})</span></legend>
          <ul className="mt-1 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
            {(q.data?.suggestions ?? []).map((u) => (
              <li key={u}><label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={picked.includes(u)} onChange={() => toggle(u)} data-testid={`check-render-${nameOf(u, site.domain)}`} /><span className="truncate" title={u}>{nameOf(u, site.domain)}</span></label></li>
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
          {running && <span className="g-text-2 text-[13px]" role="status">This takes about half a minute. You can leave this page; the result is kept.</span>}
          {!running && urls.length > max && <span className="text-[13px]" style={{ color: "var(--g-red)" }} role="alert">Choose {max} pages or fewer.</span>}
          {!running && urls.length > 0 && urls.length <= max && price == null && configured && <span className="g-text-2 text-[13px]" role="status">{status.isLoading ? "Getting the price…" : "The price couldn't be loaded, so this can't be bought yet — reload the page."}</span>}
          {!running && short && urls.length <= max && <span className="text-[13px]" style={{ color: "var(--g-red)" }} role="alert">This needs {money(price!)} of SEO data available and you have {money(available)}.</span>}
          {!configured && status.isSuccess && <span className="g-text-2 text-[13px]">Lookups are not switched on for this account yet.</span>}
        </div>
        {q.isError && <p className="mt-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="render-progress-error">Couldn't ask whether a check is running: {apiErrorMessage(q.error)} What is below may be out of date. <button type="button" className="g-link" onClick={() => { setActiveId(null); void q.refetch(); }}>Ask again</button></p>}
      </section>

      {run?.status === "failed" && <div className="g-callout g-callout--error mb-4" role="alert" data-testid="render-failed">{run.error ?? "The check could not be completed."}</div>}
      {run?.status === "done" && run.result && (() => {
        // A check saved before the wording changed counted "needs JavaScript" pages under another name.
        const s = run.result.summary, differ = (s.more ?? (s as { needsJs?: number }).needsJs ?? 0) + (s.less ?? 0);
        return (
        <section data-testid="render-result">
          <p className="g-text mb-2 text-[13px]" data-testid="render-summary">
            Checked {fmtDate(run.result.fetchedAt)}: <strong>{differ}</strong> of {s.pages} page{s.pages === 1 ? "" : "s"} {differ === 1 ? "was" : "were"} clearly different once JavaScript had run, {s.same} much the same{s.unknown ? `, ${s.unknown} could not be compared` : ""}.
          </p>
          <div className="overflow-x-auto">
            <table className="g-table w-full" data-testid="table-render">
              <thead>
                <tr><th rowSpan={2}>Page</th><th rowSpan={2}>Result</th><th colSpan={2} className="num">Words</th><th colSpan={2} className="num">Links to your own pages</th><th rowSpan={2} className="num" title="When the biggest thing on screen was painted, in the browser visit">Main content painted</th><th rowSpan={2} className="num" title="When the page finished loading, in the browser visit">Loaded</th></tr>
                <tr><th className="num">HTML</th><th className="num">Browser</th><th className="num">HTML</th><th className="num">Browser</th></tr>
              </thead>
              <tbody>
                {run.result.rows.map((r) => {
                  const isOpen = open === r.url, name = nameOf(r.url, site.domain);
                  return [
                    <tr key={r.url} data-testid={`row-render-${name}`}>
                      <td className="max-w-[18rem]"><button type="button" className="g-link truncate text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.url)} title={r.url}>{name}</button></td>
                      <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: VERDICT[r.verdict]?.color }} aria-hidden />{VERDICT[r.verdict]?.label ?? "Could not be compared"}</td>
                      <td className="num">{n(r.plain?.words)}</td><td className="num">{n(r.rendered?.words)}</td>
                      <td className="num">{n(r.plain?.internalLinks)}</td><td className="num">{n(r.rendered?.internalLinks)}</td>
                      <td className="num">{secs(r.timing?.lcp)}</td><td className="num">{secs(r.timing?.loaded)}</td>
                    </tr>,
                    isOpen && (
                      <tr key={`${r.url}-more`}><td colSpan={8} className="!whitespace-normal">
                        <p className="g-text text-[13px]">{r.why}</p>
                        <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                          <div><dt className="g-text-2">Answer (HTML / browser)</dt><dd className="g-text">{r.plain?.status ?? "—"} / {r.rendered?.status ?? "—"}</dd></div>
                          <div><dt className="g-text-2">Where the browser visit ended</dt><dd className="g-text break-all">{r.rendered?.finalUrl ?? "not reported"}</dd></div>
                          <div><dt className="g-text-2">Title in the HTML</dt><dd className="g-text">{said(r.plain, "title")}</dd></div>
                          <div><dt className="g-text-2">Title in the browser visit</dt><dd className="g-text">{said(r.rendered, "title")}</dd></div>
                          <div><dt className="g-text-2">Main heading in the HTML</dt><dd className="g-text">{said(r.plain, "h1")}</dd></div>
                          <div><dt className="g-text-2">Main heading in the browser visit</dt><dd className="g-text">{said(r.rendered, "h1")}</dd></div>
                          <div><dt className="g-text-2">Links to other sites (HTML / browser)</dt><dd className="g-text">{n(r.plain?.externalLinks)} / {n(r.rendered?.externalLinks)}</dd></div>
                          <div><dt className="g-text-2">Images (HTML / browser)</dt><dd className="g-text">{n(r.plain?.images)} / {n(r.rendered?.images)}</dd></div>
                          <div><dt className="g-text-2">Usable after</dt><dd className="g-text">{secs(r.timing?.interactive)}</dd></div>
                        </dl>
                        {r.problems.length > 0 && <p className="g-text mt-2 text-[13px]"><span className="g-text-2">Found in the browser visit:</span> {r.problems.join(" · ")}</p>}
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
