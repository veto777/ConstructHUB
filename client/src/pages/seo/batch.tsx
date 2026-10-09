/**
 * /seo/batch — Batch analysis: paste up to 100 websites and get each one's
 * authority, linking sites, links, estimated search visits and keywords, to
 * size up a list of competitors or link prospects at a glance. The price is
 * shown first; reopening the same list within a day is free.
 *
 * Every row opens that website in Site explorer, and every figure in it opens the explorer's report for that figure
 * (links.ts seoLinks.explorer: linking sites, links, pages, keywords). The meta line too: the count of sites opens
 * the table (#table-batch), the as-of date that month's lookups on Usage (where the analysis was charged).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, money, SeoShell, useHash, useScrollTo, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { seoLinks } from "./links";
import { FIGURE_LINK, QUIET_LINK, TEXT_LINK } from "./viz-more";

type Row = { domain: string; authority: number | null; referringDomains: number | null; backlinks: number | null; traffic: number | null; keywords: number | null };
type Page = { rows: Row[]; missing: string[]; fetchedAt: string };
type SortKey = keyof Row;
const MAX = 100;
/** Each column and the Site explorer report its figure comes from. */
const COLS: { key: SortKey; label: string; title?: string; view: string }[] = [
  { key: "authority", label: "Authority", title: "Link strength, 0–100", view: "overview" }, { key: "referringDomains", label: "Linking sites", view: "referringDomains" }, { key: "backlinks", label: "Links", view: "backlinks" },
  { key: "traffic", label: "Search visits / mo", title: "Estimated visits from Google each month", view: "pages" }, { key: "keywords", label: "Keywords", title: "Keywords it ranks for on Google", view: "keywords" },
];
const MISSING: Record<string, string> = { authority: "authority", referringDomains: "linking sites", backlinks: "links", traffic: "search visits and keywords" };
const parse = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "")).filter((s) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)))];
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

