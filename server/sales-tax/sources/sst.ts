/**
 * Streamlined Sales Tax member states — SST rate + boundary files.
 *
 * Source: the Streamlined Sales Tax Governing Board "Rate and Boundary Files" page
 * (www.streamlinedsalestax.org/Shared-Pages/rate-and-boundary-files), which links two
 * public, no-login directory listings where every member state posts its files:
 *   https://www.streamlinedsalestax.org/ratesandboundry/Rates/     e.g. OHR2026Q4SEP17.csv / .zip
 *   https://www.streamlinedsalestax.org/ratesandboundry/Boundary/  e.g. OHB2026Q4SEP17.zip
 * File names are <ST><R|B><YYYY>Q<n><MON><DD>: state, file kind, the quarter the file is
 * for, and the posting date. A state only posts a new file when something changed, so the
 * newest file per state may be several quarters old (IN's rate file is 2008Q4).
 *
 * Formats (SST Technology Guide, ch. 5 "Rates and Boundary Databases"), no header rows:
 *  - Rate file: State FIPS, Jurisdiction Type (X12 1721: 45 state, 00 county, 01 city, 63/69/79/26/49
 *    special…), Jurisdiction code (FIPS or state-assigned), General rate intrastate (fraction),
 *    General interstate, Food/drug intra, Food/drug inter, Begin date, End date (CCYYMMDD).
 *  - Boundary file: Record type (A address range / 4 ZIP+4 range / Z 5-digit ZIP), Begin, End,
 *    address fields, City name (col O), ZIP (P), Plus4 (Q), ZIP low/ext low/ZIP high/ext high
 *    (R-U), Composite SER code (V), FIPS state (W), FIPS state indicator (X, "00" = state rate
 *    does not apply), FIPS county (Y), FIPS place (Z), place class (AA), lon/lat (AB-AC), then up
 *    to 20 special-district triples (source, code, X12 type) from AD on.
 *
 * How rows are built: every boundary record in force on the as-of date gives a jurisdiction
 * combination (state indicator, county, place, special districts). The combined rate of a
 * combination is the sum of the general intrastate rates the state's rate file lists for each of
 * its codes on that date — exactly the SST lookup procedure (Tech Guide ch. 5, "Sum the tax for all
 * jurisdictions"); nothing is estimated. A code whose rate records have all expired contributes 0
 * (the tax ended); a combination referencing a code the rate file never lists is skipped and
 * named in `notes`. 5-digit-ZIP ("Z") records are the SST fallback level ("lowest rate in the
 * ZIP") and are used only for a place/county no address or ZIP+4 record covers. Combinations are
 * grouped into:
 *  - "city": a FIPS place code with a city-type rate record (X12 01-05), named from the U.S. Census
 *    2020 place / county-subdivision code files (www2.census.gov/geo/docs/reference/codes2020/),
 *    supplemented by the newest Census Gazetteer files for places incorporated since 2020;
 *  - "county": the rest of a county (records with no place code — includes towns without a local
 *    tax of their own), city null;
 *  - "state": the rest of the state where no county code is carried (state-rate-only states, WV);
 *  - "special": a place code the Census files do not name (state-assigned codes, e.g. UT's metro
 *    townships, WY's resort districts), or a minority rate variant inside a city/county (special
 *    district) — with the ZIP(s) set when that variant is the only rate published in those ZIPs.
 * Place names are never guessed from USPS city names (they often name a neighbouring city).
 * locationCode is the "+"-joined SST codes that make up the rate (county, place, districts).
 *
 * Effective date: the as-of date is the first day of the newest quarter posted in the SST
 * directories (from the file names, e.g. "…2026Q4…" → 2026-10-01). Each row's effectiveDate is the
 * latest begin date among the rate records it sums. If no quarter can be read, the load throws.
 */
