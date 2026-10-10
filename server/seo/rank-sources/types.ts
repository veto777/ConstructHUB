/**
 * Where a ranking can come from, so the sources can be run side by side and measured against each other
 * (owner, 2026-10-10: "lets try all 3 and see how accurate it is compared to DataForSEO").
 *
 *   dataforseo   the paid search-results source the rank tracker uses today (the baseline)
 *   gsc          Google Search Console: Google's own average position for the site's searches (free; own sites only;
 *                country-wide; 2–3 days behind; no results page, so no competitors and no map pack)
 *   cse          Google's Custom Search JSON API (official; $5 per 1,000 after 100 a day; a web index, not the real
 *                results page: no map pack, no city targeting)
 *   scrape       our own headless browser on the real results page, searched from the place (free apart from proxies;
 *                Google blocks it when it can — see ./google-scrape.ts)
 */
export type SourceName = "dataforseo" | "gsc" | "cse" | "scrape";
export type Device = "desktop" | "mobile";

export type SerpResult = { position: number; domain: string; url: string | null; title: string | null };

export type RankPlace = { code: number; label: string; /** Google's canonical name: "Bellingham,Washington,United States". */ canonical: string };

export type RankQuery = {
  keyword: string; domain: string; userId: number; device: Device;
  /** null = the whole country. */
  place: RankPlace | null; countryCode: number; languageCode: string;
};

export type RankObservation = {
  source: SourceName; keyword: string; device: Device; place: { code: number; label: string } | null;
  /** The site's organic position (null = not found where the source looked). */
  position: number | null; url: string | null;
  /** The first ten organic results, when the source has a results page (empty otherwise). */
  top: SerpResult[];
  /** Whether Google showed a map pack; null = this source cannot tell. */
  mapPack: boolean | null;
  localPosition: number | null;
  features: string[];
  costUsd: number; ms: number;
  /** The source could not answer (CAPTCHA, not configured, no data). */
  error?: string;
  /** How the figure was arrived at (Search Console: the days and impressions behind an average). */
  note?: string;
};

export interface RankSource {
  name: SourceName;
  label: string;
  available(q: Pick<RankQuery, "userId" | "domain">): Promise<{ ok: boolean; why?: string }>;
  check(q: RankQuery): Promise<RankObservation>;
}

/** The target domain or one of its sub-domains. */
export function isOwn(domain: string, target: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, ""), t = target.toLowerCase().replace(/^www\./, "");
  return d === t || d.endsWith(`.${t}`);
}

export const hostOf = (url: string): string | null => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };

/** The site's own position and page among organic results. */
export function ownIn(top: SerpResult[], target: string): { position: number | null; url: string | null } {
  const hit = top.find((r) => isOwn(r.domain, target));
  return hit ? { position: hit.position, url: hit.url } : { position: null, url: null };
}

/** Google's `uule` parameter for a canonical place name (the way the results page is told where the searcher is). */
export function uuleFor(canonical: string): string {
  const bytes = Buffer.from(canonical, "utf8");
  return "w+CAIQICI" + Buffer.concat([Buffer.from([bytes.length]), bytes]).toString("base64");
}

export const timed = async <T>(fn: () => Promise<T>): Promise<{ out: T; ms: number }> => {
  const t0 = Date.now();
  const out = await fn();
  return { out, ms: Date.now() - t0 };
};
