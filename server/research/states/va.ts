/**
 * Virginia. Checked live 2026-10-15.
 *
 *   Bulk (DPOR regulant lists, https://www.dpor.virginia.gov/RegulantLists: tab-delimited licensee files of every
 *   current license, refreshed by DPOR every 5 business days; robots.txt allows /sites/default/files/):
 *     va-dpor-contractors   Board for Contractors: Class A/B/C contractors, temporary contractors, residential building
 *                           energy analysts, tradesmen (electricians, plumbers, HVAC, gas fitters), backflow workers,
 *                           elevator and accessibility mechanics, water well providers, fire sprinkler inspectors
 *     va-dpor-apelscidla    Board for Architects, Professional Engineers, Land Surveyors, Certified Interior Designers
 *                           and Landscape Architects: individuals and business entities
 *     va-dpor-alhi          Board for Asbestos, Lead, and Home Inspectors: asbestos and lead abatement contractors,
 *                           home inspectors
 *   Every regulant row carries its license number and address (DPOR publishes no phones) as search keys.
 *     va-dpor-revocations   Board for Contractors license revocations from DPOR's News Releases page (2020 to today):
 *                           businesses only, keyed by license number so they join the va-dpor-contractors rows.
 *
 *   Robots and terms, read 2026-10-15 before any other request to the host:
 *     www.dpor.virginia.gov (22:51 UTC): robots.txt "User-agent: *" disallows only /core/, /profiles/, /README.txt,
 *       /web.config, /admin/, /comment/reply/, /filter/tips, /node/add/, /search/, /user/register|password|login|logout/
 *       and their /index.php/ forms. Web Policy (/WebPolicy): privacy, disclaimer, link policy, logo terms; no bar on
 *       automated or commercial reading.
 *     townhall.virginia.gov (23:00 UTC): robots.txt "User-agent: *", "Crawl-delay: 5", "Disallow: /L./", "Disallow:
 *       /l./", "Disallow: //" (so /L/meetings.cfm and /L/GetFile.cfm are allowed, at least 5 s apart). Web policies
 *       (/policies.cfm): "Unauthorized attempts to modify any information stored on this system, to defeat or
 *       circumvent security features, or to utilize this system for other than its intended purposes are prohibited";
 *       "The information and statements contained on this server shall not be used for the purposes of advertising, nor
 *       to imply the endorsement or recommendation of the Commonwealth of Virginia." Not loaded (see `blocked`).
 *   Live (data.virginia.gov CKAN datastore, published there by the State Corporation Commission):
 *     SCC corporations and LLCs: status and status reason (business_status). The open-data copies are dated: the
 *     corporation file was last loaded 2024-11-14 and the LLC file 2026-03-24, and the LLC file stops at 1,048,575 rows.
 *   Bulk (DGS debarment and enjoinment, dgs.virginia.gov/engineering-and-buildings/resources/debarment-enjoinment):
 *     va-eva-debarred       eVA Inactive Vendor List (logi.cgieva.com Report9020), filtered by the report's own "eVA
 *                           Status" list to Debarred and to Enjoined: name, eVA ID, address. No dates or periods are
 *                           published. Companies only. logi.cgieva.com's robots.txt is "Disallow: /"; used by OWNER
 *                           ORDER 2026-10-15. No CAPTCHA or login; DGS's web policy (Privacy & Security) sets no rule
 *                           against reuse.
 *
 * Codes: classification and specialty abbreviations are DPOR's own ("Contractor's License Classifications &
 * Specialties", 18 VAC 50-22-20/30) and the tradesman designations are DPOR's "Combined License" sheet, both linked
 * from the regulant-list page. A code DPOR doesn't define there is shown as "code X".
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { decodeEntities, isHtmlType, politeFetch, politeText } from "../http";
import { pdfText } from "./lib/a3-pdf";
import { clean, csvRecords, download, usDate, type BulkHit, type BulkSource } from "../bulk";
import type { LiveEnforcementSearch, StatePack } from "./types";
import { capNote, withNote } from "../notes";
import { fromFile, hasAllWords, htmlText } from "./lib/g3-common";
import { htmlLines, personText } from "../person-name";
import { looksLikeBusiness, personNameForm } from "./lib/business-name";
import { adverseFrom } from "../adverse";

// ── DPOR regulant lists ──────────────────────────────────────────────────────────────────────────────────────
const DPOR_PAGE = "https://www.dpor.virginia.gov/RegulantLists";
const DPOR_FILES = "https://www.dpor.virginia.gov/sites/default/files/Records%20and%20Documents/Regulant%20List";

/**
 * File stem → the list's name on the regulant-list page. `holder`: who the list licenses, from its class (round 2,
 * decision 2): contractor, firm and entity lists license businesses; tradesman, mechanic, inspector and professional
 * lists license people (a business name on their row is where they work).
 */
