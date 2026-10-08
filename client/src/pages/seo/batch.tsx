/**
 * /seo/batch — Batch analysis: paste up to 100 websites and get each one's
 * authority, linking sites, links, estimated search visits and keywords, to
 * size up a list of competitors or link prospects at a glance. The price is
 * shown first; reopening the same list within a day is free.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Row = { domain: string; authority: number | null; referringDomains: number | null; backlinks: number | null; traffic: number | null; keywords: number | null };
type Page = { rows: Row[]; missing: string[]; fetchedAt: string };
type SortKey = keyof Row;
const MAX = 100;
const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: "authority", label: "Authority", title: "Link strength, 0–100" }, { key: "referringDomains", label: "Linking sites" }, { key: "backlinks", label: "Links" },
  { key: "traffic", label: "Search visits / mo", title: "Estimated visits from Google each month" }, { key: "keywords", label: "Keywords", title: "Keywords it ranks for on Google" },
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
    mutationFn: () => api("POST", "/api/seo/batch", body),
    onSuccess: (data: unknown) => { qc.setQueryData(queryKey, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Couldn't analyse those sites", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const priceFor = (n: number) => (status.data?.prices?.batchBase != null && status.data.prices.batchPer100 != null ? status.data.prices.batchBase + Math.ceil((n / 100) * status.data.prices.batchPer100) : null);
  const price = priceFor(Math.min(asked.length || draft.length, MAX));
  const canPay = price == null || !status.data?.credits || status.data.credits.availableCents === -1 || status.data.credits.availableCents >= price;
  const page = saved.data?.page ?? null;
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
        {asked.length === 0 && <Empty testId="batch-intro"><h3>Compare a whole list at once</h3><p>Paste the competitors from your <Link href="/seo/rank-tracker" className="g-link">rank tracker</Link>, the sites from a <Link href="/seo/explorer" className="g-link">link intersect</Link>, or any list of websites. For the full picture of one site, open it in Site explorer.</p></Empty>}
        {asked.length > 0 && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved analysis…</p>}
        {asked.length > 0 && saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved analysis</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
        {asked.length > 0 && saved.isSuccess && !page && (
          <Empty testId="batch-not-run">
            <h3>{asked.length} site{asked.length === 1 ? "" : "s"} ready to analyse</h3>
            <p>{!canPay ? "You don't have enough SEO data left — add credit above." : "Nothing has been charged yet."}</p>
            <Button className="mt-2" disabled={run.isPending || !status.data?.configured || !canPay} onClick={() => run.mutate()} data-testid="button-batch-run">{run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Analysing…</> : `Get the numbers${price != null ? ` — about ${money(price)}` : ""}`}</Button>
          </Empty>
        )}
        {page && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="g-text-2" data-testid="text-batch-meta">{fmtNum(page.rows.length)} site{page.rows.length === 1 ? "" : "s"} · as of {fmtDate(page.fetchedAt)} · United States</span>
              <button type="button" className="g-pill g-pill--sm ml-auto" onClick={exportCsv} data-testid="button-batch-export"><Download /> Export</button>
            </div>
            {page.missing.length > 0 && <p className="g-text-2 mb-2 text-[13px]" role="status" data-testid="text-batch-missing">Didn't load this time: {page.missing.map((m) => MISSING[m] ?? m).join(", ")}. The other columns are complete.</p>}
            <div className="overflow-x-auto">
              <table className="g-table w-full" data-testid="table-batch">
                <thead><tr>{th("domain", "Website", false)}{COLS.map((c) => th(c.key, c.label, true, c.title))}</tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.domain}>
                    <td><Link href={`/seo/explorer?domain=${encodeURIComponent(r.domain)}`} className="g-link" title={`Open ${r.domain} in Site explorer`}>{r.domain}</Link></td>
                    {COLS.map((c) => <td key={c.key} className="num" data-label={c.label}>{r[c.key] == null ? <span className="g-text-2">—</span> : fmtNum(r[c.key] as number)}</td>)}
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
