/**
 * Build server/data/jurisdiction-coords.json: a {lat,lng} centroid for every
 * live-searchable permit portal jurisdiction, from PUBLIC US Census 2023
 * Gazetteer data (county + place national files, INTPTLAT/INTPTLONG centroids).
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/build-jurisdiction-coords.ts
 *
 * The searchable set is the SAME predicate the counts/searchable API uses
 * (governmentLinksAvailable + canScrapeGovernmentPortal), so the map and the
 * headline can never disagree. Matching is by (state, normalized name) with the
 * county-ranking normalization (County/Parish/Borough, St./Saint, DeKalb,
 * independent cities). Unmatched jurisdictions get null — never an invented
 * coordinate — and the match rate is printed.
 *
 * Gazetteer inputs live in scripts/data/gazetteer/ (git-ignored, regenerable);
 * this script downloads the national files from www2.census.gov if missing.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { governmentLinksAvailable, canScrapeGovernmentPortal } from "@shared/government-links";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GAZ_DIR = join(ROOT, "scripts/data/gazetteer");
const OUT = join(ROOT, "server/data/jurisdiction-coords.json");
const GAZ_BASE = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer";
const FILES = { counties: "2023_Gaz_counties_national", places: "2023_Gaz_place_national", cousubs: "2023_Gaz_cousubs_national" };

function ensureGaz(name: string): string {
  const txt = join(GAZ_DIR, `${name}.txt`);
  if (existsSync(txt)) return txt;
  mkdirSync(GAZ_DIR, { recursive: true });
  const zip = join(GAZ_DIR, `${name}.zip`);
  console.log(`downloading ${name} from Census...`);
  execFileSync("curl", ["-sSL", "-o", zip, `${GAZ_BASE}/${name}.zip`]);
  execFileSync("unzip", ["-o", zip, "-d", GAZ_DIR], { stdio: "ignore" });
  if (!existsSync(txt)) throw new Error(`gazetteer file missing after unzip: ${txt}`);
  return txt;
}

// County-ranking normalization: lowercase, St./Ste. -> Saint/Sainte, drop a
// trailing governmental/place type word or parenthetical, strip punctuation.
// Applied to both the Gazetteer NAME and the DB jurisdiction (minus its ", ST").
const TYPE_WORDS = /\s*\((?:balance|[^)]*)\)\s*$|\s+(county|parish|borough|census area|city and borough|municipality|metropolitan government|metro government|unified government|consolidated government|charter township|township|town|village|city|cdp|plantation|gore|grant|charter)\s*$/i;
const LEADING = /^(?:city|town|township|charter township|village|borough|county|municipality|unified government|consolidated government)\s+of\s+/i;
function norm(raw: string): string {
  let s = raw.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // drop diacritics (Canon/Canon City, Dona Ana)
    .replace(/\bst\.?\b/g, "saint").replace(/\bste\.?\b/g, "sainte")
    .replace(LEADING, "").trim();
  for (let i = 0; i < 5; i++) { const next = s.replace(TYPE_WORDS, "").trim(); if (next === s) break; s = next; }
  return s.replace(/[^a-z0-9]/g, "");
}

// Jurisdictions whose DB name differs from the Census NAME (consolidated city-counties,
// renamed/variant places). Keyed by `${STATE}|${norm(DB name)}` -> the Census name to match.
// These still resolve to a real Census centroid; no coordinate is invented.
const ALIASES: Record<string, string> = {
  "TN|nashville": "Nashville-Davidson",            // Nashville-Davidson metropolitan government
  "GA|augusta": "Augusta-Richmond County",         // consolidated government
  "MT|butte": "Silver Bow County",                 // Butte-Silver Bow consolidated city-county
  "MA|foxboro": "Foxborough",                      // spelling variant (town)
  "FL|hallandale": "Hallandale Beach",             // renamed
  "FL|islamorada": "Islamorada Village of Islands",// Islamorada, Village of Islands
  "AR|hotspringsnationalpark": "Hot Springs",      // DB carries the NPS name
};

function loadGaz(txt: string, latCol: string, lngCol: string): Map<string, { lat: number; lng: number }> {
  const lines = readFileSync(txt, "utf8").split(/\r?\n/);
  const header = lines[0].split("\t").map((h) => h.trim());
  const iState = header.indexOf("USPS"), iName = header.indexOf("NAME");
  const iLat = header.indexOf(latCol), iLng = header.indexOf(lngCol);
  const map = new Map<string, { lat: number; lng: number }>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split("\t");
    const state = (c[iState] ?? "").trim();
    const name = (c[iName] ?? "").trim();
    const lat = parseFloat((c[iLat] ?? "").trim()), lng = parseFloat((c[iLng] ?? "").trim());
    if (!state || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    map.set(`${state}|${norm(name)}`, { lat, lng }); // first wins keeps the primary place for dup names
  }
  return map;
}

async function main() {
  const countyMap = loadGaz(ensureGaz(FILES.counties), "INTPTLAT", "INTPTLONG");
  const placeMap = loadGaz(ensureGaz(FILES.places), "INTPTLAT", "INTPTLONG");
  const subMap = loadGaz(ensureGaz(FILES.cousubs), "INTPTLAT", "INTPTLONG");
  console.log(`gazetteer: ${countyMap.size} counties, ${placeMap.size} places, ${subMap.size} county subdivisions`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(`
    select d.jurisdiction, d.jurisdiction_type as "jurisdictionType", d.platform,
           d.search_url as "searchUrl", d.portal_url as "portalUrl",
           d.is_active as "isActive", d.link_status as "linkStatus", c.state_code as "stateCode"
    from permit_databases d join counties c on c.id = d.county_id`);
  await pool.end();

  const searchable = rows.filter((r: any) => governmentLinksAvailable(r) && canScrapeGovernmentPortal(r));
  // One entry per distinct jurisdiction (several portals can share one).
  const byJuris = new Map<string, any>();
  for (const r of searchable) if (!byJuris.has(r.jurisdiction)) byJuris.set(r.jurisdiction, r);

  const coords: Record<string, { lat: number; lng: number } | null> = {};
  const stat = { total: 0, matched: 0, county: { total: 0, matched: 0 }, city: { total: 0, matched: 0 } };
  const unmatched: string[] = [];
  for (const [jurisdiction, r] of byJuris) {
    const state = (r.stateCode || jurisdiction.split(",").pop() || "").trim().toUpperCase();
    const bare = jurisdiction.replace(/,\s*[A-Za-z]{2}\s*$/, "");
    const aliasName = ALIASES[`${state}|${norm(bare)}`];
    const key = `${state}|${norm(aliasName ?? bare)}`;
    const bucket = r.jurisdictionType === "county" ? stat.county : stat.city;
    stat.total++; bucket.total++;
    // county -> county file; city -> place file, then county file (VA independent cities etc.)
    let hit = r.jurisdictionType === "county"
      ? (countyMap.get(key) ?? placeMap.get(key) ?? subMap.get(key))          // city-county consolidations
      : (placeMap.get(key) ?? subMap.get(key) ?? countyMap.get(key));         // townships (NE/mid-Atlantic), VA independent cities
    coords[jurisdiction] = hit ? { lat: +hit.lat.toFixed(5), lng: +hit.lng.toFixed(5) } : null;
    if (hit) { stat.matched++; bucket.matched++; } else unmatched.push(jurisdiction);
  }

  const sorted = Object.fromEntries(Object.entries(coords).sort(([a], [b]) => a.localeCompare(b)));
  const payload = {
    generatedAt: new Date().toISOString(),
    source: "US Census Bureau 2023 Gazetteer (county + place national files), INTPTLAT/INTPTLONG centroids",
    matchRate: {
      overall: `${stat.matched}/${stat.total} (${(100 * stat.matched / stat.total).toFixed(1)}%)`,
      county: `${stat.county.matched}/${stat.county.total}`,
      city: `${stat.city.matched}/${stat.city.total}`,
    },
    coords: sorted,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 0) + "\n");
  console.log(`searchable portals: ${searchable.length}; distinct jurisdictions: ${stat.total}`);
  console.log(`match rate: ${payload.matchRate.overall} (county ${payload.matchRate.county}, city ${payload.matchRate.city})`);
  console.log(`unmatched (${unmatched.length}):`, unmatched.slice(0, 30).join("; ") + (unmatched.length > 30 ? " ..." : ""));
  console.log(`wrote ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
