/**
 * Which help entry is a page's "i": the route matcher, kept apart from the registry's text so a page header can
 * decide whether to show its "i" from the generated route table (./routes.ts, a few KB) without loading every
 * entry (./registry.ts). The registry's helpKeyForRoute and the client's useHelpKeyForRoute
 * (client/src/lib/use-help-entry.ts) both call this one function — never a copy of it.
 */
import type { HelpEntry } from "./types";

/** What route matching reads from an entry. scripts/tutorials/gen-index.ts writes one per entry to ./routes.ts. */
export type HelpRouteRow = Pick<HelpEntry, "key" | "route" | "group"> & Partial<Pick<HelpEntry, "alsoAt" | "parent" | "unlisted">>;

/**
 * The entry for a page path, so a page title can carry its "i" without naming a key (owner 2026-10-15: every
 * page gets an "i" that says what it is for and how to use it, with the walkthrough inside). Exact route first,
 * then the longest route prefix (an entry's `route`, or one of its `alsoAt` routes); at the same route a feature
 * beats its sections (they share the feature's route unless a section declares a more specific one, e.g.
 * "/cloudflare/connections"), and among features the one named after the route's last segment wins ("/crm/settings"
 * → "crm-settings" rather than any of the dozen entries that live on that page; "/crm/pipeline" → "crm-pipeline",
 * not the shorter "crm-project"), then the shortest key, then alphabetical — deterministic, never file order.
 * Query and hash are ignored.
 */
export function helpKeyForRouteIn(rows: readonly HelpRouteRow[], pathname: string): string | undefined {
  const path = (pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/");
  const clean = (r: string) => r.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  /** How well a feature's key names the route's last segment: exact ("crm-settings" / "settings"), then "-settings", then contains it. */
  const named = (key: string, r: string) => {
    const seg = r.slice(r.lastIndexOf("/") + 1);
    return key === seg || key === `crm-${seg}` ? 3 : key.endsWith(`-${seg}`) ? 2 : key.includes(seg) ? 1 : 0;
  };
  let best: HelpRouteRow | undefined, bestLen = -1, bestRank = -1;
  for (const e of rows) {
    if (e.unlisted) continue;
    for (const r of [e.route, ...(e.alsoAt ?? [])].map(clean)) {
      if (r === "/" || !(path === r || path.startsWith(r + "/"))) continue;
      // Sections lowest, then the "Start here" films (a tour of the CRM is not the home page's "i"), then features by name.
      const rank = e.parent ? 0 : e.group === "Start here" ? 1 : 2 + named(e.key, r);
      // Still tied: the shortest key, then alphabetical — never the order the entries happen to be listed in.
      const wins = r.length > bestLen || (r.length === bestLen && (rank > bestRank ||
        (rank === bestRank && !!best && (e.key.length < best.key.length || (e.key.length === best.key.length && e.key < best.key)))));
      if (wins) { best = e; bestLen = r.length; bestRank = rank; }
    }
  }
  return best?.key;
}
