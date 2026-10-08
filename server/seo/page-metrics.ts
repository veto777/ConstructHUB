/**
 * Numbers for a list of PAGES (not sites): how many sites link to each, and the search visits each is
 * estimated to get. Used by the Content explorer to turn "pages about a topic" into "pages worth
 * learning from, or asking for a link". Two lookups for the whole list; either may fail on its own.
 */
import { z } from "zod";
import { request, assertOk, taskItems, safeHttpUrl, type DfsTask } from "./dataforseo";
import { BACKLINKS_REQUEST_USD, BACKLINKS_ROW_USD, estimateLabsUsd } from "./pricing";

export const PAGE_METRICS_MAX = 100;
export const pageMetricsDeps = { request };
export const pageMetricsInput = z.object({
  urls: z.array(z.string().max(2000)).min(1).max(PAGE_METRICS_MAX),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  peek: z.boolean().default(false),
  /** Ask again for the part of a saved answer that did not load (and only that part). */
  retry: z.boolean().default(false),
}).strict();
/** Web addresses only, without fragments, no duplicates, in the order given. */
export function cleanUrls(list: readonly string[]): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const raw of list) {
    const safe = safeHttpUrl(raw);
    if (!safe) continue;
    let u: string; try { const x = new URL(safe); x.hash = ""; u = x.toString(); } catch { continue; }
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out.slice(0, PAGE_METRICS_MAX);
}
export type MetricPart = "links" | "traffic";
/** The most the lookups can cost us for `n` pages (both, or only the parts named). */
export const pageMetricsEstimateUsd = (n: number, parts: readonly string[] = ["links", "traffic"]) =>
  Math.round(((parts.includes("links") ? BACKLINKS_REQUEST_USD + n * BACKLINKS_ROW_USD * 1.2 : 0) + (parts.includes("traffic") ? estimateLabsUsd(n) : 0)) * 1e6) / 1e6;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export type PageMetric = { url: string; /** Sites linking to this page; null = that lookup did not load. */ linkingSites: number | null; /** Estimated search visits a month to this page. */ traffic: number | null; /** Keywords it ranks for. */ keywords: number | null };
export type PageMetrics = { rows: PageMetric[]; /** "links" and/or "traffic": a part that did not load (its numbers are missing, not zero). */ missing: string[]; fetchedAt: string };

/**
 * One page, one key: the address as it is, without its fragment. Nothing else is folded together — /Roof and /roof,
 * /guide and /guide/, ?id=A and ?id=a can all be different pages, and the source echoes each address as it was asked.
 */
export const pageKey = (u: unknown) => { try { const x = new URL(String(u)); x.hash = ""; return x.toString(); } catch { return String(u ?? ""); } };
const keyOf = pageKey;
/** Pure: the answer for each page asked about, from what the two lookups returned (null = that lookup failed). */
export function buildPageMetrics(urls: string[], links: any[] | null, traffic: any[] | null, fetchedAt = new Date().toISOString()): PageMetrics {
  const l = new Map((links ?? []).map((i) => [keyOf(i?.target), i] as const)), t = new Map((traffic ?? []).map((i) => [keyOf(i?.target), i] as const));
  return {
    rows: urls.map((url) => {
      const li = l.get(keyOf(url)), ti = t.get(keyOf(url))?.metrics?.organic;
      return {
        url,
        // The source answers for every page it was asked about; a page it left out is unknown, not zero.
        linkingSites: links ? (li ? num(li.referring_main_domains) ?? num(li.referring_domains) : null) : null,
        // The same for visits: zero only when the source says zero for this very page (it does, for a page it has
        // no searches for — checked 2026-10-08). A page it left out, or answered without figures, is unknown.
        traffic: ti && num(ti.etv) !== null ? Math.round(ti.etv) : null,
        keywords: ti ? num(ti.count) : null,
      };
    }),
    missing: [links ? null : "links", traffic ? null : "traffic"].filter((x): x is string => !!x), fetchedAt,
  };
}

/** A saved answer with the part that had not loaded filled in from a second try. What had loaded is kept as it was. Pure. */
export function mergePageMetrics(saved: PageMetrics, fresh: PageMetrics): PageMetrics {
  const f = new Map(fresh.rows.map((r) => [r.url, r] as const));
  const got = (part: MetricPart) => !fresh.missing.includes(part);
  return {
    rows: saved.rows.map((r) => { const n = f.get(r.url); return !n ? r : { url: r.url, linkingSites: got("links") ? n.linkingSites : r.linkingSites, traffic: got("traffic") ? n.traffic : r.traffic, keywords: got("traffic") ? n.keywords : r.keywords }; }),
    missing: saved.missing.filter((m) => fresh.missing.includes(m)), fetchedAt: saved.fetchedAt,
  };
}

/** Both lookups, or only the parts named in `only` (the others are then reported missing, for mergePageMetrics to fill from the saved answer). */
export async function fetchPageMetrics(input: { urls: string[]; locationCode: number; languageCode: string }, only?: readonly string[]): Promise<{ data: PageMetrics; costUsd: number; customerUsd: number; costUnknown: boolean }> {
  let costUsd = 0, customerUsd = 0, costUnknown = false, firstError: unknown = null;
  const call = async (path: string, body: Record<string, unknown>): Promise<any[] | null> => {
    try {
      const task: DfsTask = assertOk(await pageMetricsDeps.request("POST", path, [body]), { treatNoResultsAsEmpty: true });
      const cost = typeof task.cost === "number" ? task.cost : 0;
      costUsd += cost; customerUsd += cost;
      return taskItems(task);
    } catch (e: any) {
      firstError ??= e;
      costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
      if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) costUnknown = true;
      return null;
    }
  };
  const want = (part: MetricPart) => !only || only.includes(part);
  const [links, traffic] = await Promise.all([
    want("links") ? call("/backlinks/bulk_referring_domains/live", { targets: input.urls }) : null,
    want("traffic") ? call("/dataforseo_labs/google/bulk_traffic_estimation/live", { targets: input.urls, location_code: input.locationCode, language_code: input.languageCode, item_types: ["organic"] }) : null,
  ]);
  if (!links && !traffic) throw Object.assign(firstError instanceof Error ? firstError : new Error(String(firstError ?? "The lookups failed.")), { costUsd, costUnknown });
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return { data: buildPageMetrics(input.urls, links, traffic), costUsd: r6(costUsd), customerUsd: r6(customerUsd), costUnknown };
}
