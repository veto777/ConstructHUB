/**
 * Alabama. Every source here was opened and searched live on 2026-10-15; field labels and values are the boards' own
 * (CLAUDE.md: never fabricate government data).
 *
 *   Alabama Licensing Board for General Contractors (licensesearch.alabama.gov/genconbd, the board's "License
 *     Verification List"), live per report, companies: the whole list (about 9,000 licensees, one page) is read at
 *     most every 12 hours and kept in memory; each match's detail page gives the expiration date and bid limit.
 *     Classifications ("BC: BUILDING CONSTRUCTION", "E: ELECTRICAL", "M-S: HEATING, VENTILATION, AND AIR
 *     CONDITIONING", …) are the board's own.
 *   Alabama Onsite Wastewater Board installers (licensesearch.alabama.gov/AOWB), live per report, people: septic
 *     system installer licenses (types Basic, Advanced Level 1 and 2 Installer; pumper, manufacturer and portable
 *     toilet licenses are left out) by the installer's name, with each match's status and business name.
 *   Alabama Board of Electrical Contractors disciplinary actions (aecb.alabama.gov/public-records/disciplinary-actions/),
 *     a weekly file, companies only: every PDF the page links, read with ./lib/a3-pdf.ts (checked 2026-10-15). Two
 *     layouts: the FY2021–FY2024 table (case no., respondent, city & state, license no., date of action, disposition,
 *     fine) and the yearly 2010–2020 lists ("Name: … Case # … Date: … Disposition: …"). The FY2025–2026 files and the
 *     signed settlement agreements are scanned images with no text, so they are counted and skipped. A respondent
 *     named only as a person (no "dba" business, no company name) is left out (FCRA); "Jane Doe dba Acme Electric"
 *     is kept as Acme Electric. The "outstanding fines" lists name individuals and are left out.
 */
import type { LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { tokens } from "../licenses";
import { normLicense, normPhone, type IdQuery } from "../identifiers";
import { clean, download, usDate, type BulkHit } from "../bulk";
import { promises as fs } from "node:fs";
import type { EnforcementHit } from "@shared/research-reports";
import { decodeEntities } from "../bulk-sources";
import { pdfText, textLines } from "./lib/a3-pdf";
import { looksLikeBusiness } from "./lib/business-name";
import { adverseFrom } from "../adverse";
import { capNote, withNote } from "../notes";
import { flipName, tableRows, text } from "./lib/g4-html";
import type { StatePack } from "./types";

const HOST = "https://licensesearch.alabama.gov";
const GC_LIST = `${HOST}/genconbd`;
const AOWB_LIST = `${HOST}/AOWB`;
const MAX_DETAILS = 15;
const LIST_TTL_MS = 12 * 3600_000;

type Row = { cells: (string | null)[]; detail: string | null };

/** The rows of a licensesearch.alabama.gov list table (#myDataTable or the AOWB table) with each row's detail link. */
export function parseAlList(html: string): Row[] {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return Array.from(body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)).map((m) => ({
    cells: tableRows(`<tr>${m[1]}</tr>`)[0] ?? [],
    detail: m[1].match(/href="(\/[A-Za-z]+\/Details\/\d+)"/)?.[1] ?? null,
  }));
}

/** The read-only inputs of a detail page, by their id ("expire", "bid", "status", "businessName", …). */
export function parseAlDetail(html: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const m of Array.from(html.matchAll(/<input[^>]*id="([^"]+)"[^>]*value="([^"]*)"/g))) out[m[1]] = text(m[2]);
  for (const m of Array.from(html.matchAll(/<textarea[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))) out[m[1]] = text(m[2]);
  return out;
}

const cache = new Map<string, { at: number; rows: Row[] }>();
async function list(url: string): Promise<Row[]> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.rows;
  const res = await politeFetch(url, {}, { minDelayMs: 1500, timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`licensesearch.alabama.gov returned HTTP ${res.status}`);
  const rows = parseAlList(await res.text());
  if (rows.length < 100) throw new Error(`licensesearch.alabama.gov list came back with ${rows.length} rows`);
  cache.set(url, { at: Date.now(), rows });
  return rows;
}

