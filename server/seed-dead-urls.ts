/**
 * Permit-portal URLs the original (Replit) seed shipped that a check found DEAD, and the boot step that removes
 * them from rows that still hold exactly that seed value.
 *
 * Source: link audit w3-r4 (2026-10-15), re-checked the same day with `curl -sIL` and a GET fallback plus a DNS
 * lookup. Every entry below is NXDOMAIN or answers 404/502 — most are guessed `aca-prod.accela.com/<CODE>/`
 * agency codes that never existed. A 403 (WAF / bot block) or a timeout is inconclusive, NOT dead: those URLs
 * stay and are listed in SEED_URLS_PENDING_VERIFICATION instead.
 *
 * CLAUDE.md HARD RULE: a dead URL becomes null, or the verified permit-portals.json entry for the SAME
 * jurisdiction — never a guessed replacement.
 */
export const DEAD_SEED_URLS_CHECKED_AT = "2026-10-15T00:00:00.000Z";

export const DEAD_SEED_URLS: readonly string[] = [
  "https://aca-prod.accela.com/ABQ/", // HTTP 404
  "https://aca-prod.accela.com/ACDPW/", // HTTP 404
  "https://aca-prod.accela.com/ADAMSCOUNTYCO/", // HTTP 404
  "https://aca-prod.accela.com/ANNARBOR/", // HTTP 404
  "https://aca-prod.accela.com/BALTIMORECO/", // HTTP 404
  "https://aca-prod.accela.com/BATONROUGE/", // HTTP 404
  "https://aca-prod.accela.com/BOSTON/", // HTTP 404
  "https://aca-prod.accela.com/BOZEMAN/", // HTTP 404
  "https://aca-prod.accela.com/BUFFALONY/", // HTTP 404
  "https://aca-prod.accela.com/CAMBRIDGE/", // HTTP 404
  "https://aca-prod.accela.com/CEDARRAPIDS/", // HTTP 404
  "https://aca-prod.accela.com/CHARLESTON/", // HTTP 404
  "https://aca-prod.accela.com/CHATTANOOGA/", // HTTP 404
  "https://aca-prod.accela.com/CHEROKEEGA/", // HTTP 404
  "https://aca-prod.accela.com/CLEVELAND/", // HTTP 404
  "https://aca-prod.accela.com/DEKALBGA/", // HTTP 404
  "https://aca-prod.accela.com/DENTON/", // HTTP 404
  "https://aca-prod.accela.com/DURHAM/", // HTTP 404
  "https://aca-prod.accela.com/EUGENE/", // HTTP 404
  "https://aca-prod.accela.com/FARGOND/", // HTTP 404
  "https://aca-prod.accela.com/FAYAR/", // HTTP 404
  "https://aca-prod.accela.com/FFXCO/", // HTTP 404
  "https://aca-prod.accela.com/FORSYTH/", // HTTP 404
  "https://aca-prod.accela.com/FORTWAYNE/", // HTTP 404
  "https://aca-prod.accela.com/FORTWORTH/", // HTTP 404
  "https://aca-prod.accela.com/GREENVILLECO/", // HTTP 404
  "https://aca-prod.accela.com/GUILFORD/", // HTTP 404
  "https://aca-prod.accela.com/HENDERSONNV/", // HTTP 404
  "https://aca-prod.accela.com/HENRICO/", // HTTP 404
  "https://aca-prod.accela.com/HOUSTON/", // HTTP 404
  "https://aca-prod.accela.com/HOWARDCO/", // HTTP 404
  "https://aca-prod.accela.com/INDIANAPOLIS/", // HTTP 404
  "https://aca-prod.accela.com/JCNJ/", // HTTP 404
  "https://aca-prod.accela.com/JEFFERSONPARISH/", // HTTP 404
  "https://aca-prod.accela.com/JOCOGOV/", // HTTP 404
  "https://aca-prod.accela.com/KANSASCITYMO/", // HTTP 404
  "https://aca-prod.accela.com/LAKECOUNTYIL/", // HTTP 404
  "https://aca-prod.accela.com/LASVEGASNV/", // HTTP 404
  "https://aca-prod.accela.com/LEXINGTON/", // HTTP 404
  "https://aca-prod.accela.com/LITTLEROCKAR/", // HTTP 404
  "https://aca-prod.accela.com/LOUDOUN/", // HTTP 404
  "https://aca-prod.accela.com/LOUISVILLE/", // HTTP 404
  "https://aca-prod.accela.com/MEMPHIS/", // HTTP 404
  "https://aca-prod.accela.com/MINNEAPOLIS/", // HTTP 404
  "https://aca-prod.accela.com/MONT/", // HTTP 404
  "https://aca-prod.accela.com/NASHVILLE/", // HTTP 404
  "https://aca-prod.accela.com/NEWARKNJ/", // HTTP 404
  "https://aca-prod.accela.com/OGDEN/", // HTTP 404
  "https://aca-prod.accela.com/OKLAHOMA/", // HTTP 404
  "https://aca-prod.accela.com/PITTSBURGH/", // HTTP 404
  "https://aca-prod.accela.com/PLANO/", // HTTP 404
  "https://aca-prod.accela.com/PRINCEWIILLIAM/", // HTTP 404
  "https://aca-prod.accela.com/PROVIDENCE/", // HTTP 404
  "https://aca-prod.accela.com/PROVO/", // HTTP 404
  "https://aca-prod.accela.com/RALEIGH/", // HTTP 404
  "https://aca-prod.accela.com/RICHLAND/", // HTTP 404
  "https://aca-prod.accela.com/SALEMOR/", // HTTP 404
  "https://aca-prod.accela.com/SANANTONIO/", // HTTP 404
  "https://aca-prod.accela.com/SPRINGFIELDMO/", // HTTP 404
  "https://aca-prod.accela.com/STAMFORD/", // HTTP 404
  "https://aca-prod.accela.com/STGEORGE/", // HTTP 404
  "https://aca-prod.accela.com/STLOUIS/", // HTTP 404
  "https://aca-prod.accela.com/STLOUISCO/", // HTTP 404
  "https://aca-prod.accela.com/STPAUL/", // HTTP 404
  "https://aca-prod.accela.com/TULSA/", // HTTP 404
  "https://aca-prod.accela.com/VBGOV/", // HTTP 404
  "https://aca-prod.accela.com/WAKE/", // HTTP 404
  "https://aca-prod.accela.com/WASHCO/", // HTTP 404
  "https://aca-prod.accela.com/WASHOENV/", // HTTP 404
  "https://aca.muni.org/citizen/", // NXDOMAIN
  "https://acp.anaheim.net/etrakit/", // NXDOMAIN
  "https://fnsb.gov/140/Building", // HTTP 404
  "https://jeffconline.jccal.org/", // NXDOMAIN
  "https://kootenai.id.gov/building/", // NXDOMAIN
  "https://pdsd.tucsonaz.gov/", // NXDOMAIN
  "https://permits.dmgov.org/", // NXDOMAIN
  "https://permits.huntsvilleal.gov/", // NXDOMAIN
  "https://permits.matsugov.us/", // NXDOMAIN
  "https://permits.ocpw.ocgov.com/", // NXDOMAIN
  "https://planning.maricopa.gov/", // NXDOMAIN
  "https://rfrp.rivcoready.org/IndyOSS/", // NXDOMAIN
  "https://skagitcountywa.gov/Search/Permits/SearchAdvanced.aspx", // HTTP 404
  "https://slco.org/planning-and-development-services/", // HTTP 404
  "https://wichitaks.devnetwedge.com/", // NXDOMAIN
  "https://www.cookcountyil.gov/building", // HTTP 404
  "https://www.denvergov.org/Government/Agencies-Departments-Offices/Community-Planning-and-Development/Building-Permits", // HTTP 404
  "https://www.jeffco.us/3032/Permit-Search", // HTTP 404
  "https://www.portlandoregon.gov/bds/permits/", // HTTP 404
];

