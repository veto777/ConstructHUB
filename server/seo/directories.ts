/**
 * Directories: which of the review sites, trade directories, maps and social profiles that matter to a
 * local contractor link to a site — and to its competitors. One lookup per site (the linking sites,
 * narrowed to this list). A directory "has" a site only when a page there LINKS to it: a profile with
 * no website link, or one the link database has not crawled, shows as missing. The page says so.
 */
import { z } from "zod";
import { request, assertOk, taskItems, safeDomain, type DfsTask } from "./dataforseo";
import { BACKLINKS_REQUEST_USD, BACKLINKS_ROW_USD } from "./pricing";

export type DirectoryKind = "reviews" | "trade" | "maps" | "social" | "business";
/** The list checked. Curated for US home-service contractors; not a list of every directory there is. */
export const DIRECTORIES: readonly { domain: string; name: string; kind: DirectoryKind }[] = [
  { domain: "yelp.com", name: "Yelp", kind: "reviews" }, { domain: "bbb.org", name: "Better Business Bureau", kind: "reviews" },
  { domain: "trustpilot.com", name: "Trustpilot", kind: "reviews" }, { domain: "birdeye.com", name: "Birdeye", kind: "reviews" },
  { domain: "angi.com", name: "Angi", kind: "trade" }, { domain: "homeadvisor.com", name: "HomeAdvisor", kind: "trade" }, { domain: "houzz.com", name: "Houzz", kind: "trade" },
  { domain: "thumbtack.com", name: "Thumbtack", kind: "trade" }, { domain: "porch.com", name: "Porch", kind: "trade" }, { domain: "buildzoom.com", name: "BuildZoom", kind: "trade" },
  { domain: "guildquality.com", name: "GuildQuality", kind: "trade" }, { domain: "bestpickreports.com", name: "Best Pick Reports", kind: "trade" }, { domain: "expertise.com", name: "Expertise", kind: "trade" },
  { domain: "nextdoor.com", name: "Nextdoor", kind: "maps" }, { domain: "mapquest.com", name: "MapQuest", kind: "maps" }, { domain: "foursquare.com", name: "Foursquare", kind: "maps" },
  { domain: "yellowpages.com", name: "Yellow Pages", kind: "business" }, { domain: "superpages.com", name: "Superpages", kind: "business" }, { domain: "manta.com", name: "Manta", kind: "business" },
  { domain: "chamberofcommerce.com", name: "ChamberofCommerce.com", kind: "business" }, { domain: "alignable.com", name: "Alignable", kind: "business" },
  { domain: "facebook.com", name: "Facebook", kind: "social" }, { domain: "instagram.com", name: "Instagram", kind: "social" }, { domain: "linkedin.com", name: "LinkedIn", kind: "social" },
  { domain: "youtube.com", name: "YouTube", kind: "social" }, { domain: "pinterest.com", name: "Pinterest", kind: "social" },
];
export const DIRECTORIES_MAX_SITES = 4;
/** One lookup for one site: at most one row per directory on the list. */
export const directoriesEstimateUsd = (sites: number) => Math.round(sites * (BACKLINKS_REQUEST_USD + DIRECTORIES.length * BACKLINKS_ROW_USD * 1.2) * 1e6) / 1e6;
export const directoriesDeps = { request };

export const directoriesInput = z.object({
  domain: z.string().min(3).max(253),
  competitors: z.array(z.string().min(3).max(253)).max(DIRECTORIES_MAX_SITES - 1).default([]),
  peek: z.boolean().default(false),
  refresh: z.boolean().default(false),
}).strict();

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const directoryRequest = (target: string) => ({
  target, include_subdomains: true, backlinks_status_type: "live", limit: 100, rank_scale: "one_thousand",
  filters: ["domain", "in", DIRECTORIES.map((d) => d.domain)], order_by: ["rank,desc"],
});

export type DirectoryRow = { domain: string; name: string; kind: DirectoryKind; /** Links found from this directory to each site, in the order of `sites`; null = that site's lookup did not load. */ links: (number | null)[] };
export type DirectoriesPage = { sites: string[]; rows: DirectoryRow[]; /** Sites whose lookup did not load (their column is unknown, not empty). */ missing: string[]; fetchedAt: string };

/** Pure: the table from each site's lookup (null = it failed). A directory's sub-domains count as the directory. */
export function buildDirectories(sites: string[], results: (any[] | null)[], fetchedAt = new Date().toISOString()): DirectoriesPage {
  const perSite = results.map((items) => {
    if (!items) return null;
    const found = new Map<string, number>();
    for (const i of items) {
      const d = safeDomain(i?.domain);
      const dir = d ? DIRECTORIES.find((x) => d === x.domain || d.endsWith(`.${x.domain}`)) : null;
      if (dir) found.set(dir.domain, (found.get(dir.domain) ?? 0) + Math.max(1, num(i.backlinks) ?? 1));
    }
    return found;
  });
  return {
    sites, fetchedAt, missing: sites.filter((_, n) => !perSite[n]),
    rows: DIRECTORIES.map((dir) => ({ ...dir, links: perSite.map((f) => (f ? f.get(dir.domain) ?? 0 : null)) })),
  };
}

/** One lookup per site, together. A site whose lookup fails is marked missing and not charged; all failing fails. */
export async function fetchDirectories(sites: string[]): Promise<{ data: DirectoriesPage; costUsd: number; customerUsd: number; costUnknown: boolean }> {
  let costUsd = 0, customerUsd = 0, costUnknown = false, firstError: unknown = null;
  const results = await Promise.all(sites.map(async (site) => {
    try {
      const task: DfsTask = assertOk(await directoriesDeps.request("POST", "/backlinks/referring_domains/live", [directoryRequest(site)]), { treatNoResultsAsEmpty: true });
      const cost = typeof task.cost === "number" ? task.cost : 0;
      costUsd += cost; customerUsd += cost;
      return taskItems(task);
    } catch (e: any) {
      firstError ??= e;
      costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
      if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) costUnknown = true;
      return null;
    }
  }));
  if (results.every((r) => r === null)) throw Object.assign(firstError instanceof Error ? firstError : new Error(String(firstError ?? "The lookups failed.")), { costUsd, costUnknown });
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return { data: buildDirectories(sites, results), costUsd: r6(costUsd), customerUsd: r6(customerUsd), costUnknown };
}
