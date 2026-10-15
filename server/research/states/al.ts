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
 */
import type { LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../../scrapers/polite-fetch";
import { tokens } from "../licenses";
import { normLicense, normPhone, type IdQuery } from "../identifiers";
import { usDate } from "../bulk";
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
    });
  }
  return hits;
}

/** General contractors by company name: NAME, LIC #, CITY, STATE, SPECIALTY, PHONE, then the detail page. */
export async function searchAlGc(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind !== "company") return [];
  const want = tokens(name);
  return gcHits((await list(GC_LIST)).filter((r) => has(want, r.cells[0])), "business");
}

/** By license number or phone (both are columns of the list); the list has no street address to search. */
export async function searchAlGcBy(q: IdQuery): Promise<LicenseHit[]> {
  const rows = await list(GC_LIST);
  if (q.type === "license") { const n = normLicense(q.value) ?? q.value.replace(/\D/g, ""); return gcHits(rows.filter((r) => (normLicense(r.cells[1]) ?? r.cells[1]) === n), "license"); }
  if (q.type === "phone") { const n = normPhone(q.value); return n ? gcHits(rows.filter((r) => normPhone(r.cells[5]) === n), "phone") : []; }
  return [];
}

/** Onsite wastewater installers by person: NAME ("LAST, FIRST M"), LIC #, Type, ISSUED DATE, BASE COUNTY, SERVICE COUNTIES. */
async function aowbHits(rows: Row[], matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit[]> {
  const hits: LicenseHit[] = [];
  for (const r of rows.slice(0, MAX_DETAILS)) {
    const d = r.detail ? await detail(r.detail) : {};
    const person = flipName(r.cells[0]);
    hits.push({
      state: "AL", source: "Alabama Onsite Wastewater Board installers", sourceUrl: r.detail ? `${HOST}${r.detail}` : AOWB_LIST,
      businessName: d.businessName ?? null, licenseNumber: r.cells[1], licenseType: r.cells[2], specialty: r.cells[5] ? `Service counties: ${r.cells[5]}` : null,
      status: d.status ?? null, principal: person, city: d.city ?? (r.cells[4] ? `${r.cells[4]} County` : null), expires: null, matchedOn,
      address: addr(d, "address", "city", "state", "zip"), phone: d.workPhone ?? null, people: person ? [{ name: person, role: "Licensee" }] : [],
    });
  }
  return hits;
}

// Installer licenses only (Basic, Advanced Level 1 and 2 Installer); pumpers, manufacturers and portable toilets are not construction.
const installers = async () => (await list(AOWB_LIST)).filter((r) => /Installer|^Basic$/i.test(r.cells[2] ?? ""));

export async function searchAlAowb(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind !== "person") return [];
  const want = tokens(name);
  return aowbHits((await installers()).filter((r) => has(want, r.cells[0])), "principal");
}

export async function searchAlAowbBy(q: IdQuery): Promise<LicenseHit[]> {
  if (q.type !== "license") return [];
  const n = q.value.replace(/\D/g, "");
  return n ? aowbHits((await installers()).filter((r) => r.cells[1]?.replace(/\D/g, "") === n && /^\d+$/.test(q.value.trim())), "license") : [];
}

export const pack: StatePack = {
  state: "AL",
  checked: "2026-10-15",
  liveLicenses: [
    { source: "Alabama Licensing Board for General Contractors", sourceUrl: GC_LIST, search: searchAlGc, searchBy: searchAlGcBy },
    { source: "Alabama Onsite Wastewater Board installers", sourceUrl: AOWB_LIST, search: searchAlAowb, searchBy: searchAlAowbBy },
  ],
  blocked: [
    "Home Builders Licensure Board license search (alhobv7prod.glsuite.us, GL Suite): robots.txt disallows every path and the page answers 403",
    "Home Builders Licensure Board disciplinary actions (hblb.alabama.gov/disciplinary-actions/): scanned-image PDFs kept 90 days; the unlicensed-builder prosecution PDFs name individuals (FCRA: companies only)",
    "Electrical Contractors Board license search (alecb-search.kalmservices.net): every search needs a Cloudflare Turnstile token",
    "Electrical Contractors Board disciplinary actions (aecb.alabama.gov/public-records/disciplinary-actions/): yearly PDFs in several layouts; the production server has no PDF text tool (pdftotext) to read them",
    "Plumbers and Gas Fitters Examining Board lookup (alpgfb.igovsolution.net): a verification-code (CAPTCHA) field on every search",
    "Board of Heating, Air Conditioning and Refrigeration Contractors (hacr.alabama.gov): no public license lookup, only the iGovSolution licensee login",
  ],
};
