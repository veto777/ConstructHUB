/**
 * Scrape real assessor / property-appraiser office data from NETR Online
 * (publicrecords.netronline.com) into server/data/appraisers.json.
 *
 * NETR structure:
 *   /state/{XX}                       -> county links  /state/{XX}/county/{slug}
 *   /state/{XX}/county/{slug}         -> office rows (.div-table-row) with
 *                                        [col-name="Name"|"Phone"|"Online"]
 * The office type is embedded in the Name ("... Property Appraiser",
 * "... Assessor", "... Auditor", etc.); the "Online" link is the REAL portal URL.
 *
 * Output rows carry only REAL data (name, phone, portalUrl, platform). We never
 * fabricate an address or a URL — a county with no online appraiser portal on
 * NETR is emitted with portalUrl: null so the app can say "no portal on file".
 *
 * Resumable: progress is checkpointed to appraisers.json + .scrape-progress.json
 * after every state, and already-scraped counties are skipped on re-run.
 *
 * Run:  npx tsx scripts/scrape-netronline.ts
 *       npx tsx scripts/scrape-netronline.ts FL GA   (subset of states)
 */
import * as cheerio from "cheerio";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://publicrecords.netronline.com";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const OUT_DIR = join(process.cwd(), "server", "data");
const OUT_FILE = join(OUT_DIR, "appraisers.json");
const PROGRESS_FILE = join(OUT_DIR, ".scrape-progress.json");
const CONCURRENCY = 4;
const RETRIES = 3;

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
];

// Office names that denote the assessment / property-appraiser office.
const APPRAISER_RE = /property appraiser|assessor|appraiser|auditor|equalization|assessment|tax commissioner|revenue commissioner/i;
// Names to always skip (not assessment offices).
const SKIP_RE = /historic aerials|netr mapping|mapping and gis|\bgis\b|tax collector|treasurer|clerk|recorder|register of deeds|sheriff/i;

// Map an online-portal host to a human platform label.
function platformFor(url: string | null): string | null {
  if (!url) return null;
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const map: [RegExp, string][] = [
    [/qpublic|schneidercorp/, "qPublic / Schneider"],
    [/tylertech|tylerhost|tylerport/, "Tyler Technologies"],
    [/\.arcgis\.|esri/, "Esri ArcGIS"],
    [/county-taxes|govtechtaxpro|grantstreet/, "Grant Street / county-taxes"],
    [/visionappraisal|vgsi/, "Vision (VGSI)"],
    [/patriotproperties/, "Patriot Properties"],
    [/beacon|gworks/, "Beacon / gWorks"],
    [/devnetwedge|devnet/, "DEVNET"],
    [/spatialest/, "Spatialest"],
    [/axisgis/, "AxisGIS"],
    [/kofile|landmarkweb/, "Kofile"],
    [/\.gov$|\.us$|county/, "County Website"],
  ];
  for (const [re, label] of map) if (re.test(host)) return label;
  return "County Portal";
}

interface Appraiser {
  stateCode: string;
  county: string;      // display name as shown on NETR
  name: string;        // office name
  phone: string | null;
  portalUrl: string | null;
  platform: string | null;
  source: "netronline";
}

async function fetchHtml(path: string): Promise<string> {
  const url = path.startsWith("http") ? path : BASE + path;
  let lastErr: any;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(500 * attempt + Math.floor(Math.random() * 400));
    }
  }
  throw lastErr;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseCounties(html: string, stateCode: string): { slug: string; name: string }[] {
  const $ = cheerio.load(html);
  const out: { slug: string; name: string }[] = [];
  $(`a[href*='/state/${stateCode}/county/']`).each((_i, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/\/county\/([^/'"]+)/);
    if (m) out.push({ slug: m[1], name: $(el).text().trim() });
  });
  // dedupe by slug
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)));
}

function parseAppraiser(html: string, stateCode: string, county: string): Appraiser {
  const $ = cheerio.load(html);
  const candidates: Appraiser[] = [];
  $(".div-table-row").each((_i, row) => {
    const name = $(row).find('[col-name="Name"]').first().text().trim();
    if (!name || SKIP_RE.test(name) || !APPRAISER_RE.test(name)) return;
    const phone = $(row).find('[col-name="Phone"]').first().text().trim() || null;
    const portalUrl = $(row).find('[col-name="Online"] a').first().attr("href")?.trim() || null;
    candidates.push({
      stateCode, county, name,
      phone: phone && /\d/.test(phone) ? phone : null,
      portalUrl: portalUrl && /^https?:/i.test(portalUrl) ? portalUrl : null,
      platform: platformFor(portalUrl || null),
      source: "netronline",
    });
  });
  // Prefer a candidate with a real portal URL, then one containing "appraiser"/"assessor".
  candidates.sort((a, b) =>
    (b.portalUrl ? 1 : 0) - (a.portalUrl ? 1 : 0) ||
    (/appraiser|assessor/i.test(b.name) ? 1 : 0) - (/appraiser|assessor/i.test(a.name) ? 1 : 0));
  return candidates[0] || { stateCode, county, name: `${county} Assessor`, phone: null, portalUrl: null, platform: null, source: "netronline" };
}

async function mapPool<T, R>(items: T[], fn: (item: T) => Promise<R>, conc: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
      await sleep(150 + Math.floor(Math.random() * 250)); // politeness jitter
    }
  }));
  return out;
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const argStates = process.argv.slice(2).map((s) => s.toUpperCase()).filter((s) => STATES.includes(s));
  const targetStates = argStates.length ? argStates : STATES;

  const results: Appraiser[] = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, "utf8")) : [];
  const progress: Record<string, boolean> = existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : {};
  const byKey = new Set(results.map((r) => `${r.stateCode}/${r.county}`));

  for (const st of targetStates) {
    if (progress[st]) { console.log(`[${st}] already done, skipping`); continue; }
    try {
      const stateHtml = await fetchHtml(`/state/${st}`);
      const counties = parseCounties(stateHtml, st);
      console.log(`[${st}] ${counties.length} counties`);
      if (counties.length === 0) { console.warn(`[${st}] WARNING: 0 counties parsed`); }

      const rows = await mapPool(counties, async (c) => {
        try {
          const html = await fetchHtml(`/state/${st}/county/${c.slug}`);
          return parseAppraiser(html, st, c.name);
        } catch (e: any) {
          console.warn(`  [${st}/${c.name}] failed: ${e?.message || e}`);
          return { stateCode: st, county: c.name, name: `${c.name} Assessor`, phone: null, portalUrl: null, platform: null, source: "netronline" as const };
        }
      }, CONCURRENCY);

      for (const r of rows) {
        const k = `${r.stateCode}/${r.county}`;
        if (!byKey.has(k)) { results.push(r); byKey.add(k); }
      }
      progress[st] = true;
      const withPortal = results.filter((r) => r.portalUrl).length;
      results.sort((a, b) => a.stateCode.localeCompare(b.stateCode) || a.county.localeCompare(b.county));
      writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
      writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      console.log(`[${st}] done. total=${results.length}, with real portal=${withPortal}`);
    } catch (e: any) {
      console.error(`[${st}] STATE FAILED: ${e?.message || e} — will retry on next run`);
    }
  }

  const withPortal = results.filter((r) => r.portalUrl).length;
  console.log(`\nDONE. ${results.length} counties, ${withPortal} with a real appraiser portal (${Math.round(100 * withPortal / results.length)}%).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
