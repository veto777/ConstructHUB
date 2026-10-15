/**
 * Arkansas. Every source here was opened and read live on 2026-10-15; field names and statuses are the Department
 * of Labor and Licensing's own (CLAUDE.md: never fabricate government data).
 *
 *   Board of Electrical Examiners roster (labor.arkansas.gov, "State Board of Electrical Examiners Roster"), bulk,
 *     weekly: every license the roster's own data endpoint returns (/wp-json/metl/v1/all, the table the page draws
 *     and exports), people only: name, license type (master, journeyman, residential, apprentice, electrical
 *     contractor, …), number, status, issue and expiration dates. Business rows carry no name in the roster and are
 *     skipped.
 *   HVAC/R Licensing Board roster (labor.arkansas.gov "HVAC Roster"), bulk, weekly, the same endpoint: people only:
 *     name, city, state, license number, status and expiration date (the roster gives no license class).
 *
 * labor.arkansas.gov's robots.txt asks for a 10-second crawl delay; the loaders wait that long between pages.
 */
import type { LicenseHit } from "@shared/research-reports";
import { USER_AGENT, rateLimitHost } from "../../scrapers/polite-fetch";
import { clean, usDate, type BulkHit, type BulkSource } from "../bulk";
import type { StatePack } from "./types";

const HOST = "https://labor.arkansas.gov";
const ELECTRICAL_PAGE = `${HOST}/licensing/board-of-electrical-examiners/state-board-of-electrical-examiners-roster/`;
const HVAC_PAGE = `${HOST}/licensing/hvac-licensing-board/hvac-roster/`;
const CRAWL_DELAY_MS = 10_000;
/** The endpoint answers an empty page above a few thousand rows per request (tested: 2,000 works, 4,000 does not). */
const PAGE_SIZE = 1000;

type Row = Record<string, unknown>;
const s = (v: unknown) => clean(v == null ? null : String(v));