import { createInflateRaw } from "node:zlib";
import { Readable } from "node:stream";
import type { FetchCtx, SalesTaxRow, SalesTaxRowKind, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { unzip } from "../fetch-util";

export const SST_PAGE = "https://www.streamlinedsalestax.org/Shared-Pages/rate-and-boundary-files";
export const SST_BASE = "https://www.streamlinedsalestax.org/ratesandboundry";
export const SST_RATES_DIR = `${SST_BASE}/Rates/`;
export const SST_BOUNDARY_DIR = `${SST_BASE}/Boundary/`;
export const CENSUS_BASE = "https://www2.census.gov/geo/docs/reference/codes2020";
export const CENSUS_PLACE = `${CENSUS_BASE}/national_place2020.txt`;
export const CENSUS_COUSUB = `${CENSUS_BASE}/national_cousub2020.txt`;
export const CENSUS_COUNTY = `${CENSUS_BASE}/national_county2020.txt`;
export const CENSUS_GAZETTEER = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/";

/** SST full + associate members (streamlinedsalestax.org "State Information"), minus WA (own adapter). */
export const SST_STATE_FIPS: Record<string, string> = {
  AR: "05", GA: "13", IN: "18", IA: "19", KS: "20", KY: "21", MI: "26", MN: "27", NE: "31", NV: "32",
  NJ: "34", NC: "37", ND: "38", OH: "39", OK: "40", RI: "44", SD: "46", TN: "47", UT: "49", VT: "50",
  WV: "54", WI: "55", WY: "56",
};
export const SST_STATES = Object.keys(SST_STATE_FIPS);

/* ------------------------------------------------------------------ file discovery */

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type SstFile = { name: string; state: string; kind: "R" | "B"; year: number; quarter: number; posted: string };

/** "OHR2026Q4SEP17.csv" → parts; null for anything else (alternate-boundary files, junk). */
export function parseSstFileName(name: string): SstFile | null {
  const m = name.match(/^([A-Z]{2})([RB])(\d{4})Q([1-4])([A-Za-z]{3})(\d{1,2})\.(csv|zip)$/i);
  if (!m) return null;
  const year = Number(m[3]), quarter = Number(m[4]);
  const mon = MON.indexOf(m[5].toUpperCase()) + 1;
  if (!mon) return null;
  // Posted before (or in) the quarter: a month after the quarter's first month belongs to the year before.
  const postedYear = mon > (quarter - 1) * 3 + 3 ? year - 1 : year;
  const posted = `${postedYear}-${String(mon).padStart(2, "0")}-${String(Number(m[6])).padStart(2, "0")}`;
  return { name, state: m[1].toUpperCase(), kind: m[2].toUpperCase() as "R" | "B", year, quarter, posted };
}

/** File names linked from an IIS directory listing. */
export function parseDirListing(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const name = decodeURIComponent(m[1].split("/").pop() ?? "");
    if (parseSstFileName(name)) out.push(name);
  }
  return out;
}

const fileOrder = (f: SstFile) => `${f.year}${f.quarter}${f.posted}`;

/** Newest file of a kind for a state (latest quarter, then latest posting). */
export function newestFile(files: string[], state: string, kind: "R" | "B"): SstFile | null {
  const c = files.map(parseSstFileName).filter((f): f is SstFile => !!f && f.state === state && f.kind === kind);
  c.sort((a, b) => (fileOrder(a) < fileOrder(b) ? 1 : -1));
  return c[0] ?? null;
}

/** As-of date = first day of the newest quarter posted for any SST state. */
export function asOfFromFiles(files: string[]): { effectiveDate: string; periodLabel: string } | null {
  let best: SstFile | null = null;
  for (const n of files) {
    const f = parseSstFileName(n);
    if (f && (!best || f.year * 10 + f.quarter > best.year * 10 + best.quarter)) best = f;
  }
  if (!best) return null;
  const m = (best.quarter - 1) * 3 + 1;
  return { effectiveDate: `${best.year}-${String(m).padStart(2, "0")}-01`, periodLabel: `Q${best.quarter} ${best.year}` };
}

