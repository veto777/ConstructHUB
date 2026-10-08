/**
 * Batch analysis: the headline numbers for up to 100 websites at once —
 * authority, linking sites, links, estimated search visits and ranking
 * keywords — to size up a list of competitors or link prospects in one go.
 * Four bulk calls, bought through server/seo/budget.ts, saved for a day.
 */
import { z } from "zod";
import { request, assertOk, taskItems, normalizeDomain } from "./dataforseo";
import { estimateLabsUsd, BACKLINKS_REQUEST_USD, BACKLINKS_ROW_USD } from "./pricing";

export const BATCH_MAX = 100;
export const batchInput = z.object({
  domains: z.array(z.string().max(300)).min(1).max(1000),
  peek: z.boolean().default(false),
  /** Run it again even though a copy is saved (a column did not load last time). */
  refresh: z.boolean().default(false),
}).strict();

/** What was typed, as distinct bare domains (URLs and "www." accepted), capped. Pure. */
export function cleanDomains(list: readonly string[], cap = BATCH_MAX): { domains: string[]; rejected: string[] } {
  const domains: string[] = [], rejected: string[] = [], seen = new Set<string>();
  for (const raw of list) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const d = normalizeDomain(t);
    if (!d) { if (rejected.length < 20) rejected.push(t.slice(0, 80)); continue; }
    if (seen.has(d)) continue;
    seen.add(d);
    if (domains.length < cap) domains.push(d);
  }
  return { domains, rejected };
}

/** The most a batch of `count` sites can cost us: three link lookups and one traffic lookup. */
export const batchEstimateUsd = (count: number) =>
  Math.round((3 * (BACKLINKS_REQUEST_USD + count * BACKLINKS_ROW_USD * 1.2) + estimateLabsUsd(count)) * 1e6) / 1e6;

export type BatchRow = { domain: string; authority: number | null; referringDomains: number | null; backlinks: number | null; traffic: number | null; keywords: number | null };
export type BatchPage = { rows: BatchRow[]; /** Columns that did not load this time. */ missing: string[]; fetchedAt: string };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const key = (t: unknown) => (typeof t === "string" ? t.toLowerCase().replace(/^www\./, "") : "");
export const batchDeps = { request };

export async function fetchBatch(domains: string[]): Promise<{ data: BatchPage; costUsd: number; customerUsd: number; costUnknown: boolean }> {
  let costUsd = 0, customerUsd = 0, costUnknown = false;
  const call = async (path: string, body: Record<string, unknown>) => {
    try {
      const task = assertOk(await batchDeps.request("POST", path, [body]), { treatNoResultsAsEmpty: true });
      costUsd += typeof task.cost === "number" ? task.cost : 0;
      customerUsd += typeof task.cost === "number" ? task.cost : 0;
      return new Map(taskItems(task).map((i: any) => [key(i?.target), i] as const));
    } catch (e: any) {
      costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
      if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) costUnknown = true;
      throw e;
    }
  };
  const parts = [
    ["authority", () => call("/backlinks/bulk_ranks/live", { targets: domains, rank_scale: "one_thousand" })],
    ["referringDomains", () => call("/backlinks/bulk_referring_domains/live", { targets: domains })],
    ["backlinks", () => call("/backlinks/bulk_backlinks/live", { targets: domains })],
    ["traffic", () => call("/dataforseo_labs/google/bulk_traffic_estimation/live", { targets: domains, location_code: 2840, language_code: "en", item_types: ["organic"] })],
  ] as const;
  const settled = await Promise.allSettled(parts.map(([, run]) => run()));
  const got = (i: number) => (settled[i].status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<Map<string, any>>).value : null);
  const missing = parts.filter((_, i) => !got(i)).map(([name]) => name);
  if (missing.length === parts.length) {
    const first = (settled[0] as PromiseRejectedResult).reason;
    throw Object.assign(first instanceof Error ? first : new Error(String(first)), { costUsd, costUnknown });
  }
  const [ranks, rds, links, traffic] = [got(0), got(1), got(2), got(3)];
  const rows = domains.map((domain): BatchRow => {
    const rank = num(ranks?.get(domain)?.rank), organic = traffic?.get(domain)?.metrics?.organic;
    return {
      domain, authority: rank === null ? null : Math.max(0, Math.min(100, Math.round(rank / 10))),
      referringDomains: num(rds?.get(domain)?.referring_domains), backlinks: num(links?.get(domain)?.backlinks),
      // No row for a site means the source has no number for it — that is "unknown", not zero.
      traffic: organic ? Math.round(num(organic.etv) ?? 0) : null, keywords: organic ? num(organic.count) : null,
    };
  });
  return { data: { rows, missing, fetchedAt: new Date().toISOString() }, costUsd, customerUsd, costUnknown };
}
