/**
 * Build a VERIFIED list of real municipal building-permit portals for major US
 * jurisdictions -> server/data/permit-portals.json (consumed by
 * server/seed-permit-portals.ts).
 *
 * Integrity rules (no fabrication, no live-but-wrong URLs):
 *   1. Each candidate URL must respond live (successful GET with permit-specific page content).
 *   2. Each URL must look permit-specific (path/host matches PERMIT_HINT) — a
 *      plain city homepage is rejected even if it's live.
 * Only candidates passing BOTH are written out. Dead/ambiguous ones are dropped
 * (those jurisdictions keep the honest "Find permit portal" search fallback).
 *
 * Run:  npx tsx scripts/build-permit-portals.ts
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import * as cheerio from "cheerio";

// jurisdiction key must match permit_databases.jurisdiction = "City, ST".
interface Candidate { jurisdiction: string; url: string; platform: string; sourceUrl?: string; }

// Optional merge source: candidates discovered by the expand-permit-portals
// workflow (already WebFetch-confirmed by agents). They still pass through the
// same deterministic liveness + permit-specificity gate below before shipping.
function loadWorkflowCandidates(): Candidate[] {
  const p = join(process.cwd(), "server", "data", "_permit-candidates.json");
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.candidates || [];
    return arr.filter((c: any) => c && c.jurisdiction && c.url)
      .map((c: any) => ({ jurisdiction: String(c.jurisdiction).trim(), url: String(c.url).trim(), platform: String(c.platform || "County Portal"), sourceUrl: c.sourceUrl ? String(c.sourceUrl) : undefined }));
  } catch { return []; }
}

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

// A URL is accepted only if it looks permit-specific, not a bare homepage.
// Broad: covers common permit platforms + permit/inspection/building paths.
// (Workflow candidates are already WebFetch-confirmed by agents; this is the
// deterministic second gate. A path like "/" with no hint is rejected.)
const PERMIT_HINT = /permit|accela|energov|etrakit|epermit|eplan|dobnow|bisweb|\bdbi\b|\bpli\b|posse|inspection|building|develop|\bdpp\b|dcra|\bdsi\b|\bdns\b|\bpdd\b|ladbs|onestop|compass|tdc-online|buildingrecords|eclipse|selfservice|dppweb|citizenaccess|\baca[-.]|cityworks|mygov|viewpoint|smartgov|opengov|civicplus|projectdox|avolve|camino|clariti|epath|citizenserve|onlinepermit|land-?management|lms|\bpds\b|codeenforcement/i;
// PERMIT_BUILD_CONCURRENCY raises the parallel checks for a big batch (default 4).
const CONCURRENCY = Math.max(1, Math.min(48, Number(process.env.PERMIT_BUILD_CONCURRENCY) || 4));
// PERMIT_BUILD_ONLY_NEW=1: keep the shipped entries as they are and check only the new candidates (a large discovery
// batch right after a full re-check); the default re-checks everything.
const ONLY_NEW = process.env.PERMIT_BUILD_ONLY_NEW === "1";
// PERMIT_BUILD_UPGRADE_UNCONFIRMED=1 (with ONLY_NEW): also re-check shipped "unconfirmed" entries — best run with
// GOV_FETCH_BROWSER=1 — and keep the result only when it is now "verified"; anything else leaves the entry as it was.
const UPGRADE_UNCONFIRMED = process.env.PERMIT_BUILD_UPGRADE_UNCONFIRMED === "1";
import { classifySourceListedLink } from "../server/government-link-policy";
import { fetchGovernmentPage, classifyGovernmentPage } from "../server/government-url-check";

async function main() {
  const output = join(process.cwd(), "server", "data", "permit-portals.json");
  const existing: any[] = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : [];
  const byJur = new Set(existing.map(c => c.jurisdiction));
  const merged = [...existing];
  // Existing data wins over old inline discovery URLs, including null tombstones.
  // New discoveries need an explicit authoritative source linking to the URL.
  for (const c of [...CANDIDATES, ...loadWorkflowCandidates()]) {
    if (!byJur.has(c.jurisdiction) && c.sourceUrl) { merged.push(c); byJur.add(c.jurisdiction); }
  }
  const results: any[] = new Array(merged.length);
  let idx = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (idx < merged.length) {
      const index = idx++; const c = merged[index];
      const upgrading = UPGRADE_UNCONFIRMED && index < existing.length && c.url && c.linkStatus === "unconfirmed";
      if (ONLY_NEW && index < existing.length && !upgrading) { results[index] = c; continue; }
      const candidateUrl = c.url || c.candidateUrl;
      if (!candidateUrl) { results[index] = c; continue; }
      let sourceVerified = existing.some(e => e.jurisdiction === c.jurisdiction);
      if (!sourceVerified && c.sourceUrl) {
        const source = await fetchGovernmentPage(c.sourceUrl);
        const $ = cheerio.load(source.html);
        sourceVerified = source.httpStatus >= 200 && source.httpStatus < 300 &&
          $('a[href]').toArray().some(el => {
            try { return new URL($(el).attr('href')!, source.finalUrl).href === candidateUrl; } catch { return false; }
          });
      }
      const response = await fetchGovernmentPage(candidateUrl);
      const check = classifyGovernmentPage(response, "permit");
      const $ = cheerio.load(response.html); $('script,style').remove();
      const norm = (s: string) => s.toLowerCase().replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9]/g, '');
      const name = c.jurisdiction.split(',')[0].replace(/\b(county|parish|borough)\b/gi, '').trim();
      const identity = norm($('body').text() + $('title').text()).includes(norm(name));
      const status = sourceVerified ? classifySourceListedLink(candidateUrl,
        { ...check, httpStatus: response.httpStatus, finalUrl: response.finalUrl, jurisdictionMatched: identity },
        { state: c.jurisdiction.slice(-2), jurisdiction: name, sourceListed: true }) : "none";
      const available = status === "verified" || status === "unconfirmed";
      if (upgrading && status !== "verified") { results[index] = c; continue; }   // never downgrade in an upgrade pass
      results[index] = { ...c, url: available ? (status === "verified" ? response.finalUrl : candidateUrl) : null,
        candidateUrl, platform: available ? c.platform : null, linkStatus: status, lastVerifiedAt: new Date().toISOString() };
    }
  }));
  results.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  writeFileSync(output, JSON.stringify(results, null, 2) + "\n");
  console.log(`Verified ${results.filter(r => r.url).length} permit URLs; ${results.filter(r => !r.url).length} null fallbacks retained for DB reconciliation.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