/* ------------------------------------------------------------------ file reading */

/** Lines of a .csv buffer or of the first .csv inside a .zip (streamed: boundary files inflate to ~400 MB). */
export async function* fileLines(buf: Buffer, name: string): AsyncGenerator<string> {
  let source: AsyncIterable<Buffer> | Iterable<Buffer>;
  if (/\.zip$/i.test(name)) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`${name}: not a zip file`);
    let p = buf.readUInt32LE(eocd + 16);
    const count = buf.readUInt16LE(eocd + 10);
    let entry: { method: number; start: number; size: number } | null = null;
    for (let n = 0; n < count && !entry; n++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${name}: bad zip central directory`);
      const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      const entryName = buf.toString("utf8", p + 46, p + 46 + nameLen);
      if (/\.csv$/i.test(entryName)) {
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        entry = { method, start, size };
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (!entry) throw new Error(`${name}: no .csv inside the zip`);
    const data = buf.subarray(entry.start, entry.start + entry.size);
    if (entry.method === 0) source = [data];
    else if (entry.method === 8) source = Readable.from([data]).pipe(createInflateRaw());
    else throw new Error(`${name}: unsupported zip method ${entry.method}`);
  } else source = [buf];

  let rest = "";
  for await (const chunk of source) {
    const text = rest + (chunk as Buffer).toString("latin1");
    const lines = text.split("\n");
    rest = lines.pop() ?? "";
    for (const l of lines) yield l;
  }
  if (rest) yield rest;
}

/* ------------------------------------------------------------------ rate file */

export type RateRec = { type: number; code: string; rate: number; begin: number; end: number };

const ymd = (s: string) => Number(s.trim());
const isoFromYmd = (n: number) => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
/** Strip a UTF-8 BOM (read as latin1 "ï»¿") and stray whitespace. */
const cleanField = (s: string) => s.replace(/^(﻿|ï»¿)/, "").trim();

/** One state's rate file → records keyed "type|code" (type as a number: "0", "00" → 0). */
export function parseSstRates(lines: string[], stateFips: string): Map<string, RateRec[]> {
  const out = new Map<string, RateRec[]>();
  for (const line of lines) {
    const f = line.split(",").map(cleanField);
    if (f.length < 9 || !f[0]) continue;
    if (f[0].padStart(2, "0") !== stateFips) throw new Error(`SST rate file: row for state ${f[0]} in ${stateFips}'s file`);
    const type = Number(f[1]), rate = Number(f[3]), begin = ymd(f[7]), end = ymd(f[8]);
    if (!Number.isFinite(type) || !Number.isFinite(rate) || !begin || !end) throw new Error(`SST rate file: bad row "${line}"`);
    const key = `${type}|${f[2]}`;
    const list = out.get(key) ?? [];
    list.push({ type, code: f[2], rate, begin, end });
    out.set(key, list);
  }
  return out;
}

const CITY_TYPES = [1, 2, 3, 4, 5];

/* ------------------------------------------------------------------ census names */

export type CensusNames = {
  /** "39|18000" → "Columbus" (places first, then county subdivisions). */
  place: Map<string, string>;
  /** "39|18000" → county names a place lies in (from the place file's COUNTIES column). */
  placeCounties: Map<string, string[]>;
  /** "39|049" → "Franklin". */
  county: Map<string, string>;
};

const stripDescriptor = (name: string) => {
  let s = name.trim().replace(/\s*\(balance\)$/i, "");
  // Census appends lower-case legal descriptors ("city", "village", "metropolitan government", "CDP").
  s = s.replace(/(\s+(?:[a-z][a-z-]*|CDP))+$/, "");
  return s.trim();
};
const stripCounty = (s: string) => s.replace(/\s+(County|Parish|Borough|Census Area|Municipality)$/i, "").trim();

