/**
 * Authority numbers for many sources at once: DataForSEO's bulk Backlinks endpoints (up to 1,000 targets per
 * request) — domain rank (0–1000), backlink spam score (0–100) and referring domains — plus DataForSEO Labs'
 * estimate of monthly Google visits (a site nobody visits is a link-network footprint). Four requests per batch,
 * billed per request + per row (server/seo/pricing.ts): a full batch is about $0.31.
 */
import type { BacklinkMetrics } from "@shared/backlinks";
import { request, assertOk, taskItems } from "../seo/dataforseo";
import { BACKLINKS_REQUEST_USD, BACKLINKS_ROW_USD, LABS_TASK_USD, LABS_ITEM_USD } from "../seo/pricing";

export const METRICS_BATCH = 1000;
export const metricsEstimateUsd = (targets: number) => 3 * (BACKLINKS_REQUEST_USD + targets * BACKLINKS_ROW_USD) + LABS_TASK_USD + targets * LABS_ITEM_USD;
export const metricsDeps = { request };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function bulk(path: string, targets: string[], extra: Record<string, unknown> = {}) {
  const task = assertOk(await metricsDeps.request("POST", path, [{ targets, ...extra }]), { treatNoResultsAsEmpty: true });
  return { items: taskItems(task) as any[], costUsd: typeof task.cost === "number" ? task.cost : 0 };
}

/** domain → metrics, for every target the source answered for (a target it did not answer for is left out, not zeroed). */
export async function fetchMetrics(domains: string[], now = new Date()): Promise<{ metrics: Map<string, BacklinkMetrics>; costUsd: number }> {
  const targets = domains.slice(0, METRICS_BATCH);
  const [ranks, spam, refs, traffic] = await Promise.all([
    bulk("/backlinks/bulk_ranks/live", targets, { rank_scale: "one_thousand" }),
    bulk("/backlinks/bulk_spam_score/live", targets),
    bulk("/backlinks/bulk_referring_domains/live", targets),
    bulk("/dataforseo_labs/google/bulk_traffic_estimation/live", targets, { location_code: 2840, language_code: "en", item_types: ["organic"] }),
  ]);
  const out = new Map<string, BacklinkMetrics>();
  const at = now.toISOString();
  const row = (d: string) => out.get(d) ?? (out.set(d, { rank: null, referringDomains: null, spamScore: null, organicTraffic: null, checkedAt: at }), out.get(d)!);
  for (const it of ranks.items) if (typeof it?.target === "string") row(it.target).rank = num(it.rank);
  for (const it of spam.items) if (typeof it?.target === "string") row(it.target).spamScore = num(it.spam_score);
  for (const it of refs.items) if (typeof it?.target === "string") row(it.target).referringDomains = num(it.referring_domains);
  for (const it of traffic.items) if (typeof it?.target === "string") row(it.target).organicTraffic = num(it.metrics?.organic?.etv);
  return { metrics: out, costUsd: ranks.costUsd + spam.costUsd + refs.costUsd + traffic.costUsd };
}