async function detail(path: string): Promise<Record<string, string | null>> {
  const res = await politeFetch(`${HOST}${path}`, {}, { minDelayMs: 1100 });
  if (!res.ok) throw new Error(`licensesearch.alabama.gov detail returned HTTP ${res.status}`);
  return parseAlDetail(await res.text());
}

const has = (want: string[], v: string | null) => { const t = new Set(tokens(v ?? "")); return want.length > 0 && want.every((w) => t.has(w)); };

const addr = (d: Record<string, string | null>, street: string, city: string, st: string, zip: string) =>
  [d[street], d[city], [d[st], d[zip]].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

/** Detail pages are fetched for the first MAX_DETAILS matches; the report says when there were more. */
const capped = (hits: LicenseHit[], rows: Row[]) => withNote(hits, rows.length > MAX_DETAILS ? capNote(MAX_DETAILS, rows.length) : null);

async function gcHits(rows: Row[], matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit[]> {
  const hits: LicenseHit[] = [];
  for (const r of rows.slice(0, MAX_DETAILS)) {
    const d = r.detail ? await detail(r.detail) : {};
    const bid = d.bid ?? null;
    hits.push({
      state: "AL", source: "Alabama Licensing Board for General Contractors", sourceUrl: r.detail ? `${HOST}${r.detail}` : GC_LIST,
      businessName: r.cells[0], licenseNumber: r.cells[1], licenseType: bid ? `Bid limit: ${bid}` : null,
      specialty: r.cells[4] ?? d.specialty ?? null, status: d.extension ? `Extended to ${d.extension}` : null, principal: null,
      city: [r.cells[2], r.cells[3]].filter(Boolean).join(", ") || null, expires: usDate(d.expire), matchedOn,
      address: addr(d, "Address", "City", "state", "zip"), phone: d.phone ?? r.cells[5] ?? null,
      // The board licenses general contractors: a contractor's (business's) license by its class.
      holder: "business",
    });
  }
  return capped(hits, rows);
}

/** General contractors by company name: NAME, LIC #, CITY, STATE, SPECIALTY, PHONE, then the detail page. */
export async function searchAlGc(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind !== "company") return [];
  const want = tokens(name);
  return gcHits((await list(GC_LIST)).filter((r) => has(want, r.cells[0])), "business");
}

/** By license number or phone (both are columns of the list); the list has no street address to search. */
export async function searchAlGcBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type === "address") return null; // the list has no street address
  const rows = await list(GC_LIST);
  if (q.type === "license") { const n = normLicense(q.value) ?? q.value.replace(/\D/g, ""); return gcHits(rows.filter((r) => (normLicense(r.cells[1]) ?? r.cells[1]) === n), "license"); }
  const n = normPhone(q.value);
  return n ? gcHits(rows.filter((r) => normPhone(r.cells[5]) === n), "phone") : null;
}

/** Onsite wastewater installers by person: NAME ("LAST, FIRST M"), LIC #, Type, ISSUED DATE, BASE COUNTY, SERVICE COUNTIES. */
async function aowbHits(rows: Row[], matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit[]> {
  const hits: LicenseHit[] = [];
  for (const r of rows.slice(0, MAX_DETAILS)) {
    const d = r.detail ? await detail(r.detail) : {};
    const person = flipName(r.cells[0]);
    // An installer without a business name is a person alone: their address is a home address (city only).
    const biz = d.businessName ?? null;
    hits.push({
      state: "AL", source: "Alabama Onsite Wastewater Board installers", sourceUrl: r.detail ? `${HOST}${r.detail}` : AOWB_LIST,
      businessName: biz, licenseNumber: r.cells[1], licenseType: r.cells[2], specialty: r.cells[5] ? `Service counties: ${r.cells[5]}` : null,
      status: d.status ?? null, principal: person, city: d.city ?? (r.cells[4] ? `${r.cells[4]} County` : null), expires: null, matchedOn,
      address: biz ? addr(d, "address", "city", "state", "zip") : null, phone: biz ? d.workPhone ?? null : null, people: person ? [{ name: person, role: "Licensee" }] : [],
      // An installer license is the installer's own (an individual credential), whatever business it names.
      holder: "individual",
    });
  }
  return capped(hits, rows);
}

// Installer licenses only (Basic, Advanced Level 1 and 2 Installer); pumpers, manufacturers and portable toilets are not construction.
const installers = async () => (await list(AOWB_LIST)).filter((r) => /Installer|^Basic$/i.test(r.cells[2] ?? ""));

export async function searchAlAowb(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind !== "person") return [];
  const want = tokens(name);
  return aowbHits((await installers()).filter((r) => has(want, r.cells[0])), "principal");
}