/**
 * Census names: the 2020 reference code files (place, county subdivision, county) plus, when given,
 * the newest Census Gazetteer place / county-subdivision files for places incorporated since 2020
 * (e.g. WI's Greenville and Lisbon villages, 2021).
 */
export function parseCensusFiles(placeTxt: string, cousubTxt: string, countyTxt: string, gazPlaceTxt = "", gazCousubTxt = ""): CensusNames {
  const rows = (t: string) => t.split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));
  const place = new Map<string, string>(), placeCounties = new Map<string, string[]>(), county = new Map<string, string>();
  const p = rows(placeTxt);
  const ph = p[0];
  const iSt = ph.indexOf("STATEFP"), iPl = ph.indexOf("PLACEFP"), iNm = ph.indexOf("PLACENAME"), iCo = ph.indexOf("COUNTIES");
  if (iSt < 0 || iPl < 0 || iNm < 0) throw new Error("Census place file: unexpected header");
  for (const r of p.slice(1)) {
    const k = `${r[iSt]}|${r[iPl]}`;
    place.set(k, stripDescriptor(r[iNm]));
    if (iCo >= 0 && r[iCo]) placeCounties.set(k, r[iCo].split("~~~").map(stripCounty));
  }
  const cs = rows(cousubTxt);
  const ch = cs[0];
  const jSt = ch.indexOf("STATEFP"), jCs = ch.indexOf("COUSUBFP"), jNm = ch.indexOf("COUSUBNAME"), jCoN = ch.indexOf("COUNTYNAME");
  if (jSt < 0 || jCs < 0 || jNm < 0) throw new Error("Census county-subdivision file: unexpected header");
  for (const r of cs.slice(1)) {
    const k = `${r[jSt]}|${r[jCs]}`;
    if (place.has(k) || /^0+$/.test(r[jCs])) continue;
    place.set(k, stripDescriptor(r[jNm]));
    if (jCoN >= 0) placeCounties.set(k, [...(placeCounties.get(k) ?? []), stripCounty(r[jCoN])]);
  }
  const c = rows(countyTxt);
  const kh = c[0];
  const kSt = kh.indexOf("STATEFP"), kCo = kh.indexOf("COUNTYFP"), kNm = kh.indexOf("COUNTYNAME");
  if (kSt < 0 || kCo < 0 || kNm < 0) throw new Error("Census county file: unexpected header");
  for (const r of c.slice(1)) county.set(`${r[kSt]}|${r[kCo]}`, stripCounty(r[kNm]));
  for (const [txt, cut] of [[gazPlaceTxt, 2], [gazCousubTxt, 5]] as const) {
    if (!txt) continue;
    const g = txt.split(/\r?\n/).filter(Boolean).map((l) => l.split(/[|\t]/).map((x) => x.trim()));
    const iGeo = g[0].indexOf("GEOID"), iName = g[0].indexOf("NAME");
    if (iGeo < 0 || iName < 0) throw new Error("Census Gazetteer file: unexpected header");
    for (const r of g.slice(1)) {
      const geo = r[iGeo] ?? "";
      const k = `${geo.slice(0, 2)}|${geo.slice(cut)}`;
      if (geo.length !== cut + 5 || place.has(k) || /^0+$/.test(geo.slice(cut))) continue;
      place.set(k, stripDescriptor(r[iName]));
    }
  }
  if (place.size < 30_000 || county.size < 3_000) throw new Error(`Census code files look partial (${place.size} places, ${county.size} counties)`);
  return { place, placeCounties, county };
}

/* ------------------------------------------------------------------ boundary → rows */

type Combo = {
  stateApplies: boolean;
  county: string;
  place: string;
  specials: { type: number; code: string }[];
  records: number;
  zips: Map<string, number>;
};

const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

