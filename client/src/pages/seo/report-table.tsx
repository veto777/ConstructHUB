/**
 * One Site Explorer / Keywords Explorer report: filters, sort, paging, CSV
 * export and (for keyword rows) "track these". Each page is one lookup on the
 * account's SEO data credit; a page already run in the last day opens free
 * (the server keeps it), so the screen first asks for the saved page ("peek")
 * and only spends when the person presses Run.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { holdNote, isNotRunYet } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, kd, money, type SeoStatus } from "./shell";

export type TableKey =
  | "keywords" | "paidKeywords" | "pages" | "competitors" | "backlinks" | "newBacklinks" | "lostBacklinks" | "brokenBacklinks"
  | "referringDomains" | "anchors" | "bestByLinks" | "matchingTerms" | "relatedTerms" | "questions";
type Filters = {
  positionMin?: number; positionMax?: number; volumeMin?: number; volumeMax?: number; difficultyMin?: number; difficultyMax?: number;
  intent?: string; contains?: string; follow?: "followed" | "nofollow"; everyLink?: boolean;
};
type Page = { table: TableKey; target: string; rows: any[]; sourceRows?: number; total: number | null; limit: number; offset: number; sort: string; fetchedAt: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const strip = (u: string | null | undefined) => (u ?? "").replace(/^https?:\/\/(www\.)?/, "");
const usd2 = (n: number | null | undefined) => n == null ? "—" : `$${n.toFixed(2)}`;
const usd0 = (n: number | null | undefined) => n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const Ext = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} className="g-link" target="_blank" rel="noreferrer">{children}</a>;

type Col = { key: string; label: string; num?: boolean; cell: (r: any, ctx: { target: string; onExplore?: (d: string) => void }) => ReactNode; csv: (r: any) => string | number | null };
const kwCols: Col[] = [
  { key: "keyword", label: "Keyword", cell: (r) => r.keyword, csv: (r) => r.keyword },
  { key: "position", label: "Position", num: true, cell: (r) => r.position ?? "—", csv: (r) => r.position },
  { key: "volume", label: "Volume", num: true, cell: (r) => fmtNum(r.volume), csv: (r) => r.volume },
  { key: "traffic", label: "Traffic", num: true, cell: (r) => fmtNum(r.traffic), csv: (r) => r.traffic },
  { key: "difficulty", label: "Difficulty", num: true, cell: (r) => kd(r.difficulty), csv: (r) => r.difficulty },
  { key: "cpc", label: "CPC", num: true, cell: (r) => usd2(r.cpc), csv: (r) => r.cpc },
  { key: "intent", label: "Intent", cell: (r) => (r.intent ? cap(r.intent) : "—"), csv: (r) => r.intent },
  { key: "url", label: "Page", cell: (r, c) => (r.url ? <Ext href={r.url}>{strip(r.url).replace(c.target, "") || "/"}</Ext> : "—"), csv: (r) => r.url },
];
const ideaCols: Col[] = [
  { key: "keyword", label: "Keyword", cell: (r) => r.keyword, csv: (r) => r.keyword },
  { key: "volume", label: "Volume", num: true, cell: (r) => fmtNum(r.volume), csv: (r) => r.volume },
  { key: "difficulty", label: "Difficulty", num: true, cell: (r) => kd(r.difficulty), csv: (r) => r.difficulty },
  { key: "cpc", label: "CPC", num: true, cell: (r) => usd2(r.cpc), csv: (r) => r.cpc },
  { key: "intent", label: "Intent", cell: (r) => (r.intent ? cap(r.intent) : "—"), csv: (r) => r.intent },
  { key: "competition", label: "Ad competition", cell: (r) => (r.competition ? cap(String(r.competition).toLowerCase()) : "—"), csv: (r) => r.competition },
];
const linkCols: Col[] = [
  { key: "url", label: "Linking page", cell: (r) => <span className="block max-w-[340px]"><Ext href={r.url}>{r.title || r.domain}</Ext><span className="g-text-2 block truncate text-[12px]">{strip(r.url)}</span></span>, csv: (r) => r.url },
  { key: "authority", label: "Authority", num: true, cell: (r) => r.authority ?? "—", csv: (r) => r.authority },
  { key: "anchor", label: "Anchor", cell: (r) => <span className="block max-w-[200px] truncate">{r.anchor || <span className="g-text-2">(none)</span>}</span>, csv: (r) => r.anchor },
  { key: "target", label: "Links to", cell: (r) => <span className="g-text-2 block max-w-[200px] truncate">{strip(r.target) || "—"}</span>, csv: (r) => r.target },
  { key: "followed", label: "Follow", cell: (r) => (r.followed ? "followed" : "nofollow"), csv: (r) => (r.followed ? "followed" : "nofollow") },
  { key: "spamScore", label: "Spam", num: true, cell: (r) => r.spamScore ?? "—", csv: (r) => r.spamScore },
  { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  { key: "lastSeen", label: "Last seen", num: true, cell: (r) => fmtDate(r.lastSeen), csv: (r) => r.lastSeen },
];
const COLS: Record<TableKey, Col[]> = {
  keywords: kwCols, paidKeywords: kwCols.filter((c) => c.key !== "difficulty"),
  pages: [
    { key: "url", label: "Page", cell: (r) => <span className="block max-w-[440px] truncate"><Ext href={r.url}>{strip(r.url)}</Ext></span>, csv: (r) => r.url },
    { key: "traffic", label: "Traffic", num: true, cell: (r) => fmtNum(r.traffic), csv: (r) => r.traffic },
    { key: "keywords", label: "Keywords", num: true, cell: (r) => fmtNum(r.keywords), csv: (r) => r.keywords },
    { key: "top10", label: "In top 10", num: true, cell: (r) => fmtNum(r.top10), csv: (r) => r.top10 },
    { key: "trafficValue", label: "Traffic value", num: true, cell: (r) => usd0(r.trafficValue), csv: (r) => r.trafficValue },
  ],
  competitors: [
    { key: "domain", label: "Competitor", cell: (r) => r.domain, csv: (r) => r.domain },
    { key: "commonKeywords", label: "Shared keywords", num: true, cell: (r) => fmtNum(r.commonKeywords), csv: (r) => r.commonKeywords },
    { key: "keywords", label: "Their keywords", num: true, cell: (r) => fmtNum(r.keywords), csv: (r) => r.keywords },
    { key: "traffic", label: "Their traffic", num: true, cell: (r) => fmtNum(r.traffic), csv: (r) => r.traffic },
    { key: "avgPosition", label: "Avg. position", num: true, cell: (r) => r.avgPosition ?? "—", csv: (r) => r.avgPosition },
    { key: "explore", label: "", num: true, cell: (r, c) => (c.onExplore ? <button type="button" className="g-link" onClick={() => c.onExplore!(r.domain)}>Explore</button> : null), csv: () => null },
  ],
  backlinks: linkCols.filter((c) => c.key !== "lastSeen"), newBacklinks: linkCols.filter((c) => c.key !== "lastSeen"),
  lostBacklinks: linkCols.filter((c) => c.key !== "spamScore"), brokenBacklinks: linkCols.filter((c) => c.key !== "lastSeen"),
  referringDomains: [
    { key: "domain", label: "Domain", cell: (r) => <Ext href={`https://${r.domain}`}>{r.domain}</Ext>, csv: (r) => r.domain },
    { key: "authority", label: "Authority", num: true, cell: (r) => r.authority ?? "—", csv: (r) => r.authority },
    { key: "backlinks", label: "Links to this site", num: true, cell: (r) => fmtNum(r.backlinks), csv: (r) => r.backlinks },
    { key: "spamScore", label: "Spam", num: true, cell: (r) => r.spamScore ?? "—", csv: (r) => r.spamScore },
    { key: "followed", label: "Follow", cell: (r) => (r.followed ? "followed" : "nofollow"), csv: (r) => (r.followed ? "followed" : "nofollow") },
    { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  ],
  anchors: [
    { key: "anchor", label: "Anchor text", cell: (r) => <span className="block max-w-[440px] truncate">{r.anchor || <span className="g-text-2">(no text — image or empty link)</span>}</span>, csv: (r) => r.anchor },
    { key: "backlinks", label: "Backlinks", num: true, cell: (r) => fmtNum(r.backlinks), csv: (r) => r.backlinks },
    { key: "referringDomains", label: "Referring domains", num: true, cell: (r) => fmtNum(r.referringDomains), csv: (r) => r.referringDomains },
    { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  ],
  bestByLinks: [
    { key: "url", label: "Page", cell: (r) => <span className="block max-w-[440px] truncate"><Ext href={r.url}>{strip(r.url)}</Ext></span>, csv: (r) => r.url },
    { key: "referringDomains", label: "Referring domains", num: true, cell: (r) => fmtNum(r.referringDomains), csv: (r) => r.referringDomains },
    { key: "backlinks", label: "Backlinks", num: true, cell: (r) => fmtNum(r.backlinks), csv: (r) => r.backlinks },
    { key: "authority", label: "Page authority", num: true, cell: (r) => r.authority ?? "—", csv: (r) => r.authority },
    { key: "brokenBacklinks", label: "Broken", num: true, cell: (r) => fmtNum(r.brokenBacklinks), csv: (r) => r.brokenBacklinks },
    { key: "firstSeen", label: "First seen", num: true, cell: (r) => fmtDate(r.firstSeen), csv: (r) => r.firstSeen },
  ],
  matchingTerms: ideaCols, relatedTerms: ideaCols, questions: ideaCols,
};

const SORT_LABELS: Record<TableKey, [string, string][]> = {
  keywords: [["traffic", "Most traffic"], ["volume", "Highest volume"], ["position", "Best position"], ["difficulty", "Easiest"], ["cpc", "Highest CPC"]],
  paidKeywords: [["traffic", "Most traffic"], ["volume", "Highest volume"], ["cpc", "Highest CPC"]],
  pages: [["traffic", "Most traffic"], ["keywords", "Most keywords"]],
  competitors: [["shared", "Most shared keywords"]],
  backlinks: [["authority", "Strongest sites"], ["newest", "Newest"], ["oldest", "Oldest"]],
  newBacklinks: [["newest", "Newest"], ["authority", "Strongest sites"]],
  lostBacklinks: [["newest", "Most recently lost"], ["authority", "Strongest sites"]],
  brokenBacklinks: [["authority", "Strongest sites"], ["newest", "Newest"]],
  referringDomains: [["authority", "Strongest sites"], ["links", "Most links"], ["newest", "Newest"]],
  anchors: [["links", "Most backlinks"], ["domains", "Most domains"]],
  bestByLinks: [["links", "Most backlinks"], ["domains", "Most domains"]],
  matchingTerms: [["volume", "Highest volume"], ["difficulty", "Easiest"], ["cpc", "Highest CPC"]],
  relatedTerms: [["volume", "Highest volume"], ["difficulty", "Easiest"]],
  questions: [["volume", "Highest volume"], ["difficulty", "Easiest"]],
};
const HAS: Record<string, TableKey[]> = {
  position: ["keywords"],
  volume: ["keywords", "paidKeywords", "matchingTerms", "relatedTerms", "questions"],
  difficulty: ["keywords", "matchingTerms", "relatedTerms", "questions"],
  intent: ["keywords", "matchingTerms", "questions"],
  contains: ["keywords", "paidKeywords", "pages", "competitors", "backlinks", "newBacklinks", "lostBacklinks", "referringDomains", "anchors", "bestByLinks", "matchingTerms", "questions"],
  follow: ["backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks"],
  everyLink: ["backlinks", "newBacklinks", "lostBacklinks"],
};
const CONTAINS_LABEL: Partial<Record<TableKey, string>> = { pages: "URL contains", backlinks: "Anchor contains", newBacklinks: "Anchor contains", lostBacklinks: "Anchor contains", referringDomains: "Domain contains", anchors: "Anchor contains", competitors: "Domain contains", bestByLinks: "URL contains" };
const isKeywordRows = (t: TableKey) => ["keywords", "paidKeywords", "matchingTerms", "relatedTerms", "questions"].includes(t);

function csvOf(cols: Col[], rows: any[]): string {
  const esc = (v: unknown) => { const raw = v == null ? "" : String(v); /* A cell from the open web must not run as a spreadsheet formula. */ const s = typeof v !== "number" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const used = cols.filter((c) => c.label);
  return [used.map((c) => esc(c.label)).join(","), ...rows.map((r) => used.map((c) => esc(c.csv(r))).join(","))].join("\n");
}