export async function searchAlAowbBy(q: IdQuery): Promise<LicenseHit[] | null> {
  // Installer license numbers are digits only; a phone, an address or a lettered number can't be searched here.
  if (q.type !== "license" || !/^\d+$/.test(q.value.trim())) return null;
  const n = q.value.replace(/\D/g, "");
  return aowbHits((await installers()).filter((r) => r.cells[1]?.replace(/\D/g, "") === n), "license");
}

// ── Electrical Contractors Board disciplinary actions (PDFs) ─────────────────────────────────────────────────────
const AECB_DISCIPLINE = "https://aecb.alabama.gov/public-records/disciplinary-actions/";
const AECB_SOURCE = "Alabama Electrical Contractors Board disciplinary actions";

export type AecbAction = { business: string; caseNo: string | null; date: string | null; city: string | null; license: string | null; disposition: string | null; fine: number | null };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "May 21, 2020" or "8/18/2021" → YYYY-MM-DD. */
function aecbDate(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  const m = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) { const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1; return mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; }
  return usDate(t);
}

/**
 * The business a respondent names: the "dba" part when there is one, else the whole name when it reads as a
 * company's (./lib/business-name.ts: a suffix such as LLC or Inc, or a trade word that is not a surname, so
 * "David Power" stays a person); null for a person alone (FCRA: companies only).
 */