/** Distinct jurisdiction combinations of the boundary records in force on `asOf` (YYYYMMDD). */
export async function collectCombos(lines: AsyncIterable<string> | Iterable<string>, stateFips: string, asOf: number) {
  // 5-digit ZIP ("Z") records are the fallback level: where a ZIP spans jurisdictions they carry
  // the lowest rate, so they must not create rate variants inside a place the finer records cover.
  const fine = new Map<string, Combo>(), zip5 = new Map<string, Combo>();
  let total = 0, active = 0;
  for await (const line of lines as AsyncIterable<string>) {
    if (line.length < 30) continue;
    const f = line.split(",");
    const rt = cleanField(f[0]).toUpperCase();
    if (rt !== "A" && rt !== "4" && rt !== "Z") continue;
    total++;
    const begin = Number(f[1]), end = Number(f[2]);
    if (!(begin <= asOf && asOf <= end)) continue;
    if ((f[22] ?? "").trim().padStart(2, "0") !== stateFips) continue;
    active++;
    const ind = (f[23] ?? "").trim();
    const county = (f[24] ?? "").trim();
    const place = (f[25] ?? "").trim();
    const specials: { type: number; code: string }[] = [];
    for (let i = 29; i + 1 < f.length; i += 3) {
      const code = (f[i + 1] ?? "").trim();
      if (!code) continue;
      specials.push({ type: Number((f[i + 2] ?? "").trim()), code });
    }
    specials.sort((a, b) => (a.type - b.type) || a.code.localeCompare(b.code));
    const stateApplies = ind === "" ? true : ind.padStart(2, "0") === stateFips;
    const key = `${stateApplies ? 1 : 0}|${county}|${place}|${specials.map((s) => `${s.type}:${s.code}`).join(";")}`;
    const combos = rt === "Z" ? zip5 : fine;
    let c = combos.get(key);
    if (!c) { c = { stateApplies, county, place, specials, records: 0, zips: new Map() }; combos.set(key, c); }
    c.records++;
    if (rt === "A") {
      const z = (f[15] ?? "").trim().padStart(5, "0");
      if (/^\d{5}$/.test(z) && z !== "00000") bump(c.zips, z);
    } else {
      const lo = (f[17] ?? "").trim(), hi = (f[19] ?? "").trim();
      if (/^\d{3,5}$/.test(lo) && lo === hi) bump(c.zips, lo.padStart(5, "0"));
    }
  }
  // A 5-digit ZIP combination is kept only for a place/county the finer records never mention
  // (e.g. WV's no-city-tax remainder exists only at the ZIP level), and never one carrying district
  // codes (OK's per-ZIP "lowest rate" codes are a fallback, not a place's rate).
  const seen = new Set([...fine.values()].map((c) => `${c.place}|${c.county}`));
  const fallback = [...zip5.values()].filter((c) => !c.specials.length && !seen.has(`${c.place}|${c.county}`));
  return { combos: [...fine.values(), ...fallback], total, active };
}

type Priced = Combo & { ratePct: number; effective: number; codes: string[]; placeIsCity: boolean };

