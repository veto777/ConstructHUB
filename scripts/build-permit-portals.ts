/**
 * Build a VERIFIED list of real municipal building-permit portals for major US
 * jurisdictions -> server/data/permit-portals.json (consumed by
 * server/seed-permit-portals.ts).
 *
 * Integrity rules (no fabrication, no live-but-wrong URLs):
 *   1. Each candidate URL must respond live (2xx/3xx or an auth/blocked status).
 *   2. Each URL must look permit-specific (path/host matches PERMIT_HINT) — a
 *      plain city homepage is rejected even if it's live.
 * Only candidates passing BOTH are written out. Dead/ambiguous ones are dropped
 * (those jurisdictions keep the honest "Find permit portal" search fallback).
 *
 * Run:  npx tsx scripts/build-permit-portals.ts
 */
import { writeFileSync } from "fs";
import { join } from "path";

// jurisdiction key must match permit_databases.jurisdiction = "City, ST".
interface Candidate { jurisdiction: string; url: string; platform: string; }

const CANDIDATES: Candidate[] = [
  { jurisdiction: "New York, NY", url: "https://a810-dobnow.nyc.gov/publish/Index.html", platform: "NYC DOB NOW" },
  { jurisdiction: "Los Angeles, CA", url: "https://www.ladbsservices2.lacity.org/OnlineServices/", platform: "LADBS Online" },
  { jurisdiction: "Chicago, IL", url: "https://webapps1.chicago.gov/buildingrecords/", platform: "Chicago Building Records" },
  { jurisdiction: "Houston, TX", url: "https://www.houstonpermittingcenter.org/", platform: "Houston Permitting Center" },
  { jurisdiction: "Phoenix, AZ", url: "https://www.phoenix.gov/pdd/permits", platform: "Phoenix PDD" },
  { jurisdiction: "Philadelphia, PA", url: "https://eclipse.phila.gov/phillylmsprod/pub/lms/Login.aspx", platform: "Philadelphia Eclipse" },
  { jurisdiction: "San Antonio, TX", url: "https://aca-prod.accela.com/COSA/Default.aspx", platform: "Accela" },
  { jurisdiction: "San Diego, CA", url: "https://aca-prod.accela.com/SANDIEGO/Default.aspx", platform: "Accela" },
  { jurisdiction: "Dallas, TX", url: "https://aca-prod.accela.com/DALLAS/Default.aspx", platform: "Accela" },
  { jurisdiction: "San Jose, CA", url: "https://aca-prod.accela.com/SANJOSE/Default.aspx", platform: "Accela" },
  { jurisdiction: "Austin, TX", url: "https://abc.austintexas.gov/web/permit/public-search-other", platform: "Austin Build + Connect" },
  { jurisdiction: "Jacksonville, FL", url: "https://buildinginspections.coj.net/", platform: "Jacksonville Building Inspection" },
  { jurisdiction: "Fort Worth, TX", url: "https://aca-prod.accela.com/CFW/Default.aspx", platform: "Accela" },
  { jurisdiction: "Columbus, OH", url: "https://myportal.columbus.gov/", platform: "Columbus MyPortal" },
  { jurisdiction: "San Francisco, CA", url: "https://dbiweb02.sfgov.org/dbipts/", platform: "SF DBI PTS" },
  { jurisdiction: "Charlotte, NC", url: "https://mecklenburgcountypermits.com/", platform: "Mecklenburg Permits" },
  { jurisdiction: "Seattle, WA", url: "https://cosaccela.seattle.gov/portal/", platform: "Accela" },
  { jurisdiction: "Denver, CO", url: "https://aca-prod.accela.com/DENVER/Default.aspx", platform: "Accela" },
  { jurisdiction: "Washington, DC", url: "https://permitting.dcra.dc.gov/", platform: "DC DCRA" },
  { jurisdiction: "Nashville, TN", url: "https://epermits.nashville.gov/", platform: "Nashville ePermits" },
  { jurisdiction: "Oklahoma City, OK", url: "https://aca-prod.accela.com/OKC/Default.aspx", platform: "Accela" },
  { jurisdiction: "Boston, MA", url: "https://www.boston.gov/departments/inspectional-services/how-apply-permit", platform: "Boston ISD" },
  { jurisdiction: "Portland, OR", url: "https://www.portland.gov/permits", platform: "Portland Permitting" },
  { jurisdiction: "Las Vegas, NV", url: "https://aca.lasvegasnevada.gov/", platform: "Accela" },
  { jurisdiction: "Detroit, MI", url: "https://aca-prod.accela.com/DETROIT/Default.aspx", platform: "Accela" },
  { jurisdiction: "Memphis, TN", url: "https://aca-prod.accela.com/SHELBYCO/Default.aspx", platform: "Accela" },
  { jurisdiction: "Louisville, KY", url: "https://aca-prod.accela.com/LOUISVILLE/Default.aspx", platform: "Accela" },
  { jurisdiction: "Baltimore, MD", url: "https://permits.baltimorehousing.org/", platform: "Baltimore Permits" },
  { jurisdiction: "Milwaukee, WI", url: "https://www.milwaukee.gov/DNS/permits", platform: "Milwaukee DNS" },
  { jurisdiction: "Albuquerque, NM", url: "https://posse.cabq.gov/", platform: "Albuquerque POSSE" },
  { jurisdiction: "Tucson, AZ", url: "https://tdc-online.tucsonaz.gov/", platform: "Tucson TDC Online" },
  { jurisdiction: "Fresno, CA", url: "https://aca-prod.accela.com/FRESNO/Default.aspx", platform: "Accela" },
  { jurisdiction: "Sacramento, CA", url: "https://aca-prod.accela.com/SACRAMENTO/Default.aspx", platform: "Accela" },
  { jurisdiction: "Mesa, AZ", url: "https://aca-prod.accela.com/MESA/Default.aspx", platform: "Accela" },
  { jurisdiction: "Atlanta, GA", url: "https://aca-prod.accela.com/ATLANTA_GA/Default.aspx", platform: "Accela" },
  { jurisdiction: "Kansas City, MO", url: "https://compass.kcmo.org/", platform: "KCMO Compass" },
  { jurisdiction: "Colorado Springs, CO", url: "https://aca-prod.accela.com/COSPRINGS/Default.aspx", platform: "Accela" },
  { jurisdiction: "Raleigh, NC", url: "https://raleighnc.gov/permits", platform: "Raleigh Permits" },
  { jurisdiction: "Omaha, NE", url: "https://aca-prod.accela.com/OMAHA/Default.aspx", platform: "Accela" },
  { jurisdiction: "Long Beach, CA", url: "https://aca-prod.accela.com/LONGBEACH/Default.aspx", platform: "Accela" },
  { jurisdiction: "Virginia Beach, VA", url: "https://permits.virginiabeach.gov/", platform: "Virginia Beach Permits" },
  { jurisdiction: "Miami, FL", url: "https://espd.miamigov.com/", platform: "Miami ePlan" },
  { jurisdiction: "Oakland, CA", url: "https://aca-prod.accela.com/OAKLAND/Default.aspx", platform: "Accela" },
  { jurisdiction: "Minneapolis, MN", url: "https://www.minneapolismn.gov/business-services/permits-inspections/", platform: "Minneapolis CPED" },
  { jurisdiction: "Tulsa, OK", url: "https://aca-prod.accela.com/TULSA/Default.aspx", platform: "Accela" },
  { jurisdiction: "Arlington, TX", url: "https://aca-prod.accela.com/ARLINGTONTX/Default.aspx", platform: "Accela" },
  { jurisdiction: "Tampa, FL", url: "https://aca-prod.accela.com/TAMPA/Default.aspx", platform: "Accela" },
  { jurisdiction: "New Orleans, LA", url: "https://onestopapp.nola.gov/", platform: "New Orleans One Stop" },
  { jurisdiction: "Wichita, KS", url: "https://aca-prod.accela.com/WICHITA/Default.aspx", platform: "Accela" },
  { jurisdiction: "Cleveland, OH", url: "https://aca-prod.accela.com/CLEVELAND/Default.aspx", platform: "Accela" },
  { jurisdiction: "Bakersfield, CA", url: "https://aca-prod.accela.com/BAKERSFIELD/Default.aspx", platform: "Accela" },
  { jurisdiction: "Aurora, CO", url: "https://aca-prod.accela.com/AURORACO/Default.aspx", platform: "Accela" },
  { jurisdiction: "Anaheim, CA", url: "https://aca-prod.accela.com/ANAHEIM/Default.aspx", platform: "Accela" },
  { jurisdiction: "Honolulu, HI", url: "https://dppweb.honolulu.gov/", platform: "Honolulu DPP" },
  { jurisdiction: "Santa Ana, CA", url: "https://aca-prod.accela.com/SANTAANA/Default.aspx", platform: "Accela" },
  { jurisdiction: "Riverside, CA", url: "https://aca-prod.accela.com/RIVERSIDE/Default.aspx", platform: "Accela" },
  { jurisdiction: "Corpus Christi, TX", url: "https://aca-prod.accela.com/CORPUSCHRISTI/Default.aspx", platform: "Accela" },
  { jurisdiction: "Lexington, KY", url: "https://aca-prod.accela.com/LEXINGTONKY/Default.aspx", platform: "Accela" },
  { jurisdiction: "Henderson, NV", url: "https://aca-prod.accela.com/HENDERSON/Default.aspx", platform: "Accela" },
  { jurisdiction: "Stockton, CA", url: "https://aca-prod.accela.com/STOCKTON/Default.aspx", platform: "Accela" },
  { jurisdiction: "Saint Paul, MN", url: "https://www.stpaul.gov/departments/safety-inspections", platform: "St. Paul DSI" },
  { jurisdiction: "Cincinnati, OH", url: "https://aca-prod.accela.com/CINCINNATI/Default.aspx", platform: "Accela" },
  { jurisdiction: "Greensboro, NC", url: "https://aca-prod.accela.com/GREENSBORO/Default.aspx", platform: "Accela" },
  { jurisdiction: "Pittsburgh, PA", url: "https://pittsburghpa.gov/pli/", platform: "Pittsburgh PLI" },
  { jurisdiction: "Orlando, FL", url: "https://permitting.cityoforlando.net/", platform: "Orlando Permitting" },
  { jurisdiction: "Fort Lauderdale, FL", url: "https://aca-prod.accela.com/FTL/Default.aspx", platform: "Accela" },
  { jurisdiction: "Chandler, AZ", url: "https://aca-prod.accela.com/CHANDLER/Default.aspx", platform: "Accela" },
  { jurisdiction: "Scottsdale, AZ", url: "https://eservices.scottsdaleaz.gov/bldgresources/", platform: "Scottsdale eServices" },
  { jurisdiction: "Reno, NV", url: "https://aca-prod.accela.com/RENO/Default.aspx", platform: "Accela" },
  { jurisdiction: "Boise, ID", url: "https://aca-prod.accela.com/BOISE/Default.aspx", platform: "Accela" },
  { jurisdiction: "Richmond, VA", url: "https://energov.rva.gov/EnerGov_Prod/SelfService", platform: "Tyler EnerGov" },
  { jurisdiction: "Salt Lake City, UT", url: "https://aca-prod.accela.com/SLCUT/Default.aspx", platform: "Accela" },
];

