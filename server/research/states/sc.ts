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
 * No license source: rechecked live 2026-10-15, every free South Carolina contractor license list is behind a
 * reCAPTCHA or a robots.txt Disallow, or on a site whose terms forbid reuse (see `blocked`).
 * Removed 2026-10-15 (coordinator's decision): des.sc.gov's "Website Accessibility and Policies" page says "You may
 * not: (1) reproduce, adapt, modify, distribute, publicly perform or display, transmit, or otherwise copy or use any
 * part of this site except as specifically permitted by SCDES in writing", so sc-des-enforcement is no longer
 * registered (the code below is kept, unused) and South Carolina has no searchable source.
 */
import { promises as fs } from "node:fs";
import type { EnforcementHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { decodeEntities } from "../bulk-sources";
import { clean, download, type BulkHit } from "../bulk";
import { pdfText, textLines } from "./lib/a3-pdf";
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

export const pack: StatePack = {
  state: "SC",
  checked: "2026-10-15",
  // sc-des-enforcement is not registered (coordinator, 2026-10-15): des.sc.gov's terms bar republishing (see `blocked`).
  // Its parser and loader (desOrders) are kept; its stored rows are deleted at boot (bulk.ts RETIRED_BULK_SOURCES).
  bulk: [],
  blocked: [
    "SC DES environmental enforcement action reports (the monthly PDFs linked from des.sc.gov \"Environmental Enforcement Actions\"; was sc-des-enforcement): not used, because des.sc.gov's Website Accessibility and Policies page says \"You may not: (1) reproduce, adapt, modify, distribute, publicly perform or display, transmit, or otherwise copy or use any part of this site except as specifically permitted by SCDES in writing\" (coordinator's decision, 2026-10-15)",
    "SC LLR licensee lookup (verify.llronline.com/LicLookup/Contractors/Contractor.aspx?div=69 for the Contractor's Licensing Board's general and mechanical contractors, Resbu/Resbu.aspx?div=46 for the Residential Builders Commission, BurgFire for burglar/fire/sprinkler): a g-recaptcha widget on every search form, the Find button hidden until it is solved; rechecked 2026-10-15",
    "SC LLR board orders and bulk verification (eservice.llr.sc.gov/PublicOrdersWeb/?divisionId=69 and 46, /OnlineVerificationBulk): eservice.llr.sc.gov/robots.txt is \"User-agent: * / Disallow: /\"; rechecked 2026-10-15",
    "SC Contractor's Licensing Board meeting minutes (llr.sc.gov/clb/minutes, robots-allowed PDFs): disciplinary hearings are listed by case number only (\"In accordance with Board confidentiality statutes, the hearing was closed\"), no respondent named; checked the 2026-07-30 minutes",
    "SC LLR license rosters: sold by mailed request ($10 check per roster with a signed Family Privacy Protection Act statement, llr.sc.gov/AboutUs/MediaCenter/pidocs/Statement_Compliance.pdf, linked as 'Licensee List Request' from llr.sc.gov/clb); needs the owner",
    "SC DES Asbestos Contractors and Consultants Search (apps.des.sc.gov/AsbestosContractorsAndConsultants, with free CSV exports /CSV and /CSV/<type>: ~200 contractors, ~870 consultants and air samplers on 2026-10-15) and the UST Class I/II certified contractors PDF (des.sc.gov List_of_Certified_Contractors_August2026.pdf): not used, because des.sc.gov's Website Accessibility and Policies page says \"You may not: (1) reproduce, adapt, modify, distribute, publicly perform or display, transmit, or otherwise copy or use any part of this site except as specifically permitted by SCDES in writing\"",
    "SCDOT prequalified prime contractors (apps.scdot.org/powerbiexport, a free CSV export refreshed daily, ~425 firms on 2026-10-15): not used, because scdot.org/disclaimer.html says \"You may not modify, publish, transmit, display, participate in the transfer or sale, create derivative works or in any way exploit, any of the content, in whole or in part, without the express written permission of SCDOT\"",
    "SC Secretary of State business entities (businessfilings.sc.gov/BusinessFiling/Entity/Search): g-recaptcha on the search form; rechecked 2026-10-15",
    "SC DES ArcGIS hub: private (and on a des.sc.gov service, under the same terms)",
    "SC Workers' Compensation Commission and SC Materials Management Office: no published list of penalized employers or debarred vendors (decisions are single PDFs)",
  ],
};
