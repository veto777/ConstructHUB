/**
 * Two helpers for the links on the keyword screens (links.ts says where every figure leads):
 * - `marketParams` turns a country into the address parameters a keyword link carries, so a keyword from a Spanish
 *   list opens in the Spanish market — and nothing is added for the default (United States, English).
 * - `useTrackedKeywords` says which keywords a site tracks, for the links that only make sense then (a tracked keyword
 *   has a page in the rank tracker). It reads the same saved answer the rank tracker reads — one request, shared
 *   through the cache — and never buys anything.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_MARKET } from "@shared/seo-markets";
import type { SeoSite } from "./shell";

export const marketParams = (m: { locationCode: number; languageCode: string } | null | undefined): { locationCode?: number; languageCode?: string } =>
  !m || (m.locationCode === DEFAULT_MARKET.locationCode && m.languageCode === DEFAULT_MARKET.languageCode) ? {} : { locationCode: m.locationCode, languageCode: m.languageCode };

/** The keywords tracked on `site`, lower-cased; empty until known (and when there is no site). */
export function useTrackedKeywords(site: Pick<SeoSite, "id"> | null | undefined): Set<string> {
  const q = useQuery<{ rows?: { keyword: string }[] }>({ queryKey: [`/api/seo/sites/${site?.id}/overview`], enabled: !!site, staleTime: 5 * 60_000 });
  return useMemo(() => new Set((q.data?.rows ?? []).map((r) => r.keyword.toLowerCase())), [q.data]);
}
