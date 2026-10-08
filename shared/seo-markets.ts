/**
 * The countries (with a language) the Site Explorer and Keywords Explorer can
 * be pointed at. Each is a pair the keyword database really has; anything
 * else is refused by the server. Rank tracking has its own, finer list of
 * places (server/seo/locations.ts).
 */
export type SeoMarket = { locationCode: number; languageCode: string; label: string };

export const SEO_MARKETS: readonly SeoMarket[] = [
  { locationCode: 2840, languageCode: "en", label: "United States" },
  { locationCode: 2840, languageCode: "es", label: "United States (Spanish)" },
  { locationCode: 2124, languageCode: "en", label: "Canada" },
  { locationCode: 2124, languageCode: "fr", label: "Canada (French)" },
  { locationCode: 2826, languageCode: "en", label: "United Kingdom" },
  { locationCode: 2372, languageCode: "en", label: "Ireland" },
  { locationCode: 2036, languageCode: "en", label: "Australia" },
  { locationCode: 2554, languageCode: "en", label: "New Zealand" },
  { locationCode: 2710, languageCode: "en", label: "South Africa" },
  { locationCode: 2484, languageCode: "es", label: "Mexico" },
];
export const DEFAULT_MARKET: SeoMarket = SEO_MARKETS[0];

export const marketKey = (m: { locationCode: number; languageCode: string }) => `${m.locationCode}:${m.languageCode}`;
export const findMarket = (locationCode: unknown, languageCode: unknown): SeoMarket | null =>
  SEO_MARKETS.find((m) => m.locationCode === locationCode && m.languageCode === languageCode) ?? null;
/** The name to show for a saved report; one saved before countries existed is the United States. */
export const marketLabel = (locationCode: unknown, languageCode: unknown = "en") =>
  (findMarket(locationCode, languageCode) ?? SEO_MARKETS.find((m) => m.locationCode === locationCode) ?? DEFAULT_MARKET).label;
