/**
 * Figures the SEO pages (client/src/pages/seo) and the SEO server (server/seo) must agree on, in one place —
 * the saved-copy window and the authority scale (findings log 2026-10-11, SEO Suite #4 and #5).
 */

/**
 * A bought lookup — a Site explorer report, a keyword overview, a planner table, a content search, a directories or
 * gap comparison, a mentions check — reopens free for this many days; after that it is bought again. One window for
 * every saved copy, so no page says "a day" while another says "a week".
 */
export const SEO_SAVED_DAYS = 7;

/** The window in words, for the pages: "a week", "a day", "N days". */
export const savedForWords = (days: number): string => (days === 7 ? "a week" : days === 1 ? "a day" : `${days} days`);

/**
 * Link authority on ONE scale, 0–100: the data source's domain rank (0–1000) divided by ten, as Site explorer, the
 * dashboard and Content explorer have always shown it. Backlinks shows the same figure the same way — never the raw
 * 0–1000 beside a 0–100 elsewhere for one site.
 */
export const authorityOf = (rank: number | null | undefined): number | null =>
  rank == null || !Number.isFinite(rank) ? null : Math.max(0, Math.min(100, Math.round(rank / 10)));
