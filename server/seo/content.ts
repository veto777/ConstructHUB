/**
 * Content Explorer: search the web for pages about a topic — who is writing
 * about it, how strong their site is, and when. For finding content ideas and
 * the sites worth asking for a link or a mention. One lookup per page of
 * results, bought through server/seo/budget.ts, saved for a day.
 */
import { z } from "zod";
import { request, assertOk, taskItems, safeHttpUrl, safeDomain, normalizeDomain } from "./dataforseo";

export const CONTENT_ESTIMATE_USD = 0.03, CONTENT_TYPICAL_USD = 0.0245;
export const CONTENT_SORTS = { relevance: "score,desc", authority: "domain_rank,desc", newest: "content_info.date_published,desc" } as const;
export const CONTENT_KINDS = ["blogs", "news", "organization", "ecommerce", "message-boards"] as const;

export const contentInput = z.object({
  query: z.string().trim().min(2).max(120).regex(/^[^%_\\]+$/, "No % _ or \\ in the search text"),
  sort: z.enum(["relevance", "authority", "newest"]).default("relevance"),
  /** Only pages published in the last N days. */
  sinceDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.literal(730)]).optional(),
  /** Only sites with at least this authority (0–100). */
  minAuthority: z.number().int().min(1).max(100).optional(),
  kind: z.enum(CONTENT_KINDS).optional(),
  /** Leave out one site (usually the customer's own). */
  exclude: z.string().max(253).refine((v) => !!normalizeDomain(v), "Enter the website to leave out like example.com").optional(),
  limit: z.union([z.literal(25), z.literal(50)]).default(25),
  offset: z.number().int().min(0).max(950).default(0),
  peek: z.boolean().default(false),
}).strict();
export type ContentInput = z.infer<typeof contentInput>;

type Clause = [string, string, unknown];
const stamp = (d: Date) => `${d.toISOString().slice(0, 19).replace("T", " ")} +00:00`;

/** The request body for a search. Pure, for tests. `now` only so the dates can be pinned. */
export function contentRequest(input: ContentInput, now = new Date()): Record<string, unknown> {
  const clauses: Clause[] = [["language", "=", "en"]];
  if (input.minAuthority) clauses.push(["domain_rank", ">=", input.minAuthority * 10]);
  if (input.sinceDays) clauses.push(["content_info.date_published", ">", stamp(new Date(now.getTime() - input.sinceDays * 864e5))]);
  // "Newest" must not be led by pages with a publication date in the future (the web has plenty).
  if (input.sort === "newest" || input.sinceDays) clauses.push(["content_info.date_published", "<", stamp(new Date(now.getTime() + 864e5))]);
  const excluded = input.exclude ? normalizeDomain(input.exclude) : null;
  if (excluded) clauses.push(["main_domain", "<>", excluded]);
  return {
    keyword: input.query, search_mode: "as_is", limit: input.limit, offset: input.offset, order_by: [CONTENT_SORTS[input.sort]],
    filters: clauses.flatMap((c, i) => (i ? ["and", c] : [c])),
    ...(input.kind ? { page_type: [input.kind] } : {}),
  };
}

export type ContentRow = { url: string; domain: string; title: string; snippet: string | null; authority: number | null; published: string | null; quality: number | null; author: string | null };
export type ContentPage = { query: string; rows: ContentRow[]; total: number | null; sourceRows: number; limit: number; offset: number; fetchedAt: string };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/** One result as a row; null when it has no usable address. A page appears once however many of its sections matched. */
export function parseContentItem(item: any): ContentRow | null {
  const url = safeHttpUrl(item?.url), domain = safeDomain(item?.main_domain) ?? safeDomain(item?.domain);
  if (!url || !domain) return null;
  const c = item?.content_info ?? {};
  const rank = num(item?.domain_rank), published = typeof c.date_published === "string" ? c.date_published.slice(0, 10) : null;
  return {
    url, domain, title: text(c.main_title, 200) ?? text(c.title, 200) ?? domain, snippet: text(c.snippet, 320),
    authority: rank === null ? null : Math.max(0, Math.min(100, Math.round(rank / 10))),
    published: published && /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : null,
    quality: num(c.content_quality_score), author: text(c.author, 80),
  };
}

export const contentDeps = { request };

export async function fetchContent(input: ContentInput): Promise<{ data: ContentPage; costUsd: number }> {
  const task = assertOk(await contentDeps.request("POST", "/content_analysis/search/live", [contentRequest(input)]), { treatNoResultsAsEmpty: true });
  const items = taskItems(task), seen = new Set<string>(), rows: ContentRow[] = [];
  for (const i of items) { const r = parseContentItem(i); if (r && !seen.has(r.url)) { seen.add(r.url); rows.push(r); } }
  return {
    data: { query: input.query, rows, total: num(task.result?.[0]?.total_count), sourceRows: items.length, limit: input.limit, offset: input.offset, fetchedAt: new Date().toISOString() },
    costUsd: typeof task.cost === "number" ? task.cost : 0,
  };
}
