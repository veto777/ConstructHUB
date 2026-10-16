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
 *   Fire Protection Licensing Board rosters (labor.arkansas.gov "Roster Search", checked 2026-10-15), bulk, weekly:
 *     the two PDFs the page links, found through the page's own WordPress API entry (pages/14998), read with
 *     ./lib/a3-pdf.ts (pdftotext, or the JS reader without it):
 *       - "Licensed Sprinkler Companies" (2026/2027, updated 7/10/26): company, license FSS-nnn, phone, address,
 *         owner and RME (responsible managing employee), and each branch office (FSS-nnnA) with its own address;
 *       - "Portable and Fixed Systems Companies" (revised 4/1/2026): company, license P-/PF-nnn with the class
 *         codes the PDF's own legend defines (P portable, F fixed system, A/B class A/B hydrostatic, H Halon, CA
 *         clean agent, CO2), phone, address, owner or officer, branch offices.
 *     The PDFs give no expiration date; "status" says the company is on the roster of that date. Email addresses
 *     are left out.
 *
 *   Contractors Licensing Board hearings / findings of fact (labor.arkansas.gov "Hearings – Finding Of Fact",
 *     checked 2026-10-15), bulk, weekly, companies only (enforcement, FCRA): the PDFs the page links, found through
 *     its WordPress API entry (pages/21612; 436 PDF links for 2003 to 2026-08 on 2026-10-15, page modified
 *     2026-10-01), read with ./lib/a3-pdf.ts. Each PDF is one hearing day of the Contractors Licensing Board
 *     (commercial) or the Residential Contractors Committee: per hearing the board, "vs", the respondent as printed
 *     and the ORDER (revocation, suspension, civil penalty, agreed order), then a "SETTLEMENT AGREEMENTS" list (from
 *     about 2014 a 5-digit number before each name, which the PDFs never label: kept as the record's id, never as a
 *     license number; the name; the amount and its terms). Of the 428 links on labor.arkansas.gov (load of
 *     2026-10-15/16): 316 PDFs have a text layer (2003 to 2024-03) and are read; 112 are scanned images with no text
 *     layer (most from 2024-08 on, some older, e.g. Residential-Hearings_072419.pdf): skipped and counted, no OCR;
 *     6 with text can't be read whole and are skipped (below). One row per hearing order and one per settlement
 *     agreement entry, so a business can appear more than once (another hearing, or two agreements on one day).
 *     The 8 links to www.aclb.arkansas.gov (the board's old site, 2008 PDFs) answer 301 to the board's home page,
 *     not a PDF (checked 2026-10-15): not requested by the loader.
 *     Companies only, from the document alone: a respondent is kept only when its name as printed carries an entity
 *     word (Inc, LLC, Corp, Company, Co., Ltd, LP, LLP, PLLC); with a "d/b/a" the party before it must carry one
 *     ("Person d/b/a Business" is a sole proprietor, an individual: left out, as in va-dpor-revocations); anyone
 *     else (a person, people "&" people, a trade name with no entity word) is left out. detail names the board and
 *     hearing only: the order's other sentences (homeowners, owners) are not quoted.
 *     Fields as printed: name, hearing date (the PDF's own header, else the page's link text), the order's decision
 *     sentence or the settlement's terms (status), the penalty (an order's stated total, else its civil penalty when
 *     not per day; a settlement's first amount), and the PDF as sourceUrl. adverse: an order stating a civil
 *     penalty, revocation, suspension, probation, reprimand, "guilty of misconduct" or a violation → true; a
 *     dismissal or "found no violation" → false; both, neither, or a recommended order → null; a settlement → true
 *     only when its own terms say penalty, revocation, suspension or surrender, else null (the list itself states
 *     no finding). A document any part of which can't be read this way is skipped and counted, never half-read
 *     (2026-10-15: a findings-of-fact order that only reinstates an earlier one, an order with no text before a
 *     page break, a settlement list printed with no heading, a settlement line split mid-name).
 *     Without pdftotext the JS reader splits some words ("Suns hine"); the structure still parses.
 *
 * Robots and terms (read 2026-10-15 before the first request to each host):
 *   - labor.arkansas.gov/robots.txt (200 text/plain): "Crawl-delay: 10" / "User-agent: *" / "Disallow:" (nothing
 *     disallowed). The loaders wait 10 s between requests to the host.
 *   - portal.arkansas.gov/robots.txt (the host of the terms page the site footer links): the same lines.
 *   - www.aclb.arkansas.gov/robots.txt: 301 to www.labor.arkansas.gov/licensing/arkansas-contractors-licensing-board/
 *     (an HTML page, no rules).
 *   - Terms: portal.arkansas.gov/acceptable-use/ (the "Acceptable Use" and "Privacy Policy" links in the
 *     labor.arkansas.gov footer): "Linking to the Arkansas.gov web portal or Arkansas state agency websites is
 *     permitted with the following limitations: You may not capture Arkansas.gov pages within frames or present
 *     Arkansas.gov content as your own. You may not state or imply that the State of Arkansas, Tyler Arkansas, or
 *     Arkansas.gov is endorsing your product, site, or services." and "Neither the State of Arkansas nor any agency,
 *     officer, or employee of the State of Arkansas warrants the accuracy, reliability, or timeliness of any
 *     information published on the Arkansas.gov website". Nothing in them bars automated or commercial use; each
 *     record names the board and links its PDF.
 */
import type { LicenseHit } from "@shared/research-reports";
import { decodeEntities, fetchWithDeadline, rateLimitHost } from "../http";
import type { EnforcementHit } from "@shared/research-reports";
import { clean, usDate, type BulkHit, type BulkSource } from "../bulk";
import { pdfText, textLines } from "./lib/a3-pdf";
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
async function metlPage(postId: string, columns: string[], form: Record<string, string>, start: number): Promise<{ total: number; rows: Row[] }> {
  const q = new URLSearchParams({ draw: "1", postID: postId, start: String(start), length: String(PAGE_SIZE), "search[value]": "", "search[regex]": "false", "order[0][column]": String(Math.max(0, columns.indexOf("License_Number"))), "order[0][dir]": "asc", ...form });
  columns.forEach((c, i) => { q.set(`columns[${i}][data]`, c); q.set(`columns[${i}][searchable]`, "true"); q.set(`columns[${i}][orderable]`, "true"); q.set(`columns[${i}][search][value]`, ""); });
  await rateLimitHost(HOST, CRAWL_DELAY_MS);
  // The honest UA and Accept only: no X-Requested-With or Referer posing as the roster page's own script (audit
  // 2026-10-15, decision 12; the endpoint answered the same without them).
  const res = await fetchWithDeadline(`${HOST}/wp-json/metl/v1/all?${q}`, { headers: { accept: "application/json" } }, 180_000);
  if (!res.ok) throw new Error(`labor.arkansas.gov roster returned HTTP ${res.status}`);
  return metlBody(await res.json());
}

/** One page's JSON: the rows and the table's total, which must be a number (else the paging check could pass empty). */
export function metlBody(body: unknown): { total: number; rows: Row[] } {
  const b = body as { recordsTotal?: unknown; data?: Row[] } | null;
  const total = Number(b?.recordsTotal);
  if (!b || !Array.isArray(b.data) || !Number.isFinite(total)) throw new Error("labor.arkansas.gov roster returned an unexpected payload");
  return { total, rows: b.data };
}

async function* metlRows(postId: string, columns: string[], form: Record<string, string>): AsyncIterable<Row> {
  // Ordered by license number so pages don't shift; a row seen twice is yielded once.
  let start = 0, total = Infinity, got = 0;
  const seen = new Set<string>();
  while (start < total) {
    const page = await metlPage(postId, columns, form, start);
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
    // A named roster row is a person's own license (business rows carry no name and are skipped above).
    holder: "individual",
  };
  // Each license type is a component: one type falling far short of its last count keeps the old load (decision 10).
  return { kind: "license", hit, business: null, person, keys: { licenses: [number] }, component: hit.licenseType ?? "no type" };
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
    holder: "individual",
  };
  return { kind: "license", hit, business: null, person, keys: { licenses: [number] } };
}