type DporList = { file: string; type: string; holder: "business" | "individual"; mayBeEmpty?: boolean };
const CONTRACTOR_LISTS: DporList[] = [
  { file: "2701", type: "Class A Contractor", holder: "business" },
  { file: "2705a", type: "Class A Contractor", holder: "business" },
  { file: "2705b", type: "Class B Contractor", holder: "business" },
  { file: "2705c", type: "Class C Contractor", holder: "business" },
  { file: "2703", type: "Temporary Contractor", holder: "business" },
  { file: "2707", type: "Residential Building Energy Analyst Firm", holder: "business" },
  { file: "2722", type: "Residential Building Energy Analyst", holder: "individual" },
  { file: "2709", type: "Residential Tradesman", holder: "individual" },
  { file: "2710", type: "Tradesman", holder: "individual" },
  { file: "2717", type: "Backflow Prevention Device Worker", holder: "individual" },
  { file: "2718", type: "Certified Elevator Mechanic", holder: "individual" },
  { file: "2719", type: "Certified Water Well Systems Provider", holder: "individual" },
  { file: "2720", type: "Certified Accessibility Mechanic", holder: "individual" },
  // Only filled during a declared state of emergency: the published file is its header alone (checked 2026-10-15).
  { file: "2721", type: "Emergency Elevator Mechanic (declared state of emergency)", holder: "individual", mayBeEmpty: true },
  { file: "2723", type: "Certified Automatic Fire Sprinkler Inspector", holder: "individual" },
];
const APELSCIDLA_LISTS: DporList[] = [
  { file: "0401", type: "Architect", holder: "individual" },
  { file: "0402", type: "Professional Engineer", holder: "individual" },
  { file: "0403", type: "Land Surveyor", holder: "individual" },
  { file: "0406", type: "Landscape Architect", holder: "individual" },
  { file: "0405", type: "Professional Corporation (architects, engineers, surveyors, landscape architects)", holder: "business" },
  { file: "0407", type: "Business Entity (architects, engineers, surveyors, landscape architects)", holder: "business" },
  { file: "0413", type: "Professional LLC (architects, engineers, surveyors, landscape architects)", holder: "business" },
];
const ALHI_LISTS: DporList[] = [
  { file: "3306", type: "Asbestos Contractor", holder: "business" },
  { file: "3358", type: "Lead Abatement Contractor", holder: "business" },
  { file: "3380", type: "Home Inspector", holder: "individual" },
];

/** 18 VAC 50-22-20 and -30, as printed in DPOR's "Contractor's License Classifications & Specialties". */
const VA_CONTRACTOR_CODES: Record<string, string> = {
  CBC: "Commercial building", ELE: "Electrical", "H/H": "Highway/heavy", HVA: "HVAC", PLB: "Plumbing", RBC: "Residential building",
  ASC: "Accessibility services", ASL: "Accessibility services - LULA", AES: "Alternative energy system", ADS: "Alternative sewage disposal system",
  ASB: "Asbestos", PAV: "Asphalt paving and sealcoating", BSC: "Billboard/sign", BEC: "Blast/explosive", CIC: "Commercial improvement",
  CEM: "Concrete", CDS: "Conventional sewage disposal systems", DLR: "Drug lab remediation", DRY: "Drywall",
  ESC: "Electronic/communication service", EEC: "Elevator/escalator", FAS: "Fire alarm systems", FLR: "Flooring and floor covering",
  FRM: "Framing subcontractor", GFC: "Gas fitting", GLZ: "Glass and glazing", HIC: "Home improvement", IBC: "Industrialized building",
  INS: "Insulation and weather stripping", ISC: "Landscape irrigation", LSC: "Landscape service", LAC: "Lead abatement",
  LPG: "Liquefied petroleum gas", MHC: "Manufactured home", MCC: "Marine facility", BRK: "Masonry", MSC: "Miscellaneous",
  NGF: "Natural gas fitting provider", PTC: "Painting and wallcovering", RMC: "Radon mitigation", RFC: "Recreational facility",
  REF: "Refrigeration", ROC: "Roofing", STL: "Steel erection", POL: "Swimming pool construction", TMC: "Tile, marble, ceramic, and terrazzo",
  UUC: "Underground utility and excavating", VCC: "Vessel construction", WWP: "Water well/pump",
};
/** DPOR "Tradesman Categories" (tradesman designations sheet, revised 11/20/2013). */
const VA_TRADESMAN_CODES: Record<string, string> = {
  JELE: "Journeyman Electrician", JPLB: "Journeyman Plumber", JNGF: "Journeyman Natural Gas Fitter", JLPG: "Journeyman Liquefied Petroleum Gas Fitter",
  JHVA: "Journeyman HVAC", JGFC: "Journeyman Gas Fitter", MELE: "Master Electrician", MPLB: "Master Plumber", MNGF: "Master Natural Gas Fitter",
  MLPG: "Master Liquefied Petroleum Gas Fitter", MHVA: "Master HVAC", MGFC: "Master Gas Fitter",
};