/**
 * Non-null URLs still in the seed (server/seed-all-states.ts ALL_DATABASES, server/seed.ts NORTHERN_WA_DATABASES)
 * that server/data/permit-portals.json does not carry. They were not found dead (most answered 2xx/3xx; a few are
 * WAF 403s or timeouts, which are inconclusive) but no verified source backs them either. They need a
 * build-permit-portals / verify-links pass before they can be called verified. A new seed URL must be added to
 * permit-portals.json or to this list (server/seed-urls.test.ts).
 */
export const SEED_URLS_PENDING_VERIFICATION: readonly string[] = [
  "https://a810-bisweb.nyc.gov/",
  "https://a810-bisweb.nyc.gov/bisweb/bispi00.jsp",
  "https://abc.austintexas.gov/",
  "https://aca-prod.accela.com/AACO/",
  "https://aca-prod.accela.com/ATLANTA_GA/",
  "https://aca-prod.accela.com/BOISE/",
  "https://aca-prod.accela.com/CHARLOTTE/",
  "https://aca-prod.accela.com/CHESTERFIELD/",
  "https://aca-prod.accela.com/CINCINNATI/",
  "https://aca-prod.accela.com/CLACKAMAS/",
  "https://aca-prod.accela.com/COBBCO/",
  "https://aca-prod.accela.com/COLUMBUS/",
  "https://aca-prod.accela.com/COSPRINGS/",
  "https://aca-prod.accela.com/DALLASTX/",
  "https://aca-prod.accela.com/DAYTON/",
  "https://aca-prod.accela.com/DETROIT/",
  "https://aca-prod.accela.com/ELPASO/",
  "https://aca-prod.accela.com/GRANDRAPIDS/",
  "https://aca-prod.accela.com/GWINNETT/",
  "https://aca-prod.accela.com/KNOXVILLE/",
  "https://aca-prod.accela.com/LINCOLN/",
  "https://aca-prod.accela.com/MADISON/",
  "https://aca-prod.accela.com/MECKLENBURG/",
  "https://aca-prod.accela.com/MILWAUKEE/",
  "https://aca-prod.accela.com/MISSOULA/",
  "https://aca-prod.accela.com/OMAHA/",
  "https://aca-prod.accela.com/PGCO/",
  "https://aca-prod.accela.com/RENO/",
  "https://aca-prod.accela.com/SANDIEGO/",
  "https://aca-prod.accela.com/SCCGOV/",
  "https://aca-prod.accela.com/SLC/",
  "https://adacounty.id.gov/developmentservices/",
  "https://atlas.phila.gov/",
  "https://building.saccounty.net/",
  "https://ci-anacortes-wa.smartgovcommunity.com/Public/Home",
  "https://ci-ferndale-wa.smartgovcommunity.com/",
  "https://ci-lynden-wa.smartgovcommunity.com/Public/Home",
  "https://ci-mountvernon-wa.smartgovcommunity.com/public/documentsview",
  "https://citizenaccess.clarkcountynv.gov/",
  "https://co-island-wa.smartgovcommunity.com/",
  "https://co-sanjuan-wa.smartgovcommunity.com/",
  "https://dppweb.honolulu.gov/",
  "https://epcdevplanreview.com/",
  "https://epicla.lacounty.gov/",
  "https://eservices.scottsdaleaz.gov/",
  "https://icgov.org/city-government/departments-and-divisions/neighborhood-and-development-services",
  "https://ladbs.org/permits",
  "https://nccde.org/478/Building-Permits",
  "https://nsdonline.phoenix.gov/Permits/",
  "https://oakharbor.onlama.com/",
  "https://permits.cob.org/etrakit/",
  "https://permits.cob.org/etrakit/Search/permit.aspx",
  "https://permits.harriscountytx.gov/",
  "https://sbcounty.gov/lus/",
  "https://selfservice.portlandmaine.gov/EnerGov_Prod/",
  "https://siouxfalls.org/building-services",
  "https://sjpermits.org/",
  "https://twn-coupeville-wa.smartgovcommunity.com/Public/Home",
  "https://webcms.pima.gov/government/development_services/",
  "https://www.pinalcountyaz.gov/CommunityDevelopment/",
  "https://www.skagitcounty.net/Departments/PlanningAndPermit/permitsearch.htm",
  "https://www.whatcomcounty.us/4547/Customer-Service-Portal",
];

