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
 * labor.arkansas.gov's robots.txt asks for a 10-second crawl delay; the loaders wait that long between pages.
 */
import type { LicenseHit } from "@shared/research-reports";
import { fetchWithDeadline, rateLimitHost } from "../http";
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
      };
    }
  };
}

const BULK: BulkSource[] = [
  { id: "ar-electrical-roster", state: "AR", label: "Arkansas Board of Electrical Examiners roster", pageUrl: ELECTRICAL_PAGE, everyHours: 24 * 7, minRows: 67_000, load: electrical },
  { id: "ar-hvacr-roster", state: "AR", label: "Arkansas HVAC/R Licensing Board roster", pageUrl: HVAC_PAGE, everyHours: 24 * 7, minRows: 23_000, load: hvac },
  { id: "ar-fire-sprinkler", state: "AR", label: FIRE_LABEL.sprinkler, pageUrl: FIRE_PAGE, everyHours: 24 * 7, minRows: FIRE_FLOOR.sprinkler, load: fireLoader("sprinkler") },
  { id: "ar-fire-portable", state: "AR", label: FIRE_LABEL.portable, pageUrl: FIRE_PAGE, everyHours: 24 * 7, minRows: FIRE_FLOOR.portable, load: fireLoader("portable") },
];

export const pack: StatePack = {
  state: "AR",
  checked: "2026-10-15",
  bulk: BULK,
  blocked: [
    "Contractors Licensing Board search (aclb2.arkansas.gov/clbsearch.php, linked from the board's 'Find a Licensed Contractor' page): the server never answered on 2026-10-15 (connection timed out from tower1 and vb11); retried 2026-10-15 06:46 and 06:47 UTC from tower1 and vb11, robots.txt and the search page both timed out after 30 s. The board publishes no downloadable roster",
    "Contractors Licensing Board hearings / findings of fact (labor.arkansas.gov hearings-finding-of-fact): scanned-image PDFs with no text layer",
    "Electrical and HVAC/R rosters: business rows carry no business name, so only people are searchable there",
  ],
};