/** "CBC RBC" → "CBC (Commercial building), RBC (Residential building)"; undefined codes as "code X". */
export function vaSpecialties(raw: string | null | undefined, board: string): string | null {
  const codes = (raw ?? "").split(/\s+/).filter(Boolean);
  if (!codes.length) return null;
  const table = board === "27" ? { ...VA_CONTRACTOR_CODES, ...VA_TRADESMAN_CODES } : {};
  return codes.map((c) => (table[c] ? `${c} (${table[c]})` : `code ${c}`)).join(", ");
}

/** One regulant-list row → a license hit. Exported for the unit test. */
export function vaRegulantHit(r: Record<string, string>, list: DporList, source: string): BulkHit | null {
  const board = (r.BOARD ?? "").trim(), occ = (r.OCCUPATION ?? "").trim(), cert = (r["CERTIFICATE #"] ?? "").trim();
  const who = personText(r["INDIVIDUAL NAME"]); // as published: a list stays a list (round 6, decision 3)
  const business = clean(r["BUSINESS NAME"]);
  if (!who && !business) return null;
  const licenseNumber = board && occ && cert ? `${board}${occ}${cert}` : clean(cert);
  const zip = clean(r["FIVE DIGIT ZIP CODE"]), ext = clean(r["ZIP CODE EXTENSION"]);
  const street = [clean(r["FIRST LINE ADDRESS"]), clean(r["SECOND LINE ADDRESS"]), clean(r["P O BOX #"])].filter(Boolean).join(", ");
  const place = [clean(r.CITY), [clean(r.STATE), zip ? (ext && ext !== "0000" ? `${zip}-${ext}` : zip) : null].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [street, place, clean(r.PROVINCE), clean(r.COUNTRY), clean(r["POSTAL CODE"])].filter(Boolean).join(", ") || null;
  const hit: LicenseHit = {
    state: "VA", source, sourceUrl: DPOR_PAGE,
    businessName: business, licenseNumber,
    licenseType: list.type, specialty: vaSpecialties(r["LICENSE SPECIALTY"], board),
    // The lists hold current licenses only (DPOR names the files "__crnt"); DPOR publishes no status column.
    status: "Current (on DPOR's regulant list)", principal: who, city: [clean(r.CITY), clean(r.STATE)].filter(Boolean).join(", ") || null,
    expires: usDate(r["EXPIRATION DATE"]), matchedOn: business ? "business" : "principal",
    // A contractor-class row naming only an individual (no business name) doesn't say whether it is a sole proprietor's.
    holder: list.holder === "business" && !business ? null : list.holder,
    // DPOR leaves phone numbers out of the lists. The file doesn't say what the individual on a firm's row is.
    address, phone: null, people: who ? [{ name: who, role: business ? null : "Licensee" }] : [],
  };
  return { kind: "license", hit, business, person: who, keys: { licenses: [licenseNumber], addresses: [address] } };
}

/** The columns every regulant list has (DPOR's layout); a file without them is an error page or a new layout. */
const DPOR_COLUMNS = ["BOARD", "OCCUPATION", "CERTIFICATE #", "INDIVIDUAL NAME", "BUSINESS NAME", "EXPIRATION DATE"];
export function checkDporColumns(r: Record<string, string>, file: string): void {
  const missing = DPOR_COLUMNS.filter((c) => !(c in r));
  if (missing.length) throw new Error(`DPOR list ${file}: not the regulant-list layout (no ${missing.join(", ")} column); kept the previous load`);
}

/**
 * Every list of one board. Each component file is checked on its own (its columns, and at least one row), so one
 * file that comes back as an HTML error page fails the whole load instead of vanishing inside the board's total.
 */
function dporLoader(lists: DporList[], source: string): () => AsyncIterable<BulkHit> {
  return async function* () {
    for (const list of lists) {
      const url = `${DPOR_FILES}/${list.file}__crnt.txt`;
      let rows = 0;
      for await (const r of fromFile(await download(url), (p) => csvRecords(p, "\t"))) {
        if (!rows) checkDporColumns(r, list.file);
        rows++;
        if ((r.BOARD ?? "") === "BOARD") continue; // a repeated header row
        const h = vaRegulantHit(r, list, source);
        // Each list file is a component: the 70% rule applies to it on its own (round 2, decision 10).
        if (h) yield { ...h, component: `${list.file} ${list.type}` };
      }
      if (!rows && !list.mayBeEmpty) throw new Error(`DPOR list ${list.file} (${list.type}) had no rows; kept the previous load`);
    }
  };
}

const CONTRACTORS = "Virginia DPOR Board for Contractors licenses (contractors and tradesmen)";
const APELSCIDLA = "Virginia DPOR architects, engineers, land surveyors and landscape architects";
const ALHI = "Virginia DPOR asbestos and lead abatement contractors, home inspectors";

// Row counts on 2026-10-15: contractors 88,119 rows, APELSCIDLA 46,836, ALHI 1,157, revocations 310 (of 427 printed; 116
// individuals and one repeat left out).
/**
 * A row stored before round 3 (round 4, decision 3): today's holder from the list its license type names, by the same
 * rule as vaRegulantHit (a contractor-class row without a business name is unknown).
 */
export const vaLegacyHolder = (lists: DporList[]) => (h: LicenseHit): LicenseHit["holder"] => {
  const list = lists.find((l) => l.type === h.licenseType);
  return !list ? null : list.holder === "business" && !h.businessName ? null : list.holder;
};

// ── DPOR Board for Contractors revocation releases ───────────────────────────────────────────────────────────
/*
 * https://www.dpor.virginia.gov/NewsReleases lists DPOR's news releases by year; each "Contractor License Revocations"
 * item links to one Board for Contractors meeting's revocations: a plain-text file (2024 on), one PDF (March 12, 2024),
 * or a release page (2020–2023). Every revocation is printed as the licensee's name, city line, case ("File") number(s)
 * and license number. Checked 2026-10-15: 37 contractor releases, June 23, 2020 to August 25, 2026.
 *
 * Who is listed is decided only from the name DPOR prints: a business when the licensee (the name before a "t/a" or
 * "dba", which DPOR uses for the trade name a licensee works under) carries an entity word (LLC, LC, Inc, Corp,
 * Company, Co, Ltd, LP, LLP, PLLC, PC). A person's name, a person "t/a" a trade name (a sole proprietor), people "&"
 * people, and a name without an entity word are left out: the release doesn't say they are a business (FCRA). Most
 * revoked licenses are no longer on DPOR's current regulant lists (4 of the 310 kept were on 2026-10-15, all under
 * the same business name), so the lists can't settle it for the rest. A license number in an individual's class
 * (2709, 2710, 2717–2723) is a person's whatever the name.
 *
 * robots.txt (www.dpor.virginia.gov, read 2026-10-15 22:51 UTC before any other request): "User-agent: *" disallows
 * /core/, /profiles/, /admin/, /search/, /user/…, /node/add/ and their /index.php/ forms only; /NewsReleases, /news/,
 * /News/, /sites/default/files/ and the release paths are allowed. DPOR's Web Policy (https://www.dpor.virginia.gov/
 * WebPolicy) has a privacy policy, disclaimer, link policy and logo terms ("Terms and Conditions of Use" is about the
 * DPOR logo); nothing in it bars automated or commercial reading of the published pages.
 */
const DPOR_NEWS = "https://www.dpor.virginia.gov/NewsReleases";
const DPOR_HOST = "www.dpor.virginia.gov";
const VA_REVOCATIONS = "Virginia DPOR Board for Contractors license revocations (news releases)";

/** An entity word in a licensee's name, as DPOR prints it ("LLC", "L.L.C.", "LC", "INC.", "CORPORATION", "CO", …). */
const VA_ENTITY = /(?:^|[\s,(])(?:l\.?\s?l\.?\s?c|l\.?c|inc|incorporated|corp|corporation|company|co|ltd|limited|l\.?p|l\.?l\.?p|p\.?l\.?l\.?c|p\.?c)\.?(?=$|[\s,)])/i;
/** "t/a", "dba", "d/b/a", "trading as", "doing business as": what follows is the trade name, not the licensee. */
const VA_TRADE_AS = /(?:^|[\s,])(?:t\/a|d\/?b\/?a|trading as|doing business as)(?=$|[\s,.])/i;

/** The licensee part of a printed name (before "t/a" / "dba"), and whether it carries an entity word. */
export function vaRevokedBusiness(name: string): boolean {
  const licensee = name.split(VA_TRADE_AS)[0] ?? "";
  return VA_ENTITY.test(licensee);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "August 25, 2026", "Sept. 22, 2020", "Oct. 26. 2021" (DPOR's own punctuation) → ISO; anything else null. */
export function vaLongDate(v: string | null | undefined): string | null {
  const m = (v ?? "").replace(/ /g, " ").trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})[.,]?\s*,?\s*(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  const day = Number(m[2]);
  if (mon < 0 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The text lines of a release: a release page's body field, or a text/PDF file's lines. */
export function vaReleaseLines(body: string, kind: "html" | "text"): string[] {
  let t = body;
  if (kind === "html") {
    const start = t.search(/<div[^>]*property="schema:text"/i);
    if (start < 0) return [];
    t = t.slice(start);
    const end = t.search(/<div[^>]*field--name-field-accordion-widget|<\/article>/i);
    if (end > 0) t = t.slice(0, end);
    t = decodeEntities(htmlLines(t.replace(/<!--[\s\S]*?-->/g, " ")));
  }
  return t.replace(/\f/g, "\n").split(/\r?\n/).map((l) => l.replace(/[ \s]+/g, " ").trim()).filter(Boolean);
}

const CASE_LINE = /^(?:Case|File)\s+(?:Numbers?|Nos?\.?)(?=\s|\d|$)/i;
const LICENSE_LABEL = /\bLic[a-z]*\s+(?:Numbers?|No\.?)\s*:?\s*([\d ]+)/i; // DPOR's own typos too: "Licnese Number", "Licenase No."
const HEADER_LINE = /^(?:REVOCATIONS|Meeting Date\b|Board Name\b|###|Media Contact)/i;

export type VaRevocation = { name: string; city: string | null; cases: string[]; license: string | null };

/**
 * The revocations in a release's lines: each case line ("Case No. 2026-02731", "File Number 2021-00570 | License No.
 * 2705041651") with the licensee's name two lines above it and the city line between. A license number DPOR broke
 * over two lines ("License Number 27051" / "35164") is joined only when the next line is digits alone and the two make
 * the ten digits every Board for Contractors license number in the releases has. An entry whose name line is a
 * heading is not read (counted by the caller).
 */
export function vaRevocationEntries(lines: string[]): { entries: VaRevocation[]; unread: number } {
  const entries: VaRevocation[] = [];
  let unread = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!CASE_LINE.test(lines[i]) || (i > 0 && CASE_LINE.test(lines[i - 1]))) continue;
    // One entry's case lines: "Case No. 2023-01840" / "Case No. 2023-02006" on consecutive lines, or one line.
    let j = i;
    const cases: string[] = [];
    let lic: string | null = null;
    for (; j < lines.length && CASE_LINE.test(lines[j]); j++) {
      const [casePart, ...rest] = lines[j].split("|");
      cases.push(...(casePart.match(/\b\d{4}-\d{3,6}\b/g) ?? []));
      lic ??= rest.join("|").match(LICENSE_LABEL)?.[1]?.replace(/\s+/g, "") ?? null;
    }
    if (!lic && j < lines.length) {
      lic = lines[j].match(new RegExp(`^${LICENSE_LABEL.source}`, "i"))?.[1]?.replace(/\s+/g, "") ?? null;
      if (lic && lic.length < 10 && /^\d+$/.test(lines[j + 1] ?? "") && (lic + lines[j + 1]).length === 10) lic += lines[j + 1];
    }
    const name = clean(lines[i - 2]?.replace(/[\s,]+$/, "")), city = clean(lines[i - 1]?.replace(/[\s,]+$/, ""));
    if (!name || !cases.length || HEADER_LINE.test(name) || LICENSE_LABEL.test(name) || /^RICHMOND\s*[–-]|\brevoked\b|following is/i.test(name)
      || !city || LICENSE_LABEL.test(city) || HEADER_LINE.test(city)) { unread++; continue; }
    entries.push({ name, city, cases: [...new Set(cases)], license: lic && /^\d{10}$/.test(lic) ? lic : null });
  }
  return { entries, unread };
}

/** The meeting date a release prints ("Meeting Date - August 25, 2026"; "at its meeting Tuesday, June 23, 2020"). */
export function vaMeetingDate(lines: string[]): string | null {
  for (const l of lines) {
    const m = l.match(/^Meeting Date\s*[-–:]\s*(.+)$/i) ?? l.match(/at its meeting (?:[A-Z][a-z]+day,?\s+)?([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s*\d{4})/);
    if (m) return clean(m[1]);
  }
  return null;
}

/**
 * One release → its business revocations (individuals dropped and counted). `listed`: the date DPOR lists the release
 * under on the News Releases page, as printed there; the hit's date. A release that doesn't say "revocations" or
 * "revoked" yields nothing (adverse is set only because the release says so).
 */
export function vaRevocationHits(lines: string[], url: string, listed: string | null): { hits: EnforcementHit[]; entries: number; individuals: number; unread: number } {
  if (!lines.some((l) => /\brevocations?\b|\brevoked\b/i.test(l))) return { hits: [], entries: 0, individuals: 0, unread: 0 };
  const { entries, unread } = vaRevocationEntries(lines);
  const meeting = vaMeetingDate(lines);
  const hits: EnforcementHit[] = [];
  let individuals = 0;
  for (const e of entries) {
    // A license of an individual's class (tradesman 2710, fire sprinkler inspector 2723, …: the regulant-list classes
    // above) is a person's whatever the name; otherwise the printed name decides.
    const cls = e.license ? CONTRACTOR_LISTS.find((l) => /^\d{4}$/.test(l.file) && e.license!.startsWith(l.file)) : undefined;
    if (cls?.holder === "individual" || !vaRevokedBusiness(e.name)) { individuals++; continue; }
    hits.push({
      state: "VA", source: VA_REVOCATIONS, sourceUrl: url, category: "discipline",
      name: e.name, id: e.cases.join(", "), date: vaLongDate(listed), endDate: null,
      status: "License revoked by the Board for Contractors", city: e.city,
      detail: [meeting ? `Board for Contractors meeting of ${meeting}` : null, `${e.cases.length > 1 ? "cases" : "case"} ${e.cases.join(", ")}`,
        e.license ? `license ${e.license}` : null, listed ? `DPOR news release listed ${listed}` : null].filter(Boolean).join("; "),
      amount: null, adverse: true, licenseNumber: e.license,
    });
  }
  return { hits, entries: entries.length, individuals, unread };
}

/** The contractor revocation items on the News Releases page: link and the date printed after it. */
export function vaRevocationIndex(html: string): { url: string; listed: string | null }[] {
  const out: { url: string; listed: string | null }[] = [];
  for (const li of html.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) ?? []) {
    const a = li.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*)<\/li>/i);
    if (!a) continue;
    const title = decodeEntities(a[2].replace(/<[^>]+>/g, " ")).replace(/[ \s]+/g, " ").trim();
    if (!/^Contractors? License Revocations?$/i.test(title)) continue;
    const listed = clean(decodeEntities(a[3].replace(/<[^>]+>/g, " ")).replace(/[ ]/g, " ").replace(/^[\s|]+/, ""));
    out.push({ url: new URL(decodeEntities(a[1]), DPOR_NEWS).toString(), listed });
  }
  return out;
}

async function* vaRevocationLoader(): AsyncIterable<BulkHit> {
  const index = vaRevocationIndex(await politeText(DPOR_NEWS));
  if (index.length < 20) throw new Error(`DPOR News Releases: only ${index.length} contractor revocation releases found; kept the previous load`);
  const seen = new Set<string>();
  let read = 0;
  for (const item of index) {
    if (new URL(item.url).host !== DPOR_HOST) continue; // a release elsewhere: that host's robots.txt and terms weren't checked
    const res = await politeFetch(item.url, { headers: { accept: "text/plain,text/html,application/pdf;q=0.9,*/*;q=0.5" } });
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(`DPOR release ${item.url}: HTTP ${res.status}; kept the previous load`); }
    const type = res.headers.get("content-type") ?? "";
    const lines = /pdf/i.test(type) ? vaReleaseLines((await pdfText(new Uint8Array(await res.arrayBuffer()))).text, "text")
      : isHtmlType(type) ? vaReleaseLines(await res.text(), "html") : vaReleaseLines(await res.text(), "text");
    const r = vaRevocationHits(lines, item.url, item.listed);
    if (!r.entries) throw new Error(`DPOR release ${item.url}: no revocations read; kept the previous load`);
    read++;
    for (const hit of r.hits) {
      const key = `${hit.id}|${hit.licenseNumber}|${hit.name}`;
      if (seen.has(key)) continue; // the same revocation in a release and its "updated" copy
      seen.add(key);
      yield { kind: "enforcement", hit, business: hit.name, person: null, keys: { licenses: [hit.licenseNumber ?? null] } };
    }
  }
  if (!read) throw new Error("DPOR News Releases: no contractor revocation release read; kept the previous load");
}