export function buildRows(
  state: string,
  stateFips: string,
  rates: Map<string, RateRec[]>,
  combos: Combo[],
  names: CensusNames,
  asOf: number,
): { rows: SalesTaxRow[]; skipped: string[] } {
  const skipped: string[] = [];
  const known = (type: number, code: string) => rates.has(`${type}|${code}`);
  const current = (type: number, code: string) => {
    const cur = (rates.get(`${type}|${code}`) ?? []).filter((r) => r.begin <= asOf && asOf <= r.end);
    // Identical duplicate lines are harmless; two different rates in force at once are not.
    if (cur.length > 1 && cur.some((r) => r.rate !== cur[0].rate)) throw new Error(`${state}: conflicting rate records in force for ${type}/${code}`);
    return cur.slice(0, 1).map((r) => ({ ...r, begin: Math.max(...cur.map((x) => x.begin)) }));
  };
  const stateRec = current(45, stateFips);
  if (stateRec.length !== 1) throw new Error(`${state}: expected one state rate in force, found ${stateRec.length}`);

  const priced: Priced[] = [];
  for (const c of combos) {
    let total = 0, effective = 0, ok = true, placeIsCity = false;
    const codes: string[] = [];
    const add = (type: number, code: string) => {
      const cur = current(type, code);
      if (cur.length === 1) { total += cur[0].rate; effective = Math.max(effective, cur[0].begin); }
    };
    if (c.stateApplies) add(45, stateFips);
    if (c.county) {
      if (!known(0, c.county)) { ok = false; skipped.push(`county ${c.county}`); }
      else { add(0, c.county); codes.push(c.county); }
    }
    if (c.place) {
      const types = CITY_TYPES.filter((t) => known(t, c.place));
      const anyTypes = [...rates.values()].flat().filter((r) => r.code === c.place && r.type !== 0 && r.type !== 45).map((r) => r.type);
      const cityType = types.find((t) => current(t, c.place).length) ?? types[0];
      if (cityType !== undefined) { add(cityType, c.place); placeIsCity = true; }
      else if (anyTypes.length) { add(anyTypes.find((t) => current(t, c.place).length) ?? anyTypes[0], c.place); }
      else { ok = false; skipped.push(`place ${c.place}`); }
      codes.push(c.place);
    }
    for (const s of c.specials) {
      if (!known(s.type, s.code)) { ok = false; skipped.push(`district ${s.type}/${s.code}`); continue; }
      add(s.type, s.code); codes.push(s.code);
    }
    if (!ok) continue;
    priced.push({ ...c, ratePct: Math.round(total * 100 * 10_000) / 10_000, effective, codes, placeIsCity });
  }

  // Group by identity → variants by combined rate. Identity: a named city (place code with a
  // city-type rate record and a Census name) + county; else a coded area the Census files do not
  // name (state-assigned codes such as UT's township/unincorporated codes) + county; else county.
  type Variant = { ratePct: number; records: number; zips: Map<string, number>; effective: number; codes: Map<string, number> };
  type Group = { kind: SalesTaxRowKind; placeCode: string | null; city: string | null; county: string; variants: Map<number, Variant> };
  const groups = new Map<string, Group>();
  for (const p of priced) {
    const placeName = p.place ? names.place.get(`${stateFips}|${p.place}`) ?? null : null;
    const isCity = !!p.place && p.placeIsCity && !!placeName;
    const gk = `${p.place}|${p.county}`;
    let g = groups.get(gk);
    if (!g) {
      const kind: SalesTaxRowKind = isCity ? "city" : p.place ? "special" : p.county ? "county" : "state";
      g = { kind, placeCode: p.place || null, city: isCity ? placeName : null, county: p.county, variants: new Map() };
      groups.set(gk, g);
    }
    let v = g.variants.get(p.ratePct);
    if (!v) { v = { ratePct: p.ratePct, records: 0, zips: new Map(), effective: 0, codes: new Map() }; g.variants.set(p.ratePct, v); }
    v.records += p.records;
    v.effective = Math.max(v.effective, p.effective);
    bump(v.codes, p.codes.join("+"), p.records);
    for (const [z, k] of p.zips) bump(v.zips, z, k);
  }

  const rows: SalesTaxRow[] = [];
  // Some states omit the county code on part of a place's records; that county-less group adds
  // nothing when the same place is published with a county at the same rate(s).
  const countyRates = new Map<string, Set<number>>();
  for (const g of groups.values()) {
    if (!g.placeCode || !g.county) continue;
    const set = countyRates.get(g.placeCode) ?? new Set<number>();
    for (const r of g.variants.keys()) set.add(r);
    countyRates.set(g.placeCode, set);
  }
  for (const g of groups.values()) {
    if (g.placeCode && !g.county) {
      const known = countyRates.get(g.placeCode);
      if (known && [...g.variants.keys()].every((r) => known.has(r))) continue;
    }
    let county = g.county ? names.county.get(`${stateFips}|${g.county}`) ?? null : null;
    if (!county && g.city && g.placeCode) {
      const pc = names.placeCounties.get(`${stateFips}|${g.placeCode}`);
      if (pc?.length === 1) county = pc[0];
    }
    const variants = [...g.variants.values()].sort((a, b) => b.records - a.records);
    // In the remainder with no county and no city code, only the plain state-rate variant is a
    // "state" row; district combinations there can only be told apart by their ZIPs.
    const main = g.kind === "state" ? variants.find((v) => !top(v.codes)) : variants[0];
    const base = { state, city: g.city, county };
    if (main) rows.push({ ...base, locationCode: top(main.codes) || null, zip: null, kind: g.kind, ratePct: main.ratePct, effectiveDate: isoFromYmd(main.effective) });
    for (const v of variants) {
      if (v === main) continue;
      // A minority variant (a district inside this place/county): name the ZIPs where it is the only
      // rate published for this place/county; otherwise one row without a ZIP (its codes tell it apart).
      const exclusive = [...v.zips.keys()].filter((z) => !variants.some((o) => o !== v && o.zips.has(z)));
      const zips = exclusive.length ? exclusive.sort() : [null];
      for (const zip of zips) {
        rows.push({ ...base, locationCode: top(v.codes) || null, zip, kind: "special", ratePct: v.ratePct, effectiveDate: isoFromYmd(v.effective) });
      }
    }
  }
  rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind < b.kind ? -1 : 1) || (a.county ?? "").localeCompare(b.county ?? "") || (a.city ?? "").localeCompare(b.city ?? "") || (a.zip ?? "").localeCompare(b.zip ?? ""));
  return { rows, skipped: [...new Set(skipped)] };
}

