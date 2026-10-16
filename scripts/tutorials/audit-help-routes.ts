/**
 * Route audit for the help system: does every signed-in page of the app resolve to a help entry (its "i"), and
 * does that entry have a film to play (its own walkthrough, or its feature's intro film — shared/help/registry.ts
 * INTRO_FALLBACKS)? Static: reads the <Route path="…"> lines of client/src/App.tsx (the main app's DashboardRouter
 * and the CRM's PortalRouter), resolves each through helpKeyForRoute (route parameters get a sample value), and
 * prints one line per route. Public, marketing, legal, sign-in, customer-token and redirect routes are skipped.
 *
 *   npx tsx scripts/tutorials/audit-help-routes.ts            # the table; exit 1 when a route has no entry
 *   npx tsx scripts/tutorials/audit-help-routes.ts --list      # only the routes that resolve, one per line
 *                                                               # (feed them to audit-help-pages.cjs)
 *   npx tsx scripts/tutorials/audit-help-routes.ts --list all  # every audited route, resolved or not
 *   npx tsx scripts/tutorials/audit-help-routes.ts --json      # the same as JSON
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { helpEntry, helpKeyForRoute, introFallbackKey } from "../../shared/help/registry";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Routes that are not a signed-in page of the product: no "i" is expected there. */
const SKIP: RegExp[] = [
  /^\/$/, /^\/landing$/, /^\/features(\/|$)/, /^\/done-for-you(\/|$)/, /^\/pricing$/, /^\/privacy$/, /^\/terms$/, /^\/support$/,
  /^\/data-deletion$/, /^\/auth$/, /^\/e\/:token/, /^\/i\/:token/, /^\/co\/:token/, /^\/jc\/:token/, /^\/portal\/:token/,
  /^\/review\/:token/, /^\/contract\/sign\//, /^\/lead-form\//, /^\/invite\//, /^\/crm-terms$/, /^\/crm-privacy$/, /^\/guides$/,
  /^\/not-found$/, /^\/tutorials$/, /-landing$/, /^\/googleads-/, /^\/crm\/join$/, /^\/account\/delete$/, /^\/crm-app$/,
];

type Found = { route: string; host: "app" | "crm"; component: string | null };

/** The <Route> lines of one router function in App.tsx. */
function routesOf(src: string, fn: string, host: Found["host"]): Found[] {
  const start = src.indexOf(`function ${fn}()`);
  if (start === -1) throw new Error(`App.tsx has no ${fn}`);
  const end = src.indexOf("\nfunction ", start + 1);
  const block = src.slice(start, end === -1 ? undefined : end);
  const out: Found[] = [];
  for (const line of block.split("\n")) {
    const m = /<Route\s+path="([^"]+)"(?:\s+component=\{(\w+)\})?/.exec(line);
    if (!m) continue;
    const [, route, component] = m;
    // A redirect is not a page.
    if (/<Redirect/.test(line) || /Redirect|Moved/.test(component ?? "")) continue;
    if (SKIP.some((re) => re.test(route))) continue;
    if (!out.some((f) => f.route === route && f.host === host)) out.push({ route, host, component: component ?? null });
  }
  return out;
}

/** A sample address for a route pattern: each ":param" becomes "1" (helpKeyForRoute matches on the prefix). */
const sampleAddress = (route: string) => route.replace(/:[A-Za-z]+/g, "1");

type RouteAudit = Found & {
  address: string; key: string | null; title: string | null;
  /** "walkthrough": the entry's own film; "intro": its feature's intro film; null: nothing to play. */
  film: "walkthrough" | "intro" | null; filmKey: string | null;
};

function auditRoutes(): RouteAudit[] {
  const src = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
  const found = [...routesOf(src, "DashboardRouter", "app"), ...routesOf(src, "PortalRouter", "crm")];
  return found.map((f) => {
    const address = sampleAddress(f.route);
    const key = helpKeyForRoute(address) ?? null;
    const e = key ? helpEntry(key) : undefined;
    const film = e?.videoSource ?? null;
    const filmKey = !e ? null : film === "walkthrough" ? e.key : film === "intro" ? (introFallbackKey(e) ?? null) : null;
    return { ...f, address, key, title: e?.title ?? null, film, filmKey };
  });
}

const main = () => {
  const args = process.argv.slice(2);
  const rows = auditRoutes();
  const unresolved = rows.filter((r) => !r.key);
  if (args.includes("--json")) { console.log(JSON.stringify(rows, null, 2)); process.exit(unresolved.length ? 1 : 0); }
  if (args.includes("--list")) {
    const all = args[args.indexOf("--list") + 1] === "all";
    for (const r of rows) if (all || r.key) console.log(r.address);
    process.exit(0);
  }
  const w = Math.max(...rows.map((r) => r.route.length)) + 2;
  console.log(`${"route".padEnd(w)} host  entry                         film`);
  for (const r of rows) {
    const film = r.film === "walkthrough" ? `walkthrough (${r.filmKey})` : r.film === "intro" ? `intro film (${r.filmKey})` : r.key ? "none" : "";
    console.log(`${r.route.padEnd(w)} ${r.host.padEnd(5)} ${(r.key ?? "— NO ENTRY —").padEnd(29)} ${film}`);
  }
  const withFilm = rows.filter((r) => r.film).length;
  console.log(`\n${rows.length} routes audited: ${rows.length - unresolved.length} resolve to an entry, ${withFilm} have a film to play, ${unresolved.length} unresolved.`);
  if (unresolved.length) {
    console.log("\nNo help entry covers these routes (helpKeyForRoute):");
    for (const r of unresolved) console.log(`  ${r.route}${r.component ? `  (${r.component})` : ""}`);
    process.exit(1);
  }
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