const BULK: BulkSource[] = [
  { id: "va-dpor-contractors", state: "VA", label: CONTRACTORS, pageUrl: DPOR_PAGE, everyHours: 24, minRows: 60_000, load: dporLoader(CONTRACTOR_LISTS, CONTRACTORS), legacyHolder: vaLegacyHolder(CONTRACTOR_LISTS) },
  { id: "va-dpor-apelscidla", state: "VA", label: APELSCIDLA, pageUrl: DPOR_PAGE, everyHours: 24 * 7, minRows: 32_000, load: dporLoader(APELSCIDLA_LISTS, APELSCIDLA), legacyHolder: vaLegacyHolder(APELSCIDLA_LISTS) },
  { id: "va-dpor-alhi", state: "VA", label: ALHI, pageUrl: DPOR_PAGE, everyHours: 24 * 7, minRows: 800, load: dporLoader(ALHI_LISTS, ALHI), legacyHolder: vaLegacyHolder(ALHI_LISTS) },
  { id: "va-dpor-revocations", state: "VA", label: VA_REVOCATIONS, pageUrl: DPOR_NEWS, everyHours: 24 * 7, minRows: 217, load: vaRevocationLoader,
    companiesOnly: true, category: "discipline" },
];

// ── SCC business entities (data.virginia.gov) ────────────────────────────────────────────────────────────────
const CKAN = "https://data.virginia.gov/api/3/action/datastore_search";
const SCC_DATASETS: { resource: string; page: string; kind: string; loaded: string }[] = [
  { resource: "9d79f14f-86cd-4ce2-b2da-2df005958e0d", page: "https://data.virginia.gov/dataset/corporation", kind: "Corporation", loaded: "2024-11-14" },
  { resource: "6d55efe1-1784-414a-a38e-ce1f6b4be5fe", page: "https://data.virginia.gov/dataset/llc-limited-liability-company", kind: "LLC", loaded: "2026-03-24" },
];
/** SCC status reasons that say the entity lost its existence or good standing for a filing or fee failure, or by court order. */
const SCC_ADVERSE = /^(automatically|auto) (revoked|terminated|canceled)|not in good st|by court order/i;

