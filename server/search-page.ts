import { z } from "zod";

/**
 * Pages of stored permit matches for the Search page (/search): POST /api/search (the first page),
 * GET /api/search/results (older pages) and GET /api/search/live/:searchId (the poll).
 *
 * Reviewers (2026-10-11): the search read the newest 1,000 stored matches nationwide and only then
 * kept the chosen area's, so in a busy jurisdiction older matches were silently unreachable. The
 * area filter now runs in SQL and the answer is a cursor page: `totalResults` is the real count in
 * scope, `nextCursor` the id to send back as `before` for the next (older) page, null on the last.
 * Order is newest first by result id: ids follow insertion order, so they stay stable where rows
 * share a created_at (the rule server/permits/hit-pagination.ts uses for watch hits).
 *
 * The default page is the old cap on purpose: the Search page still lists everything it receives
 * and pages it 50 at a time in the browser, so until it asks for `limit=50` and follows
 * `nextCursor`, what it shows does not change — only the count and cursor now say when older
 * matches exist.
 */
export const SEARCH_PAGE_MAX = 1000;

export const searchPageInput = z.object({
  limit: z.coerce.number().int().min(1).max(SEARCH_PAGE_MAX).default(SEARCH_PAGE_MAX),
  before: z.coerce.number().int().positive().optional(),
});
export type SearchPage = z.infer<typeof searchPageInput>;

export const SEARCH_PAGE_MESSAGE =
  `limit must be a whole number from 1 to ${SEARCH_PAGE_MAX.toLocaleString("en-US")}, and before the id of a result on the previous page`;

export interface ResultPage<T> {
  results: T[];
  /** Every stored match in scope, not only this page. */
  totalResults: number;
  /** Send back as `before` for the next page of older matches; null when this was the last page. */
  nextCursor: number | null;
}

/** Turns a query that fetched one row past the page into the page and its cursor. */
export function resultPage<T extends { id: number }>(rows: T[], limit: number, totalResults: number): ResultPage<T> {
  const results = rows.slice(0, limit);
  return { results, totalResults, nextCursor: rows.length > limit ? results[results.length - 1].id : null };
}

/** Reads limit/before from a request body or query string; undefined when either is malformed. */
export function readSearchPage(source: unknown): SearchPage | undefined {
  const o = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
  const parsed = searchPageInput.safeParse({ limit: o.limit, before: o.before });
  return parsed.success ? parsed.data : undefined;
}