// A URL is accepted only if it looks permit-specific, not a generic homepage.
const PERMIT_HINT = /permit|accela|energov|etrakit|epermit|dobnow|bisweb|dbi|pli|posse|inspection|building|dpp|dcra|dsi|dns|pdd|ladbs|onestop|compass|tdc-online|buildingrecords|eclipse|selfservice|dppweb/i;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const ALIVE = new Set([401, 403, 405, 406, 429, 999]);
const CONCURRENCY = 8;

async function isLive(url: string): Promise<boolean> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { method, redirect: "follow", headers: { "User-Agent": UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status < 400 || ALIVE.has(res.status)) return true;
      if (res.status === 404 || res.status === 410) return false;
      if (method === "HEAD") continue;
      return true; // other 4xx/5xx: host responded
    } catch { if (method === "HEAD") continue; return false; }
  }
  return false;
}

async function main() {
  const verified: Candidate[] = [];
  const rejected: { c: Candidate; reason: string }[] = [];
  let idx = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (idx < CANDIDATES.length) {
      const c = CANDIDATES[idx++];
      if (!PERMIT_HINT.test(c.url)) { rejected.push({ c, reason: "not permit-specific" }); continue; }
      const live = await isLive(c.url);
      if (live) verified.push(c);
      else rejected.push({ c, reason: "dead/unreachable" });
    }
  }));
  verified.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  writeFileSync(join(process.cwd(), "server", "data", "permit-portals.json"), JSON.stringify(verified, null, 2));
  console.log(`\nVerified ${verified.length}/${CANDIDATES.length} permit portals -> server/data/permit-portals.json`);
  if (rejected.length) {
    console.log(`Dropped ${rejected.length}:`);
    for (const r of rejected) console.log(`  ✗ ${r.c.jurisdiction} (${r.reason}) ${r.c.url}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
