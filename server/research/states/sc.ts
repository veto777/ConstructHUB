/**
 * South Carolina, checked live 2026-10-15.
 *
 *   sc-des-enforcement  Department of Environmental Services enforcement action reports: the monthly PDFs linked from
 *                       des.sc.gov "Environmental Enforcement Actions" (consent orders and administrative orders of every
 *                       bureau: underground storage tanks, solid, hazardous and infectious waste, drinking and recreational
 *                       water, water pollution, air quality, onsite wastewater), the newest 24 monthly reports. Each order:
 *                       its number, type, date, the business it names, the facility's county or location, the program,
 *                       the violations and the civil penalty. Companies only: an order naming only individuals is skipped,
 *                       and from one naming a person and a business ("…, individually and d/b/a …") only the business is kept.
 *
 * Read with ./lib/a3-pdf.ts (pdftotext, or the JS reader when the binary is missing). Two layouts are in the window:
 * reports through late 2024 list "Individual/Entity", "Facility", "Location" and "Mailing Address"; later ones
 * "Individual/Entity/Facility" and "County". A personal mailing address is never kept.
 *
 *   sc-llr-board-orders  LLR Public Board Orders (eservice.llr.sc.gov/PublicOrdersWeb/?divisionId=69 for the Contractor's
 *                       Licensing Board, 46 for the Residential Builders Commission): one page per board lists every
 *                       public order (Order Date, Name, License Type, License Number). Companies only: rows naming a
 *                       person ("LAST, FIRST") or a bare name are left out. The order documents behind "View Order" ask
 *                       for a reCAPTCHA and are not read, so a hit says an order was issued, not what it decided.
 *                       eservice.llr.sc.gov's robots.txt is "Disallow: /"; used by OWNER ORDER 2026-10-15 (a robots.txt
 *                       Disallow no longer stops a search). llr.sc.gov's Disclaimer (aboutus/disclaimer.aspx) is a
 *                       liability disclaimer only, with no rule against reuse.
 *
 * No license source: rechecked live 2026-10-15, every free South Carolina contractor license list is behind a
 * reCAPTCHA or a login, or on a site whose terms forbid reuse (see `blocked`).
 * Removed 2026-10-15 (coordinator's decision): des.sc.gov's "Website Accessibility and Policies" page says "You may
 * not: (1) reproduce, adapt, modify, distribute, publicly perform or display, transmit, or otherwise copy or use any
 * part of this site except as specifically permitted by SCDES in writing", so sc-des-enforcement is no longer
 * registered (the code below is kept, unused).
 */