export interface PortalEntry { jurisdiction: string; url: string | null; platform: string | null; linkStatus?: string; lastVerifiedAt?: string | null }
export interface SeedUrlRow {
  jurisdiction: string; jurisdictionType: string; countyName: string | null; stateCode: string | null;
  portalUrl: string | null; searchUrl: string | null;
}
export interface SeedUrlFix {
  portalUrl: string | null; searchUrl: string | null; platform?: string | null;
  linkStatus?: string; isActive?: boolean; lastVerifiedAt?: Date | null;
}

/** The permit-portals.json key for a row: "City, ST" for a city; "<County> County, ST" (or the county's own
 *  "… Parish" / "… Borough" name; a county-style jurisdiction is used as is) for a county row — never the city-style jurisdiction some seeded county rows
 *  carry ("Winston-Salem, NC" for Forsyth County), which would hand a county the city's portal. */
const COUNTY_SUFFIX = /\b(County|Parish|Borough|Municipality|Census Area)$/;
export function portalKeyFor(row: Pick<SeedUrlRow, "jurisdiction" | "jurisdictionType" | "countyName" | "stateCode">): string | null {
  if (row.jurisdictionType !== "county") return row.jurisdiction;
  if (COUNTY_SUFFIX.test(row.jurisdiction.replace(/, [A-Z]{2}$/, ""))) return row.jurisdiction;
  if (!row.countyName || !row.stateCode) return null;
  const n = row.countyName.trim();
  if (COUNTY_SUFFIX.test(n)) return `${n}, ${row.stateCode}`;
  return `${n} ${row.stateCode === "LA" ? "Parish" : "County"}, ${row.stateCode}`;
}

