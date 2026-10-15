/**
 * The citation checklist: the ~30 directories a contractor should be listed on, Google first, and how a program
 * finds a business on each one (the "script" every audit runs — owner 2026-10-15: "the way this data is found and
 * acquired we will build a script for all future users").
 *
 *   search        the directory's own search page for a business name + place, when it has one a program can load
 *   mode          how that directory answers: plain HTTP, or only a real browser (403 / JavaScript-only pages)
 *   listingPath   what a listing's URL looks like on the site — candidates are links on the search page whose
 *                 path matches and whose card names the business
 *   manualOnly    no automatic check exists (Google: filled from the linked profile; Facebook: sign-in only; …)
 *
 * Probed from the production host on 2026-10-15: plain HTTP reaches BBB, MapQuest, MerchantCircle, Brownbook,
 * EZLocal, ShowMeLocal, CitySearch, Buildzoom, Porch, Bing; a headless browser additionally reaches Yellow Pages,
 * Superpages, DexKnows, Manta, HotFrog, Angi, Houzz, Nextdoor, Foursquare and Chamber of Commerce; Yelp,
 * TripAdvisor and Cylex refuse both, so those run on web search + the owner's own eyes (finder.ts).
 * Honest by construction (CLAUDE.md): a directory that cannot be read stays "unconfirmed", never "not listed".
 */
export type SearchQuery = { name: string; city: string; state: string; zip: string; /** "City, ST" (or the zip). */ place: string };

export type CitationDirectory = {
  name: string;
  /** The site's domain (also the host listings live on; subdomains count). */
  url: string;
  category: string;
  search?: (q: SearchQuery) => string;
  mode: "http" | "browser";
  listingPath: RegExp;
  manualOnly?: string;
};

const enc = encodeURIComponent;