async function* electrical(): AsyncIterable<BulkHit> {
  const cols = ["First_Name", "Last_Name", "License_Type_Display_Name", "License_Number", "License_Status", "License_Expiration_Date", "License_Issue_Date"];
  for await (const r of metlRows("15109", cols, { First_Name: "", Last_Name: "", License_Number: "" })) { const h = electricalHit(r); if (h) yield h; }
}

async function* hvac(): AsyncIterable<BulkHit> {
  const cols = ["Submitter_Type", "First_Name", "Last_Name", "physicalCity", "physicalState", "License_Number", "License_Status", "License_Expiration_Date"];
  for await (const r of metlRows("35270", cols, { firstName: "", Last_Name: "", physicalCity: "" })) { const h = hvacHit(r); if (h) yield h; }
}

// ── Fire Protection Licensing Board rosters (PDF) ─────────────────────────────────────────────────────────────

const FIRE_PAGE = `${HOST}/licensing/fire-protection-licensing-board/roster-search/`;
/** The roster page's WordPress entry: its content holds the links to the current PDFs. */
const FIRE_PAGE_API = `${HOST}/wp-json/wp/v2/pages/14998`;

/** The class codes of the portable/fixed list, as the PDF's own legend defines them. */
const FIRE_CLASSES: Record<string, string> = {
  P: "Portable", F: "Fixed system", A: "Class A hydrostatic", B: "Class B hydrostatic", H: "Halon", CA: "Clean agent", CO2: "CO2",
};
export type FireRoster = "sprinkler" | "portable";
/** About 70% of the rows on 2026-10-15 (the floor of a load). */
const FIRE_FLOOR: Record<FireRoster, number> = { sprinkler: 75, portable: 65 }; // 109 and 96 rows on 2026-10-15
const FIRE_LABEL: Record<FireRoster, string> = {
  sprinkler: "Arkansas Fire Protection Licensing Board: licensed sprinkler companies",
  portable: "Arkansas Fire Protection Licensing Board: portable and fixed fire-extinguishing systems companies",
};