export function aecbBusiness(respondent: string): string | null {
  // "Name c/o Business" is the person's mailing address, not the business as respondent: judge the name alone. Case
  // numbers and dates the 2010-2020 lists print after the name ("Milton Bullock & 2020-021", "Larry Walker ; 2018-014",
  // "Dexter White Date: November13, 2019", "Steven A. Pritchard & 046") are not part of it.
  const t = respondent.replace(/\s+/g, " ").replace(/\s*\b[cC]\/[oO]\b.*$/, "")
    .replace(/\s*\bDate:.*$/i, "").replace(/\s*(?:[&;,]|\band\b)\s*#?\s*(?:\d{4}-\d{2,4}|\d{2,4})\b.*$/i, "").trim();
  // "Name dba Business" (the JS reader can glue "dbaBusiness").
  const dba = t.split(/\s*\b(?:[dD]\/?[bB]\/?[aA])(?:\b|(?=[A-Z&]))[:.]?\s*/);
  if (dba.length > 1) return clean(dba.slice(1).join(" ").replace(/^[,\s]+/, ""));
  return looksLikeBusiness(t) ? t : null;
}

const fineOf = (v: string | null | undefined): number | null => {
  const m = (v ?? "").match(/\$\s*([\d,]+(?:\.\d\d)?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

/**
 * The FY2021–FY2024 table: "ECB 2021-077  Respondent  City ST  04760  violation…  8/18/2021  disposition  $ 500.00  None".
 * Read by content (the case number, the license column, the date, the "$" of the fine) and by the columns where the
 * respondent and the disposition start, so their wrapped lines are picked up below the first.
 */
export function parseAecbTable(text: string): AecbAction[] {
  const out: AecbAction[] = [];
  const lines = textLines(text);
  const CASE = /^(\s*(?:and\s+)?ECB\s*(\d{4}-\d{2,4}(?:\.\d+)?)((?:\s+and\s+(?:ECB\s*)?\d{4}-\d{2,4}(?:\.\d+)?)*))\s{2,}/;
  const isBreak = (l: string) => CASE.test(l) || /CASE NO\.|DISCIPLINARY ACTIONS|FY 20\d\d through/i.test(l);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(CASE);
    if (!m) continue;
    const rest = line.slice(m[0].length);
    const parts = rest.split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
    // No respondent printed (the row starts at the license column): nothing to name.
    if (!parts.length || /^(None|\d{3,6})$/.test(parts[0])) continue;
    const licIdx = parts.findIndex((x, k) => k > 0 && /^(None|\d{3,6})$/.test(x));
    if (licIdx < 1) continue;
    let respondent = parts[0];
    const city = licIdx >= 2 ? parts.slice(1, licIdx).join(" ") : null;
    const license = /^\d+$/.test(parts[licIdx]) ? parts[licIdx] : null;
    const tail = parts.slice(licIdx + 1).join("  ");
    const dm = tail.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(.*)$/);
    if (!dm) continue;
    const dollar = dm[2].search(/\$/);
    let disposition = dollar >= 0 ? dm[2].slice(0, dollar) : dm[2];
    const fineText = dollar >= 0 ? dm[2].slice(dollar) : "";
    // Wrapped lines: the respondent's column (up to the city column) and the disposition's (right of the date).
    const respCol = m[0].length;
    const cityCol = city ? line.indexOf(city.split(" ")[0], respCol + respondent.length) : -1;
    const dateEnd = line.indexOf(dm[1]) + dm[1].length;
    for (let j = i + 1; j < lines.length && !isBreak(lines[j]); j++) {
      const l = lines[j];
      if (cityCol > respCol) { const seg = l.slice(Math.max(0, respCol - 2), cityCol - 1).trim(); if (seg) respondent += ` ${seg}`; }
      const seg = l.length > dateEnd ? l.slice(dateEnd + 1).trim() : "";
      if (seg && !seg.startsWith("$")) disposition += ` ${seg}`;
    }
    const business = aecbBusiness(respondent);
    if (!business) continue;
    out.push({
      business, caseNo: `ECB ${m[2]}${m[3] ? m[3].replace(/\s+/g, " ").replace(/\band ECB\s*/, "and ") : ""}`, date: aecbDate(dm[1]),
      city: clean(city), license, disposition: clean(disposition), fine: /\$\s*-/.test(fineText) ? null : fineOf(fineText),
    });
  }
  return out;
}

/** The yearly 2010–2020 lists: "Name: …", "Case # …", "Date: …", "Disposition: …" blocks. */
export function parseAecbBlocks(text: string): AecbAction[] {
  const out: AecbAction[] = [];
  const body = text.replace(/\u2010|\u2011|\u2013/g, "-").split(/OUTSTANDING DISCIPLINARY FINES/i)[0];
  for (const block of body.split(/^\s*Name:\s*/m).slice(1)) {
    const [head, ...rest] = block.split(/Disposition:\s*/);
    if (!rest.length) continue;
    const caseNo = head.match(/Case\s*#\s*([\w.-]+)/)?.[1] ?? null;
    const date = head.match(/Date:\s*([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/)?.[1] ?? null;
    const name = head.replace(/Case\s*#\s*[\w.-]+/, " ").replace(/Date:\s*[A-Za-z]+\.?\s+\d{1,2},?\s+\d{4}/, " ").replace(/\s+/g, " ").trim();
    const disposition = clean(rest.join(" ").split(/\n\s*\n/)[0]);
    const business = aecbBusiness(name);
    if (!business || !caseNo) continue;
    out.push({ business, caseNo, date: aecbDate(date), city: null, license: null, disposition, fine: disposition && /fine/i.test(disposition) ? fineOf(disposition) : null });
  }
  return out;
}

export function parseAecbText(text: string): AecbAction[] {
  return /ECB DISCIPLINARY ACTIONS|CASE NO\./i.test(text) ? parseAecbTable(text) : parseAecbBlocks(text);
}

const AECB_ADVERSE = /cease and desist|revok|suspen|fine|probation|consent|surrender|denied/i;

async function* aecbDiscipline(): AsyncIterable<BulkHit> {
  const res = await politeFetch(AECB_DISCIPLINE, {}, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`${AECB_DISCIPLINE} returned HTTP ${res.status}`);
  const html = await res.text();
  const pdfs = Array.from(new Set(Array.from(html.matchAll(/href="([^"]+\.pdf)"/gi)).map((m) => new URL(decodeEntities(m[1]), AECB_DISCIPLINE).toString())))
    .filter((u) => u.startsWith("https://aecb.alabama.gov/"));
  if (!pdfs.length) throw new Error(`no disciplinary-action PDF linked from ${AECB_DISCIPLINE}`);
  const seen = new Set<string>();
  let scanned = 0;
  for (const url of pdfs) {
    const path = await download(url);
    let text: string;
    try { text = (await pdfText(await fs.readFile(path))).text; } finally { await fs.rm(path, { force: true }); }
    if (text.replace(/\s+/g, "").length < 200) { scanned++; continue; } // a scanned image: nothing to read
    for (const a of parseAecbText(text)) {
      const key = `${a.caseNo}|${a.business.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hit: EnforcementHit = {
        state: "AL", source: AECB_SOURCE, sourceUrl: url, category: "discipline", name: a.business, id: a.caseNo, date: a.date, endDate: null,
        status: a.disposition ? a.disposition.slice(0, 160) : null, city: a.city, detail: a.disposition, amount: a.fine,
        adverse: adverseFrom(a.disposition, { adverse: AECB_ADVERSE }), licenseNumber: a.license,
      };
      yield { kind: "enforcement", hit, business: a.business, person: null, keys: { licenses: [a.license] } };
    }
  }
  if (scanned) console.log(`[research-bulk] al-aecb-discipline: ${scanned} scanned PDF(s) without text skipped`);
}

export const pack: StatePack = {
  state: "AL",
  checked: "2026-10-15",
  liveLicenses: [
    // The GC list is searched by company name only, the installer list by person only (round 2, decision 8).
    { source: "Alabama Licensing Board for General Contractors", sourceUrl: GC_LIST, search: searchAlGc, searchBy: searchAlGcBy, kinds: ["company"] },
    { source: "Alabama Onsite Wastewater Board installers", sourceUrl: AOWB_LIST, search: searchAlAowb, searchBy: searchAlAowbBy, kinds: ["person"] },
  ],
  bulk: [
    { id: "al-aecb-discipline", state: "AL", label: AECB_SOURCE, pageUrl: AECB_DISCIPLINE, everyHours: 24 * 7, minRows: 87,
      load: aecbDiscipline, companiesOnly: true, category: "discipline" },
  ],
  blocked: [
    "Home Builders Licensure Board license search (alhobv7prod.glsuite.us, GL Suite): robots.txt disallows every path and the page answers 403",
    "Home Builders Licensure Board disciplinary actions (hblb.alabama.gov/disciplinary-actions/): scanned-image PDFs kept 90 days (rechecked 2026-10-15: September-2026-Disciplinary-Actions.pdf is an image with no text layer); the unlicensed-builder prosecution PDFs name individuals (FCRA: companies only)",
    "Electrical Contractors Board license search (alecb-search.kalmservices.net): every search needs a Cloudflare Turnstile token",
    "Electrical Contractors Board disciplinary actions for FY2025 to today and the signed settlement agreements (aecb.alabama.gov): scanned-image PDFs with no text layer (FY2021-FY2024 and the 2010-2020 lists are read above)",
    "Plumbers and Gas Fitters Examining Board lookup (alpgfb.igovsolution.net): a verification-code (CAPTCHA) field on every search",
    "Board of Heating, Air Conditioning and Refrigeration Contractors (hacr.alabama.gov): no public license lookup, only the iGovSolution licensee login",
  ],
};
