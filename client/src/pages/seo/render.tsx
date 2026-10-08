/**
 * Site audit → Rendering: the chosen pages fetched twice — as plain HTML and in a real browser with JavaScript
 * run — and compared (server/seo/render-check.ts). Shows whether what a search engine reads depends on JavaScript.
 * The price is on the button; the check runs in the background and this view asks for it until it is done.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, money, useSeoStatus, type SeoSite } from "./shell";

type Side = { status: number | null; words: number | null; internalLinks: number | null; externalLinks: number | null; images: number | null; title: string | null; h1: string | null };
type Row = { url: string; plain: Side | null; rendered: Side | null; timing: { lcp: number | null; interactive: number | null; loaded: number | null } | null; problems: string[]; verdict: "same" | "needs_js" | "unknown"; why: string };
type Run = { id: number; status: "running" | "done" | "failed"; urls: string[]; result: { rows: Row[]; summary: { pages: number; needsJs: number; same: number; unknown: number }; fetchedAt: string } | null; error: string | null; at: string };
type Data = { latest: Run | null; suggestions: string[]; max: number };

const VERDICT: Record<Row["verdict"], { label: string; color: string }> = {
  needs_js: { label: "Depends on JavaScript", color: "#e8710a" },
  same: { label: "Same either way", color: "var(--g-green)" },
  unknown: { label: "Could not be compared", color: "var(--g-text-2)" },
};
const n = (v: number | null | undefined) => (v == null ? "—" : fmtNum(v));
const secs = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const pathOf = (u: string) => { try { const x = new URL(u); return (x.pathname + x.search) || "/"; } catch { return u; } };

export function RenderCheck({ site }: { site: SeoSite }) {
  const status = useSeoStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site.id}/render`;
  const q = useQuery<Data>({ queryKey: [key], refetchOnMount: "always" });
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setPicked([]); setExtra(""); setActiveId(null); setOpen(null); }, [site.id]);
  // Nothing chosen yet: start with the first few pages offered (the home page first).
  useEffect(() => { if (q.data && !picked.length) setPicked(q.data.suggestions.slice(0, 3)); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // A check left running (started in another tab, or before this page was reloaded) is picked up again.
  useEffect(() => { if (q.data?.latest?.status === "running" && q.data.latest.id !== activeId) setActiveId(q.data.latest.id); }, [q.data?.latest?.id, q.data?.latest?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const max = q.data?.max ?? 10;
  const typed = useMemo(() => extra.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean), [extra]);
  const urls = useMemo(() => Array.from(new Set([...picked, ...typed])), [picked, typed]);
  const prices = status.data?.prices as (Record<string, number | undefined> | undefined);
  const holds = status.data?.holds as (Record<string, number | undefined> | undefined);
  const price = prices?.renderPer10 != null ? Math.ceil((urls.length * prices.renderPer10) / 10) : null;
  const hold = holds?.renderPer10 != null ? Math.ceil((urls.length * holds.renderPer10) / 10) : price;
  const available = status.data?.credits ? status.data.credits.availableCents : -1;
  const short = hold != null && available !== -1 && available < hold;

  const start = useMutation({
    mutationFn: (v: { siteId: number; urls: string[] }) => api("POST", `/api/seo/sites/${v.siteId}/render`, { urls: v.urls }),
    onSuccess: (d: { id: number; reused?: boolean }, v) => {
      if (v.siteId !== site.id) return;
      setActiveId(d.id);
      if (d.reused) toast({ title: "A check is already running for this site", description: "Showing that one. Start another when it finishes." });
    },
    onError: (e) => toast({ title: "Couldn't start the check", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const active = useQuery<Run>({ queryKey: [`${key}/${activeId}`], enabled: activeId != null, refetchInterval: (query) => (!query.state.data || query.state.data.status === "running" ? 3000 : false) });
  const ended = active.data && active.data.status !== "running" ? active.data.id : undefined;
  useEffect(() => {
    if (ended == null) return;
    void qc.invalidateQueries({ queryKey: [key] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
  }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = start.isPending || (activeId != null && (!active.data || active.data.status === "running"));
  // While a check runs, the one before it is put away: two sets of numbers on screen would be read as one.
  const run: Run | null = running ? null : (activeId != null && active.data && active.data.status !== "running" ? active.data : null) ?? (q.data?.latest && q.data.latest.status !== "running" ? q.data.latest : null);
  const toggle = (u: string) => setPicked((p) => (p.includes(u) ? p.filter((x) => x !== u) : [...p, u]));
  const configured = !!status.data?.configured;

  if (q.isLoading) return <p className="g-text-2 py-6 text-[13px]"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <div className="g-callout g-callout--error" role="alert">{apiErrorMessage(q.error)}</div>;

  return (
    <div data-testid="render-check">
      <section className="mb-4 rounded-lg border p-4" style={{ borderColor: "var(--g-divider)" }}>
        <h2 className="g-text text-[16px] font-medium">Does Google need JavaScript to read your pages?</h2>
        <p className="g-text-2 mt-1 max-w-3xl text-[13px]">Each page is fetched twice: once as plain HTML, the way a simple crawler reads it, and once in a real browser with JavaScript run, the way Google's renderer does. If words or links only appear in the second, the page depends on JavaScript — Google can usually still read it, but later and less reliably, and other crawlers and AI assistants often cannot.</p>
        <fieldset className="mt-3" disabled={running}>
          <legend className="g-text text-[13px] font-medium">Pages to check <span className="g-text-2 font-normal">(up to {max})</span></legend>
          <ul className="mt-1 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
            {(q.data?.suggestions ?? []).map((u) => (
              <li key={u}><label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={picked.includes(u)} onChange={() => toggle(u)} data-testid={`check-render-${pathOf(u)}`} /><span className="truncate" title={u}>{pathOf(u)}</span></label></li>
            ))}
          </ul>
          <label className="mt-2 block text-[13px]"><span className="g-text-2">Other pages of this site (full addresses, one per line)</span>
            <textarea className="g-input mt-1 block w-full max-w-xl" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={`https://${site.domain}/services`} data-testid="input-render-urls" />
          </label>
        </fieldset>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" disabled={running || !configured || !urls.length || urls.length > max || short} onClick={() => start.mutate({ siteId: site.id, urls })} data-testid="button-render-run">
            {running ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Checking…</> : `Check ${urls.length} page${urls.length === 1 ? "" : "s"}${price != null && urls.length ? ` — about ${money(price)}` : ""}`}
          </Button>
          {running && <span className="g-text-2 text-[13px]" role="status">This takes about half a minute. You can leave this page; the result is kept.</span>}
          {!running && urls.length > max && <span className="text-[13px]" style={{ color: "var(--g-red)" }} role="alert">Choose {max} pages or fewer.</span>}
          {!running && short && urls.length <= max && <span className="text-[13px]" style={{ color: "var(--g-red)" }} role="alert">This needs {money(hold!)} of SEO data available and you have {money(available)}.</span>}
          {!configured && <span className="g-text-2 text-[13px]">Lookups are not switched on for this account yet.</span>}
        </div>
        {activeId != null && active.isError && <p className="mt-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert">Couldn't read the check's progress. It is still running; this page keeps trying.</p>}
      </section>

      {run?.status === "failed" && <div className="g-callout g-callout--error mb-4" role="alert" data-testid="render-failed">{run.error ?? "The check could not be completed."}</div>}
      {run?.status === "done" && run.result && (
        <section data-testid="render-result">
          <p className="g-text mb-2 text-[13px]" data-testid="render-summary">
            Checked {fmtDate(run.result.fetchedAt)}: <strong>{run.result.summary.needsJs}</strong> of {run.result.summary.pages} page{run.result.summary.pages === 1 ? "" : "s"} depend{run.result.summary.needsJs === 1 ? "s" : ""} on JavaScript, {run.result.summary.same} read the same either way{run.result.summary.unknown ? `, ${run.result.summary.unknown} could not be compared` : ""}.
          </p>
          <div className="overflow-x-auto">
            <table className="g-table w-full" data-testid="table-render">
              <thead>
                <tr><th rowSpan={2}>Page</th><th rowSpan={2}>Result</th><th colSpan={2} className="num">Words</th><th colSpan={2} className="num">Links to your own pages</th><th rowSpan={2} className="num" title="When the biggest thing on screen was painted, in the browser fetch">Main content painted</th><th rowSpan={2} className="num" title="When the page finished loading, in the browser fetch">Loaded</th></tr>
                <tr><th className="num">HTML</th><th className="num">Rendered</th><th className="num">HTML</th><th className="num">Rendered</th></tr>
              </thead>
              <tbody>
                {run.result.rows.map((r) => {
                  const isOpen = open === r.url;
                  return [
                    <tr key={r.url} data-testid={`row-render-${pathOf(r.url)}`}>
                      <td className="max-w-[18rem]"><button type="button" className="g-link truncate text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.url)} title={r.url}>{pathOf(r.url)}</button></td>
                      <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: VERDICT[r.verdict].color }} aria-hidden />{VERDICT[r.verdict].label}</td>
                      <td className="num">{n(r.plain?.words)}</td><td className="num">{n(r.rendered?.words)}</td>
                      <td className="num">{n(r.plain?.internalLinks)}</td><td className="num">{n(r.rendered?.internalLinks)}</td>
                      <td className="num">{secs(r.timing?.lcp)}</td><td className="num">{secs(r.timing?.loaded)}</td>
                    </tr>,
                    isOpen && (
                      <tr key={`${r.url}-more`}><td colSpan={8} className="!whitespace-normal">
                        <p className="g-text text-[13px]">{r.why}</p>
                        <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                          <div><dt className="g-text-2">Title in the HTML</dt><dd className="g-text">{r.plain ? r.plain.title ?? "none" : "not fetched"}</dd></div>
                          <div><dt className="g-text-2">Title once rendered</dt><dd className="g-text">{r.rendered ? r.rendered.title ?? "none" : "not fetched"}</dd></div>
                          <div><dt className="g-text-2">Main heading in the HTML</dt><dd className="g-text">{r.plain ? r.plain.h1 ?? "none" : "not fetched"}</dd></div>
                          <div><dt className="g-text-2">Main heading once rendered</dt><dd className="g-text">{r.rendered ? r.rendered.h1 ?? "none" : "not fetched"}</dd></div>
                          <div><dt className="g-text-2">Links to other sites (HTML / rendered)</dt><dd className="g-text">{n(r.plain?.externalLinks)} / {n(r.rendered?.externalLinks)}</dd></div>
                          <div><dt className="g-text-2">Images (HTML / rendered)</dt><dd className="g-text">{n(r.plain?.images)} / {n(r.rendered?.images)}</dd></div>
                          <div><dt className="g-text-2">Usable after</dt><dd className="g-text">{secs(r.timing?.interactive)}</dd></div>
                          <div><dt className="g-text-2">Answer (HTML / rendered)</dt><dd className="g-text">{r.plain?.status ?? "—"} / {r.rendered?.status ?? "—"}</dd></div>
                        </dl>
                        {r.problems.length > 0 && <p className="g-text mt-2 text-[13px]"><span className="g-text-2">Found on the rendered page:</span> {r.problems.join(" · ")}</p>}
                      </td></tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="g-text-2 mt-2 text-[12px]">One fetch each way, from a data centre, at the time shown. Timings are from that single browser visit, not from your visitors. "Depends on JavaScript" means the rendered page had at least half as many words or own-site links again as the HTML, or a title or main heading that only exists once rendered.</p>
        </section>
      )}
      {!run && !running && <Empty testId="render-empty"><h3>No rendering check yet</h3><p>Choose the pages above and run the check.</p></Empty>}
    </div>
  );
}