/* ------------------------------------------------------------------ source */

/** Minimum rows per state — far below the real counts, so a truncated boundary file fails loudly. */
const MIN_ROWS: Record<string, number> = {
  AR: 300, GA: 100, IA: 50, KS: 400, MN: 60, NC: 80, ND: 200, NE: 200, NV: 10, OH: 70, OK: 400,
  SD: 250, TN: 250, UT: 100, VT: 15, WI: 1000, WV: 50, WY: 15,
};

export async function loadSstState(
  ctx: FetchCtx,
  state: string,
  files: string[],
  names: CensusNames,
  period: { effectiveDate: string; periodLabel: string },
): Promise<SalesTaxSourceResult> {
  const fips = SST_STATE_FIPS[state];
  const rf = newestFile(files, state, "R"), bf = newestFile(files, state, "B");
  if (!rf || !bf) throw new Error(`${state}: no SST ${rf ? "boundary" : "rate"} file posted`);
  const asOf = Number(period.effectiveDate.replace(/-/g, ""));
  const rateUrl = SST_RATES_DIR + rf.name, bndUrl = SST_BOUNDARY_DIR + bf.name;
  const rateLines: string[] = [];
  for await (const l of fileLines(await ctx.get(rateUrl), rf.name)) rateLines.push(l);
  const rates = parseSstRates(rateLines, fips);
  const { combos, total, active } = await collectCombos(fileLines(await ctx.get(bndUrl), bf.name), fips, asOf);
  if (!active) throw new Error(`${state}: no boundary records in force on ${period.effectiveDate} (${total} read)`);
  const { rows, skipped } = buildRows(state, fips, rates, combos, names, asOf);
  const min = MIN_ROWS[state] ?? 1;
  if (rows.length < min) throw new Error(`${state}: only ${rows.length} rows built (expected ≥ ${min}) — refusing a partial table`);
  if (rows.some((r) => !Number.isFinite(r.ratePct) || r.ratePct <= 0 || r.ratePct > 15)) throw new Error(`${state}: implausible combined rate in SST data`);
  const notes = [
    `SST rate file ${rf.name}, boundary file ${bf.name}; ${active} boundary records in force on ${period.effectiveDate}. Combined rate = sum of the SST rate-file rates for each jurisdiction code on the boundary record.`,
    skipped.length ? `Skipped boundary combinations referencing codes absent from the rate file: ${skipped.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return {
    state, sourceName: `SST ${state} rate/boundary files`, sourceUrl: `${rateUrl} ; ${bndUrl}`,
    effectiveDate: period.effectiveDate, periodLabel: period.periodLabel, rows, notes,
  };
}

/** Census responses sometimes come back as an HTML "Request Rejected" page with status 200: retry. */
async function censusText(ctx: FetchCtx, url: string, expect: RegExp): Promise<string> {
  let last = "";
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((r) => setTimeout(r, 3000 * i));
    try {
      const buf = await ctx.get(url);
      const text = /\.zip$/i.test(url) ? [...unzip(buf).values()][0]?.toString("utf8") ?? "" : buf.toString("utf8");
      if (expect.test(text.slice(0, 200))) return text;
      last = text.slice(0, 120);
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`Census file ${url} unavailable (${last})`);
}

/** Census 2020 reference code files + the newest Gazetteer place/cousub files (best effort for the latter). */
export async function loadCensusNames(ctx: FetchCtx): Promise<CensusNames> {
  const place = await censusText(ctx, CENSUS_PLACE, /^STATE\|STATEFP\|PLACEFP/);
  const cousub = await censusText(ctx, CENSUS_COUSUB, /^STATE\|STATEFP\|COUNTYFP/);
  const county = await censusText(ctx, CENSUS_COUNTY, /^STATE\|STATEFP\|COUNTYFP/);
  let gazPlace = "", gazCousub = "";
  try {
    const years = [...(await censusText(ctx, CENSUS_GAZETTEER, /</)).matchAll(/href="(\d{4})_Gazetteer\/"/g)].map((m) => Number(m[1])).sort((a, b) => b - a);
    for (const y of years.slice(0, 2)) {
      try {
        gazPlace = await censusText(ctx, `${CENSUS_GAZETTEER}${y}_Gazetteer/${y}_Gaz_place_national.zip`, /^USPS[|\t]GEOID/);
        gazCousub = await censusText(ctx, `${CENSUS_GAZETTEER}${y}_Gazetteer/${y}_Gaz_cousubs_national.zip`, /^USPS[|\t]GEOID/);
        break;
      } catch { gazPlace = gazCousub = ""; }
    }
  } catch { /* the 2020 reference files alone still name every place that existed in 2020 */ }
  return parseCensusFiles(place, cousub, county, gazPlace, gazCousub);
}

export const sstSource: SalesTaxSource = {
  states: SST_STATES,
  name: "Streamlined Sales Tax rate & boundary files",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const files = [...parseDirListing(await ctx.getText(SST_RATES_DIR)), ...parseDirListing(await ctx.getText(SST_BOUNDARY_DIR))];
    const period = asOfFromFiles(files);
    if (!period) throw new Error("SST: could not read a quarter from the rate/boundary file names");
    const names = await loadCensusNames(ctx);
    // One state's odd file must not block the other 22: it is left out (and logged); the load
    // only fails outright when most states fail, which means the SST format or site changed.
    const out: SalesTaxSourceResult[] = [];
    const failed: string[] = [];
    for (const st of SST_STATES) {
      try { out.push(await loadSstState(ctx, st, files, names, period)); }
      catch (e) { failed.push(`${st}: ${(e as Error).message}`); console.error(`[sales-tax] SST ${st} not loaded — ${(e as Error).message}`); }
    }
    if (failed.length > SST_STATES.length / 2) throw new Error(`SST: ${failed.length} states failed — ${failed.join("; ")}`);
    return out;
  },
};