import { promises as fs } from "node:fs";
import type { EnforcementHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { decodeEntities } from "../bulk-sources";
import { clean, download, usDate, type BulkHit } from "../bulk";
import { pdfText, textLines } from "./lib/a3-pdf";
import { htmlText } from "./lib/g3-common";
import { looksLikeBusinessTrailingSuffix, personNameForm } from "./lib/business-name";
import type { StatePack } from "./types";
import { adverseFrom } from "../adverse";

const DES_PAGE = "https://des.sc.gov/about-scdes/programs-divisions/environmental-enforcement-actions";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const REPORT_WINDOW = 24;

/** The monthly report PDFs linked from the index, newest first, with their month (summary sheets left out). */
export function desReportLinks(html: string, base = DES_PAGE): { url: string; month: string }[] {
  const out = new Map<string, string>();
  for (const m of Array.from(html.matchAll(/href="([^"]+\.pdf)"/gi))) {
    const url = new URL(decodeEntities(m[1]), base).toString();
    const file = decodeURIComponent(url.split("/").pop() ?? "");
    if (!/enforcement\s*_?report/i.test(file) || /summary/i.test(file)) continue;
    const mm = file.match(/(january|february|march|april|may|june|july|august|september|october|november|december)[\s_-]*(20\d{2})/i);
    if (!mm) continue;
    const month = `${mm[2]}-${String(MONTHS.indexOf(mm[1].toLowerCase()) + 1).padStart(2, "0")}`;
    if (!Array.from(out.values()).includes(month)) out.set(url, month);
  }
  return Array.from(out, ([url, month]) => ({ url, month })).sort((a, b) => b.month.localeCompare(a.month));
}

const LABELS = [
  "Order Type and Number", "Order Type/Order Number", "Order Date", "Individual/Entity/Facility", "Individual/Entity / Facility", "Individual/Entity",
  "Facility", "Location", "Mailing Address", "County", "Previous Orders", "Permit/ID Number",
];
const LABEL_RE = new RegExp(`^\\s*(?:\\d+[.)]\\s*)?(${LABELS.map((l) => l.replace(/[/]/g, "\\/").replace(/ /g, "\\s*")).join("|")})\\s*:\\s*(.*)$`, "i");
/** "County        Oconee": one report drops the colon after County. */
const COUNTY_NO_COLON = /^\s*County\s{2,}([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)\s*$/;
const SECTION_RE = /^\s*(Violations Cited|Summary|Action)\s*:/i;
const NOISE_RE = /^\s*(\d+|ENFORCEMENT ACTION REPORT|(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})\s*$/i;

const BUSINESS_WORDS = /\b(L\.?L\.?C|Inc|Incorporated|Corp|Corporation|Company|Co|L\.?P|LLP|Ltd|PLLC|P\.?A|Partnership|Association|Assn|Authority|District|Commission|City|Town|County|University|College|School|Schools|Church|Hospital|Center|Centre|Utilit\w*|Water|Sewer|Wastewater|WWTP|Mart|Market|Store|Stores|Apartments?|Condominiums?|Villas?|Homes|Properties|Property|Holdings|Enterprises?|Services?|Construction|Farms?|Dairy|Mine|Plant|Landfill|Club|Resort|Hotel|Inn|Motel|Marina|Park|Campground|Restaurant|Grill|Group|Industries|Industrial|Manufacturing|Systems|Solutions|Contracting|Contractors?|Paving|Grading|Clearing|Septic|Plumbing|Electric\w*|Recycling|Laborator\w+|Consultants|Galvanizing|Fabricating|Plating|Healthcare|Medical|Radiology|Estates|Subdivision|Owners|Homeowners|Stockpiles?|Pools?|Spa|Department|Agency|Station|Storage|Oil|Gas|Petroleum|Fuel|Auto|Motors|Trucking|Transport\w*|Logistics|Materials|Metals|Chemicals?|Products|Mills?|Foods?|Meats|Packing|Quarry|Sand|Concrete|Asphalt|Masonry|Builders|Development|Developers|Investments?|Partners|Ventures|Capital|Management|Realty|Living|Lodge|Golf|Shop|Shell|Exxon|BP|Circle\s*K|Walmart|Food|Express|Casting|Depot|Labs?|Health|Containers|Shelters|Packaging|Brick|Silica|Composite|Structures|Residential Care|Reserve|Gardens|Community|HOA|Camps|Housing|DST|Townhomes|Administration|Ink|Boeing|Veterans|Southern|Mineral|Lumber|Sawmill|Timber|Clean Burn)\b/i;
const PERSON_ONLY = /\b(individually|aka|a\.k\.a|estate of|heirs?|life estate|trustees?|living trust|revocable|irrevocable|personal representative|lifetime tenant)\b/i;
/** Business words that are also common surnames or place words: on their own they don't make a person's name a business. */
const SURNAME_LIKE = /\b(Mills?|Parks?|Sand|Shell|Hall|Gardens|Southern|Reserve|Lodge|Inn|Water|Oil|Gas|Auto|Capital|Express|Food|Station|Living|Golf|Grill|Center|Centre)\b/gi;
const hasAcronym = (p: string) => /[a-z]/.test(p) && /\b(?!(?:II|III|IV|JR|SR|AKA)\b)[A-Z]{2,5}\b/.test(p);
/** Every word is a capitalized name word, an initial, a suffix or "and"/"&": "Andrew J. Mills and William E. Shepard, Jr.". */
function personShaped(p: string): boolean {
  // An acronym in a mixed-case name ("HWC Custom Cabinetry", "MUSC Health") is a business's, not a person's.
  if (hasAcronym(p)) return false;
  const words = p.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const names = words.filter((w) => /^[A-Z][a-z'’-]+$/.test(w) || /^[A-Z]{2,}$/.test(w) && w.length <= 12);
  return names.length >= 2 && words.every((w) => /^([A-Z][a-z'’-]+|[A-Z][A-Za-z'’-]*|[A-Z]\.?|and|&|Jr\.?|Sr\.?|II|III|IV|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)$/.test(w));
}
/** A street address with no business named in it ("7328 Middle Street", "1321 Evergreen Road, Anderson, SC"). */
const ADDRESS_ONLY = /^\d+[A-Z]?\s+(?:[\w.'’-]+\s+){0,4}(Road|Rd|Street|St|Highway|Hwy|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Circle|Cir|Parkway|Pkwy|Trail|Place|Pl)\b\.?(,.*)?$/i;

/**
 * The business names in an order's "Individual/Entity…" (and "Facility") text: split on "/", "d/b/a" and "individually
 * and"; a part is kept only when it reads as a business (a business word, a single brand-like word, digits or "&").
 * A part shaped like a person's name, or naming an estate or heirs, is dropped (FCRA: companies only).
 */
export function businessParts(text: string | null): string[] {
  if (!text) return [];
  const parts = text
    .replace(/\bc\/o\s+[^/]+/gi, " ") // "c/o John Loveless": a contact person, not the business
    .split(/\s*\/\s*(?![Bb]\/?[Aa]\b)|\s*,?\s*\b(?:d\s*\/\s*b\s*\/\s*a|d\.\s*b\.\s*a\.?|dba|doing business as)(?=\s|:|$)\s*:?\s*|\s*,?\s*individually and\s*/i)
    .map((p) => p.replace(/^[\s,;&-]+|[\s,;&-]+$/g, "").replace(/\s+/g, " "))
    .filter((p) => p.length >= 2);
  const out: string[] = [];
  for (const raw of parts) {
    if (PERSON_ONLY.test(raw) || ADDRESS_ONLY.test(raw)) continue;
    // "Teodosio Estrada 667 Gooseneck Road, Aiken, SC": a name with an address after it is judged without the address.
    let p = raw.replace(/\s+\d+[A-Z]?\s+[A-Za-z].*\b(Road|Rd|Street|St|Highway|Hwy|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Circle)\b.*$/i, "").trim();
    // "Eric Potter and Friendly Feller, LLC": a person named jointly with a business; only the business is kept.
    const joint = p.match(/^(.+?),?\s+and\s+(.+)$/);
    if (joint && personShaped(joint[1]) && !BUSINESS_WORDS.test(joint[1].replace(SURNAME_LIKE, " "))) p = joint[2].trim();
    if (personShaped(p) && !BUSINESS_WORDS.test(p.replace(SURNAME_LIKE, " "))) continue;
    const brand = /^[A-Za-z0-9][\w'’.&-]*$/.test(p) && !/^[A-Z][a-z]+$/.test(p); // "ChromaScape", "76" — not a lone "Smith"
    if (BUSINESS_WORDS.test(p) || /\d|&/.test(p) || brand || hasAcronym(p)) {
      if (p !== raw && !BUSINESS_WORDS.test(p) && !/&/.test(p)) continue;
      if (!out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
    }
  }
  return out;
}

export type DesOrder = {
  orderType: string | null; orderNumber: string | null; date: string | null; businesses: string[]; county: string | null;
  /** The order date as published, when it could not be normalized (a two-digit year: the century isn't stated). */
  dateText?: string | null;
  location: string | null; city: string | null; program: string | null; violations: string | null; penalty: number | null;
};

const LONG_MONTH = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i;
/**
 * "June 12, 2025" or "8/13/2026" → YYYY-MM-DD. A two-digit year ("8/24/26") gives null: the century is not stated, so
 * it is never guessed (round 3, decision 13); the publisher's text is kept on the record instead (dateText).
 */
export function longDate(v: string | null): string | null {
  const t = v?.trim() ?? "";
  const m = t.match(LONG_MONTH);
  if (m) return `${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const n = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  return n ? `${n[3]}-${n[1].padStart(2, "0")}-${n[2].padStart(2, "0")}` : null;
}

/** Every order in one monthly report's text. */
export function parseDesReport(text: string): DesOrder[] {
  const lines = textLines(text);
  const out: DesOrder[] = [];
  let program: string | null = null;
  let fields: Record<string, string> | null = null;
  let fieldLines: Record<string, string[]> = {};
  let last: string | null = null;
  let body: string[] = [];
  let entryProgram: string | null = null;
  const flush = () => {
    if (!fields) return;
    const f = fields;
    const ot = (f["order type and number"] ?? "").replace(/\s*-\s*/g, "-") // the JS reader spaces hyphens: "AF -0001689 -UST"
      .replace(/^CO\b/, "Consent Order").replace(/^AO\b/, "Administrative Order"); // "CO 26-002-A"
    const m = ot.match(/^(.*?(?:Order|Agreement|Decision))\s*:?\s*(?:No\.?\s*)?([A-Z0-9][\w-]*\d[\w-]*)/i);
    const entity = f["individual/entity/facility"] ?? f["individual/entity / facility"] ?? f["individual/entity"] ?? null;
    // An order whose individual/entity is a person is a record about that person, whatever the facility is called.
    const own = businessParts(entity);
    const businesses = own.length ? [...own, ...businessParts(f["facility"] ?? null)].filter((b, i, a) => a.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i) : [];
    const loc = clean(f["location"] ?? null);
    // The city is the location's last line when it reads "City, SC 29XXX" (a street line is never taken for a city).
    const lastLine = (fieldLines["location"] ?? []).slice(-1)[0] ?? "";
    const city = lastLine.match(/^([A-Za-z][A-Za-z .'-]*?),\s*(?:SC|South Carolina)\b/)?.[1]?.trim() ?? null;
    const text1 = body.join(" ").replace(/\s+/g, " ");
    const summary = text1.match(/Summary:\s*(.*?)(?=\bAction:|$)/i)?.[1] ?? "";
    const violations = summary.match(/as follows:\s*(.*)$/i)?.[1]?.trim() ?? null;
    const action = text1.match(/\bAction:\s*(.*)$/i)?.[1] ?? "";
    const pen = action.match(/civil penalty[^$]{0,200}?\(\$\s?([\d,]+(?:\.\d{2})?)\)/i) ?? action.match(/civil penalty[^$]{0,120}?\$\s?([\d,]+(?:\.\d{2})?)/i);
    out.push({
      orderType: clean(m?.[1] ?? null), orderNumber: m?.[2] ?? null, date: longDate(f["order date"] ?? null), businesses,
      dateText: longDate(f["order date"] ?? null) ? null : clean(f["order date"] ?? null),
      county: clean(f["county"] ?? null), location: loc, city, program: entryProgram,
      violations: violations ? violations.slice(0, 400) : null, penalty: pen ? Number(pen[1].replace(/,/g, "")) : null,
    });
    fields = null; fieldLines = {}; last = null; body = [];
  };
  for (const raw of lines) {
    if (NOISE_RE.test(raw) || !raw.trim()) { if (!raw.trim()) last = null; continue; }
    const nc = fields && raw.match(COUNTY_NO_COLON);
    const lm = raw.match(LABEL_RE) ?? (nc ? ([raw, "County", nc[1]] as unknown as RegExpMatchArray) : null);
    if (lm) {
      const label = lm[1].replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").toLowerCase().replace("individual/entity/facility", "individual/entity/facility");
      const key = /^individual\/entity ?\/ ?facility$/.test(label) ? "individual/entity/facility"
        : label === "order type/order number" ? "order type and number" : label;
      if (key === "order type and number") { flush(); fields = {}; entryProgram = program; body = []; }
      if (!fields) continue;
      fields[key] = lm[2].trim();
      fieldLines[key] = [lm[2].trim()];
      last = key;
      continue;
    }
    if (SECTION_RE.test(raw)) { last = null; if (fields) body.push(raw.trim()); continue; }
    const t = raw.trim();
    // A centered program heading between orders ("Underground Storage Tank Enforcement").
    if (/^\s{8,}\S/.test(raw) && /\b(Enforcement|Program)\s*$/.test(t) && !/ACTION REPORT/i.test(t) && t.length < 80 && !last) {
      flush(); program = t; continue;
    }
    if (/^\s*BUREAU OF\b/.test(raw)) { flush(); continue; }
    if (fields && last && Object.keys(fields).length && !body.length) { fields[last] += ` ${t}`; fieldLines[last]?.push(t); continue; } // a wrapped field value
    if (fields) body.push(t);
  }
  flush();
  return out;
}

export function desHit(o: DesOrder, sourceUrl: string): EnforcementHit | null {
  if (!o.businesses.length || !o.orderNumber) return null;
  return {
    state: "SC", source: "South Carolina DES environmental enforcement orders", sourceUrl, category: "environmental",
    name: o.businesses.join(" / "), id: o.orderNumber, date: o.date, endDate: null, status: o.orderType,
    city: o.city ?? (o.county ? `${o.county.replace(/\s+County$/i, "")} County` : null),
    detail: [o.program, o.dateText ? `Order date as published: ${o.dateText}` : null, o.violations ? `Violations: ${o.violations}` : null].filter(Boolean).join(". ") || null,
    // Adverse only from what the report publishes: a civil penalty. An order with no penalty printed stays unknown.
    amount: o.penalty, adverse: adverseFrom(o.penalty ? "civil penalty" : null),
    ...(o.location ? { address: o.location } : {}),
  };
}

async function* desOrders(): AsyncIterable<BulkHit> {
  const res = await politeFetch(DES_PAGE, {}, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`${DES_PAGE} returned HTTP ${res.status}`);
  const reports = desReportLinks(await res.text()).slice(0, REPORT_WINDOW);
  if (reports.length < 6) throw new Error(`only ${reports.length} monthly enforcement reports linked from ${DES_PAGE}`);
  const seen = new Set<string>();
  for (const r of reports) {
    const path = await download(r.url);
    let text: string;
    try { text = (await pdfText(await fs.readFile(path))).text; } finally { await fs.rm(path, { force: true }); }
    for (const o of parseDesReport(text)) {
      const hit = desHit(o, r.url);
      if (!hit || seen.has(`${hit.id}|${hit.name}`)) continue;
      seen.add(`${hit.id}|${hit.name}`);
      yield { kind: "enforcement", hit, business: o.businesses.join(" "), person: null, keys: { addresses: o.location ? [o.location] : [] } };
    }
  }
}

// ── LLR Public Board Orders (Contractor's Licensing Board, Residential Builders Commission) ───────────────────
const LLR_ORDERS = "https://eservice.llr.sc.gov/PublicOrdersWeb/";
/** LLR's own division ids (the same ids its licensee lookup uses: div=69 and div=46). */
export const LLR_BOARDS = [
  { division: "69", board: "SC Contractor's Licensing Board" },
  { division: "46", board: "SC Residential Builders Commission" },
] as const;
export const llrOrdersUrl = (division: string) => `${LLR_ORDERS}?divisionId=${division}`;

export type LlrOrderRow = { fileId: string | null; date: string | null; dateText: string | null; name: string; licenseType: string | null; licenseNumber: string | null };

/**
 * The orders table of one board's list (Order Date, Name, License Type, License Number, and a "View Order" link whose
 * fileId names the order). A page without the table's header is an error, never "no orders". A date later than
 * `today` (one row reads 5/13/2029) is not taken as the order's date: it stays as published (dateText).
 */
export function parseLlrOrders(html: string, today = new Date().toISOString().slice(0, 10)): LlrOrderRow[] {
  if (!/<th[^>]*>\s*Order Date\s*<\/th>\s*<th[^>]*>\s*Name\s*<\/th>\s*<th[^>]*>\s*License Type\s*<\/th>\s*<th[^>]*>\s*License Number\s*<\/th>/i.test(html)) {
    throw new Error("SC LLR Public Board Orders: unexpected page (no orders table)");
  }
  const out: LlrOrderRow[] = [];
  for (const m of Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]);
    if (cells.length !== 5) continue;
    const name = htmlText(cells[2]);
    if (!name) continue;
    const fileId = decodeEntities(cells[0]).match(/[?&]fileId=(\d+)/i)?.[1] ?? null;
    const published = htmlText(cells[1]);
    const iso = usDate(published);
    out.push({
      fileId, name, licenseType: htmlText(cells[3]), licenseNumber: htmlText(cells[4]),
      date: iso && iso <= today ? iso : null, dateText: iso && iso <= today ? null : published,
    });
  }
  return out;
}

const readsAsCompany = (n: string) => personNameForm(n) === null && looksLikeBusinessTrailingSuffix(n);
/** Given names after a comma: "Vraj", "Juan Pablo", "David & Lauren", "April / Kevin", "Casey Black". */
function givenNames(p: string): boolean {
  const words = p.split(/\s*(?:&|\/|\band\b)\s*|\s+/i).filter(Boolean);
  return words.length >= 1 && words.length <= 4 && words.every((w) => /^[A-Z][A-Za-z'’.-]*$/.test(w)) && !looksLikeBusinessTrailingSuffix(p);
}
/** A surname before the slash: one or two plain name words ("Patel", "Vega Mendivil"). */
const surname = (p: string) => /^[A-Z][A-Za-z'’-]*(?: [A-Z][A-Za-z'’-]*)?$/.test(p) && !looksLikeBusinessTrailingSuffix(p);
/** An entity form no surname is (Co and Pa are left out: "NEALY FENCE CO., BRADLEY" stays ambiguous). */
const ENDS_IN_ENTITY = /(?:^|[\s,])(?:inc|incorporated|llc|l\.l\.c|corp|corporation|ltd|limited|llp|lllp|pllc|company|companies)\.?\s*$/i;

/**
 * The business a row names, or null when it names none (companies only, FCRA). The list prints people "LAST, FIRST"
 * ("WILSON, WILLARD E", "Villatoro, Osman"), and the Residential Builders Commission often names the licensee with
 * the business: "Patel/Trinity Home Remodeling, LLC, Vraj", "Brooks Bentley dba Carolina Gutters, LLC", "Casey's Custom
 * Home Services LLC, Casey Black". From those only the business is kept; the person is never part of the name.
 * Anything else is kept only when the whole name reads as a business by the shared rules (an entity form as its last
 * word, a trade word, "& Sons"): a bare name ("CASS LOWRIE") or an ambiguous one ("STROUD'S REMODELING, DAVID") is
 * left out.
 */
export function llrBusinessName(raw: string): { name: string; personLeftOut: boolean } | null {
  const t = raw.replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/[\s,]+$/, "").trim();
  // "Brooks Bentley dba Carolina Gutters, LLC", "FOUR SEASONS (dba Carroll & Sons Inc)".
  const dba = t.split(/\s*\(?\s*\b(?:d\.?\s?\/?\s?b\.?\s?\/?\s?a\.?|doing business as)\s+/i);
  if (dba.length === 2) {
    const parts = dba.map((p) => p.replace(/[()]/g, "").trim()).filter(Boolean);
    const kept = parts.filter(readsAsCompany);
    return kept.length ? { name: kept.join(" / "), personLeftOut: kept.length < parts.length } : null;
  }
  // "Surname/Business, First": "Hollfelder/GTL Contracting LLC, Rich", "Miller / Dirt Cheap Hauling & Services, April / Kevin".
  const sl = t.match(/^([^/,]+?)\s*\/\s*(.+?),\s*([^,]+)$/);
  if (sl && surname(sl[1].trim()) && givenNames(sl[3].trim())) {
    const b = sl[2].trim();
    return readsAsCompany(b) ? { name: b, personLeftOut: true } : null;
  }
  // "Business LLC, First [Last]": "Powells Home Improvments LLC, Mason", "Dean and Sons Construction, Brian".
  const i = t.lastIndexOf(",");
  if (i > 0) {
    const b = t.slice(0, i).trim(), p = t.slice(i + 1).trim();
    if (givenNames(p) && (ENDS_IN_ENTITY.test(b) || /&\s*sons?\b|\band sons?\b/i.test(b))) return readsAsCompany(b) ? { name: b, personLeftOut: true } : null;
  }
  return readsAsCompany(t) ? { name: t, personLeftOut: false } : null;
}

/** The rows that name a business, each under the business's name only. */
export const llrBusinessRows = (rows: LlrOrderRow[]): (LlrOrderRow & { personLeftOut: boolean })[] =>
  rows.flatMap((r) => { const b = llrBusinessName(r.name); return b ? [{ ...r, name: b.name, personLeftOut: b.personLeftOut }] : []; });

/**
 * One row as a report hit. The list says only that the board issued an order: the order itself sits behind a
 * reCAPTCHA on LLR's site and is not read, so what it decided is unknown (adverse null, never guessed). License type
 * codes (CLG, CLM, RBB, …) are shown as published; LLR doesn't define them on the page.
 */
export function llrOrderHit(r: LlrOrderRow & { personLeftOut?: boolean }, board: (typeof LLR_BOARDS)[number]): EnforcementHit {
  return {
    state: "SC", source: "SC LLR public board orders (contractors and residential builders)", sourceUrl: llrOrdersUrl(board.division), category: "discipline",
    name: r.name, id: r.fileId ? `order file ${r.fileId}` : null, date: r.date, endDate: null,
    status: `Board order issued by the ${board.board.replace(/^SC /, "")} (listed on LLR's Public Board Orders)`,
    city: null,
    detail: [
      r.licenseType || r.licenseNumber ? `License ${[r.licenseType ? `type ${r.licenseType}` : null, r.licenseNumber ? `no. ${r.licenseNumber}` : null].filter(Boolean).join(" ")} (as published)` : null,
      r.dateText ? `Order date as published: ${r.dateText}` : null,
      r.personLeftOut ? "The list's entry also names an individual, who is left out" : null,
      "The order's text is behind a reCAPTCHA on LLR's site and was not read",
    ].filter(Boolean).join("; "),
    amount: null, adverse: null,
    ...(r.licenseNumber ? { licenseNumber: r.licenseNumber } : {}),
  };
}

async function* llrOrdersLoader(): AsyncIterable<BulkHit> {
  for (const board of LLR_BOARDS) {
    // One page per board carries its whole list (about 1,900 and 6,400 rows, 1 MB and 3 MB on 2026-10-15).
    const res = await politeFetch(llrOrdersUrl(board.division), {}, { minDelayMs: 2000, timeoutMs: 120_000 });
    if (!res.ok) throw new Error(`SC LLR Public Board Orders (division ${board.division}) returned HTTP ${res.status}`);
    const rows = parseLlrOrders(await res.text());
    if (rows.length < 100) throw new Error(`SC LLR Public Board Orders (division ${board.division}): only ${rows.length} rows`);
    const seen = new Set<string>();
    for (const r of llrBusinessRows(rows)) {
      const key = `${r.fileId}|${r.name}|${r.licenseNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      yield { kind: "enforcement", hit: llrOrderHit(r, board), business: r.name, person: null, keys: { licenses: [r.licenseNumber] }, component: board.board };
    }
  }
}

export const pack: StatePack = {
  state: "SC",
  checked: "2026-10-15",
  // sc-des-enforcement is not registered (coordinator, 2026-10-15): des.sc.gov's terms bar republishing (see `blocked`).
  // Its parser and loader (desOrders) are kept; its stored rows are deleted at boot (bulk.ts RETIRED_BULK_SOURCES).
  bulk: [
    // OWNER ORDER 2026-10-15: eservice.llr.sc.gov's robots.txt Disallow no longer stops a search (http.ts). Business
    // rows on 2026-10-15: 1,206 of 1,889 (Contractor's Licensing Board) and 143 of 6,446 (Residential Builders Commission).
    { id: "sc-llr-board-orders", state: "SC", label: "SC LLR public board orders (Contractor's Licensing Board, Residential Builders Commission)",
      pageUrl: llrOrdersUrl("69"), everyHours: 24 * 7, minRows: 900, load: llrOrdersLoader, companiesOnly: true, category: "discipline" },
  ],
  blocked: [
    "SC DES environmental enforcement action reports (the monthly PDFs linked from des.sc.gov \"Environmental Enforcement Actions\"; was sc-des-enforcement): not used, because des.sc.gov's Website Accessibility and Policies page says \"You may not: (1) reproduce, adapt, modify, distribute, publicly perform or display, transmit, or otherwise copy or use any part of this site except as specifically permitted by SCDES in writing\" (coordinator's decision, 2026-10-15)",
    "SC LLR licensee lookup (verify.llronline.com/LicLookup/Contractors/Contractor.aspx?div=69 for the Contractor's Licensing Board's general and mechanical contractors, Resbu/Resbu.aspx?div=46 for the Residential Builders Commission, BurgFire for burglar/fire/sprinkler): a g-recaptcha widget on every search form, the Find button hidden until it is solved; rechecked 2026-10-15",
    "SC LLR bulk license verification (eservice.llr.sc.gov/OnlineVerificationBulk): a login (username and password, \"Don't have an account? Register Here!\") with a reCAPTCHA; checked 2026-10-15",
    "SC LLR board order documents (the \"View Order\" PDFs of eservice.llr.sc.gov/PublicOrdersWeb, /PublicOrder/Download): \"To download this public order verify that you are not a robot\", a reCAPTCHA on every order (2026-10-15); only the list (date, name, license type and number) is used, as sc-llr-board-orders",
    "SC Contractor's Licensing Board meeting minutes (llr.sc.gov/clb/minutes, robots-allowed PDFs): disciplinary hearings are listed by case number only (\"In accordance with Board confidentiality statutes, the hearing was closed\"), no respondent named; checked the 2026-07-30 minutes",
    "SC LLR license rosters: sold by mailed request ($10 check per roster with a signed Family Privacy Protection Act statement, llr.sc.gov/AboutUs/MediaCenter/pidocs/Statement_Compliance.pdf, linked as 'Licensee List Request' from llr.sc.gov/clb); needs the owner",
    "SC DES Asbestos Contractors and Consultants Search (apps.des.sc.gov/AsbestosContractorsAndConsultants, with free CSV exports /CSV and /CSV/<type>: ~200 contractors, ~870 consultants and air samplers on 2026-10-15) and the UST Class I/II certified contractors PDF (des.sc.gov List_of_Certified_Contractors_August2026.pdf): not used, because des.sc.gov's Website Accessibility and Policies page says \"You may not: (1) reproduce, adapt, modify, distribute, publicly perform or display, transmit, or otherwise copy or use any part of this site except as specifically permitted by SCDES in writing\"",
    "SCDOT prequalified prime contractors (apps.scdot.org/powerbiexport, a free CSV export refreshed daily, ~425 firms on 2026-10-15): not used, because scdot.org/disclaimer.html says \"You may not modify, publish, transmit, display, participate in the transfer or sale, create derivative works or in any way exploit, any of the content, in whole or in part, without the express written permission of SCDOT\"",
    "SC Secretary of State business entities (businessfilings.sc.gov/BusinessFiling/Entity/Search): g-recaptcha on the search form; rechecked 2026-10-15",
    "SC DES ArcGIS hub: private (and on a des.sc.gov service, under the same terms)",
    "SC Workers' Compensation Commission and SC Materials Management Office: no published list of penalized employers or debarred vendors (decisions are single PDFs)",
  ],
};