export function ReportView({ table, domain, keyword, status, onExplore, onTrack, trackLabel, extraAction }: {
  /** Keyword tables: something else to do with the ticked rows (e.g. add them to a list). */
  extraAction?: (rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent?: string | null }[], clear: () => void) => ReactNode;
  table: TableKey; domain?: string; keyword?: string; status: SeoStatus | undefined;
  onExplore?: (domain: string) => void;
  /** Keyword tables: track the ticked keywords (the page supplies the site). */
  onTrack?: (rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null }[]) => void;
  trackLabel?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const target = (domain ?? keyword ?? "").trim();
  const [sort, setSort] = useState(SORT_LABELS[table][0][0]);
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState<25 | 50 | 100>(50);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // A different report or target starts clean.
  useEffect(() => { setSort(SORT_LABELS[table][0][0]); setDraft({}); setFilters({}); setOffset(0); setPicked(new Set()); }, [table, target]);

  const body = useMemo(() => ({ ...(domain ? { domain } : { keyword }), table, sort, filters, limit, offset }), [domain, keyword, table, sort, filters, limit, offset]);
  const queryKey = ["/api/seo/report", body];
  const saved = useQuery<{ page: Page } | null>({
    queryKey, enabled: !!target, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/report", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: () => api("POST", "/api/seo/report", body),
    onSuccess: (data: { page: Page }) => { qc.setQueryData(queryKey, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Couldn't run the report", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const page = saved.data?.page ?? null;
  const cols = COLS[table];
  const has = (f: string) => HAS[f]?.includes(table);
  const price = status?.prices ? money(status.prices.reportPage) : "";
  const affordable = canAfford(status, "reportPage");
  const numField = (key: keyof Filters, label: string, width = "w-[88px]") => (
    <label className="g-text-2 flex items-center gap-1 text-[12px]">{label}
      <input className={`g-input ${width} !py-1`} inputMode="numeric" value={(draft[key] as number | undefined) ?? ""} data-testid={`filter-${key}`}
        onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ""); setDraft((d) => ({ ...d, [key]: v === "" ? undefined : Number(v) })); }} />
    </label>
  );
  const apply = () => { setFilters(Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined && v !== "" && v !== false)) as Filters); setOffset(0); setPicked(new Set()); };
  const download = () => {
    if (!page) return;
    const blob = new Blob([csvOf(cols, page.rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${target.replace(/[^a-z0-9.-]+/gi, "-")}-${table}-${offset + 1}-${offset + page.rows.length}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const trackable = (!!onTrack || !!extraAction) && isKeywordRows(table);
  const from = offset + 1, to = offset + (page?.rows.length ?? 0);

  return (
    <div data-testid={`report-${table}`}>
      {saved.isError && <p className="g-text-2 mb-2 text-[13px]" role="alert" data-testid="report-saved-error">Couldn't check for a saved copy of this report: {apiErrorMessage(saved.error)} <button type="button" className="g-link" onClick={() => void saved.refetch()}>Try again</button></p>}
      <form className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2" onSubmit={(e) => { e.preventDefault(); apply(); }} data-testid="report-filters">
        {has("position") && <>{numField("positionMin", "Position from", "w-[60px]")}{numField("positionMax", "to", "w-[60px]")}</>}
        {has("volume") && numField("volumeMin", "Volume ≥")}
        {has("difficulty") && numField("difficultyMax", "Difficulty ≤", "w-[60px]")}
        {has("intent") && (
          <label className="g-text-2 flex items-center gap-1 text-[12px]">Intent
            <select className="g-input g-select !w-auto !py-1" value={draft.intent ?? ""} onChange={(e) => setDraft((d) => ({ ...d, intent: e.target.value || undefined }))} data-testid="filter-intent">
              <option value="">Any</option>{["informational", "navigational", "commercial", "transactional"].map((i) => <option key={i} value={i}>{cap(i)}</option>)}
            </select>
          </label>
        )}
        {has("follow") && (
          <label className="g-text-2 flex items-center gap-1 text-[12px]">Links
            <select className="g-input g-select !w-auto !py-1" value={draft.follow ?? ""} onChange={(e) => setDraft((d) => ({ ...d, follow: (e.target.value || undefined) as Filters["follow"] }))} data-testid="filter-follow">
              <option value="">All</option><option value="followed">Followed</option><option value="nofollow">Nofollow</option>
            </select>
          </label>
        )}
        {has("everyLink") && <label className="g-text flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={!!draft.everyLink} onChange={(e) => setDraft((d) => ({ ...d, everyLink: e.target.checked || undefined }))} data-testid="filter-everyLink" /> Every link, not one per site</label>}
        {has("contains") && (
          <label className="g-text-2 flex items-center gap-1 text-[12px]">{CONTAINS_LABEL[table] ?? "Keyword contains"}
            <input className="g-input w-[150px] !py-1" value={draft.contains ?? ""} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, contains: e.target.value.replace(/[%_\\]/g, "") || undefined }))} data-testid="filter-contains" />
          </label>
        )}
        <label className="g-text-2 flex items-center gap-1 text-[12px]">Sort
          <select className="g-input g-select !w-auto !py-1" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }} data-testid="report-sort">
            {SORT_LABELS[table].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="g-text-2 flex items-center gap-1 text-[12px]">Rows
          <select className="g-input g-select !w-auto !py-1" value={limit} onChange={(e) => { setLimit(Number(e.target.value) as 25 | 50 | 100); setOffset(0); }} data-testid="report-limit">
            <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
        {Object.keys(HAS).some((f) => has(f)) && <button type="submit" className="g-pill g-pill--sm" data-testid="button-apply-filters">Apply filters</button>}
      </form>

      {saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved copy…</p>}
      {!saved.isLoading && !page && (
        <Empty testId="report-not-run">
          <h3>{offset ? `Rows ${fmtNum(offset + 1)}–${fmtNum(offset + limit)} haven't been loaded` : "This report hasn't been run with these settings"}</h3>
          <p>Each page of a report costs about {price} of your SEO data. A page you've run is kept for a day and opens free.{holdNote(status, "reportPage")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={run.isPending || !status?.configured || !affordable} onClick={() => run.mutate()} data-testid="button-run-report">
              {run.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}{offset ? "Load these rows" : "Run report"} — about {price}
            </Button>
            {offset > 0 && <button type="button" className="g-pill" onClick={() => setOffset(Math.max(0, offset - limit))}>Back</button>}
            {!affordable && <span className="text-[13px]" style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit above.</span>}
          </div>
        </Empty>
      )}
      {page && (
        <>
          <div className="g-text-2 mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span data-testid="report-meta">
              {page.rows.length ? `Rows ${fmtNum(from)}–${fmtNum(to)}` : "No rows"}{page.total != null ? ` of ${fmtNum(page.total)}` : ""} · as of {fmtDate(page.fetchedAt)}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {trackable && extraAction && picked.size > 0 && extraAction(page.rows.filter((r) => picked.has(r.keyword)), () => setPicked(new Set()))}
              {trackable && onTrack && picked.size > 0 && <Button size="sm" onClick={() => { onTrack(page.rows.filter((r) => picked.has(r.keyword))); setPicked(new Set()); }} data-testid="button-track-picked">{trackLabel ?? "Track"} ({picked.size})</Button>}
              <button type="button" className="g-pill g-pill--sm" disabled={!page.rows.length} onClick={download} data-testid="button-export-csv"><Download /> Export CSV</button>
            </span>
          </div>
          {page.rows.length === 0 ? <Empty testId="report-empty">Nothing matches. Try wider filters.</Empty> : (
            <div className="overflow-x-auto">
              <table className="g-table" data-testid={`table-${table}`}>
                <thead><tr>{trackable && <th className="w-8"></th>}{cols.map((c) => <th key={c.key} className={c.num ? "num" : undefined}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {page.rows.map((r, i) => (
                    <tr key={`${r.keyword ?? r.url ?? r.domain ?? r.anchor}-${i}`}>
                      {trackable && <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>}
                      {cols.map((c, j) => <td key={c.key} className={c.num ? "num" : undefined} data-label={j ? c.label : undefined}>{c.cell(r, { target, onExplore })}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <button type="button" className="g-pill g-pill--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-prev-page">← Previous</button>
            <button type="button" className="g-pill g-pill--sm" disabled={(page.sourceRows ?? page.rows.length) < limit || (page.total != null && to >= page.total) || offset + limit > 9900} onClick={() => setOffset(offset + limit)} data-testid="button-next-page">Next →</button>
            <span className="g-text-2">A page you haven't opened yet costs about {price}.</span>
          </div>
        </>
      )}
    </div>
  );
}
