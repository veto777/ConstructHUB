/**
 * Find permit portals at scale from an authoritative source — no search engine, no guessing.
 *
 * Owner, 2026-10-04: "As far as the portals can we use cpu to finish this faster?". The research agents found each
 * jurisdiction's official site one at a time; this does the same crawl locally and in parallel:
 *   1. The official website of every city/county comes from CISA's .gov registry (github.com/cisagov/dotgov-data,
 *      current-full.csv: domain → organization, city, state) — matched to permit_databases rows that have no portal.
 *   2. Each official site is read: the homepage, then its building / permit / inspection / development pages.
 *   3. A link on those official pages to a known permit system (Accela, EnerGov, eTRAKiT, MyGov, OpenGov/ViewPoint,
 *      CitizenServe, iWorQ, BS&A, Cloudpermit, SmartGov, MGO, SDL, GovPilot, Cityworks, CityView, …) becomes a candidate
 *      with that official page as its sourceUrl. Shared vendor hosts must carry the jurisdiction's name in the link.
 *   4. Nothing ships from here: scripts/build-permit-portals.ts runs the same gate as every other portal (the source
 *      page links the exact URL; live; permit-specific; names the jurisdiction).
 *
 * Run: npx tsx scripts/discover-permit-portals.ts <dotgov.csv> <out.json> [concurrency=32]
 * Needs DATABASE_URL (read-only: SELECT of the rows without a portal).
 */
import { readFileSync, writeFileSync } from "fs";
import * as cheerio from "cheerio";
import pg from "pg";
import { fetchGovernmentPage } from "../server/government-url-check";

const [csvPath, outPath, concArg] = process.argv.slice(2);
if (!csvPath || !outPath) { console.error("usage: discover-permit-portals.ts <dotgov.csv> <out.json> [concurrency]"); process.exit(2); }
const CONCURRENCY = Math.max(1, Math.min(64, Number(concArg) || 32));

/** Known permit systems: host patterns, and whether the host is shared by many governments. */
const PLATFORMS: { re: RegExp; name: string; shared: boolean }[] = [
  { re: /(^|\.)aca[-.]?prod\.accela\.com$|(^|\.)accela\.com$/i, name: "Accela", shared: true },
  { re: /citizenaccess|\baca\b/i, name: "Accela Citizen Access", shared: false },
  { re: /energov|tylerhost\.net$|tyler-?(eservices|css)/i, name: "Tyler EnerGov", shared: false },
  { re: /etrakit/i, name: "eTRAKiT", shared: false },
  { re: /(^|\.)mygov\.us$/i, name: "MyGov", shared: true },
  { re: /(^|\.)viewpointcloud\.com$|(^|\.)portal\.opengov\.com$|(^|\.)opengov\.com$/i, name: "OpenGov", shared: true },
  { re: /(^|\.)citizenserve\.com$/i, name: "CitizenServe", shared: true },
  { re: /(^|\.)iworq\.net$/i, name: "iWorQ", shared: true },
  { re: /(^|\.)bsaonline\.com$/i, name: "BS&A Online", shared: true },
  { re: /(^|\.)cloudpermit\.com$/i, name: "Cloudpermit", shared: true },
  { re: /(^|\.)smartgovcommunity\.com$/i, name: "SmartGov", shared: true },
  { re: /(^|\.)mgoconnect\.org$/i, name: "MGO Connect", shared: true },
  { re: /(^|\.)sdlportal\.com$/i, name: "SDL Portal", shared: true },
  { re: /(^|\.)govpilot\.com$/i, name: "GovPilot", shared: true },
  { re: /(^|\.)citysquared\.com$/i, name: "CitySquared", shared: true },
  { re: /(^|\.)municity5?\.com$|municity/i, name: "Municity", shared: true },
  { re: /cityworks/i, name: "Cityworks", shared: false },
  { re: /cityview/i, name: "CityView", shared: false },
  { re: /(^|\.)mybuildingpermit\.com$/i, name: "MyBuildingPermit", shared: true },
  { re: /(^|\.)permitium\.com$|(^|\.)permiteyes\.us$|(^|\.)egovlink\.com$|(^|\.)clariti\.app$|(^|\.)cloud\.clariti/i, name: "Online permitting", shared: true },
];
const PERMIT_WORDS = /permit|building|inspection|development services|community development|code enforcement|planning|zoning/i;
const SKIP_HREF = /\.(pdf|docx?|xlsx?|jpg|png|zip)(\?|$)|^mailto:|^tel:|^javascript:/i;

type Row = { jurisdiction: string; type: string };
type Candidate = { jurisdiction: string; url: string; platform: string; sourceUrl: string };

const norm = (s: string) => s.toLowerCase().replace(/\bsaint\b/g, "st").replace(/\bfort\b/g, "ft").replace(/[^a-z0-9]/g, "");
const ORG_PREFIX = /^(city|town|village|borough|township|municipality|county|city and county|unified government|consolidated government|metropolitan government|charter township|parish)\s+of\s+(the\s+)?/i;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells: string[] = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { cells.push(cur); cur = ""; } else cur += ch;
    }
    cells.push(cur); rows.push(cells);
  }
  return rows;
}