/** One page of a roster table, the way the roster page's own DataTable asks for it (server-side paging). */
async function metlPage(postId: string, columns: string[], form: Record<string, string>, referer: string, start: number): Promise<{ total: number; rows: Row[] }> {
  const q = new URLSearchParams({ draw: "1", postID: postId, start: String(start), length: String(PAGE_SIZE), "search[value]": "", "search[regex]": "false", "order[0][column]": String(Math.max(0, columns.indexOf("License_Number"))), "order[0][dir]": "asc", ...form });
  columns.forEach((c, i) => { q.set(`columns[${i}][data]`, c); q.set(`columns[${i}][searchable]`, "true"); q.set(`columns[${i}][orderable]`, "true"); q.set(`columns[${i}][search][value]`, ""); });
  await rateLimitHost(HOST, CRAWL_DELAY_MS);
  const res = await fetch(`${HOST}/wp-json/metl/v1/all?${q}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json, text/javascript, */*; q=0.01", referer, "x-requested-with": "XMLHttpRequest" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`labor.arkansas.gov roster returned HTTP ${res.status}`);
  const body = await res.json() as { recordsTotal?: number; data?: Row[] };
  if (!Array.isArray(body.data)) throw new Error("labor.arkansas.gov roster returned an unexpected payload");
  return { total: Number(body.recordsTotal ?? 0), rows: body.data };
}

async function* metlRows(postId: string, columns: string[], form: Record<string, string>, referer: string): AsyncIterable<Row> {
  // Ordered by license number so pages don't shift; a row seen twice is yielded once.
  let start = 0, total = Infinity, got = 0;
  const seen = new Set<string>();
  while (start < total) {
    const page = await metlPage(postId, columns, form, referer, start);
    total = page.total;
    if (!page.rows.length) break;
    for (const r of page.rows) {
      const key = JSON.stringify(r);
      if (seen.has(key)) continue;
      seen.add(key);
      got++;
      yield r;
    }
    start += PAGE_SIZE;
  }
  if (got < total * 0.95) throw new Error(`roster paging returned ${got} of ${total} rows`);
}

const personOf = (r: Row) => clean([s(r.First_Name), s(r.Last_Name)].filter(Boolean).join(" "));
/** The roster prints "02/28/2020 23:59:59"; the year 2999 marks a license with no expiration. */
const day = (v: unknown) => { const d = usDate(s(v)); return d && !d.startsWith("2999") ? d : null; };

export function electricalHit(r: Row): BulkHit | null {
  const person = personOf(r);
  if (!person) return null;
  const number = s(r.License_Number);
  const hit: LicenseHit = {
    state: "AR", source: "Arkansas Board of Electrical Examiners roster", sourceUrl: ELECTRICAL_PAGE, businessName: null,
    licenseNumber: number, licenseType: s(r.License_Type_Display_Name), specialty: null,
    status: s(r.License_Status), principal: person, city: null, expires: day(r.License_Expiration_Date), matchedOn: "principal",
    people: [{ name: person, role: "Licensee" }],
  };
  return { kind: "license", hit, business: null, person, keys: { licenses: [number] } };
}

export function hvacHit(r: Row): BulkHit | null {
  const person = personOf(r);
  if (!person) return null;
  const number = s(r.License_Number);
  const hit: LicenseHit = {
    state: "AR", source: "Arkansas HVAC/R Licensing Board roster", sourceUrl: HVAC_PAGE, businessName: null,
    licenseNumber: number, licenseType: null, specialty: null, status: s(r.License_Status), principal: person,
    city: [s(r.physicalCity), s(r.physicalState)].filter(Boolean).join(", ") || null, expires: day(r.License_Expiration_Date), matchedOn: "principal",
    people: [{ name: person, role: "Licensee" }],
  };
  return { kind: "license", hit, business: null, person, keys: { licenses: [number] } };
}

async function* electrical(): AsyncIterable<BulkHit> {
  const cols = ["First_Name", "Last_Name", "License_Type_Display_Name", "License_Number", "License_Status", "License_Expiration_Date", "License_Issue_Date"];
  for await (const r of metlRows("15109", cols, { First_Name: "", Last_Name: "", License_Number: "" }, ELECTRICAL_PAGE)) { const h = electricalHit(r); if (h) yield h; }
}

async function* hvac(): AsyncIterable<BulkHit> {
  const cols = ["Submitter_Type", "First_Name", "Last_Name", "physicalCity", "physicalState", "License_Number", "License_Status", "License_Expiration_Date"];
  for await (const r of metlRows("35270", cols, { firstName: "", Last_Name: "", physicalCity: "" }, HVAC_PAGE)) { const h = hvacHit(r); if (h) yield h; }
}

const BULK: BulkSource[] = [
  { id: "ar-electrical-roster", state: "AR", label: "Arkansas Board of Electrical Examiners roster", pageUrl: ELECTRICAL_PAGE, everyHours: 24 * 7, minRows: 67_000, load: electrical },
  { id: "ar-hvacr-roster", state: "AR", label: "Arkansas HVAC/R Licensing Board roster", pageUrl: HVAC_PAGE, everyHours: 24 * 7, minRows: 23_000, load: hvac },
];

export const pack: StatePack = {
  state: "AR",
  checked: "2026-10-15",
  bulk: BULK,
  blocked: [
    "Contractors Licensing Board search (aclb2.arkansas.gov/clbsearch.php, linked from the board's 'Find a Licensed Contractor' page): the server never answered on 2026-10-15 (connection timed out from tower1 and vb11)",
    "Contractors Licensing Board hearings / findings of fact (labor.arkansas.gov hearings-finding-of-fact): scanned-image PDFs with no text layer",
    "Fire Protection Licensing Board roster: PDF files only, and the production server has no PDF text tool (pdftotext)",
    "Electrical and HVAC/R rosters: business rows carry no business name, so only people are searchable there",
  ],
};