export default function SeoBatchPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "authority", dir: -1 });
  const draft = useMemo(() => parse(text), [text]);
  const body = useMemo(() => ({ domains: asked }), [asked]);
  const queryKey = ["/api/seo/batch", body];
  const saved = useQuery<{ page: Page } | null>({
    queryKey, enabled: asked.length > 0, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/batch", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { body: Record<string, unknown>; key: readonly unknown[]; again: boolean }) => api("POST", "/api/seo/batch", v.again ? { ...v.body, refresh: true } : v.body),
    onSuccess: (data: unknown, v) => { qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Couldn't analyse those sites", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const priceFor = (n: number) => (status.data?.prices?.batchBase != null && status.data.prices.batchPer100 != null ? status.data.prices.batchBase + Math.ceil((n / 100) * status.data.prices.batchPer100) : null);
  const price = priceFor(Math.min(asked.length || draft.length, MAX));
  // What must be available to start is the most it can cost — the server's own figure, not a guess.
  const holds = status.data?.holds;
  const holdFor = (n: number) => (holds?.batchBase != null && holds.batchPer100 != null ? holds.batchBase + Math.ceil((n / 100) * holds.batchPer100) : priceFor(n));
  const need = holdFor(Math.min(asked.length || draft.length, MAX));
  const canPay = need == null || !status.data?.credits || status.data.credits.availableCents === -1 || status.data.credits.availableCents >= need;
  const page = saved.data?.page ?? null;
  // "N sites" in the meta line opens the table (#table-batch): brought into view once it is on screen.
  const hash = useHash();
  useScrollTo(hash === "table-batch" ? hash : null, !!page);
  const rows = useMemo(() => {
    if (!page) return [];
    const val = (r: Row) => (sort.key === "domain" ? r.domain : (r[sort.key] ?? -1));
    return [...page.rows].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.domain.localeCompare(b.domain)) * sort.dir; });
  }, [page, sort]);
  const exportCsv = () => {
    const blob = new Blob([[["Website", ...COLS.map((c) => c.label)], ...rows.map((r) => [r.domain, r.authority, r.referringDomains, r.backlinks, r.traffic, r.keywords])].map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "batch-analysis.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
  const th = (key: SortKey, label: string, num: boolean, title?: string) => (
    <th key={key} className={num ? "num" : undefined} title={title} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" className="g-text-2 whitespace-nowrap" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "domain" ? 1 : -1 }))}>{label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button>
    </th>
  );
  return (
    <SeoShell title="Batch analysis" description="The headline numbers for many websites at once — to size up a list of competitors or sites you might get a link from." site={site} onSite={onSite} sites={sites} status={status} picker={false}>
      <form onSubmit={(e) => { e.preventDefault(); setAsked(draft.slice(0, MAX)); }} data-testid="form-batch">
        <label className="block text-[13px]"><span className="g-text-2">Websites — one per line, up to {MAX}. Full addresses are fine; only the site name is used.</span>
          <textarea className="g-input mt-1 min-h-[140px] w-full py-2" value={text} onChange={(e) => setText(e.target.value)} placeholder={"competitor-one.com\ncompetitor-two.com\nlocal-directory.org"} data-testid="textarea-batch" />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!draft.length} data-testid="button-batch-prepare">Analyse {draft.length ? `${Math.min(draft.length, MAX)} site${draft.length === 1 ? "" : "s"}` : "sites"}</Button>
          <span className="g-text-2 text-[13px]">{draft.length > MAX ? `Only the first ${MAX} of ${fmtNum(draft.length)} are analysed at once. ` : ""}{draft.length && priceFor(Math.min(draft.length, MAX)) != null ? `About ${money(priceFor(Math.min(draft.length, MAX)))} of your SEO data; reopening the same list within a day is free.` : "Authority, linking sites, links, estimated search visits and keywords for each."}</span>
        </div>
      </form>
      <div className="mt-4">
        {asked.length === 0 && <Empty testId="batch-intro"><h3>Compare a whole list at once</h3><p>Paste the competitors from your {site ? <Link href={seoLinks.rankTracker(site.id, { panel: "competitors" })} className={TEXT_LINK}>rank tracker</Link> : "rank tracker"}, the sites from a <Link href={site ? seoLinks.explorer(site.domain, "linkIntersect") : seoLinks.explorer("")} className={TEXT_LINK}>link intersect</Link>, or any list of websites. For the full picture of one site, open it in <Link href={site ? seoLinks.explorer(site.domain) : seoLinks.explorer("")} className={TEXT_LINK}>Site explorer</Link>.</p></Empty>}
        {asked.length > 0 && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved analysis…</p>}
        {asked.length > 0 && saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved analysis</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
        {asked.length > 0 && saved.isSuccess && !page && (
          <Empty testId="batch-not-run">
            <h3>{asked.length} site{asked.length === 1 ? "" : "s"} ready to analyse</h3>
            <p>{!canPay ? "You don't have enough SEO data left — add credit above." : "Nothing has been charged yet."}</p>
            <Button className="mt-2" disabled={run.isPending || !status.data?.configured || !canPay} onClick={() => run.mutate({ body, key: queryKey, again: false })} data-testid="button-batch-run">{run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Analysing…</> : `Get the numbers${price != null ? ` — about ${money(price)}` : ""}`}</Button>
          </Empty>
        )}
        {page && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="g-text-2" data-testid="text-batch-meta"><Link href={`${seoLinks.batch()}#table-batch`} className={QUIET_LINK} title="The websites, in the table below" data-testid="link-batch-count">{fmtNum(page.rows.length)} site{page.rows.length === 1 ? "" : "s"}</Link> · <Link href={seoLinks.usage({ month: page.fetchedAt.slice(0, 7) })} className={QUIET_LINK} title="When this was looked up — that month's lookups on the Usage page" data-testid="link-batch-as-of">as of {fmtDate(page.fetchedAt)}</Link> · United States</span>
              <button type="button" className="g-pill g-pill--sm !min-h-11 ml-auto" onClick={exportCsv} data-testid="button-batch-export"><Download /> Export</button>
            </div>
            {page.missing.length > 0 && <p className="g-text-2 mb-2 text-[13px]" role="status" data-testid="text-batch-missing">Didn't load this time: {page.missing.map((m) => MISSING[m] ?? m).join(", ")}. The other columns are complete. <button type="button" className={TEXT_LINK} disabled={run.isPending || !canPay} onClick={() => run.mutate({ body, key: queryKey, again: true })} data-testid="button-batch-retry">{run.isPending ? "Trying again…" : `Try again${price != null ? ` — about ${money(price)}` : ""}`}</button></p>}
            {/* On a phone the table's head is hidden (rows become cards), so the order is picked here instead. */}
            <label className="mb-2 flex items-center gap-2 text-[13px] sm:hidden"><span className="g-text-2">Order by</span>
              <select className="g-input g-select !w-auto min-h-11" value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort({ key: key as SortKey, dir: dir === "1" ? 1 : -1 }); }} data-testid="select-batch-sort">
                <option value="domain:1">Website, A to Z</option>
                {COLS.map((c) => [<option key={`${c.key}:-1`} value={`${c.key}:-1`}>{c.label}, highest first</option>, <option key={`${c.key}:1`} value={`${c.key}:1`}>{c.label}, lowest first</option>])}
              </select>
            </label>
            <div className="overflow-x-auto">
              <table id="table-batch" className="g-table w-full scroll-mt-4" data-testid="table-batch">
                <thead><tr>{th("domain", "Website", false)}{COLS.map((c) => th(c.key, c.label, true, c.title))}</tr></thead>
                {/* The website opens in Site explorer; each figure opens the explorer's report it was read from. */}
                <tbody>{rows.map((r) => (
                  <tr key={r.domain}>
                    <td><Link href={seoLinks.explorer(r.domain)} className={TEXT_LINK} title={`Open ${r.domain} in Site explorer`} data-testid={`link-batch-${r.domain}`}>{r.domain}</Link></td>
                    {COLS.map((c) => <td key={c.key} className="num" data-label={c.label}>{r[c.key] == null ? <span className="g-text-2">—</span> : <Link href={seoLinks.explorer(r.domain, c.view)} className={FIGURE_LINK} title={`${c.label} of ${r.domain} in Site explorer`}>{fmtNum(r[c.key] as number)}</Link>}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="g-text-2 mt-2 text-[12px]">A dash means the source has no number for that site. Visits are estimates from where the site ranks, not analytics.</p>
          </>
        )}
      </div>
    </SeoShell>
  );
}