/** "City of Abilene" / "Abilene, City of" / "Harris County" → the jurisdiction key "Abilene, TX" / "Harris County, TX". */
function keysFor(org: string, type: string, state: string): string[] {
  let name = org.trim().replace(/,\s*(city|town|village|county|borough|township) of$/i, "").replace(ORG_PREFIX, "").trim();
  name = name.replace(/\s*\(.*\)$/, "").trim();
  if (!name || !/^[A-Z]{2}$/.test(state)) return [];
  if (type === "County") {
    const base = name.replace(/\s+(county|parish|borough)$/i, "");
    return [`${base} County, ${state}`, `${base} Parish, ${state}`, `${base} Borough, ${state}`];
  }
  return [`${name}, ${state}`];
}

async function page(url: string): Promise<{ url: string; $: cheerio.CheerioAPI } | null> {
  const r = await fetchGovernmentPage(url).catch(() => null);
  if (!r?.html || !r.httpStatus || r.httpStatus >= 400) return null;
  return { url: r.finalUrl || url, $: cheerio.load(r.html) };
}

function links(p: { url: string; $: cheerio.CheerioAPI }): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  p.$("a[href]").each((_, el) => {
    const raw = p.$(el).attr("href")!;
    if (SKIP_HREF.test(raw)) return;
    try { out.push({ href: new URL(raw, p.url).href, text: p.$(el).text().replace(/\s+/g, " ").trim() }); } catch { /* bad href */ }
  });
  return out;
}

function platformOf(href: string, siteHost: string, jurisdiction: string): string | null {
  let u: URL; try { u = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  const nameTok = norm(jurisdiction.split(",")[0].replace(/\b(county|parish|borough)\b/gi, ""));
  for (const p of PLATFORMS) {
    if (!p.re.test(host) && !(p.name === "Accela Citizen Access" && /citizenaccess/i.test(u.pathname))) continue;
    // A shared vendor host lists many governments: the link itself must name this one (path, query, subdomain or #).
    if (p.shared && !norm(host.split(".")[0] + u.pathname + u.search + u.hash).includes(nameTok.slice(0, Math.max(5, Math.min(nameTok.length, 8))))) return null;
    return p.name;
  }
  // The government's own permit system on its own domain (permits.<city>.gov, <city>.gov/…/epermits/…).
  const reg = (h: string) => h.split(".").slice(-2).join(".");
  if (reg(host) === reg(siteHost) && /(^|[./_-])(e-?permits?|permitting|onlinepermits?|permitportal|citizenportal|publicportal)([./_-]|$)/i.test(host + u.pathname)) return "Online permitting";
  return null;
}

async function discover(row: Row, domains: string[]): Promise<Candidate | null> {
  for (const domain of domains) {
    const home = await page(`https://${domain}/`) ?? await page(`http://${domain}/`);
    if (!home) continue;
    const siteHost = new URL(home.url).hostname;
    const seen = new Set<string>([home.url]);
    const queue: { url: string; $: cheerio.CheerioAPI }[] = [home];
    for (let depth = 0; depth < 2 && queue.length; depth++) {
      const next: string[] = [];
      for (const p of queue.splice(0)) {
        for (const l of links(p)) {
          const platform = platformOf(l.href, siteHost, row.jurisdiction);
          if (platform) return { jurisdiction: row.jurisdiction, url: l.href, platform, sourceUrl: p.url };
          let u: URL; try { u = new URL(l.href); } catch { continue; }
          if (u.hostname !== siteHost || seen.has(u.href.split("#")[0])) continue;
          if (PERMIT_WORDS.test(l.text) || PERMIT_WORDS.test(u.pathname)) { seen.add(u.href.split("#")[0]); next.push(u.href.split("#")[0]); }
        }
      }
      for (const url of next.slice(0, depth === 0 ? 8 : 12)) { const p = await page(url); if (p) queue.push(p); }
    }
  }
  return null;
}

async function main() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await db.query<Row>(
    "SELECT DISTINCT jurisdiction, jurisdiction_type AS type FROM permit_databases WHERE portal_url IS NULL AND coalesce(link_status, 'none') IN ('none', 'dead', 'unchecked')");
  await db.end();
  // Portals already in the shipped list (incl. ones not seeded into this DB yet) are skipped.
  const shipped = new Set((JSON.parse(readFileSync("server/data/permit-portals.json", "utf8")) as any[]).filter((p) => p.url).map((p) => p.jurisdiction));
  const want = new Map(rows.filter((r) => !shipped.has(r.jurisdiction)).map((r) => [r.jurisdiction, r]));
  const domainsFor = new Map<string, string[]>();
  for (const cells of parseCsv(readFileSync(csvPath, "utf8")).slice(1)) {
    const [domain, type, org, , , state] = cells;
    if (type !== "City" && type !== "County") continue;
    for (const key of keysFor(org ?? "", type, (state ?? "").trim())) {
      if (!want.has(key)) continue;
      const list = domainsFor.get(key) ?? [];
      if (!list.includes(domain.toLowerCase())) list.push(domain.toLowerCase());
      domainsFor.set(key, list);
    }
  }
  const jobs = Array.from(domainsFor.entries());
  console.log(`${rows.length} rows without a portal; ${jobs.length} have an official .gov site in the registry; crawling ${CONCURRENCY} at a time.`);
  const found: Candidate[] = [];
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < jobs.length) {
      const [key, domains] = jobs[i++];
      const c = await discover(want.get(key)!, domains.slice(0, 3)).catch(() => null);
      if (c) { found.push(c); writeFileSync(outPath, JSON.stringify(found, null, 1)); }
      if (++done % 100 === 0) console.log(`${done}/${jobs.length} crawled, ${found.length} candidates`);
    }
  }));
  writeFileSync(outPath, JSON.stringify(found, null, 1));
  console.log(`done: ${found.length} candidates from ${jobs.length} official sites → ${outPath}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
