/**
 * Shared facts for the marketing pages — one brand spelling, one copyright
 * line, and directory numbers read from the database instead of typed into
 * the copy (the old hard-coded "32,864+ permit databases" matched nothing).
 */
import { useQuery } from "@tanstack/react-query";

/** The one brand spelling every marketing surface uses. */
export const BRAND_NAME = "ConstructHUB";

export function copyrightNotice(): string {
  return `© ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.`;
}

/**
 * GET /api/databases/counts. `total`/`county`/`city` count jurisdictions
 * listed in the permit directory — NOT portals. `verifiedPortals` is the
 * number of those with a checked, live portal link; it only renders once the
 * API reports it (never guessed on the client).
 */
export interface PermitDirectoryCounts {
  total: number;
  county: number;
  city: number;
  verifiedPortals?: number;
}

export function usePermitDirectoryCounts() {
  return useQuery<PermitDirectoryCounts>({ queryKey: ["/api/databases/counts"] });
}

export const formatCount = (n: number) => n.toLocaleString("en-US");