/**
 * What a row holding a dead seed URL becomes. Only a field equal to a dead URL changes. When both links end up
 * empty, the row takes the permit-portals.json entry for its own jurisdiction (exactly one entry, with a URL), the
 * same values syncPermitPortals writes; otherwise it is an honest null marked dead. null = nothing to change.
 */
export function planDeadSeedFix(row: SeedUrlRow, portalsByKey: Map<string, PortalEntry[]>, dead: ReadonlySet<string>): SeedUrlFix | null {
  const portalDead = !!row.portalUrl && dead.has(row.portalUrl);
  const searchDead = !!row.searchUrl && dead.has(row.searchUrl);
  if (!portalDead && !searchDead) return null;
  const portalUrl = portalDead ? null : row.portalUrl;
  const searchUrl = searchDead ? null : row.searchUrl;
  if (portalUrl || searchUrl) return { portalUrl, searchUrl };
  const key = portalKeyFor(row);
  const entries = key ? (portalsByKey.get(key) || []) : [];
  const p = entries.length === 1 && entries[0].url && !dead.has(entries[0].url) ? entries[0] : null;
  if (p) {
    return {
      portalUrl: p.url, searchUrl: p.url, platform: p.platform,
      isActive: ["live", "verified", "unconfirmed"].includes(p.linkStatus || ""),
      linkStatus: p.linkStatus || "unchecked",
      lastVerifiedAt: p.lastVerifiedAt ? new Date(p.lastVerifiedAt) : null,
    };
  }
  return { portalUrl: null, searchUrl: null, platform: null, isActive: false, linkStatus: "dead", lastVerifiedAt: new Date(DEAD_SEED_URLS_CHECKED_AT) };
}

/**
 * Boot step (idempotent): rows in permit_databases — production included — that still hold a dead seed URL are
 * corrected per planDeadSeedFix. A row whose link was since changed by the portal sync or verify-links no longer
 * matches and is left alone; a clean database changes nothing.
 */
export async function correctDeadSeedUrls(): Promise<{ nulled: number; replaced: number; partial: number }> {
  const report = { nulled: 0, replaced: 0, partial: 0 };
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const { sql } = await import("drizzle-orm");
  const { db } = await import("./db");
  let portals: PortalEntry[] = [];
  try {
    portals = JSON.parse(readFileSync(join(import.meta.dirname || __dirname, "data", "permit-portals.json"), "utf8"));
  } catch { /* no file: dead links are still nulled, nothing is replaced */ }
  const portalsByKey = new Map<string, PortalEntry[]>();
  for (const p of portals) { const l = portalsByKey.get(p.jurisdiction); if (l) l.push(p); else portalsByKey.set(p.jurisdiction, [p]); }
  // A URL the verified file lists is never treated as dead, whatever this list says.
  const listed = new Set(portals.map((p) => p.url).filter(Boolean) as string[]);
  const dead = new Set(DEAD_SEED_URLS.filter((u) => !listed.has(u)));
  const deadList = [...dead].join("\n"); // one text parameter (drizzle would expand an array into a row)

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(8159002)`); // the permit-portal sync's lock
    const { rows } = await tx.execute(sql`
      SELECT p.id, p.jurisdiction, p.jurisdiction_type, p.portal_url, p.search_url, c.name AS county_name, c.state_code
      FROM permit_databases p LEFT JOIN counties c ON c.id = p.county_id
      WHERE p.portal_url = ANY(string_to_array(${deadList}, E'\\n')) OR p.search_url = ANY(string_to_array(${deadList}, E'\\n'))`);
    for (const r of rows as any[]) {
      const fix = planDeadSeedFix({
        jurisdiction: r.jurisdiction, jurisdictionType: r.jurisdiction_type, countyName: r.county_name, stateCode: r.state_code,
        portalUrl: r.portal_url, searchUrl: r.search_url,
      }, portalsByKey, dead);
      if (!fix) continue;
      if (fix.linkStatus === undefined) {
        await tx.execute(sql`UPDATE permit_databases SET portal_url=${fix.portalUrl}, search_url=${fix.searchUrl} WHERE id=${r.id}`);
        report.partial++;
      } else {
        await tx.execute(sql`UPDATE permit_databases SET portal_url=${fix.portalUrl}, search_url=${fix.searchUrl}, platform=${fix.platform ?? null},
          link_status=${fix.linkStatus}, is_active=${fix.isActive ?? false}, last_verified_at=${fix.lastVerifiedAt ?? null} WHERE id=${r.id}`);
        if (fix.portalUrl) report.replaced++; else report.nulled++;
      }
    }
  });
  return report;
}