/** The class codes after a license: "(B)", "(A-B)", "(H)", "(CA)", "(CO2)". */
const CLASS_RE = /\(((?:A|B|H|CA|CO2)(?:\s*[-,&]\s*(?:A|B|H|CA|CO2))*)\)/g;
const PHONE_RE = /\(?\b(\d{3})\)?\s*[-.]?\s*(\d{3})\s*[-.–]\s*(\d{4})\b/;
/** FSS-248, FSS-235A, FSS-115BR, FSS-224B1, "FSS-212 B" (a branch letter after a space), (PF-273), (P-240B). */
const LICENSE_RE = /\(?(FSS|\bPF|\bP|\bF)\s*[-–]\s*(\d{1,4}(?:\s?[A-Z]{1,2}\d?)?)\b\)?/;
/** A ZIP code after a city or state ("AR 72023", "Arkansas 72023"), never a house number at the start of a line. */
const ZIP_RE = /(?<=[A-Za-z][.,]?\s{0,3})\d{5}(?:-\d{4})?\b/;
const ROLES = "BRANCH OFFICE MANAGER|BRANCH MANAGER|DIVISION MANAGER|GENERAL MANAGER|OPERATIONS MANAGER|VICE PRESIDENT|PRESIDENT|CEO|COO|CFO|VP|OWNER|OFFICER|MANAGER|PARTNER|MEMBER|QUALIFIER|RME|SECRETARY|TREASURER";
/** "OWNER: APRIL BRODERICK", "RME- 4798 AUSTIN WHITE", "VP NICK PICKENS". */
const ROLE_GROUP = `(?:${ROLES})(?:\\/(?:${ROLES}))*`;
const ROLE_FIRST = new RegExp(`^(${ROLE_GROUP})\\b\\s*[:\\-–]?\\s*(?:\\d+\\s+)?(.+)$`, "i");
/** "Mark Hoskyn, Owner", "PAUL MEYERS CEO", "KARL LIMBERG, III, PRESIDENT". */
const ROLE_AFTER = new RegExp(`^(.+?)\\s*,?\\s+(${ROLE_GROUP})\\.?$`, "i");
const NOISE = /ARKANSAS\s+FIRE\s+PROTECTION\s+LICENSING\s+BOARD|^\s*20\d\d\s*\/\s*20\d\d\s*$|^\s*Updated\b|LICENSED\s+SPRINKLER\s+COMPANIES|\|\s*Page|^\s*Revised\b|^\s*Note:|=\s*(portable|fixed|class|Halon|clean)|^\s*\d+\s*$/i;

const isFax = (line: string, at: number) => /fax/i.test(line.slice(Math.max(0, at - 12), at));
/** The first phone on a line that isn't a fax number, as ddd-ddd-dddd. */
function phoneOf(line: string): string | null {
  for (const m of Array.from(line.matchAll(new RegExp(PHONE_RE, "g")))) if (!isFax(line, m.index!)) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
/** A line without its phone, fax and email parts (the right-hand column). */
const leftOf = (line: string) => clean(line.replace(/\(?fax\)?:?\s*/gi, " ").replace(new RegExp(PHONE_RE, "g"), " ").replace(/\S+@\S+(?:\s*-\s*\S+)?/g, " ").replace(/\s{2,}.*$/, "")) ?? "";
const fullLeft = (line: string) => clean(line.replace(/\(?fax\)?:?\s*/gi, " ").replace(new RegExp(PHONE_RE, "g"), " ").replace(/\S+@\S+(?:\s*-\s*\S+)?/g, " ")) ?? "";
/** A person's name: two or more words of letters (a suffix like ", III" allowed), not a company ("SPF HOLDING, INC."). */
const looksLikeName = (v: string) =>
  /^[A-Za-z][A-Za-z.,'’ -]+$/.test(v) && !/\b(INC|LLC|CORP|CORPORATION|HOLDINGS?|COMPANY|CO|LP|LTD|GROUP)\b/i.test(v) &&
  v.replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/).length >= 2;
const oneRole = (r: string) => (/^RME$/i.test(r) ? "Responsible managing employee (RME)" : /^VP$/i.test(r) ? "Vice President" : /^(CEO|COO|CFO)$/i.test(r) ? r.toUpperCase() : r.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));
const titleRole = (r: string) => r.split("/").map(oneRole).join("/");

/** A person named on a line ("OWNER: APRIL BRODERICK", "RME- 4798 AUSTIN WHITE", "Mark Hoskyn, Owner"), else null. */
export function firePerson(line: string): { name: string; role: string } | null {
  const t = clean(line.replace(/\s+([-–])\s*/g, "$1 ").replace(/\s+/g, " "))?.replace(/,$/, "") ?? "";
  let m = t.match(ROLE_FIRST);
  if (m) { const name = clean(m[2].replace(/^[-–:\s\d]+/, "")); return name && looksLikeName(name) ? { name, role: titleRole(m[1]) } : null; }
  m = t.match(ROLE_AFTER);
  if (m) { const name = clean(m[1].replace(/\.(?=\s)/g, "").replace(/,$/, "")); return name && looksLikeName(name) ? { name, role: titleRole(m[2]) } : null; }
  return null;
}

