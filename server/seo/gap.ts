/**
 * Content gap and Link intersect for Site Explorer.
 *
 *   Content gap    keywords up to three competitors rank for and the target
 *                  does not — one Labs domain_intersection call per competitor,
 *                  merged so a keyword several competitors share comes first.
 *   Link intersect sites that link to every competitor named and not to the
 *                  target — one backlinks domain_intersection call.
 *
 * Both are bought through server/seo/budget.ts and saved in seo_report_cache.
 */
import { z } from "zod";
import { request, assertOk, taskItems, labsDomainIntersection, type GapKeyword } from "./dataforseo";
import { estimateLabsUsd } from "./pricing";

export const GAP_MAX_COMPETITORS = 3;
export const CONTENT_GAP_ROWS = 100;
/**
 * Measured 2026-10-08 on backlinks/domain_intersection/live: $0.0249 for 25 rows (one target or two), $0.0258 for 50
 * rows — about $0.024 a call plus $0.00004 a row, whatever the number of targets. A little room is added on top.
 */
export const LINK_INTERSECT_TASK_USD = 0.024, LINK_INTERSECT_TARGET_USD = 0.0005, LINK_INTERSECT_ROW_USD = 0.00005;

export const gapInput = z.object({
  kind: z.enum(["content", "links"]),
  domain: z.string().min(3).max(253),
  competitors: z.array(z.string().min(3).max(253)).min(1).max(GAP_MAX_COMPETITORS),
  limit: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(50),
  offset: z.number().int().min(0).max(9900).default(0),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  /** Return the saved copy or 404 — never buy. */
  peek: z.boolean().default(false),
}).strict();
export type GapInput = z.infer<typeof gapInput>;

/** The most a comparison can cost us; what is reserved before it runs. */
export function gapEstimateUsd(kind: "content" | "links", competitors: number, limit: number): number {
  return kind === "content"
    ? Math.round(competitors * estimateLabsUsd(CONTENT_GAP_ROWS) * 1e6) / 1e6
    : Math.round((LINK_INTERSECT_TASK_USD + competitors * LINK_INTERSECT_TARGET_USD + limit * LINK_INTERSECT_ROW_USD) * 1e6) / 1e6;
}

export type ContentGapRow = {
  keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent: string | null;
  /** Who ranks for it, best position first. */
  competitors: { domain: string; position: number | null; url: string | null }[];
  /** Estimated monthly visits the competitors get from it, summed. */
  traffic: number;
};

/** One row per keyword across the competitors' lists: shared by the most competitors first, then by volume. */
export function mergeContentGap(lists: { competitor: string; items: GapKeyword[] }[]): ContentGapRow[] {
  const rows = new Map<string, ContentGapRow>();
  for (const { competitor, items } of lists) {
    for (const k of items) {
      const row = rows.get(k.keyword) ?? { keyword: k.keyword, volume: k.searchVolume, cpc: k.cpc, difficulty: k.difficulty, intent: k.intent, competitors: [], traffic: 0 };
      if (row.competitors.some((c) => c.domain === competitor)) continue;
      row.competitors.push({ domain: competitor, position: k.competitorPosition, url: k.competitorUrl });
      row.traffic += k.etv ?? 0;
      row.volume ??= k.searchVolume; row.cpc ??= k.cpc; row.difficulty ??= k.difficulty; row.intent ??= k.intent;
      rows.set(k.keyword, row);
    }
  }
  for (const r of rows.values()) {
    r.competitors.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    r.traffic = Math.round(r.traffic);
  }
  return [...rows.values()].sort((a, b) => b.competitors.length - a.competitors.length || (b.volume ?? 0) - (a.volume ?? 0) || a.keyword.localeCompare(b.keyword));
}

export type LinkGapRow = {
  domain: string;
  /** 0–100 authority of the linking site. */
  authority: number | null;
  spamScore: number | null;
  /** Links from this site to each competitor, in the order the competitors were given. */
  links: { competitor: string; backlinks: number; firstSeen: string | null }[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** backlinks/domain_intersection item: `domain_intersection` keyed "1".."n" in the order the targets were sent. */
export function parseLinkIntersect(item: any, competitors: string[]): LinkGapRow | null {
  const di = item?.domain_intersection;
  if (!di || typeof di !== "object") return null;
  let domain: string | null = null, rank: number | null = null, spam: number | null = null;
  const links: LinkGapRow["links"] = [];
  competitors.forEach((competitor, i) => {
    const d = di[String(i + 1)];
    if (!d) return;
    domain ??= typeof d.target === "string" ? d.target : null;
    rank ??= num(d.rank);
    spam ??= num(d.backlinks_spam_score);
    links.push({ competitor, backlinks: num(d.backlinks) ?? 0, firstSeen: typeof d.first_seen === "string" ? d.first_seen.slice(0, 10) : null });
  });
  if (!domain) return null;
  return { domain, authority: rank === null ? null : Math.max(0, Math.min(100, Math.round(rank / 10))), spamScore: spam, links };
}

export type GapPage = {
  kind: "content" | "links"; target: string; competitors: string[];
  rows: ContentGapRow[] | LinkGapRow[];
  /** Links: sites the source knows of in total. Content: null (each competitor's list is its top 100). */
  total: number | null; limit: number; offset: number;
  /** Competitors whose list did not load this time. */
  missing: string[];
  fetchedAt: string;
};

export const gapDeps = { labsDomainIntersection, request };

export async function fetchGap(input: { kind: "content" | "links"; target: string; competitors: string[]; limit: number; offset: number; locationCode: number; languageCode: string }): Promise<{ data: GapPage; costUsd: number }> {
  const base = { kind: input.kind, target: input.target, competitors: input.competitors, limit: input.limit, offset: input.offset, fetchedAt: new Date().toISOString() };
  if (input.kind === "content") {
    // Every competitor's call finishes before we decide, so a failure never hides what the others cost.
    const settled = await Promise.allSettled(input.competitors.map((competitor) =>
      gapDeps.labsDomainIntersection({ competitor, ours: input.target, locationCode: input.locationCode, languageCode: input.languageCode, limit: CONTENT_GAP_ROWS })));
    let costUsd = 0;
    const lists: { competitor: string; items: GapKeyword[] }[] = [], missing: string[] = [];
    let firstError: unknown = null;
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") { costUsd += s.value.costUsd; lists.push({ competitor: input.competitors[i], items: s.value.data.items }); }
      else { costUsd += typeof s.reason?.costUsd === "number" ? s.reason.costUsd : 0; missing.push(input.competitors[i]); firstError ??= s.reason; }
    });
    if (!lists.length) throw Object.assign(firstError instanceof Error ? firstError : new Error(String(firstError)), { costUsd });
    const all = mergeContentGap(lists);
    return { data: { ...base, rows: all, total: null, limit: all.length, offset: 0, missing }, costUsd };
  }
  const targets = Object.fromEntries(input.competitors.map((c, i) => [String(i + 1), c]));
  const task = assertOk(await gapDeps.request("POST", "/backlinks/domain_intersection/live", [{
    targets, exclude_targets: [input.target], limit: input.limit, offset: input.offset, order_by: ["1.rank,desc"], rank_scale: "one_thousand",
  }]), { treatNoResultsAsEmpty: true });
  const rows = taskItems(task).map((i) => parseLinkIntersect(i, input.competitors)).filter((r): r is LinkGapRow => !!r);
  return { data: { ...base, rows, total: num(task.result?.[0]?.total_count), missing: [] }, costUsd: typeof task.cost === "number" ? task.cost : 0 };
}