// Checklist order: Google Business Profile first (it drives local search), then the rest by priority.
export const CITATION_DIRECTORIES: readonly CitationDirectory[] = [
  { name: "Google Business Profile", url: "google.com", category: "Search Engine", mode: "http", listingPath: /maps/, manualOnly: "Filled in from your linked Google Business Profile." },
  { name: "Yelp", url: "yelp.com", category: "Review Site", mode: "browser", listingPath: /^\/biz\//, search: (q) => `https://www.yelp.com/search?find_desc=${enc(q.name)}&find_loc=${enc(q.place)}` },
  { name: "BBB", url: "bbb.org", category: "Business Directory", mode: "http", listingPath: /\/profile\//, search: (q) => `https://www.bbb.org/search?find_text=${enc(q.name)}&find_loc=${enc(q.place)}` },
  { name: "Yellow Pages", url: "yellowpages.com", category: "Business Directory", mode: "browser", listingPath: /\/mip\//, search: (q) => `https://www.yellowpages.com/search?search_terms=${enc(q.name)}&geo_location_terms=${enc(q.place)}` },
  { name: "Angi", url: "angi.com", category: "Home Services", mode: "browser", listingPath: /\/companylist\//, search: (q) => `https://www.angi.com/search?q=${enc(q.name)}&location=${enc(q.place)}` },
  { name: "HomeAdvisor", url: "homeadvisor.com", category: "Home Services", mode: "browser", listingPath: /\/rated\./ },
  { name: "Houzz", url: "houzz.com", category: "Home & Design", mode: "browser", listingPath: /\/pro(?:fessionals)?\//, search: (q) => `https://www.houzz.com/professionals/probr0-bo~?query=${enc(q.name)}` },
  { name: "Facebook", url: "facebook.com", category: "Social Media", mode: "http", listingPath: /./, manualOnly: "Facebook shows business pages only to signed-in people. Search Facebook for your page and paste its link." },
  { name: "Nextdoor", url: "nextdoor.com", category: "Community", mode: "browser", listingPath: /\/pages\//, search: (q) => `https://nextdoor.com/find-business/?q=${enc(q.name)}` },
  { name: "Thumbtack", url: "thumbtack.com", category: "Home Services", mode: "browser", listingPath: /\/service\// },
  { name: "MapQuest", url: "mapquest.com", category: "Maps & Navigation", mode: "http", listingPath: /^\/us\//, search: (q) => `https://www.mapquest.com/search/results?query=${enc(`${q.name} ${q.place}`)}` },
  { name: "Superpages", url: "superpages.com", category: "Business Directory", mode: "browser", listingPath: /\/bp\//, search: (q) => `https://www.superpages.com/search?search_terms=${enc(q.name)}&geo_location_terms=${enc(q.place)}` },
  { name: "DexKnows", url: "dexknows.com", category: "Business Directory", mode: "browser", listingPath: /\/bp\//, search: (q) => `https://www.dexknows.com/search?search_terms=${enc(q.name)}&geo_location_terms=${enc(q.place)}` },
  { name: "CitySearch", url: "citysearch.com", category: "Local Search", mode: "http", listingPath: /\/profile\//, search: (q) => `https://www.citysearch.com/search?what=${enc(q.name)}&where=${enc(q.place)}` },
  { name: "Manta", url: "manta.com", category: "Business Directory", mode: "browser", listingPath: /^\/c\//, search: (q) => `https://www.manta.com/search?search=${enc(q.name)}&context=all&search_location=${enc(q.place)}` },
  { name: "MerchantCircle", url: "merchantcircle.com", category: "Business Directory", mode: "http", listingPath: /^\/[a-z0-9-]+-[a-z]{2}\/?$/i, search: (q) => `https://www.merchantcircle.com/search?q=${enc(q.name)}&qn=${enc(q.place)}` },
  { name: "Foursquare", url: "foursquare.com", category: "Local Search", mode: "browser", listingPath: /^\/v\//, search: (q) => `https://foursquare.com/explore?near=${enc(q.place)}&q=${enc(q.name)}` },
  { name: "Apple Maps", url: "maps.apple.com", category: "Maps & Navigation", mode: "http", listingPath: /./, manualOnly: "Apple Maps has no web search a program can read. Look your business up in the Maps app and mark what you see." },
  { name: "Bing Places", url: "bing.com", category: "Search Engine", mode: "http", listingPath: /ypid/i, search: (q) => `https://www.bing.com/maps?q=${enc(`${q.name} ${q.place}`)}` },
  { name: "TripAdvisor", url: "tripadvisor.com", category: "Review Site", mode: "browser", listingPath: /Review|Profile/ },
  { name: "Buildzoom", url: "buildzoom.com", category: "Home Services", mode: "http", listingPath: /\/contractor\//, search: (q) => `https://www.buildzoom.com/search?q=${enc(q.name)}&location=${enc(q.place)}` },
  { name: "Porch", url: "porch.com", category: "Home Services", mode: "http", listingPath: /\/pp\/?$/, search: (q) => `https://porch.com/search?q=${enc(q.name)}&loc=${enc(q.place)}` },
  { name: "Bark", url: "bark.com", category: "Home Services", mode: "http", listingPath: /\/company\//, search: (q) => `https://www.bark.com/en/us/search/?q=${enc(q.name)}` },
  { name: "Expertise", url: "expertise.com", category: "Business Directory", mode: "http", listingPath: /^\/[a-z]{2}\/[a-z0-9-]+\/[a-z0-9-]+/ },
  { name: "Chamber of Commerce", url: "chamberofcommerce.com", category: "Business Directory", mode: "browser", listingPath: /\/business-directory\//, search: (q) => `https://www.chamberofcommerce.com/search?what=${enc(q.name)}&where=${enc(q.place)}` },
  { name: "HotFrog", url: "hotfrog.com", category: "Business Directory", mode: "browser", listingPath: /\/company\//, search: (q) => `https://www.hotfrog.com/search/us/${enc(q.name)}` },
  { name: "Brownbook", url: "brownbook.net", category: "Business Directory", mode: "http", listingPath: /\/business\//, search: (q) => `https://www.brownbook.net/search/worldwide/${enc(q.name)}` },
  { name: "ShowMeLocal", url: "showmelocal.com", category: "Business Directory", mode: "http", listingPath: /profile\.aspx/i, search: (q) => `https://www.showmelocal.com/search.aspx?q=${enc(q.name)}&l=${enc(q.place)}` },
  { name: "EZLocal", url: "ezlocal.com", category: "Business Directory", mode: "http", listingPath: /^\/[a-z]{2}\/[a-z0-9-]+\/[a-z0-9-]+\/\d+/, search: (q) => `https://www.ezlocal.com/search?q=${enc(q.name)}&l=${enc(q.place)}` },
  { name: "Local.com", url: "local.com", category: "Local Search", mode: "http", listingPath: /\/business\// },
];

/** Checklists built before the rename carry the old name. */
export const LEGACY_CITATION_NAMES: Record<string, string> = { "Google My Business": "Google Business Profile" };

export const citationRank = new Map(CITATION_DIRECTORIES.map((d, i) => [d.name, i]));

export const directoryByName = (name: string): CitationDirectory | undefined => {
  const n = LEGACY_CITATION_NAMES[name] ?? name;
  return CITATION_DIRECTORIES.find((d) => d.name === n) ?? CITATION_DIRECTORIES.find((d) => d.name.toLowerCase() === n.trim().toLowerCase());
};

/** Is this URL on the directory (its domain or a subdomain)? */
export function onDirectory(url: string, dir: CitationDirectory): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === dir.url || host.endsWith(`.${dir.url}`);
  } catch { return false; }
}

/** The directory a listing URL belongs to, if any (spreadsheet imports name a site by its link). */
export const directoryOfUrl = (url: string): CitationDirectory | undefined => CITATION_DIRECTORIES.find((d) => !d.manualOnly && onDirectory(url, d)) ?? CITATION_DIRECTORIES.find((d) => onDirectory(url, d));