/** The date the roster gives itself ("Updated 7/10/26", "Revised 4/1/2026"), as YYYY-MM-DD. */
export function fireRosterDate(text: string): string | null {
  const m = text.replace(/\s*\/\s*/g, "/").replace(/(\d)\s+(\d)/g, "$1$2").match(/(?:Updated|Revised):?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return usDate(`${m[1]}/${m[2]}/${y}`);
}

/**
 * The companies and branch offices of one roster PDF's text. A block starts at a line carrying a phone that isn't a
 * fax and a license number, "Branch office" or a business name (not a street or city line); its address runs to
 * the first line with a ZIP code; its people are the role lines after that. Content, not columns: pdftotext and
 * the JS reader lay the text out differently.
 */
export function parseFireRoster(text: string, roster: FireRoster): LicenseHit[] {
  const date = fireRosterDate(text);
  const status = date ? `On the board's roster of ${date}` : "On the board's current roster";
  const lines = textLines(text).filter((l) => l.trim() && !NOISE.test(l));
  const out: LicenseHit[] = [];
  let company: string | null = null;
  let cur: { hit: LicenseHit; addr: string[]; addrDone: boolean } | null = null;
  const finish = () => {
    if (!cur) return;
    cur.hit.address = clean(cur.addr.join(" ")) ?? null;
    out.push(cur.hit);
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+([-–])\s*(?=\d)/g, "$1").replace(/([-–])\s+(?=\d)/g, "$1").replace(/(FSS|\b(?:PF|P|F))\s+[-–]/g, "$1-");
    const phone = phoneOf(line);
    const left = fullLeft(line);
    const lic = left.match(LICENSE_RE);
    const branch = /^branch\s*office/i.test(left);
    const streetOrCity = /^\d/.test(left) && !lic || ZIP_RE.test(left) || /p\.?\s*o\.?\s*box/i.test(left);
    if (phone && (lic || branch || (!streetOrCity && !firePerson(left) && /[A-Z]{3}/.test(left)))) {
      finish();
      const name = clean(left.replace(LICENSE_RE, " ").replace(CLASS_RE, " ").replace(/^branch\s*office\s*[:]?/i, "").replace(/[-–:(]\s*$/, "").replace(/\s+[-–]$/, ""));
      if (!branch) company = name;
      const number = lic ? `${lic[1]}-${lic[2].replace(/\s/g, "")}` : null;
      const codes = roster === "portable"
        ? [...(lic ? lic[1].split("").filter((c) => c === "P" || c === "F") : []), ...Array.from(left.matchAll(CLASS_RE)).flatMap((m) => m[1].split(/\s*[-,&]\s*/))]
        : [];
      const specialty = [branch ? "Branch office" : null, codes.length ? codes.map((c) => FIRE_CLASSES[c]).join(", ") : null].filter(Boolean).join("; ") || null;
      if (!company) continue;
      cur = {
        addr: [], addrDone: false,
        hit: {
          state: "AR", source: FIRE_LABEL[roster], sourceUrl: FIRE_PAGE, businessName: company, licenseNumber: number,
          licenseType: roster === "sprinkler" ? "Sprinkler company license" : "Portable and fixed fire-extinguishing systems company license",
          specialty, status, principal: null, city: null, expires: null, matchedOn: "business", phone, people: [],
          // A company license (the rosters list licensed companies and their branch offices).
          holder: "business",
        },
      };
      continue;
    }
    if (!cur) continue;
    let rest = left;
    if (!cur.addrDone) {
      if (/^mailing address:?$/i.test(rest)) { cur.addrDone = true; continue; }
      const zip = rest.match(ZIP_RE);
      if (zip) {
        cur.addr.push(rest.slice(0, zip.index! + zip[0].length));
        // "SHERWOOD, AR 72120" → SHERWOOD; a street and city on one line are left unsplit (no city is guessed).
        const before = rest.slice(0, zip.index!).trim().replace(/,$/, "");
        cur.hit.city = /^\d|box/i.test(before) ? null : clean(before.replace(/,?\s*[A-Za-z]+\.?$/, "").replace(/,$/, ""));
        cur.addrDone = true;
        rest = clean(rest.slice(zip.index! + zip[0].length)) ?? "";
        if (!rest) continue;
      } else if (!rest.split(/\s+\/\s+/).some((x) => firePerson(x))) { cur.addr.push(rest); continue; }
    }
    // A mailing address after the street address can share its last line with a person ("Sherwood, AR 72124 Alan Ford, Owner").
    const zipAfter = rest.match(ZIP_RE);
    if (zipAfter) rest = clean(rest.slice(zipAfter.index! + zipAfter[0].length)) ?? "";
    // "OWNER RYAN COLE / RME-024 JESSE MOORE": two people on one line.
    for (const part of rest.split(/\s+\/\s+/)) {
      const who = firePerson(part);
      if (who && !cur.hit.people!.some((p) => p.name === who.name)) cur.hit.people!.push(who);
    }
  }
  finish();
  for (const h of out) h.principal = h.people?.[0]?.name ?? null;
  return out;
}

/** The roster PDFs the page links right now (the board renames them each year). */
async function fireRosterUrls(): Promise<{ url: string; roster: FireRoster }[]> {
  await rateLimitHost(HOST, CRAWL_DELAY_MS);
  const res = await fetchWithDeadline(FIRE_PAGE_API, { headers: { accept: "application/json" } }, 60_000);
  if (!res.ok) throw new Error(`Fire Protection roster page returned HTTP ${res.status}`);
  const body = await res.json() as { content?: { rendered?: string } };
  const links = Array.from((body.content?.rendered ?? "").matchAll(/href="([^"]+\.pdf)"/gi)).map((m) => m[1]);
  return links.map((url) => ({ url, roster: /sprinkler/i.test(url) ? "sprinkler" as const : "portable" as const }));
}

function fireLoader(roster: FireRoster): () => AsyncIterable<BulkHit> {
  return async function* () {
    const pdf = (await fireRosterUrls()).find((u) => u.roster === roster);
    if (!pdf) throw new Error(`no ${roster} roster PDF linked from ${FIRE_PAGE}`);
    await rateLimitHost(HOST, CRAWL_DELAY_MS);
    const res = await fetchWithDeadline(pdf.url, {}, 180_000);
    if (!res.ok) throw new Error(`${pdf.url} returned HTTP ${res.status}`);
    const { text } = await pdfText(new Uint8Array(await res.arrayBuffer()));
    for (const h of parseFireRoster(text, roster)) {
      const hit = { ...h, sourceUrl: pdf.url };
      yield {
        kind: "license", hit, business: hit.businessName, person: null, people: (hit.people ?? []).map((p) => p.name),
        keys: { licenses: [hit.licenseNumber], phones: [hit.phone], addresses: [hit.address] },
        component: /^branch office/i.test(hit.specialty ?? "") ? "branch offices" : "companies",
      };
    }
  };
}

// ── Contractors Licensing Board hearings / findings of fact (PDF) ─────────────────────────────────────────────

const CLB_PAGE = `${HOST}/licensing/arkansas-contractors-licensing-board/hearings-finding-of-fact/`;
/** The hearings page's WordPress entry: its content holds the links to every findings-of-fact PDF. */
const CLB_PAGE_API = `${HOST}/wp-json/wp/v2/pages/21612`;
const CLB_SOURCE = "Arkansas Contractors Licensing Board and Residential Contractors Committee hearing orders and settlement agreements";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "JUNE 21, 2023" / "August 8 2003" → 2023-06-21; anything else null. */
export function monthDate(v: string | null | undefined): string | null {
  const m = (v ?? "").match(/\b([A-Za-z]+)\.?\s*(\d{1,2})\s*,?\s*(\d{4})(?!\d)/);
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  return m && mo ? usDate(`${mo}/${m[2]}/${m[3]}`) : null;
}

/**
 * An entity word in a name as printed (Inc, LLC, Corp, Company, Co., Ltd, LP, LLP, PLLC): the only sign these PDFs
 * give that a respondent is a business (they print no license class). Trade words ("Construction", "Roofing") are
 * not enough: "S S FENCE & IRON" or "A-TEAM REMODELING & CONSTRUCTION" may be one person's trade name.
 */
const ENTITY = /\b(?:inc|incorporated|l\.?\s?l\.?\s?c|corp|corporation|company|companies|ltd|limited|l\.?l\.?p|l\.p|lp|p\.?l\.?l\.?c)\b\.?|\bco(?:\.|(?=,)|$)/i;
const DBA_SPLIT = /\s*,?\s*\b(?:d\/b\/a|dba)\b\s*[-–]?\s*/i;

/**
 * The business a respondent names, or null for an individual (FCRA: companies only). A name with an entity word is
 * kept as printed. With a "d/b/a", the respondent is the party before it, and it is kept only when that party (the
 * last one, after any "&" or "and") carries an entity word itself: "JAIME LARA, INC., D/B/A ARKANSAS CUSTOM POLE
 * BARNS" is kept; "Mark Justice, d/b/a Justice Construction Co." and "JEREMY TERRELL DBA - IAT, LLC" are a person
 * doing business under a trade name (a sole proprietor, an individual), and "T.J. Kelley & Associates, Inc. & Mike
 * Dugan, d/b/a MD Heat & Air" names a person d/b/a: all left out, as va-dpor-revocations does.
 */
export function clbBusiness(respondent: string): string | null {
  const name = clean(respondent.replace(/""/g, '"').replace(/^"(.*)"$/, "$1"));
  if (!name) return null;
  const parts = name.split(DBA_SPLIT);
  if (parts.length > 1) {
    const before = parts[0].split(/\s+(?:&|and)\s+/i);
    return ENTITY.test(before[before.length - 1]) ? name : null;
  }
  return ENTITY.test(name) ? name : null;
}

export type ClbRecord = {
  kind: "order" | "settlement";
  /** "Contractors Licensing Board", "Residential Contractors Committee", or null (a settlement list with no hearing above it). */
  board: string | null;
  respondent: string;
  /** The number printed before a settlement's name (the PDFs don't say what it is). */
  number: string | null;
  /** The order's decision sentence, or the settlement's terms, as printed. */
  outcome: string;
  /** The whole order or settlement entry, as printed. */
  text: string;
};
export type ClbDoc = { date: string | null; records: ClbRecord[] } | { unreadable: string };

/*
 * The structural lines are matched with their spaces removed: the JS reader (used when pdftotext is missing) splits
 * words ("ARKANSAS CONTRACTOR   S LICENSING BOARD", "JUNE 21 , 2023HE ARINGS").
 */
const squash = (l: string) => l.replace(/\s+/g, "");
const BOARD_LINE = /^ARKANSAS(?:CONTRACTORSLICENSINGBOARD|RESIDENTIAL(?:BUILDING)?CONTRACTORSCOMMITTEE)$/i;
const VS_LINE = /^vs\.?$/i;
/** "ORDER", or "RECOMMENDED ORDER" (2023–2024 commercial hearings). */
const ORDER_LINE = /^(?:RECOMMENDED|AGREED|FINAL)?ORDER$/;
const ORDER_START = /^\s*The\s+(?:Board|Committee|Contractor|Respondent)\b/;
const SETTLEMENTS = /^SETTLEMENTAGREEMENTS?$/i;
/**
 * Page headers and stray marks: "JUNE 21, 2023 HEARINGS" (or one without a readable year, "FEBRUARY 24, 202 HEARINGS3",
 * "JANUARY 24 HEARINGS", "JUNE 10, 2016, 2016 HEARINGS": the date then comes from the first full one, else the page's
 * link text), "FINDINGS OF FACT", ".", a page number.
 */
const CLB_NOISE = /^(?:(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)[\d,]*HEARINGS?\d?|FINDINGS?OFFACT|\.|\d{1,3}|Page\d+(?:of\d+)?)$/i;
const HEADER = /HEARINGS?$/i;
/**
 * Where a settlement entry's terms start: a dollar amount, a bare amount ("Eddie Long 500.00"), or an outcome in
 * words ("License is revoked", "The license is revoked", "Revoke for misconduct", "Suspend license for …", "Surrendered license in lieu of
 * hearing", "Contractor surrendered license …", "Pay the homeowner …").
 */
const TERMS_AT = /\$\s?\d|\b\d[\d,]*\.\d{2}\b|\b(?:The\s+)?[Ll]icense\s+is\b|\b(?:Contractor\s+)?(?:Revoke[ds]?|Revocation|Suspend(?:ed)?|Surrender(?:ed)?)\b|\bPay\s+(?:the|any)\b/;
/** A line that continues the entry above it rather than starting one (lower case, an amount, "reduced …"). */
const CONTINUES = /^\s*(?:[$a-z(]|reduced\b|Revocation\b|\d+\s+(?:years?|months?|days?)\b|\d[\d,]*\.\d{2}\b)/;
const NUMBERED = /^\s*\d{4,6}\s+\S/;

const boardName = (line: string) => (/RESIDENTIAL/i.test(line) ? "Residential Contractors Committee" : "Contractors Licensing Board");
const joinText = (lines: string[]) => clean(lines.join(" ")) ?? "";
/** Words a period follows without ending the sentence ("Roy Lee Jones, Jr., d/b/a …", "Co., Inc.", "Ark. Code"). */
const NOT_END = /(?:^|[\s,(.])(?:Jr|Sr|Inc|Co|Corp|Ltd|Mr|Mrs|Ms|Dr|St|Ark|Ann|No|Sec|[A-Z])$/;
/** The first sentence of an order (where the decision is): up to a period before a capital or the end. */
export function firstSentence(t: string): string {
  for (const m of Array.from(t.matchAll(/\.(?=\s+[A-Z"]|\s*$)/g))) {
    if (!NOT_END.test(t.slice(0, m.index!))) return t.slice(0, m.index! + 1).trim();
  }
  return t.trim();
}

/**
 * One findings-of-fact PDF's text: the date in its header, each hearing (board, "vs", respondent, ORDER, the order)
 * and each settlement agreement (an optional number, the name, the amount and terms). Content, not columns. Any part
 * that can't be read this way (a respondent with no order after it, an entry with no amount or outcome, a line outside
 * every section) makes the whole document unreadable: it is skipped and counted, never half-read.
 */
export function parseClbDoc(text: string, title: string | null = null): ClbDoc {
  const lines = text.replace(/\f/g, "\n").split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const header = lines.map(squash).find((l) => HEADER.test(l) && monthDate(l));
  const date = monthDate(header) ?? monthDate(title);
  if (!date) return { unreadable: "no hearing date" };
  const records: ClbRecord[] = [];
  let board: string | null = null;
  type State = "none" | "board" | "respondent" | "order" | "settlements";
  let state: State = "none";
  let resp: string[] = [], order: string[] = [], entry: string[] | null = null;
  /** Whether this settlement list puts a number before each name (decided by its first entry). */
  let numbered = false;
  let problem: string | null = null;
  const closeOrder = () => {
    if (state !== "order" && state !== "respondent") return;
    const respondent = joinText(resp), body = joinText(order);
    if (!respondent || respondent.length > 200 || !body || !/\b(?:voted|ordered|agreed order|entered into|found)\b/i.test(body)) problem ??= `a hearing without a readable respondent or order (${respondent.slice(0, 60) || "no respondent"})`;
    else records.push({ kind: "order", board, respondent, number: null, outcome: firstSentence(body), text: body });
    resp = []; order = [];
  };
  const closeEntry = () => {
    if (!entry) return;
    let t = joinText(entry);
    entry = null;
    const num = t.match(/^(\d{4,6})\s+/);
    if (num) t = t.slice(num[0].length);
    const at = t.search(TERMS_AT);
    const respondent = at > 0 ? clean(t.slice(0, at)) : null;
    if (!respondent || at < 0) { problem ??= `a settlement entry without a readable name and amount (${t.slice(0, 60)})`; return; }
    records.push({ kind: "settlement", board, respondent, number: num?.[1] ?? null, outcome: t.slice(at).trim(), text: t });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const sq = squash(line);
    if (BOARD_LINE.test(sq)) {
      // A board name starts a hearing only when "vs" follows (a line or two down).
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next && VS_LINE.test(squash(next))) { closeOrder(); closeEntry(); board = boardName(line); state = "board"; continue; }
    }
    if (SETTLEMENTS.test(sq)) { closeOrder(); closeEntry(); state = "settlements"; numbered = false; continue; }
    if (CLB_NOISE.test(sq)) continue;
    if (state === "board") { if (VS_LINE.test(sq)) { state = "respondent"; continue; } problem ??= `unexpected line after the board name: ${line.trim().slice(0, 60)}`; continue; }
    if (state === "respondent") {
      if (ORDER_LINE.test(sq)) { state = "order"; continue; }
      if (ORDER_START.test(line) && resp.length) { state = "order"; order.push(line); continue; }
      resp.push(line);
      continue;
    }
    if (state === "order") { order.push(line); continue; }
    if (state === "settlements") {
      if (!entry) numbered = NUMBERED.test(line);
      const starts = numbered ? NUMBERED.test(line) : !entry || (TERMS_AT.test(joinText(entry)) && !CONTINUES.test(line));
      if (starts) { closeEntry(); entry = [line]; } else if (entry) entry.push(line); else problem ??= `a line before the first settlement entry: ${line.trim().slice(0, 60)}`;
      continue;
    }
    problem ??= `a line outside every hearing and settlement list: ${line.trim().slice(0, 60)}`;
  }
  closeOrder(); closeEntry();
  if (problem) return { unreadable: problem };
  if (!records.length) return { unreadable: "no hearing or settlement found" };
  return { date, records };
}

/** The order's words for a sanction or a finding (the brief's rule: revocation, suspension, penalty, violation found). */
const CLB_ADVERSE = /\bcivil\s+penalt(?:y|ies)\b|\bshall\s+pay\b|\brevoked?\b|\brevocation\b|\bsuspen(?:ded|sion)\b|\bwas\s+in\s+violation\b|\bviolated\b|\bpenalty\b|\bguilty\b|\breprimand\b|\bprobation\b|\bsurrender/i;
const CLB_CLEARED = /\bdismiss|\bnot\s+in\s+violation\b|\bno\s+violation\b|\bfound\s+not\b/i;

/**
 * true when the order states a sanction or a violation; false for a dismissal or "no violation"; null otherwise, for
 * both, or for a recommendation ("voted unanimously to recommended that the license of … be revoked", a RECOMMENDED
 * ORDER of the Residential Contractors Committee: what the Board then decided isn't in the document).
 */
export function clbAdverse(outcome: string): boolean | null {
  if (/\brecommend/i.test(outcome)) return null;
  const bad = CLB_ADVERSE.test(outcome), cleared = CLB_CLEARED.test(outcome);
  return bad && cleared ? null : bad ? true : cleared ? false : null;
}

/** The penalty an order or settlement prints: its stated total, else the first civil penalty, else (a settlement) the amount it starts with. */
export function clbAmount(r: ClbRecord): number | null {
  const num = (v: string | undefined) => (v ? Number(v.replace(/,/g, "")) : null);
  const total = r.text.match(/\btotal\s+(?:penalty\s+)?(?:is\s+|of\s+)?\$\s?(\d[\d,]*(?:\.\d{2})?)/i);
  if (total) return num(total[1]);
  if (r.kind === "order") {
    const m = r.text.match(/\bcivil\s+penalty\s+(?:of|in\s+the\s+amount\s+of)\s+\$\s?(\d[\d,]*(?:\.\d{2})?)(\s+per\s+day)?/i);
    return m && !m[2] ? num(m[1]) : null; // "$400 per day for 1 day" with no total printed: no amount
  }
  // Only an amount the terms start with is the settlement's ("Pay the homeowner $2,000" is not a penalty).
  const m = r.outcome.match(/^\$\s?(\d[\d,]*(?:\.\d{2})?)/) ?? r.outcome.match(/^(\d[\d,]*\.\d{2})\b/);
  return m ? num(m[1]) : null;
}

/**
 * An outcome without its conditions: cut before "if", "provided", "on the condition" or "contingent", where the
 * terms name homeowners, residences and other people ("provided the foundation issues on the Goff residence are
 * corrected and he pay any settlement with the Wares"). The conditions stay in the linked PDF.
 */
export function withoutConditions(outcome: string): string {
  const at = outcome.search(/[\s,;]+(?:if|provided|on\s+the\s+condition|contingent)\b/i);
  return at > 0 ? `${outcome.slice(0, at).replace(/[\s,;]+$/, "")} (conditions in the PDF)` : outcome;
}

export function clbHit(r: ClbRecord, date: string, sourceUrl: string): EnforcementHit | null {
  const name = clbBusiness(r.respondent);
  if (!name) return null;
  const where = r.board ? `Arkansas ${r.board}` : "Arkansas Contractors Licensing Board";
  const order = r.kind === "order";
  return {
    state: "AR", source: CLB_SOURCE, sourceUrl, category: "discipline", name, id: r.number, date, endDate: null,
    status: order ? withoutConditions(r.outcome).slice(0, 400) : `Settlement agreement: ${withoutConditions(r.outcome)}`.slice(0, 400),
    city: null,
    // The order's other sentences (homeowners, owners, other parties by name) are left in the PDF, not quoted.
    detail: order
      ? `${where} hearing of ${date}: order (the full order is in the PDF)`
      : `${where}, settlement agreements listed with the hearings of ${date}${r.number ? ` (number printed before the name: ${r.number})` : ""}`,
    amount: clbAmount(r),
    // An order: from its decision sentence. A settlement: true only when its own terms say penalty, revocation,
    // suspension or surrender (a
    // bare amount under "Settlement agreements" states no violation or penalty, so it stays null).
    adverse: order ? clbAdverse(r.outcome) : /\bpenalty\b|\brevoke[ds]?\b|\brevocation\b|\bsuspen|\bsurrender/i.test(r.outcome) && !CLB_CLEARED.test(r.outcome) ? true : null,
    // The PDFs label no number as a license number (the settlement number is unlabeled): none is given.
    licenseNumber: null,
  };
}

/** The findings-of-fact PDFs the page links: [url, link text]. */
export function clbLinks(rendered: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  for (const m of Array.from(rendered.matchAll(/<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi))) {
    const title = clean(decodeEntities(m[2].replace(/<[^>]+>/g, " "))) ?? "";
    if (!out.some((o) => o.url === m[1])) out.push({ url: m[1], title });
  }
  return out;
}

/** Below this many characters of text a PDF is a scanned image (no text layer): skipped and counted, no OCR. */
const SCAN_CHARS = 100;
export const scannedText = (text: string): boolean => text.replace(/\s+/g, "").length < SCAN_CHARS;
/**
 * About 70% of the business records (the floor of a load): 2,164 loaded on 2026-10-16 before the person-d/b/a rule,
 * which removed 16 of 227 rows (7%) re-parsing the saved PDFs: about 2,010 under the current rules.
 */
const CLB_FLOOR = 1_400;

async function* clbLoader(): AsyncIterable<BulkHit> {
  const res = await fetchWithDeadline(CLB_PAGE_API, { headers: { accept: "application/json" } }, 60_000, CRAWL_DELAY_MS);
  if (!res.ok) throw new Error(`Contractors Licensing Board hearings page returned HTTP ${res.status}`);
  const body = await res.json() as { content?: { rendered?: string } };
  const links = clbLinks(body.content?.rendered ?? "");
  if (links.length < 300) throw new Error(`only ${links.length} findings-of-fact PDFs linked from ${CLB_PAGE}`);
  const n = { text: 0, scans: 0, unreadable: 0, offHost: 0, failed: 0, kept: 0, individuals: 0 };
  const seen = new Set<string>();
  for (const { url, title } of links) {
    // Links to www.aclb.arkansas.gov (the board's old site) redirect to the board's home page, not a PDF: not requested.
    if (!url.startsWith(`${HOST}/`)) { n.offHost++; continue; }
    const r = await fetchWithDeadline(url, {}, 180_000, CRAWL_DELAY_MS);
    if (!r.ok) { await r.body?.cancel().catch(() => undefined); n.failed++; console.log(`[research-bulk] ar-clb-hearings: HTTP ${r.status} for ${url}`); continue; }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!/^%PDF/.test(Buffer.from(buf.subarray(0, 5)).toString("latin1"))) { n.failed++; console.log(`[research-bulk] ar-clb-hearings: not a PDF: ${url}`); continue; }
    const { text } = await pdfText(buf);
    if (scannedText(text)) { n.scans++; continue; }
    n.text++;
    const doc = parseClbDoc(text, title);
    if ("unreadable" in doc) { n.unreadable++; console.log(`[research-bulk] ar-clb-hearings: skipped ${url}: ${doc.unreadable}`); continue; }
    for (const rec of doc.records) {
      const hit = clbHit(rec, doc.date!, url);
      if (!hit) { n.individuals++; continue; }
      const key = `${url}|${hit.name}|${hit.status}|${hit.amount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      n.kept++;
      yield { kind: "enforcement", hit, business: hit.name, person: null, component: rec.kind === "order" ? "hearing orders" : "settlement agreements" };
    }
  }
  console.log(`[research-bulk] ar-clb-hearings: ${links.length} PDFs linked; ${n.text} with text, ${n.scans} scanned (no text layer, skipped), ${n.unreadable} unreadable (skipped), ${n.offHost} on www.aclb.arkansas.gov (not requested), ${n.failed} failed; ${n.kept} business records kept, ${n.individuals} individual respondents left out`);
}

const BULK: BulkSource[] = [
  { id: "ar-electrical-roster", state: "AR", label: "Arkansas Board of Electrical Examiners roster", pageUrl: ELECTRICAL_PAGE, everyHours: 24 * 7, minRows: 67_000, load: electrical },
  { id: "ar-hvacr-roster", state: "AR", label: "Arkansas HVAC/R Licensing Board roster", pageUrl: HVAC_PAGE, everyHours: 24 * 7, minRows: 23_000, load: hvac },
  { id: "ar-fire-sprinkler", state: "AR", label: FIRE_LABEL.sprinkler, pageUrl: FIRE_PAGE, everyHours: 24 * 7, minRows: FIRE_FLOOR.sprinkler, load: fireLoader("sprinkler") },
  { id: "ar-fire-portable", state: "AR", label: FIRE_LABEL.portable, pageUrl: FIRE_PAGE, everyHours: 24 * 7, minRows: FIRE_FLOOR.portable, load: fireLoader("portable") },
  { id: "ar-clb-hearings", state: "AR", label: CLB_SOURCE, pageUrl: CLB_PAGE, everyHours: 24 * 7, minRows: CLB_FLOOR, load: clbLoader, companiesOnly: true, category: "discipline" },
];

export const pack: StatePack = {
  state: "AR",
  checked: "2026-10-15",
  bulk: BULK,
  blocked: [
    "Contractors Licensing Board search (aclb2.arkansas.gov/clbsearch.php, linked from the board's 'Find a Licensed Contractor' page): the server never answered on 2026-10-15 (connection timed out from tower1 and vb11); retried 2026-10-15 06:46 and 06:47 UTC from tower1 and vb11, robots.txt and the search page both timed out after 30 s. The board publishes no downloadable roster",
    "Contractors Licensing Board hearings / findings of fact (labor.arkansas.gov hearings-finding-of-fact), corrected 2026-10-15: 316 of the 428 PDFs on labor.arkansas.gov (2003 to March 2024) have a text layer and are read above (ar-clb-hearings), 6 of them skipped as unreadable; 112 (most from August 2024 on, a few older) are scanned images with no text layer (no OCR), and the 8 links to www.aclb.arkansas.gov redirect to the board's home page",
    "Electrical and HVAC/R rosters: business rows carry no business name, so only people are searchable there",
  ],
};