export function sccHit(r: Record<string, unknown>, ds: (typeof SCC_DATASETS)[number]): EnforcementHit {
  const s = (v: unknown) => clean(v == null ? null : String(v));
  const status = s(r.Status), reason = s(r.StatusReason);
  return {
    state: "VA", source: "Virginia SCC business entity status (open data)", sourceUrl: ds.page, category: "business_status",
    name: s(r.Name), id: s(r.EntityID), date: anySccDate(r.IncorpDate),
    endDate: status && /^INACTIVE/.test(status) ? anySccDate(r["Status Date"]) : null,
    status: `${ds.kind}: ${[status, reason && reason.toUpperCase() !== status ? reason : null].filter(Boolean).join(", ") || "status not given"}`,
    city: [s(r.City), s(r.State)].filter(Boolean).join(", ") || null,
    address: [s(r.Street1), s(r.Street2), s(r.City), [s(r.State), s(r.Zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    detail: [s(r["RA-Name"]) ? `Registered agent ${s(r["RA-Name"])}` : null, s(r.IncorpState) ? `Formed in ${s(r.IncorpState)}` : null, anySccDate(r["Status Date"]) ? `status date ${anySccDate(r["Status Date"])}` : null,
      `SCC open-data copy loaded ${ds.loaded}`].filter(Boolean).join("; "),
    amount: null, adverse: reason && SCC_ADVERSE.test(reason) ? true : null,
  };
}
const anySccDate = (v: unknown): string | null => {
  const t = clean(v == null ? null : String(v)) ?? "";
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] === "9999" ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  return usDate(t);
};

async function searchScc(name: string): Promise<EnforcementHit[]> {
  const out: EnforcementHit[] = [];
  const notes: string[] = [];
  for (const ds of SCC_DATASETS) {
    const q = new URL(CKAN);
    q.searchParams.set("resource_id", ds.resource);
    q.searchParams.set("q", JSON.stringify({ Name: name }));
    q.searchParams.set("limit", "100");
    const res = await politeFetch(q.toString(), { headers: { accept: "application/json" } }, { minDelayMs: 1500 });
    if (!res.ok) throw new Error(`data.virginia.gov returned HTTP ${res.status}`);
    const body = await res.json() as { success?: boolean; result?: { records?: Record<string, unknown>[]; total?: number } };
    if (!body.success || !Array.isArray(body.result?.records)) throw new Error("data.virginia.gov returned an unexpected payload");
    for (const r of body.result!.records!) if (hasAllWords(name, String(r.Name ?? ""))) out.push(sccHit(r, ds));
    const total = Number(body.result!.total);
    if (Number.isFinite(total) && total > body.result!.records!.length) notes.push(`${ds.kind} file: ${capNote(body.result!.records!.length, total, "entities matching the words")}`);
  }
  return withNote(out, notes.join("; ") || null);
}

// ── eVA Inactive Vendor List: debarred and enjoined (DGS) ────────────────────────────────────────────────────
/** Linked as "eVA Inactive Vendor List" from dgs.virginia.gov/engineering-and-buildings/resources/debarment-enjoinment. */
export const EVA_REPORT = "https://logi.cgieva.com/External/rdPage.aspx?rdReport=Public.Reports.Report9020_Data";
/**
 * The two statuses that are exclusions, with the option values of the report's "eVA Status" list and DGS's own
 * definitions (dgs.virginia.gov/procurement/resources/eva-vendor-statuses). Bad Address, Discontinued and Non Payment
 * are account states, not sanctions, and are not loaded.
 */
export const EVA_STATUSES = [
  { value: "deb", label: "Debarred", meaning: "excluded from contracting with state agencies for particular types of goods or non-professional services for a specified period" },
  { value: "enj", label: "Enjoined", meaning: "excluded from contracting with state agencies for construction for a specified period" },
] as const;
export const evaStatusUrl = (value: string) =>
  `${EVA_REPORT}&rdAgReset=True&txtSearch=&chkStartWith=0&txtOthers=&rbQueryType=2&selVendorStatus=${value}&LinkHref=True`;

export type EvaRow = { status: string; entered: string | null; evaId: string | null; name: string; street: string | null; city: string | null; st: string | null; zip: string | null };

/**
 * The report's rows (each cell is a span with a per-row id: lblSTATUS_Row1, lblLGL_NM_Row1, …). "No data found" is an
 * empty list; a page with neither rows nor that message, or with a second page, is an error (never a partial list).
 */
export function parseEvaReport(html: string): EvaRow[] {
  if (!/eVA Inactive Vendor List/.test(html) || !/id="colLGL_NM-TH"/.test(html)) throw new Error("eVA Inactive Vendor List: unexpected page");
  const pages = Number(html.match(/id="dtAnalysisGrid-PageOfPages"[^>]*>\s*(\d+)\s*</)?.[1] ?? "1");
  if (pages > 1) throw new Error(`eVA Inactive Vendor List: ${pages} pages; only one page is read`);
  const cell = (id: string, n: string) => {
    const m = html.match(new RegExp(`id="${id}_Row${n}"[^>]*>([\\s\\S]*?)</(?:SPAN|span)>`));
    return m ? clean(htmlText(m[1].replace(/<font[^>]*>|<\/font>/gi, ""))) : null;
  };
  const rows = Array.from(html.matchAll(/id="lblSTATUS_Row(\d+)"/g)).map((m) => m[1]);
  if (!rows.length && !/No data found/.test(html)) throw new Error("eVA Inactive Vendor List: no rows and no \"No data found\"");
  const out: EvaRow[] = [];
  for (const n of rows) {
    const name = cell("lblLGL_NM", n), status = cell("lblSTATUS", n);
    if (!name || !status) continue;
    out.push({ status, entered: cell("lblREG_TYPE", n), evaId: cell("lblVEND_CUST_CD", n), name, street: cell("lblSTR_1_NM", n), city: cell("lblCITY_NM", n), st: cell("lblST", n), zip: cell("lblZIP", n) });
  }
  return out;
}

/** Companies only (FCRA): a vendor listed under a person's name ("David Horton") is left out. */
export const evaBusinesses = (rows: EvaRow[]) => rows.filter((r) => personNameForm(r.name) === null && looksLikeBusiness(r.name));

/** One row as a report hit. The report publishes no debarment dates or periods. */
export function evaHit(r: EvaRow, st: (typeof EVA_STATUSES)[number]): EnforcementHit {
  return {
    state: "VA", source: "Virginia eVA Inactive Vendor List (debarred and enjoined vendors)", sourceUrl: EVA_REPORT, category: "debarment",
    name: r.name, id: r.evaId ? `eVA ID ${r.evaId}` : null, date: null, endDate: null,
    status: `eVA status: ${r.status} (${st.meaning}, per DGS)`,
    city: [r.city, r.st].filter(Boolean).join(", ") || null,
    address: [r.street, r.city, [r.st, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    detail: r.entered ? `Status entry as published: ${r.entered}` : null,
    amount: null, adverse: adverseFrom(r.status, { adverse: /\bdebarred\b|\benjoined\b/i }),
  };
}

async function* evaLoader(): AsyncIterable<BulkHit> {
  for (const st of EVA_STATUSES) {
    const res = await politeFetch(evaStatusUrl(st.value), {}, { minDelayMs: 3000, timeoutMs: 90_000 });
    if (!res.ok) throw new Error(`eVA Inactive Vendor List (${st.label}) returned HTTP ${res.status}`);
    const rows = parseEvaReport(await res.text());
    // The filter must have held: a row of another status means the report ignored it.
    if (rows.some((r) => r.status.toLowerCase() !== st.label.toLowerCase())) throw new Error(`eVA Inactive Vendor List: the ${st.label} filter returned other statuses`);
    for (const r of evaBusinesses(rows)) {
      const hit = evaHit(r, st);
      yield { kind: "enforcement", hit, business: r.name, person: null, keys: { addresses: [hit.address] } };
    }
  }
}

// The SCC copies are searched through data.virginia.gov's CKAN datastore API. Its robots.txt disallows /api/ and
// /datastore/*; back on by OWNER ORDER 2026-10-15, under which a robots.txt Disallow no longer stops a search (http.ts).
export const SCC_SEARCH: LiveEnforcementSearch = { source: "Virginia SCC business entity status (open data)", scope: "Corporations (copy of 2024-11-14) and LLCs (copy of 2026-03-24, first 1,048,575 rows)", category: "business_status", search: searchScc };
const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [SCC_SEARCH];

export const pack: StatePack = {
  state: "VA",
  checked: "2026-10-15",
  bulk: [
    ...BULK,
    // OWNER ORDER 2026-10-15: logi.cgieva.com's robots.txt ("Disallow: /") no longer stops a search (http.ts). On
    // 2026-10-15: 49 debarred vendors (38 under a business name), no enjoined ones.
    { id: "va-eva-debarred", state: "VA", label: "Virginia eVA Inactive Vendor List (debarred and enjoined vendors)", pageUrl: EVA_REPORT,
      everyHours: 24 * 7, minRows: 20, load: evaLoader, companiesOnly: true, category: "debarment" },
  ],
  liveEnforcement: LIVE_ENFORCEMENT,
  blocked: [
    "DPOR License Lookup (dporweb.dpor.virginia.gov/LicenseLookup), which also carries board orders: reCAPTCHA on the search",
    "DPOR disciplinary orders: no list or download; published only per licensee in the CAPTCHA lookup and in board minutes on Town Hall (PDF). Revocations are loaded from the News Releases page (va-dpor-revocations)",
    "Board for Contractors consent orders and fines in Town Hall meeting minutes (townhall.virginia.gov/L/meetings.cfm?BoardID=10): checked 2026-10-15, not built. The final minutes (v2 and later, e.g. Minutes_DPOR_39828_v2.pdf for April 28, 2026, 64 pages, and Minutes_DPOR_38882_v3.pdf for October 7, 2025) are scanned page images (PaperStream Capture, no text layer: pdftotext gives nothing), so reading them would mean OCR. Only the v1 drafts have text (Minutes_DPOR_40744_v1.pdf, August 25, 2026), and they are marked DRAFT (the watermark's letters are interleaved with the text), set in two columns with margin labels, and each case paragraph quotes the respondent's earlier consent orders and fines next to the new sanctions (per-count fines, a total, Recovery Fund payments to consumer claimants): respondent, outcome and amount can't be read reliably from them",
    "SCC Clerk's Information System bulk data: paid subscription ($1,000/month per the SCC page); only the dated open-data copies are used",
    "data.virginia.gov SCC Lien Details: no debtor names, only filing numbers",
  ],
};
