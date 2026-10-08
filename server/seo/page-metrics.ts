/**
 * Numbers for a list of PAGES (not sites): how many sites link to each, and the search visits each is
 * estimated to get. Used by the Content explorer to turn "pages about a topic" into "pages worth
 * learning from, or asking for a link". Two lookups for the whole list; either may fail on its own.
 */
import { z } from "zod";
import { request, assertOk, taskItems, type DfsTask } from "./dataforseo";
import { BACKLINKS_REQUEST_USD, BACKLINKS_ROW_USD, estimateLabsUsd } from "./pricing";
import { cleanPageUrls, pageKey } from "@shared/seo-page-key";

export { pageKey };
export const PAGE_METRICS_MAX = 100;
export const pageMetricsDeps = { request };
export const pageMetricsInput = z.object({
  urls: z.array(z.string().max(2000)).min(1).max(PAGE_METRICS_MAX),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  peek: z.boolean().default(false),
  /** Ask again for the figures a saved answer is still without (and only those). */
  retry: z.boolean().default(false),
}).strict();
/** Web addresses only, without fragments, no duplicates, in the order given (shared with the page: shared/seo-page-key.ts). */
export const cleanUrls = (list: readonly string[]): string[] => cleanPageUrls(list, PAGE_METRICS_MAX);

export type MetricPart = "links" | "traffic";
/** Which pages to ask each lookup about. An empty list = that lookup is not made. */
export type MetricPlan = Record<MetricPart, string[]>;
/** The most the lookups in a plan can cost us. */
export const planEstimateUsd = (plan: MetricPlan) =>
  Math.round(((plan.links.length ? BACKLINKS_REQUEST_USD + plan.links.length * BACKLINKS_ROW_USD * 1.2 : 0) + (plan.traffic.length ? estimateLabsUsd(plan.traffic.length) : 0)) * 1e6) / 1e6;
/** The most both lookups can cost us for `n` pages. */
export const pageMetricsEstimateUsd = (n: number) => planEstimateUsd({ links: Array(n).fill(""), traffic: Array(n).fill("") });

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export type PageMetric = { url: string; /** Sites linking to this page; null = not known (the lookup failed, or left this page out). */ linkingSites: number | null; /** Estimated search visits a month to this page; null = not known. */ traffic: number | null; /** Keywords it ranks for. */ keywords: number | null };
export type PageMetrics = { rows: PageMetric[]; /** "links" and/or "traffic": a lookup that did not load at all (its numbers are missing, not zero). */ missing: string[]; fetchedAt: string };

const keyOf = (u: unknown) => pageKey(u) ?? String(u ?? "");
/** Pure: the answer for each page asked about, from what the two lookups returned (null = that lookup failed or was not made). */
export function buildPageMetrics(urls: string[], links: any[] | null, traffic: any[] | null, fetchedAt = new Date().toISOString()): PageMetrics {
  const l = new Map((links ?? []).map((i) => [keyOf(i?.target), i] as const)), t = new Map((traffic ?? []).map((i) => [keyOf(i?.target), i] as const));
  return {
    rows: urls.map((url) => {
      const li = l.get(keyOf(url)), ti = t.get(keyOf(url))?.metrics?.organic;
      return {
        url,
        // The source answers for every page it was asked about; a page it left out is unknown, not zero.
        linkingSites: li ? num(li.referring_main_domains) ?? num(li.referring_domains) : null,
        // The same for visits: zero only when the source says zero for this very page (it does, for a page it has
        // no searches for — checked 2026-10-08). A page it left out, or answered without figures, is unknown.
        traffic: ti && num(ti.etv) !== null ? Math.round(ti.etv) : null,
        keywords: ti ? num(ti.count) : null,
      };
    }),
    missing: [links ? null : "links", traffic ? null : "traffic"].filter((x): x is string => !!x), fetchedAt,
  };
}
/** What a saved answer is still without: the pages with no linking-sites figure, and those with no visits figure. Pure. */
export const retryPlan = (saved: PageMetrics): MetricPlan => ({ links: saved.rows.filter((r) => r.linkingSites === null).map((r) => r.url), traffic: saved.rows.filter((r) => r.traffic === null).map((r) => r.url) });
/**
 * A saved answer completed from a second try. A figure that was known is never replaced by an unknown one; a lookup
 * stays "missing" unless it was asked for again and loaded. Pure.
 */
export function mergePageMetrics(saved: PageMetrics, fresh: PageMetrics, asked: MetricPlan): PageMetrics {
  const f = new Map(fresh.rows.map((r) => [r.url, r] as const));
  return {
    rows: saved.rows.map((r) => { const n = f.get(r.url); return !n ? r : { url: r.url, linkingSites: n.linkingSites ?? r.linkingSites, traffic: n.traffic ?? r.traffic, keywords: n.traffic !== null ? n.keywords : r.keywords }; }),
    missing: saved.missing.filter((m) => !(asked[m as MetricPart]?.length && !fresh.missing.includes(m))), fetchedAt: saved.fetchedAt,
  };
}

/** Both lookups for every page — or, with a plan, each lookup only for the pages the plan names. */
export async function fetchPageMetrics(input: { urls: string[]; locationCode: number; languageCode: string }, plan?: MetricPlan): Promise<{ data: PageMetrics; costUsd: number; customerUsd: number; costUnknown: boolean }> {
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
  const ask: MetricPlan = plan ?? { links: input.urls, traffic: input.urls };
  const [links, traffic] = await Promise.all([
    ask.links.length ? call("/backlinks/bulk_referring_domains/live", { targets: ask.links }) : null,
    ask.traffic.length ? call("/dataforseo_labs/google/bulk_traffic_estimation/live", { targets: ask.traffic, location_code: input.locationCode, language_code: input.languageCode, item_types: ["organic"] }) : null,
  ]);
  if (!links && !traffic) throw Object.assign(firstError instanceof Error ? firstError : new Error(String(firstError ?? "The lookups failed.")), { costUsd, costUnknown });
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return { data: buildPageMetrics(input.urls, links, traffic), costUsd: r6(costUsd), customerUsd: r6(customerUsd), costUnknown };
}
