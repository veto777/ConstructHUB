/**
 * The bulk-file sources (./bulk.ts) by state. Each one was opened and parsed live on 2026-10-14: file URLs, column
 * layouts and status codes are the publishers' own (CLAUDE.md: never fabricate government data). A row a source
 * can't name is skipped, never guessed.
 *
 *   FL  DBPR construction (CILB) and electrical (ECLB) licensees, daily extracts, with every qualifier and financially
 *       responsible officer on the business they qualify (joined by the DBA name), and the licensee address
 *   FL  DBPR license applicants (construction and electrical), with address and phone          (added 2026-10-15)
 *   FL  Sunbiz corporate filings of the businesses DBPR licenses: officers, registered agent,   (added 2026-10-15)
 *       principal and mailing address (the quarterly file, streamed and filtered)
 *   FL  DBPR public complaints (licensed and unlicensed activity, construction + electrical), 2010 to today, merged
 *       with CILB's licensed-contractor and recovery-fund discipline files (license number, discipline lines)
 *   FL  DFS Workers' Comp stop-work orders, 2004 to today (one full pull of the public query form a day)
 *   FL  Sunbiz federal tax liens against corporations and partnerships (the state's public SFTP), with debtor address
 *   TX  TSBPE plumbing licensee lists (daily), with address and phone where the list has them
 *   CA  CSLB license master + personnel (daily), with suspensions and disciplinary bonds as enforcement; every officer,
 *       RMO, RME, member and partner on each license; business address and phone
 *   CA  CSLB monthly lists of revoked licenses, 2020 to today (PDF, read by a small text reader)  (added 2026-10-15)
 *   CA  DCA licensees: engineers/surveyors/geologists, architects, landscape architects, structural pest control
 *   CA  DIR certified electricians and electrician trainees
 *   CA  DIR Labor Commissioner public-works debarments
 *   WA  L&I contractors not allowed to bid on public works (debarments), and public-works strikes   (added 2026-10-15)
 *
 * Every license and enforcement row carries its identifier keys (license numbers, phones, street addresses;
 * ./identifiers.ts) where the file publishes them, and its people with the publisher's roles (re-checked 2026-10-15).
 */
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { USER_AGENT, rateLimitHost } from "../scrapers/polite-fetch";
import { clean, csvRecords, csvRows, download, lines, plainRequest, saveResponse, usDate, type BulkHit, type BulkSource } from "./bulk";
import type { IdKeys } from "./identifiers";

const run = promisify(execFile);

async function* fromFile<T>(path: string, fn: (p: string) => AsyncIterable<T>): AsyncIterable<T> {
  try { yield* fn(path); } finally { await fs.rm(path, { force: true }); }
}

/** The single member of a zip, extracted to a temp file (Info-ZIP reads Deflate64, which Sunbiz uses). */
async function unzipTo(zip: string, member?: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "ch-unzip-"));
  try {
    await run("unzip", ["-q", "-o", zip, ...(member ? [member] : []), "-d", dir], { maxBuffer: 1 << 20 });
    const files = await fs.readdir(dir);
    if (!files.length) throw new Error("empty zip");
    const out = join(tmpdir(), `ch-bulk-${Date.now()}-${files[0]}`);
    await fs.rename(join(dir, files[0]), out);
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(zip, { force: true });
  }
}

const person = (last: string | null, first: string | null, middle?: string | null, suffix?: string | null) =>
  clean([first, middle, last, suffix].filter(Boolean).join(" "));
/** "LAST, FIRST M" → "FIRST M LAST". */
const flipName = (v: string | null) => {
  const m = v?.match(/^([^,]+),\s*(.+)$/);
  return m ? clean(`${m[2]} ${m[1]}`) : clean(v);
};
type Person = { name: string; role: string | null };
type Extra = { people?: Person[]; keys?: IdKeys };
/** A license row: its people go on the hit (with roles) and into the person index; its keys into the identifier index. */
const lic = (h: Omit<LicenseHit, "matchedOn">, business: string | null, personName: string | null, x: Extra = {}): BulkHit =>
  ({ kind: "license", hit: { ...h, matchedOn: business ? "business" : "principal", ...(x.people?.length ? { people: x.people } : {}) }, business, person: personName, ...(x.people?.length ? { people: x.people.map((p) => p.name) } : {}), ...(x.keys ? { keys: x.keys } : {}) });
const enf = (h: EnforcementHit, business: string | null, keys?: IdKeys): BulkHit => ({ kind: "enforcement", hit: h, business, person: null, ...(keys ? { keys } : {}) });

/** Street lines, then "CITY ST ZIP": the display address. Lines that are only the city again are dropped. */
/** "330683353" → "33068-3353" (fixed-width files drop the dash, which hides the ZIP from ./identifiers.ts). */
const zip5 = (v: string | null) => { const t = clean(v); return t && /^\d{9}$/.test(t) ? `${t.slice(0, 5)}-${t.slice(5)}` : t; };

function joinAddress(lines: (string | null | undefined)[], city: string | null, state: string | null, rawZip: string | null): string | null {
  const zip = zip5(rawZip);
  const street = lines.map((l) => clean(l)).filter((l): l is string => !!l && l.toUpperCase() !== (city ?? "").toUpperCase());
  if (!street.length) return null;
  return [street.join(" "), [city, state, zip].map((v) => clean(v)).filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
/** Each street line that starts with a house number or is a PO box, with the city/state/ZIP: one index key per real address. */
function addressKeysOf(lines: (string | null | undefined)[], city: string | null, state: string | null, zip: string | null): string[] {
  const tail = [city, state, zip5(zip)].map((v) => clean(v)).filter(Boolean).join(" ");
  return lines.map((l) => clean(l)).filter((l): l is string => !!l && (/^\d+[A-Z]?(-\d+)?\s+[A-Z0-9]/i.test(l) || /\bP\.?\s?O\.?\s?BOX\b|^BOX\s+\d/i.test(l)))
    .map((l) => `${l} ${tail}`.trim());
}
const nameKey = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9&]+/g, " ").replace(/\s+/g, " ").trim();

// ── Florida DBPR licensee extracts ───────────────────────────────────────────────────────────────────────────
const FL_CILB_PAGE = "https://www2.myfloridalicense.com/construction-industry/public-records/";
const FL_ECLB_PAGE = "https://www2.myfloridalicense.com/electrical-contractors/public-records/";
const FL_CILB_FILE = "https://www2.myfloridalicense.com/sto/file_download/extracts//CONSTRUCTIONLICENSE_1.csv";
const FL_ECLB_FILE = "https://www2.myfloridalicense.com/sto/file_download/extracts/lic08el.csv";

/** Occupation codes of boards 06 (construction) and 08 (electrical), from DBPR's "Understanding DBPR Codes" (checked 2026-10-15). */
const FL_OCCUPATIONS: Record<string, string> = {
  CAC: "Certified Air Conditioning Contractor", CBC: "Certified Building Contractor", CCC: "Certified Roofing Contractor",
  CFC: "Certified Plumbing Contractor", CGC: "Certified General Contractor", CMC: "Certified Mechanical Contractor",
  CPC: "Certified Pool/Spa Contractor", CRC: "Certified Residential Contractor", CSC: "Certified Sheet Metal Contractor",
  CUC: "Certified Utility & Excavation Contractor", CVC: "Certified Solar Contractor", SCC: "Certified Specialty Contractor",
  PCC: "Certified Pollutant Storage Contractor", RA: "Registered Air Conditioning Contractor", RB: "Registered Building Contractor",
  RC: "Registered Roofing Contractor", RF: "Registered Plumbing Contractor", RG: "Registered General Contractor",
  RL: "Registered Tank Lining Applicator", RM: "Registered Mechanical Contractor", RP: "Registered Pool/Spa Contractor",
  RQ: "Registered Precision Tank Tester", RR: "Registered Residential Contractor", RS: "Registered Sheet Metal Contractor",
  RU: "Registered Underground Utility Excavator", RX: "Registered Specialty Contractor", QB: "Construction Business Information",
  FRO: "Financial Responsible Officer", RV: "Registered Solar Contractor",
  EC: "Electrical Contractor", EF: "Certified Alarm System Contractor I", EG: "Certified Alarm System Contractor II",
  ES: "Certified Specialty Contractor", ER: "Registered Electrical Contractor", EY: "Registered Alarm System Contractor I",
  EZ: "Registered Alarm System Contractor II", ET: "Registered Specialty Contractor", EH: "Registered Alarm System Contractor EH",
  EI: "Registered Alarm System Contractor EI", EJ: "Registered Residential Alarm System Cont", QC: "Qualified Business Organization",
};
/** Class codes by occupation (same page; classes are listed per occupation number, e.g. 0612 SCC). */
const FL_CLASSES: Record<string, Record<string, string>> = {
  CAC: { A: "Class A", B: "Class B", C: "Air Conditioning Service" }, RA: { A: "Class A", B: "Class B", C: "Air Conditioning Service" },
  CGC: { LIM1: "Limited to Communications Structures" },
  CPC: { A: "Commercial Pool/Spa Contractor", B: "Residential Pool/Spa Contractor", C: "Pool/Spa Contractor Service" },
  RP: { A: "Commercial Pool/Spa Contractor", B: "Residential Pool/Spa Contractor", C: "Pool/Spa Contractor Service" },
  SCC: {
    CKC: "Gypsum Drywall", CSS: "Specialty Structure", CWC: "Residential Solar Water Heater", CYC: "Traditional Thatched Structure",
    CZC: "Gas Line Specialty", DEM: "Demolition Specialty Contractor", GD: "Garage Door Installation Contractor", GLZ: "Glass & Glazing Specialty",
    IFC: "Industrial Facilities Specialty Contractor", IS: "Irrigation Specialty Contractor", MBD: "Marine Bulkhead Work Contractor",
    MDW: "Marine Dock Work Contractor", MPD: "Marine Pile Driving Contractor", MRN: "Marine Specialty Contractor", MSW: "Marine Seawall Work Contractor",
    PDC: "Swimming Pool Decking Specialty Contract", PEC: "Swimming Pool Excavation Specialty Contractor", PFC: "Swimming Pool Finishes Specialty Contractor",
    PLC: "Swimming Pool Layout Specialty Contractor", PLL: "Plaster and Lath Specialty Contractor", PPC: "Swimming Pool Piping Specialty Contractor",
    PSC: "Swimming Pool Structural Specialty Contractor", PTC: "Swimming Pool Trim Specialty Contractor", RFS: "Rooftop Solar Heating Insulation Contractor",
    RPS: "Residential Pool/Spa Servicing Contractor", SAS: "Structural Aluminum or Screen Enclosures Contractor",
    SCW: "Structural Prestressed Precast Concrete Contractor", SCY: "Structural Carpentry Specialty Contractor", SM: "Structural Masonry Specialty Contractor",
    STS: "Structural Steel Work Contractor", TWR: "Tower Specialty Contractor", WDI: "Window and Door Installation Contractor",
  },
  RX: { CZC: "Gas Line Specialty", DRWL: "Dry Wall Contractor", LR: "Limited Non-Renewable", SOLR: "Solar Energy Contractor", STRC: "Structure" },
  ...Object.fromEntries(["RB", "RC", "RF", "RG", "RL", "RM", "RQ", "RR", "RS", "RU"].map((k) => [k, { LR: "Limited Non-Renewable" }])),
  ...Object.fromEntries(["ES", "ET"].map((k) => [k, {
    ENRG: "Limited Energy Systems Specialty", LGHT: "Lighting Maintenance Specialty", RESD: "Residential Specialty", SIGN: "Sign Specialty",
    UTIL: "Utility Line Specialty", TWRC: "Two-Way Radio Communications",
  }])),
};
const flOccupation = (occ: string) => FL_OCCUPATIONS[occ] ?? `occupation code ${occ}`;
const flClass = (occ: string, cls: string | null) => (cls ? FL_CLASSES[occ]?.[cls] ?? `class code ${cls}` : null);
const FL_PRIMARY: Record<string, string> = { C: "Current", P: "Probation", S: "Suspended" };
const FL_SECONDARY: Record<string, string> = { A: "Active", I: "Inactive" };

/**
 * One row of a DBPR licensee extract, by the published layout ("File Layout Information" on the public-records page,
 * checked 2026-10-15): Board, Occupation Code, Licensee Name, Doing Business As Name, Class Code, Address Line 1–3,
 * City, State, Zip, County Code, License Number, Primary Status, Secondary Status, Original Licensure Date, Effective
 * Date, Expiration Date, Blank, Renewal Period, Alternate Lic#. No phone is published.
 */
type FlRow = { occ: string; name: string | null; dba: string | null; isBusiness: boolean; number: string | null; full: string | null; lines: string[]; city: string | null; state: string | null; zip: string | null };
function flRow(r: string[]): FlRow | null {
  if (r.length < 21) return null;
  const occ = r[1].trim();
  if (/^(PVDR|CRS\d*)$/.test(occ)) return null; // course providers and courses
  return {
    occ, name: clean(r[2]), dba: /^INDIVIDUAL$/i.test(r[3].trim()) ? null : clean(r[3]), isBusiness: occ === "QB",
    number: clean(r[12]), full: clean(r[20]) ?? clean(r[12]), lines: [r[5], r[6], r[7]], city: clean(r[8]), state: clean(r[9]), zip: clean(r[10]),
  };
}

/** Each licensed individual's role on the business named in their DBA column (a qualifier, or the financially responsible officer). */
const flRole = (row: FlRow) => row.occ === "FRO" ? `Financial Responsible Officer${row.full ? ` (${row.full})` : ""}` : `Qualifier, ${flOccupation(row.occ)}${row.full ? ` ${row.full}` : ""}`;

/** Qualifiers and financially responsible officers by business name, from one or more extracts (DBPR links them only by that name). */
export async function flQualifiers(paths: string[]): Promise<Map<string, Person[]>> {
  const out = new Map<string, Person[]>();
  for (const path of paths) for await (const r of csvRows(path)) {
    const row = flRow(r);
    if (!row || row.isBusiness || !row.dba || !row.name) continue;
    const k = nameKey(row.dba);
    (out.get(k) ?? out.set(k, []).get(k)!).push({ name: flipName(row.name)!, role: flRole(row) });
  }
  return out;
}

export async function* flLicenseRows(path: string, label: string, page: string, qualifiers: Map<string, Person[]>): AsyncIterable<BulkHit> {
  for await (const r of csvRows(path)) {
    const row = flRow(r);
    if (!row) continue;
    const status = [FL_PRIMARY[r[13].trim()] ?? clean(r[13]), FL_SECONDARY[r[14].trim()] ?? clean(r[14])].filter(Boolean).join(", ") || null;
    const business = row.isBusiness ? row.name : row.dba;
    // A business license carries everyone DBPR lists under its name; an individual's license carries that individual.
    const people = row.isBusiness ? qualifiers.get(nameKey(row.name)) ?? (row.dba ? qualifiers.get(nameKey(row.dba)) : null) ?? [] : row.name ? [{ name: flipName(row.name)!, role: flRole(row) }] : [];
    const hit = {
      state: "FL", source: label, sourceUrl: page,
      businessName: business, licenseNumber: row.full,
      licenseType: flOccupation(row.occ), specialty: flClass(row.occ, clean(r[4])), status,
      principal: row.isBusiness ? null : flipName(row.name), city: row.city, expires: usDate(r[17]),
      address: joinAddress(row.lines, row.city, row.state, row.zip), phone: null,
    };
    yield lic(hit, row.isBusiness ? [row.name, row.dba].filter(Boolean).join(" ") || null : row.dba, row.isBusiness ? null : row.name, {
      people, keys: { licenses: [row.full], addresses: addressKeysOf(row.lines, row.city, row.state, row.zip) },
    });
  }
}

function flLicenseLoader(url: string, label: string, page: string): () => AsyncIterable<BulkHit> {
  return async function* () {
    const path = await download(url);
    try { yield* flLicenseRows(path, label, page, await flQualifiers([path])); }
    finally { await fs.rm(path, { force: true }); }
  };
}

/**
 * DBPR applicant lists (construction and electrical): people with an application on file, by the published layout
 * (Occupation Number, Occupation Description, First, Second and Last Name, Suffix, Address 1–2, City, State, Zip,
 * Phone Number, Phone Number Extension). The rows carry two more columns than the layout names (a blank third address
 * line after Address 2 and a two-digit county code before the phone); those two are not used. An applicant is not a
 * licensee: the status says so.
 */
const FL_APPLICANT_FILES: { url: string; page: string }[] = [
  { url: "https://www2.myfloridalicense.com/sto/file_download/extracts/constr_app.csv", page: FL_CILB_PAGE },
  { url: "https://www2.myfloridalicense.com/sto/file_download/extracts/elec_app.csv", page: FL_ECLB_PAGE },
];

export async function* flApplicantRows(path: string, page: string): AsyncIterable<BulkHit> {
  for await (const r of csvRows(path)) {
    if (r.length < 14 || !/^\d{4}$/.test(r[0].trim())) continue;
    const who = person(clean(r[4]), clean(r[2]), clean(r[3]), clean(r[5]));
    if (!who) continue;
    const city = clean(r[9]), st = clean(r[10]), zip = clean(r[11]), phone = clean(r[13]);
    yield lic({
      state: "FL", source: "Florida DBPR license applicants (construction and electrical)", sourceUrl: page,
      businessName: null, licenseNumber: null, licenseType: clean(r[1]), specialty: null,
      status: "Applicant: an application is on file with DBPR (not a license)", principal: who, city, expires: null,
      address: joinAddress([r[6], r[7]], city, st, zip), phone,
    }, null, who, { people: [{ name: who, role: "Applicant" }], keys: { phones: [phone], addresses: addressKeysOf([r[6], r[7]], city, st, zip) } });
  }
}

async function* flApplicantsLoader(): AsyncIterable<BulkHit> {
  for (const f of FL_APPLICANT_FILES) yield* fromFile(await download(f.url), (p) => flApplicantRows(p, f.page));
}

// ── Florida DBPR public complaints and CILB discipline ───────────────────────────────────────────────────────
const FL_COMPLAINTS_PAGE = "https://www2.myfloridalicense.com/unlicensed-activity-public-records/";
const FL_COMPLAINT_FILES = [
  "https://www2.myfloridalicense.com/sto/file_download/extracts/unlicensed_2021_current.csv",
  "https://www2.myfloridalicense.com/sto/file_download/extracts/unlicensed_2010_current.csv",
];
const FL_ADVERSE = /final order|citation filed|cease (&|and) desist|rf claim granted|revok|suspen/i;
const FL_NOT_ADVERSE = /no violation|insufficient evidence|duplicate|no jurisdiction|withdrawn|closed.*no action|no probable cause/i;

/**
 * CILB's "Licensed Contractor Discipline" and "Recovery Fund Contractor Discipline" files (public-records page,
 * one per fiscal year, checked 2026-10-15): one row per discipline line, with the license type and number the case
 * is on. Most of their complaint numbers are also in the complaint extracts; they add the license number and the
 * cases the extracts don't have. (The "ULA" files repeat the unlicensed-activity extracts, so they aren't read.)
 */
const FL_DISCIPLINE_YEARS = ["2526", "2425", "2324", "2223", "2122"];
const FL_DISCIPLINE_FILES = FL_DISCIPLINE_YEARS.flatMap((y) => [
  `https://www2.myfloridalicense.com/pro/cilb/reports/contractor_disc_lic_${y}.csv`,
  `https://www2.myfloridalicense.com/pro/cilb/reports/contractor_disc_rf_${y}.csv`,
]);

type FlCase = { id: string; licType: string | null; licNo: string | null; name: string; dbas: string[]; lines: string[]; city: string | null; state: string | null; zip: string | null; county: string | null; classification: string | null; entered: string | null; disposition: string | null; dispDate: string | null; discipline: string[]; violations: string[] };

/** Discipline cases by complaint (or claim) number. */
export async function flDisciplineCases(paths: string[]): Promise<Map<string, FlCase>> {
  const cases = new Map<string, FlCase>();
  for (const path of paths) for await (const r of csvRecords(path)) {
    const id = clean(r["Complaint Nbr"] ?? r["Claim Nbr"]), name = clean(r["Respondent Name"]);
    if (!id || !name) continue;
    const lines = [r["Address Line 1"], r["Address Line 2"], r["Address Line 3"]];
    const c = cases.get(id) ?? {
      id, licType: clean(r["License Type"]), licNo: clean(r["License Nbr"]), name,
      dbas: lines.map((l) => clean(l)?.match(/^DBA:?\s*(.+)$/i)?.[1] ?? null).filter((v): v is string => !!v),
      lines: lines.filter((l) => !/^\s*DBA\b/i.test(l ?? "")), city: clean(r.City), state: clean(r.State), zip: clean(r["ZIP Code"]), county: clean(r.County),
      classification: clean(r.Classification), entered: usDate(r["Entered Date"]), disposition: clean(r.Disposition), dispDate: usDate(r["Disposition Date"]),
      discipline: [], violations: [],
    };
    const d = clean(r["Discipline Date - Description"]?.replace(/^(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(.+)$/, (_, dt, what) => `${what.trim()} on ${usDate(dt)}`));
    if (d && !c.discipline.includes(d)) c.discipline.push(d);
    const v = clean(r["Violation Code"]);
    if (v && !c.violations.includes(v)) c.violations.push(v);
    cases.set(id, c);
  }
  return cases;
}

/** "Certified General Contractor" + "1512345" → the licensee extract's own number (CGC1512345), when the extract has it. */
export async function flLicenseIndex(paths: string[]): Promise<Map<string, string>> {
  const byType = Object.fromEntries(Object.entries(FL_OCCUPATIONS).map(([k, v]) => [k, v.toUpperCase()]));
  const out = new Map<string, string>();
  for (const path of paths) for await (const r of csvRows(path)) {
    const row = flRow(r);
    if (!row?.number || !row.full || !byType[row.occ]) continue;
    out.set(`${byType[row.occ]}|${Number(row.number)}`, row.full);
  }
  return out;
}
const fullLicense = (idx: Map<string, string>, type: string | null, no: string | null) => (type && no && /^\d+$/.test(no) ? idx.get(`${type.toUpperCase()}|${Number(no)}`) ?? null : null);

const caseAdverse = (disposition: string | null, discipline: string[]) =>
  disposition ? (FL_ADVERSE.test(disposition) ? true : FL_NOT_ADVERSE.test(disposition) ? false : null)
    : discipline.some((d) => /citation|fine|revok|suspen|cease/i.test(d)) ? true : null;

export async function* flComplaintRows(complaintPaths: string[], cases: Map<string, FlCase>, licenses: Map<string, string>): AsyncIterable<BulkHit> {
  const seen = new Set<string>();
  // Complaint extracts, by the published layout: Profession, Respondent Name, County Name, Street Address, Address
  // Line 2, Address Line 3, City, State Code, Zip Code, Profession, Complaint Number, Complaint Class, Entered Date,
  // Disposition, Disposition Date, Discipline List.
  for (const path of complaintPaths) for await (const r of csvRows(path)) {
    if (r.length < 15 || !/^0[68]/.test(r[0])) continue; // construction (06xx) and electrical (08xx) only
    const name = clean(r[1]);
    if (!name) continue;
    // DBPR puts DBA names in the address lines; a line with no digits is a name, not a street.
    const addrLines = [r[3], r[4], r[5]];
    const dbas = addrLines.map(clean).filter((v): v is string => !!v && !/\d/.test(v)).map((v) => v.replace(/^DBA:?\s*/i, ""));
    const street = addrLines.filter((l) => /\d/.test(l ?? ""));
    const id = clean(r[10]);
    const c = id ? cases.get(id) : undefined;
    if (id) seen.add(id);
    const disposition = clean(r[13]);
    const discipline = clean(r[15]?.replace(/;$/, "").replace(/;/g, "; ").replace(/,/g, " on "));
    const licenseNumber = c ? fullLicense(licenses, c.licType, c.licNo) ?? c.licNo : null;
    const city = clean(r[6]), st = clean(r[7]), zip = clean(r[8]);
    yield enf({
      state: "FL", source: "Florida DBPR complaints and discipline (construction and electrical)", sourceUrl: FL_COMPLAINTS_PAGE,
      category: "complaint", name: [name, ...dbas].join(" / "), id, date: usDate(r[12]), endDate: usDate(r[14]),
      status: disposition, city,
      detail: [clean(r[11]), clean(r[9]), discipline ? `Discipline: ${discipline}` : null, c?.licType && c.licNo ? `On ${c.licType} license ${licenseNumber}` : null].filter(Boolean).join(". ") || null,
      amount: null, adverse: disposition ? (FL_ADVERSE.test(disposition) ? true : FL_NOT_ADVERSE.test(disposition) ? false : null) : null,
      address: joinAddress(street, city, st, zip), licenseNumber,
    }, [name, ...dbas].join(" "), { licenses: [licenseNumber], addresses: addressKeysOf(street, city, st, zip) });
  }
  // Discipline cases the complaint extracts don't list.
  for (const c of Array.from(cases.values())) {
    if (seen.has(c.id)) continue;
    const licenseNumber = fullLicense(licenses, c.licType, c.licNo) ?? c.licNo;
    yield enf({
      state: "FL", source: "Florida DBPR complaints and discipline (construction and electrical)", sourceUrl: FL_CILB_PAGE,
      category: "discipline", name: [c.name, ...c.dbas].join(" / "), id: c.id, date: c.entered, endDate: c.dispDate, status: c.disposition,
      city: [c.city, c.county ? `${c.county} County` : null].filter(Boolean).join(", ") || null,
      detail: [c.classification, c.licType && c.licNo ? `On ${c.licType} license ${licenseNumber}` : c.licType,
        c.discipline.length ? `Discipline: ${c.discipline.join("; ")}` : null, c.violations.length ? `Violation code ${c.violations.join(", ")}` : null].filter(Boolean).join(". ") || null,
      amount: null, adverse: caseAdverse(c.disposition, c.discipline),
      address: joinAddress(c.lines, c.city, c.state, c.zip), licenseNumber,
    }, [c.name, ...c.dbas].join(" "), { licenses: [licenseNumber], addresses: addressKeysOf(c.lines, c.city, c.state, c.zip) });
  }
}

/** Download several files, hand their paths to fn, and delete them afterwards. */
async function withFiles<T>(urls: string[], fn: (paths: string[]) => Promise<T>): Promise<T> {
  const paths: string[] = [];
  try { for (const url of urls) paths.push(await download(url)); return await fn(paths); }
  finally { await Promise.all(paths.map((p) => fs.rm(p, { force: true }))); }
}

async function* flComplaintsLoader(): AsyncIterable<BulkHit> {
  const cases = await withFiles(FL_DISCIPLINE_FILES, flDisciplineCases);
  const licenses = await withFiles([FL_CILB_FILE, FL_ECLB_FILE], flLicenseIndex);
  const paths: string[] = [];
  try {
    for (const url of FL_COMPLAINT_FILES) paths.push(await download(url));
    yield* flComplaintRows(paths, cases, licenses);
  } finally {
    await Promise.all(paths.map((p) => fs.rm(p, { force: true })));
  }
}

// ── Florida stop-work orders (DFS Division of Workers' Compensation) ─────────────────────────────────────────
const FL_SWO = "https://dwcdataportal.fldfs.com/SWOquery.aspx";

/** Hidden + text inputs and selected options of an ASP.NET form, as the browser would post them. */
function formFields(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const m of Array.from(html.matchAll(/<input[^>]*>/g))) {
    const tag = m[0];
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const type = (tag.match(/type="([^"]+)"/)?.[1] ?? "text").toLowerCase();
    if (!name || !["hidden", "text"].includes(type)) continue;
    form.set(name, decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const m of Array.from(html.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g))) {
    const opt = m[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/) ?? m[2].match(/<option[^>]*value="([^"]*)"/);
    form.set(m[1], opt ? decodeEntities(opt[1]) : "");
  }
  return form;
}

export function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

const cookieOf = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

async function* flStopWorkLoader(): AsyncIterable<BulkHit> {
  await rateLimitHost(FL_SWO, 2000);
  const page = await fetch(FL_SWO, { headers: { "user-agent": USER_AGENT } });
  if (!page.ok) throw new Error(`stop-work query page returned HTTP ${page.status}`);
  const html = await page.text();
  const form = formFields(html);
  form.set("ctl00$ContentPlaceHolder1$txtEmployerName", ""); // blank: every order since 2004
  form.set("ctl00$ContentPlaceHolder1$btnSearch", "Search");
  const path = await download(FL_SWO, {
    method: "POST", body: form.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", referer: FL_SWO, ...(cookieOf(page) ? { cookie: cookieOf(page) } : {}) },
  });
  try {
    const body = await fs.readFile(path, "utf8");
    const span = (row: string, field: string) => clean(decodeEntities(row.match(new RegExp(`_In_${field}_\\d+"[^>]*>([^<]*)<`))?.[1] ?? ""));
    for (const m of Array.from(body.matchAll(/<tr>\s*<td[\s\S]*?<\/tr>/g))) {
      const row = m[0];
      const name = span(row, "EMP_NAME");
      if (!name) continue;
      const ended = span(row, "DateEnded"), reinstated = span(row, "Reinstated");
      const endDate = usDate(ended);
      // "Reinstated": the employer defaulted on its penalty payment agreement and the order is back in force.
      const back = usDate(reinstated);
      const status = back ? `Reinstated ${back} after a defaulted payment agreement` : endDate ? `Ended ${endDate}` : "Not ended";
      yield enf({
        state: "FL", source: "Florida stop-work orders (Division of Workers' Compensation)", sourceUrl: FL_SWO,
        category: "stop_work", name, id: null, date: usDate(span(row, "DateServed")), endDate, status,
        city: [span(row, "City"), span(row, "County")].filter(Boolean).join(", ") || null, detail: span(row, "Reason"), amount: null, adverse: true,
      }, name);
    }
  } finally {
    await fs.rm(path, { force: true });
  }
}

// ── Florida Sunbiz federal tax liens ─────────────────────────────────────────────────────────────────────────
const SUNBIZ_SFTP = "sftp://sftp.floridados.gov/~/doc/quarterly/flr";
const SUNBIZ_PAGE = "https://dos.fl.gov/sunbiz/other-services/data-downloads/";

/** The server's host keys, pinned (ssh-keyscan 2026-10-14): curl's libssh checks them against $HOME/.ssh/known_hosts. */
const SUNBIZ_HOST_KEYS = [
  "sftp.floridados.gov ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIFRdq4ekBu4hkT7QRm+frcyLZFQZplBp63gRcEm0Kwq",
  "sftp.floridados.gov ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCcqcmLnzD8ophR/Ox+GUXEeg/UbNw5ghGtUxKgXz9vLY9z8KFn5e9HtjOeCF9UldrcMn1uece49dYGRqOI2Xo7pDH7B3vTqH9l1QPes8rM7WK4+mpAeV5Isct+VpL6bSJyHd5wOCKWVtszeTTQUdXzDlPR6sJweHWu/4e7z1UiCJtjEYac1nK4H7dX3ZZCJ10SzvMwA/DbHOojEhKTJIwk0RdD/umSM2fa+WSw0Oi+CD9g/lKuFGzEn0OLYj5x7IQrVfcDLIYpBUuBEoDxvpnMx8Cf+SSgOsyZvgSx/70AZO8lzs+PqC2xzn2lKyiFnCYtUuQFb78U8gM7d/UaOe5x",
  "sftp.floridados.gov ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEoTyT4Kp6MNXcKhRwwN5Je/j7HAwtWvhXKT41h0x8l0SWEuPnh0QfhMHXMMhxvAItK5y/CoUZBTeO8aVmGJ/TE=",
].join("\n");

/** Sunbiz's public SFTP login is published on its data-downloads page (it is not a secret). */
async function sunbizFile(file: string): Promise<string> {
  const home = await fs.mkdtemp(join(tmpdir(), "ch-sftp-"));
  const out = join(tmpdir(), `ch-sunbiz-${Date.now()}-${file}`);
  try {
    await fs.mkdir(join(home, ".ssh"), { mode: 0o700 });
    await fs.writeFile(join(home, ".ssh", "known_hosts"), `${SUNBIZ_HOST_KEYS}\n`);
    await run("curl", ["-sS", "--fail", "--max-time", "900", "-u", "Public:PubAccess1845!", "-o", out, `${SUNBIZ_SFTP}/${file}`],
      { maxBuffer: 1 << 20, env: { ...process.env, HOME: home } });
    return out;
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

/** LIEN_DATA_FILING_STATUS, from the Federal Tax Lien File Definitions. */
const LIEN_STATUS: Record<string, string> = { A: "Active", L: "Lapsed", T: "Terminated" };

async function* flTaxLiensLoader(): AsyncIterable<BulkHit> {
  // Filings: document number → filed date, status, expiration.
  const filings = new Map<string, { filed: string | null; status: string | null; expires: string | null }>();
  const ymd = (v: string) => { const m = v.trim().match(/^(\d{2})(\d{2})(\d{4})$/); return m && +m[3] >= 1990 && +m[3] <= 2100 && +m[1] >= 1 && +m[1] <= 12 ? `${m[3]}-${m[1]}-${m[2]}` : null; };
  for await (const l of fromFile(await unzipTo(await sunbizFile("flrf.zip")), (p) => lines(p))) {
    if (l.length < 30) continue;
    filings.set(l.slice(0, 12).trim(), { filed: ymd(l.slice(12, 20)), status: clean(l.slice(30, 31)), expires: ymd(l.slice(48, 56)) });
  }
  for await (const l of fromFile(await unzipTo(await sunbizFile("flrd.zip")), (p) => lines(p))) {
    if (l.length < 190) continue;
    const doc = l.slice(1, 13).trim();
    const name = clean(l.slice(13, 68));
    if (!name || l.slice(68, 69) !== "C") continue; // corporations and partnerships only, not people
    const f = filings.get(doc);
    // Debtor address, by the Federal Tax Lien File Definitions: address lines at 70 and 114, city 158, state 186, ZIP 188.
    const street = [l.slice(69, 113), l.slice(113, 157)], city = clean(l.slice(157, 185)), st = clean(l.slice(185, 187)), zip = clean(l.slice(187, 196));
    yield enf({
      state: "FL", source: "Florida federal tax liens on businesses (Sunbiz)", sourceUrl: SUNBIZ_PAGE,
      category: "tax_lien", name, id: doc, date: f?.filed ?? null, endDate: f?.expires ?? null,
      status: f?.status ? LIEN_STATUS[f.status] ?? `code ${f.status}` : null, city: clean(`${l.slice(157, 185)} ${l.slice(185, 187)}`),
      detail: "Federal tax lien filed with the Florida Department of State (no amount is published)", amount: null, adverse: true,
      address: joinAddress(street, city, st, zip),
    }, name, { addresses: addressKeysOf(street, city, st, zip) });
  }
}

// ── Florida Sunbiz corporate filings of licensed contractors (officers and registered agents) ─────────────────
/**
 * Sunbiz's quarterly corporate file (doc/quarterly/cor/cordata.zip, about 1.8 GB in ten Deflate64 members, checked
 * 2026-10-15) holds every corporation, LLC and partnership with its principal and mailing address, registered agent
 * and up to six officers. Only the filings whose name is a business in the DBPR construction or electrical extracts
 * are kept. The zip is never written to disk: each member is read with an SFTP byte range and inflated as a stream
 * (Info-ZIP funzip reads Deflate64), so the load needs no free space for it.
 */
const SUNBIZ_COR = "cor/cordata.zip";
/** The page that publishes the file (search.sunbiz.org answers bots with a Cloudflare challenge, so it isn't linked unchecked). */
const SUNBIZ_QUARTERLY = "https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/";
/** Filing types and officer titles, from the Corporate File Definitions (dos.sunbiz.org/data-definitions/cor.html). A title the definitions don't list is shown as Sunbiz shows it ("Title MGR"). */
const SUNBIZ_FILING: Record<string, string> = {
  DOMP: "Domestic Profit", DOMNP: "Domestic Non-Profit", FORP: "Foreign Profit", FORNP: "Foreign Non-Profit",
  DOMLP: "Domestic Limited Partnership", FORLP: "Foreign Limited Partnership", FLAL: "Florida Limited Liability Co.",
  FORL: "Foreign Limited Liability Co.", NPREG: "Non-Profit, Registration", TRUST: "Declaration of Trust", AGENT: "Designation of Registered Agent",
};
const SUNBIZ_TITLE: Record<string, string> = { P: "President", T: "Treasurer", C: "Chairman", V: "Vice President", S: "Secretary", D: "Director" };
const SUNBIZ_STATUS: Record<string, string> = { A: "Active", I: "Inactive" };

async function sunbizHome(): Promise<string> {
  const home = await fs.mkdtemp(join(tmpdir(), "ch-sftp-"));
  await fs.mkdir(join(home, ".ssh"), { mode: 0o700 });
  await fs.writeFile(join(home, ".ssh", "known_hosts"), `${SUNBIZ_HOST_KEYS}\n`);
  return home;
}
const sunbizCurl = (home: string, extra: string[], file: string) =>
  run("curl", ["-sS", "--fail", "--max-time", "300", "-u", "Public:PubAccess1845!", ...extra, `${SUNBIZ_SFTP.replace(/\/flr$/, "")}/${file}`],
    { maxBuffer: 64 << 20, encoding: "buffer", env: { ...process.env, HOME: home } }).then((r) => r.stdout as Buffer);

/** The members of a remote zip (name, local-header offset, compressed size), from its central directory. */
async function remoteZipMembers(home: string, file: string): Promise<{ name: string; offset: number; size: number; method: number }[]> {
  const listing = (await sunbizCurl(home, [], `${file.replace(/[^/]+$/, "")}`)).toString("latin1");
  const size = Number(listing.split("\n").find((l) => l.trim().endsWith(` ${file.split("/").pop()}`))?.trim().split(/\s+/)[4]);
  if (!Number.isFinite(size) || size < 1000) throw new Error(`could not read the size of ${file}`);
  const tail = await sunbizCurl(home, ["-r", `${Math.max(0, size - 65_557)}-${size - 1}`], file);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("no end of central directory");
  const cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = await sunbizCurl(home, ["-r", `${cdOffset}-${cdOffset + cdSize - 1}`], file);
  const out: { name: string; offset: number; size: number; method: number }[] = [];
  for (let i = 0; i + 46 <= cd.length && cd.readUInt32LE(i) === 0x02014b50;) {
    const method = cd.readUInt16LE(i + 10), csize = cd.readUInt32LE(i + 20), n = cd.readUInt16LE(i + 28), e = cd.readUInt16LE(i + 30), c = cd.readUInt16LE(i + 32);
    out.push({ name: cd.toString("latin1", i + 46, i + 46 + n), offset: cd.readUInt32LE(i + 42), size: csize, method });
    i += 46 + n + e + c;
  }
  if (!out.length) throw new Error("empty central directory");
  return out;
}

/** The lines of one member, inflated as they arrive (curl byte range → funzip), never stored. */
async function* remoteZipLines(home: string, file: string, m: { offset: number; size: number }): AsyncIterable<string> {
  const curl = spawn("curl", ["-sS", "--fail", "--max-time", "3600", "-u", "Public:PubAccess1845!", "-r", `${m.offset}-${m.offset + m.size + 65_535}`, `${SUNBIZ_SFTP.replace(/\/flr$/, "")}/${file}`],
    { env: { ...process.env, HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
  const unzip = spawn("funzip", [], { stdio: ["pipe", "pipe", "pipe"] });
  curl.stdout.pipe(unzip.stdin);
  unzip.stdin.on("error", () => {}); // funzip stops reading at the member's end; curl then sees a closed pipe
  let errText = "";
  unzip.stderr.on("data", (d) => { errText += String(d); });
  const done = new Promise<number>((resolve) => unzip.on("close", (code) => resolve(code ?? 1)));
  let rest = "";
  for await (const chunk of unzip.stdout) {
    const parts = (rest + (chunk as Buffer).toString("latin1")).split(/\r?\n/);
    rest = parts.pop() ?? "";
    for (const l of parts) yield l;
  }
  if (rest) yield rest;
  curl.kill();
  if ((await done) !== 0) throw new Error(`funzip failed: ${errText.slice(0, 200)}`);
}

/** One corporate record → a hit, by the Corporate File Definitions' positions (1-based in the definitions). */
export function sunbizCorporation(l: string): { hit: LicenseHit; name: string; people: Person[]; keys: IdKeys } | null {
  if (l.length < 668) return null;
  const f = (start: number, len: number) => clean(l.slice(start - 1, start - 1 + len));
  const doc = f(1, 12), name = f(13, 192);
  if (!doc || !name) return null;
  const status = f(205, 1), type = f(206, 15);
  const street = [f(221, 42), f(263, 42)], city = f(305, 28), st = f(333, 2), zip = f(335, 10);
  const mail = [f(347, 42), f(389, 42)], mCity = f(431, 28), mSt = f(459, 2), mZip = f(461, 10);
  const filed = f(473, 8)?.replace(/^(\d{2})(\d{2})(\d{4})$/, "$1/$2/$3") ?? null;
  const people: Person[] = [];
  const agent = f(545, 42);
  if (agent) people.push({ name: agent, role: "Registered agent" });
  for (let i = 0; i < 6; i++) {
    const base = 669 + 128 * i;
    const title = f(base, 4), who = f(base + 5, 42);
    if (!who) continue;
    people.push({ name: who, role: title ? SUNBIZ_TITLE[title] ?? `Title ${title}` : "Officer" });
  }
  const more = f(495, 1) === "Y";
  const address = joinAddress(street, city, st, zip);
  return {
    name, people,
    keys: { addresses: [...addressKeysOf(street, city, st, zip), ...addressKeysOf(mail, mCity, mSt, mZip)] },
    hit: {
      state: "FL", source: "Florida Division of Corporations (Sunbiz) filings of licensed contractors", sourceUrl: SUNBIZ_QUARTERLY,
      businessName: name, licenseNumber: null,
      licenseType: `Business entity filing, not a license (${type ? SUNBIZ_FILING[type] ?? `type ${type}` : "type not given"}; document ${doc})`,
      specialty: [filed && usDate(filed) ? `Filed ${usDate(filed)}` : null, more ? "Sunbiz lists more than six officers; this file names six" : null].filter(Boolean).join(". ") || null,
      status: status ? SUNBIZ_STATUS[status] ?? `code ${status}` : null, principal: null, city, expires: null, matchedOn: "business",
      address, phone: null, people,
    },
  };
}

async function* flSunbizOfficersLoader(): AsyncIterable<BulkHit> {
  // The business names DBPR licenses (qualified businesses, and the businesses individual licensees work under).
  const names = await withFiles([FL_CILB_FILE, FL_ECLB_FILE], async (paths) => {
    const out = new Set<string>();
    for (const path of paths) for await (const r of csvRows(path)) {
      const row = flRow(r);
      if (!row) continue;
      for (const v of [row.isBusiness ? row.name : null, row.dba]) if (v && nameKey(v).length >= 4) out.add(nameKey(v));
    }
    return out;
  });
  if (names.size < 50_000) throw new Error(`only ${names.size} DBPR business names; not reading Sunbiz`);
  const home = await sunbizHome();
  try {
    const members = (await remoteZipMembers(home, SUNBIZ_COR)).filter((m) => /\.txt$/i.test(m.name));
    if (members.length < 10) throw new Error(`cordata.zip has ${members.length} text members (expected 10)`);
    for (const m of members) {
      if (m.method !== 8 && m.method !== 9) throw new Error(`${m.name}: compression method ${m.method}`);
      for await (const l of remoteZipLines(home, SUNBIZ_COR, m)) {
        const name = l.slice(12, 204).trim();
        if (!name || !names.has(nameKey(name))) continue;
        const c = sunbizCorporation(l);
        if (c) yield lic(c.hit, c.name, null, { people: c.people, keys: c.keys });
      }
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

// ── Texas TSBPE plumbing licensees ───────────────────────────────────────────────────────────────────────────
const TSBPE_PAGE = "https://tsbpe.texas.gov/free-licensee-list/";
const BROWSER_UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) ConstructHUB research bot (support@constructhub.us)" };
const TSBPE_LISTS: { url: string; type: string; zip?: boolean }[] = [
  { url: "https://tsbpe.texas.gov/download-csv/RMP/", type: "Responsible Master Plumber" },
  { url: "https://tsbpe.texas.gov/download-csv/MP/", type: "Master Plumber" },
  { url: "https://tsbpe.texas.gov/download-csv/TP/", type: "Tradesman Plumber-Limited" },
  { url: "https://tsbpe.texas.gov/download-csv/PI/", type: "Plumbing Inspector" },
  { url: "https://tsbpe.texas.gov/wp-content/uploads/2015/03/JP.csv.zip", type: "Journeyman Plumber", zip: true },
  { url: "https://tsbpe.texas.gov/wp-content/uploads/2015/03/PA.csv.zip", type: "Plumber's Apprentice", zip: true },
];

async function* txPlumbingLoader(): AsyncIterable<BulkHit> {
  for (const list of TSBPE_LISTS) {
    let path = await download(list.url, { headers: BROWSER_UA });
    if (list.zip) path = await unzipTo(path);
    for await (const r of fromFile(path, (p) => csvRecords(p))) {
      const who = person(clean(r.LAST_NAME), clean(r.FIRST_NAME), clean(r.MIDDLE_NAME), clean(r.SUFFIX));
      const company = clean(r.PLUMB_COMPANY);
      if (!who && !company) continue;
      // The RMP, MP, TP and PI lists carry ADDR1–3, CITY, STATE, ZIP and PHONE; the JP and PA lists only ZIP and COUNTY.
      const street = [r.ADDR1, r.ADDR2, r.ADDR3], city = clean(r.CITY), st = clean(r.STATE), zip = clean(r.ZIP), phone = clean(r.PHONE);
      const hit = {
        state: "TX", source: "Texas State Board of Plumbing Examiners licensees", sourceUrl: TSBPE_PAGE,
        businessName: company, licenseNumber: clean(r.LICENSE_NBR), licenseType: list.type, specialty: null,
        status: clean(r.LIC_STATUS), principal: who, city: city ?? (clean(r.COUNTY) ? `${clean(r.COUNTY)} County` : null),
        expires: usDate(r.EXPIRATION_DTE), address: joinAddress(street, city, st, zip), phone,
      };
      yield {
        kind: "license", hit: { ...hit, matchedOn: company ? "business" : "principal", ...(who ? { people: [{ name: who, role: list.type }] } : {}) },
        business: company, person: who, keys: { licenses: [hit.licenseNumber], phones: [phone], addresses: addressKeysOf(street, city, st, zip) },
      };
    }
  }
}

// ── California CSLB public data portal ───────────────────────────────────────────────────────────────────────
const CSLB = "https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList";

/**
 * One CSLB file. The portal's CSV links end in a redirect to DownLoadFile.ashx (checked 2026-10-14), which serves the
 * file directly. Retried: CSLB answers 503 when busy and cuts slow downloads off (a short file then fails the row
 * floor and the previous load stays).
 */
async function cslbFile(file: "MasterLicenseData" | "PersonnelData"): Promise<string> {
  const url = `https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=${file}&type=C`;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rateLimitHost(url, 2000);
      const res = await plainRequest(url, { timeoutMs: 10 * 60_000 });
      if (!/text\/csv/i.test(String(res.headers["content-type"] ?? ""))) { res.resume(); throw new Error(`CSLB sent ${res.headers["content-type"] ?? "no file"} (HTTP ${res.statusCode})`); }
      return await saveResponse(res);
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 60_000 * (attempt + 1)));
    }
  }
  throw last;
}

const CSLB_DISCIPLINE = /susp|probation|pending case|cit|judgement|judgment|disc|revok|arb/i;

/** "DAVIS                              DANA           MICHAEL" (last, first, middle) → "DANA MICHAEL DAVIS". */
const cslbName = (raw: string) => { const [last, ...rest] = raw.trim().split(/\s{2,}/); return clean(`${rest.join(" ")} ${last ?? ""}`); };
const pipes = (v: string | undefined) => (v ?? "").split("|").map((t) => t.trim());

/**
 * Everyone PersonnelData ties to each license: officers, RMOs, RMEs, members, partners, sole owners, with each
 * title's classification and dates (a title with a disassociation date is a former one). Name-TP "Principal| AKA" rows
 * carry the person's other name after the bar; "Business" rows are the member businesses of a joint venture.
 */
export async function cslbPersonnel(path: string): Promise<Map<string, (Person & { raw: string; aka: string[] })[]>> {
  const out = new Map<string, (Person & { raw: string; aka: string[] })[]>();
  for await (const r of csvRecords(path)) {
    const no = clean(r["LIC-NO"]);
    const types = pipes(r["Name-TP"]), names = pipes(r.Name);
    if (!no || !names[0]) continue;
    const isBusiness = /^business$/i.test(types[0] ?? "");
    const name = isBusiness ? clean(names[0]) : cslbName(names[0]);
    if (!name) continue;
    const aka = names.slice(1).filter((_, i) => /aka/i.test(types[i + 1] ?? "")).map((n) => (isBusiness ? clean(n) : cslbName(n))).filter((n): n is string => !!n);
    const titles = pipes(r["EMP-Titl-CDE"]), classes = pipes(r["CL-CDE"]), to = pipes(r["DIS-ASSN-DT"]);
    // One entry per title with its classifications; a title whose every entry has a disassociation date is a former one.
    const byTitle = new Map<string, { classes: string[]; current: boolean; ended: string | null }>();
    titles.forEach((t, i) => {
      if (!t) return;
      const e = byTitle.get(t) ?? { classes: [], current: false, ended: null };
      if (classes[i] && !e.classes.includes(classes[i])) e.classes.push(classes[i]);
      const end = usDate(to[i]);
      if (!end) e.current = true; else if (!e.ended || end > e.ended) e.ended = end;
      byTitle.set(t, e);
    });
    const roles = Array.from(byTitle.entries()).sort((x, y) => Number(y[1].current) - Number(x[1].current))
      .map(([t, e]) => `${e.current ? t : `Former ${t}`}${e.classes.length ? ` (${e.classes.join(", ")})` : ""}${!e.current && e.ended ? ` until ${e.ended}` : ""}`);
    const jv = clean(r.JointVentureLicenseNumber);
    const role = isBusiness ? `Joint venture member${jv ? ` (license ${jv})` : ""}` : roles.join("; ") || null;
    (out.get(no) ?? out.set(no, []).get(no)!).push({ name, role, raw: names[0].trim().replace(/\s+/g, " "), aka });
  }
  return out;
}

/** The license master joined with its personnel: one license hit per license (with everyone on it), plus enforcement facts. */
export async function* cslbRows(masterPath: string, personnelPath: string): AsyncIterable<BulkHit> {
  const personnel = await cslbPersonnel(personnelPath);
  const inMaster = new Set<string>();
  for await (const r of csvRecords(masterPath)) {
    const no = clean(r.LicenseNo);
    const name = clean(r.BusinessName);
    if (!no || !name) continue;
    inMaster.add(no);
    const primary = clean(r.PrimaryStatus), secondary = clean(r.SecondaryStatus);
    const status = [primary, secondary].filter(Boolean).join("; ") || null;
    const classes = clean(r["Classifications(s)"]?.replace(/\|\s*/g, ", "));
    const expires = usDate(r.ExpirationDate);
    const soleOwner = clean(r.FullBusinessName); // sole owners: "FIRST MIDDLE LAST"
    const isPerson = /sole owner/i.test(r.BusinessType ?? "");
    const businessNames = [name, clean(r["BUS-NAME-2"])].filter(Boolean).join(" ");
    const city = clean(r.City), st = clean(r.State), zip = clean(r.ZIPCode), phone = clean(r.BusinessPhone);
    const street = [r.MailingAddress];
    const address = joinAddress(street, city, st, zip);
    const people = personnel.get(no) ?? [];
    const keys: IdKeys = { licenses: [no], phones: [phone], addresses: addressKeysOf(street, city, st, zip) };
    const base = {
      state: "CA", source: "California CSLB contractor licenses", sourceUrl: CSLB, businessName: name, licenseNumber: no,
      licenseType: clean(r.BusinessType) ? `Contractor license (${clean(r.BusinessType)})` : "Contractor license",
      specialty: classes ? `Classes ${classes}` : null, status, city, expires, address, phone,
      people: people.map(({ name, role }) => ({ name, role })),
    };
    yield {
      kind: "license", hit: { ...base, principal: isPerson ? soleOwner : null, matchedOn: "business" },
      business: businessNames, person: isPerson ? soleOwner ?? name : null, people: people.flatMap((p) => [p.raw, ...p.aka]), keys,
    };
    // Each person on the license also gets a row in their own name (the license, seen from them), so a person search
    // that checks the named principal still finds it.
    for (const p of people) {
      if (/^joint venture/i.test(p.role ?? "")) continue;
      yield {
        kind: "license", hit: { ...base, source: "California CSLB contractor licenses (personnel)", principal: p.name, matchedOn: "principal", specialty: [p.role, base.specialty].filter(Boolean).join(". ") || null },
        business: null, person: [p.raw, ...p.aka].join(" "), keys,
      };
    }
    // A suspension, probation, pending case or disciplinary bond is a CSLB enforcement fact on the license itself.
    const bond = clean(r.DBCaseNo);
    if ((primary && primary !== "CLEAR" && CSLB_DISCIPLINE.test(primary)) || (secondary && CSLB_DISCIPLINE.test(secondary)) || bond) {
      const amount = Number(r.DBAmount);
      yield enf({
        state: "CA", source: "California CSLB license status (suspensions, probation, pending cases, disciplinary bonds)", sourceUrl: CSLB,
        category: "discipline", name, id: no, date: usDate(r.LastUpdate), endDate: null, status, city,
        detail: [bond ? `Disciplinary bond ${clean(r.DBNumber) ?? ""} for case ${bond}${clean(r.DBBondReason) ? ` (${clean(r.DBBondReason)})` : ""}` : null,
          `License ${no}`].filter(Boolean).join(". "),
        amount: Number.isFinite(amount) && amount > 0 ? amount : null,
        adverse: primary && primary !== "CLEAR" ? true : null, address, phone, licenseNumber: no,
      }, businessNames, keys);
    }
  }
  // Personnel of a license that is no longer in the master list: still a real record of the person.
  for (const [no, people] of Array.from(personnel.entries())) {
    if (inMaster.has(no)) continue;
    for (const p of people) {
      if (/^joint venture/i.test(p.role ?? "")) continue;
      yield {
        kind: "license",
        hit: {
          state: "CA", source: "California CSLB contractor licenses (personnel)", sourceUrl: CSLB, businessName: null, licenseNumber: no,
          licenseType: "Contractor license", specialty: p.role, status: "Not in the current license list", principal: p.name, city: null, expires: null,
          matchedOn: "principal", people: people.map(({ name, role }) => ({ name, role })),
        },
        business: null, person: [p.raw, ...p.aka].join(" "), keys: { licenses: [no] },
      };
    }
  }
}

async function* caCslbLoader(): AsyncIterable<BulkHit> {
  const personnel = await cslbFile("PersonnelData");
  try {
    const master = await cslbFile("MasterLicenseData");
    try { yield* cslbRows(master, personnel); }
    finally { await fs.rm(master, { force: true }); }
  } finally {
    await fs.rm(personnel, { force: true });
  }
}

// ── California CSLB revoked licenses (monthly lists) ─────────────────────────────────────────────────────────
/**
 * CSLB posts, each month, the licenses revoked in the previous month as a PDF ("Licenses Revoked" library, one page
 * per year; 2020 to today are online, checked 2026-10-15). Each list has BUSINESS NAME, LICENSE NUMBER and REVOKED
 * DATE columns. Home improvement salesperson registrations (individuals, "HIS 123456 SP") are left out: enforcement
 * records are companies only.
 */
const CSLB_REVOKED_YEARS = "https://www.cslb.ca.gov/About_us/Library/Revoked/Default.aspx";
const CSLB_REVOKED_FIRST_YEAR = 2020;

/** Unescape a PDF literal string's body. */
function pdfString(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e: string) =>
    e === "n" ? "\n" : e === "r" ? "\r" : e === "t" ? "\t" : e === "b" ? "\b" : e === "f" ? "\f" : /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : /^\r?\n$/.test(e) ? "" : e);
}

/**
 * Text of a simple PDF (Flate content streams, single-byte WinAnsi fonts, text placed with Tm/Td and shown with
 * Tj/TJ), as lines of positioned fragments: enough for the CSLB lists, not a general PDF reader.
 */
export function pdfTextLines(pdf: Buffer): { page: number; y: number; parts: { x: number; text: string }[] }[] {
  const out = new Map<string, { page: number; y: number; parts: { x: number; text: string }[] }>();
  let page = 0;
  const seen = new Set<string>();
  for (let i = pdf.indexOf("stream"); i >= 0; i = pdf.indexOf("stream", i + 6)) {
    if (pdf.subarray(i - 3, i).toString("latin1") === "end") continue;
    const start = i + 6 + (pdf[i + 6] === 0x0d ? 2 : 1);
    const end = pdf.indexOf("endstream", start);
    if (end < 0) break;
    let content: string;
    try { content = inflateSync(pdf.subarray(start, end)).toString("latin1"); } catch { continue; }
    if (!/\bBT\b/.test(content) || seen.has(content)) continue; // the same page content can be stored twice
    seen.add(content);
    page++;
    let x = 0, y = 0, lx = 0, ly = 0;
    const re = /\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj|(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|\bBT\b/g;
    for (const m of Array.from(content.matchAll(re))) {
      if (m[0] === "BT") { x = lx = 0; y = ly = 0; continue; }
      if (m[7] !== undefined) { x = lx = Number(m[7]); y = ly = Number(m[8]); continue; }
      if (m[9] !== undefined) { lx += Number(m[9]); ly += Number(m[10]); x = lx; y = ly; continue; }
      const text = m[1] !== undefined ? Array.from(m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)).map((t) => pdfString(t[1])).join("") : pdfString(m[2] ?? "");
      if (!text) continue;
      const key = `${page}:${Math.round(y)}`;
      const line = out.get(key) ?? out.set(key, { page, y: Math.round(y), parts: [] }).get(key)!;
      line.parts.push({ x, text });
    }
  }
  return Array.from(out.values()).sort((a, b) => a.page - b.page || b.y - a.y).map((l) => ({ ...l, parts: l.parts.sort((a, b) => a.x - b.x) }));
}

/** The rows of one monthly list: business name, license number, revoked date, split at the header's column positions. */
export function cslbRevokedRows(pdf: Buffer): { name: string; license: string; date: string }[] {
  const lines = pdfTextLines(pdf);
  const rows: { name: string; license: string; date: string }[] = [];
  let cols: { lic: number; date: number } | null = null;
  let declared: number | null = null;
  const at = (parts: { x: number; text: string }[], word: string) => {
    let text = "";
    for (const p of parts) { const before = text.length; text += p.text; const k = text.indexOf(word); if (k >= 0 && k < text.length) return k >= before ? p.x : parts[Math.max(0, parts.indexOf(p) - 1)].x; }
    return null;
  };
  for (const l of lines) {
    const text = l.parts.map((p) => p.text).join("");
    if (/LICENSE NUMBER/.test(text) && /REVOKED DATE/.test(text)) {
      const lic = at(l.parts, "LICENSE NUMBER"), date = at(l.parts, "REVOKED DATE");
      cols = lic != null && date != null ? { lic: lic - 2, date: date - 2 } : null;
      continue;
    }
    if (!cols) continue;
    const cell = (from: number, to: number) => clean(l.parts.filter((p) => p.x >= from && p.x < to).map((p) => p.text).join(""));
    const name = cell(-Infinity, cols.lic), license = cell(cols.lic, cols.date), date = cell(cols.date, Infinity);
    if (name && license && date && /^\d{2}\/\d{2}\/\d{4}$/.test(date)) rows.push({ name, license, date });
    const total = text.match(/TOTAL REVOKED LICENSES:\s*(\d+)/)?.[1];
    if (total) declared = Number(total);
  }
  // Some lists store each page's text twice; a row is one row however often it is drawn.
  const unique = Array.from(new Map(rows.map((r) => [`${r.name}|${r.license}|${r.date}`, r])).values());
  if (declared != null && unique.length !== declared) throw new Error(`read ${unique.length} rows, the list says ${declared}`);
  return unique;
}

async function* caCslbRevokedLoader(): AsyncIterable<BulkHit> {
  const urls: string[] = [];
  for (let y = new Date().getUTCFullYear(); y >= CSLB_REVOKED_FIRST_YEAR; y--) {
    await rateLimitHost(CSLB_REVOKED_YEARS, 2000);
    const res = await fetch(`${CSLB_REVOKED_YEARS}?Year=${y}`, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`CSLB revoked-list page ${y} returned HTTP ${res.status}`);
    for (const m of Array.from((await res.text()).matchAll(/href="([^"]*\/Revoked\/Revoked\d{6}[^"]*\.pdf)"/gi))) {
      const u = new URL(m[1].replace(/ /g, "%20"), CSLB_REVOKED_YEARS).toString();
      if (!urls.includes(u)) urls.push(u);
    }
  }
  if (urls.length < 12) throw new Error(`only ${urls.length} monthly lists found`);
  for (const url of urls) {
    const path = await download(url, { headers: { "user-agent": USER_AGENT } }, 5 * 60_000);
    let pdf: Buffer;
    try { pdf = await fs.readFile(path); } finally { await fs.rm(path, { force: true }); }
    for (const r of cslbRevokedRows(pdf)) {
      if (/^HIS\b/i.test(r.license)) continue; // a salesperson registration: an individual
      yield enf({
        state: "CA", source: "California CSLB revoked licenses (monthly lists)", sourceUrl: url, category: "discipline",
        name: r.name, id: r.license, date: usDate(r.date), endDate: null, status: "License revoked", city: null,
        detail: `CSLB license ${r.license} revoked ${usDate(r.date)} (CSLB's monthly list of revoked licenses)`, amount: null, adverse: true,
        licenseNumber: r.license,
      }, r.name, { licenses: [r.license] });
    }
  }
}

// ── California DCA licensee files (Box) ──────────────────────────────────────────────────────────────────────
const DCA_PAGE = "https://www.dca.ca.gov/consumers/public_info/index.html";
const DCA_BOARDS: { folder: string; label: string }[] = [
  { folder: "72556212335", label: "California Board for Professional Engineers, Land Surveyors, and Geologists" },
  { folder: "72554906673", label: "California Architects Board" },
  { folder: "72555389228", label: "California Landscape Architects Technical Committee" },
  { folder: "72555272087", label: "California Structural Pest Control Board" },
];

async function* caDcaLoader(): AsyncIterable<BulkHit> {
  for (const board of DCA_BOARDS) {
    await rateLimitHost("https://www.dca.ca.gov/", 1500);
    const token = (await (await fetch("https://www.dca.ca.gov/boxToken/getToken", { headers: { "user-agent": USER_AGENT } })).text()).trim();
    if (!token || /\s|</.test(token)) throw new Error("DCA did not return a Box token");
    const auth = { authorization: `Bearer ${token}`, "user-agent": USER_AGENT };
    await rateLimitHost("https://api.box.com/", 1000);
    const items = await (await fetch(`https://api.box.com/2.0/folders/${board.folder}/items?limit=1000`, { headers: auth })).json() as { entries?: { id: string; name: string; type: string }[] };
    const data = (items.entries ?? []).filter((e) => e.type === "file" && /_Data\d+\.(xls|txt|csv)$/i.test(e.name));
    if (!data.length) throw new Error(`no data file in DCA folder ${board.folder}`);
    for (const file of data) {
      for await (const r of fromFile(await download(`https://api.box.com/2.0/files/${file.id}/content`, { headers: auth }), (p) => csvRecords(p, "\t"))) {
        const isOrg = (r["Indiv/Org"] ?? "").trim().toUpperCase() === "O";
        const orgOrLast = clean(r["Org/Last Name"]);
        if (!orgOrLast) continue;
        const who = isOrg ? null : person(orgOrLast, clean(r["First Name"]), clean(r["Middle Name"]), clean(r.Suffix));
        const dt = (v: string | undefined) => usDate(v?.replace(/-/g, "/"));
        const street = [r["Address Line 1"], r["Address Line 2"]], city = clean(r.City), st = clean(r.State), zip = clean(r.Zip);
        const no = clean(r["License Number"]), type = clean(r["License Type"]);
        yield {
          kind: "license",
          hit: {
            state: "CA", source: board.label, sourceUrl: DCA_PAGE, businessName: isOrg ? orgOrLast : null,
            licenseNumber: no, licenseType: type, specialty: clean(r["Speciality Code"]),
            status: clean(r["License Status"]), principal: who, city, expires: dt(r["Expiration Date"]),
            matchedOn: isOrg ? "business" : "principal", address: joinAddress(street, city, st, zip), phone: null,
            ...(who ? { people: [{ name: who, role: type ? `Licensee (${type})` : "Licensee" }] } : {}),
          },
          business: isOrg ? orgOrLast : null, person: who,
          keys: { licenses: [no], addresses: addressKeysOf(street, city, st, zip) },
        };
      }
    }
  }
}

// ── California DIR certified electricians ────────────────────────────────────────────────────────────────────
const DIR_ECU_PAGE = "https://data.ca.gov/dataset/dir-electrician-certification-unit-ecu";
const DIR_ECU_FILES: { resource: string; type: string }[] = [
  { resource: "291bacb8-2fdb-4d9c-a330-113781ce2f59", type: "Certified Electrician" },
  { resource: "f0b9e36d-32be-408d-8dd9-4d539becfdc8", type: "Electrician Trainee" },
];

async function* caElectriciansLoader(): AsyncIterable<BulkHit> {
  for (const f of DIR_ECU_FILES) {
    // CKAN's datastore dump: the whole resource as CSV with a header row.
    for await (const r of fromFile(await download(`https://data.ca.gov/datastore/dump/${f.resource}`), (p) => csvRecords(p))) {
      const raw = clean(r.ELECTRICIAN_NAME);
      if (!raw) continue;
      const who = flipName(raw);
      yield {
        kind: "license",
        hit: {
          state: "CA", source: "California DIR electrician certification", sourceUrl: DIR_ECU_PAGE, businessName: null,
          licenseNumber: clean(r.CERTIFICATE_NUMBER), licenseType: f.type, specialty: null, status: null, principal: who,
          city: clean(r.ZIP_CODE) ? `ZIP ${clean(r.ZIP_CODE)}` : null, expires: clean(r.EXPIRATION_DATE)?.slice(0, 10) ?? null, matchedOn: "principal",
          ...(who ? { people: [{ name: who, role: f.type }] } : {}),
        },
        business: null, person: raw, keys: { licenses: [clean(r.CERTIFICATE_NUMBER)] }, // the file gives a ZIP only, no street
      };
    }
  }
}

// ── California Labor Commissioner public-works debarments ────────────────────────────────────────────────────
const DLSE_DEBAR = "https://www.dir.ca.gov/dlse/debar.html";

async function* caDebarmentsLoader(): AsyncIterable<BulkHit> {
  await rateLimitHost(DLSE_DEBAR, 1500);
  const res = await fetch(DLSE_DEBAR, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`debarment page returned HTTP ${res.status}`);
  const html = await res.text();
  const text = (s: string) => clean(decodeEntities(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));
  const today = new Date().toISOString().slice(0, 10);
  for (const m of Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (cells.length < 2) continue;
    const who = text(cells[0]), period = text(cells[1]);
    if (!who || !period || /name of contractor/i.test(who)) continue;
    // Dates are written M/D/YYYY, and on some rows M/D/YY ("9/13/24 through 9/13/27"): a two-digit year is 20YY.
    const dates = Array.from(period.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)).map((d) => usDate(`${d[1]}/${d[2]}/${d[3].length === 2 ? `20${d[3]}` : d[3]}`));
    const from = dates[0] ?? null, to = dates[1] ?? null;
    const pdf = cells[1].match(/href="([^"]+\.pdf)"/i)?.[1];
    const stayed = /stay/i.test(period);
    // The page writes the CSLB number several ways: "CSLB License Number: 976339", "CSLB Number: #969048", "CSLB# 919516",
    // "CSB # 699574", "CLSB#710322"; some rows name two licenses.
    const licenses = Array.from(who.matchAll(/\b(?:CSLB|CSB|CLSB)\s*(?:License\s*)?(?:Number|No\.?|#)\s*:?\s*#?\s*(\d{5,7})\b/gi)).map((x) => x[1]);
    const licenseNumber = licenses[0] ?? null;
    yield enf({
      state: "CA", source: "California Labor Commissioner public-works debarments", sourceUrl: pdf ? new URL(pdf, DLSE_DEBAR).toString() : DLSE_DEBAR,
      category: "debarment", name: who.replace(/\s*\b(?:CSLB|CSB|CLSB)\s*(?:License\s*)?(?:Number|No\.?|#)\s*:?.*$/i, ""), id: licenseNumber,
      date: from, endDate: to,
      status: stayed ? "Stayed by a court (see decision)" : to && to < today ? "Debarment period over" : "Debarred",
      city: null, detail: period, amount: null, adverse: true, licenseNumber,
    }, who, { licenses });
  }
}

// ── Washington L&I public-works debarments and strikes ──────────────────────────────────────────────────────
/**
 * L&I's "Contractors Not Allowed To Bid" list and its contractor strike list (secure.lni.wa.gov/debarandstrike,
 * checked 2026-10-15): the public search pages read JSON from their own page methods, which take blank filters for
 * the whole list. No CAPTCHA or login; robots.txt has no rule for these paths. The RCW chapters are the grounds the
 * "Contractors Not Allowed To Bid" page lists.
 */
const LNI_DEBAR_PAGE = "https://secure.lni.wa.gov/debarandstrike/ContractorDebarList.aspx";
const LNI_STRIKE_PAGE = "https://secure.lni.wa.gov/debarandstrike/ContractorStrikeList.aspx";
const LNI_RCW: Record<string, string> = {
  "39.12": "Prevailing wage law (Chapter 39.12 RCW)", "18.27": "Contractor registration law (Chapter 18.27 RCW)",
  "18.106": "Plumber certification and licensing law (Chapter 18.106 RCW)", "19.28": "Electrical certification and licensing law (Chapter 19.28 RCW)",
  "70.87": "Elevator licensing and permitting law (Chapter 70.87 RCW)", "51.48": "Industrial insurance law (Chapter 51.48 RCW)",
};
const rcwText = (code: string | null) => {
  if (!code) return null;
  const chapter = code.match(/^(\d+\.\d+)/)?.[1];
  return `RCW ${code}${chapter && LNI_RCW[chapter] ? `: ${LNI_RCW[chapter]}` : ""}`;
};

/** "A  B, A  B, C" → "A B, C" (L&I repeats a principal once per role). */
const uniqueList = (v: string) => Array.from(new Set(v.split(",").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean))).join(", ");

/** Every row of one list, 100 a page (the endpoint accepts 100; 500 is refused). */
async function lniList(page: string, method: string, filters: Record<string, string>): Promise<Record<string, string>[]> {
  const out: Record<string, string>[] = [];
  for (let p = 1; p <= 400; p++) {
    await rateLimitHost(page, 1500);
    const res = await fetch(`${page}/${method}`, {
      method: "POST", headers: { "user-agent": USER_AGENT, "content-type": "application/json; charset=utf-8", referer: page },
      body: JSON.stringify({ Echo: 1, PageNumber: p, RowspPage: 100, OrderByColumn: 0, OrderType: "asc", co_name: "", ubi_num: "", license_id: "", principals: "", rcw_code: "", ...filters }),
    });
    if (!res.ok) throw new Error(`L&I ${method} returned HTTP ${res.status}`);
    const body = JSON.parse(((await res.json()) as { d?: string }).d ?? "null") as { IsSuccess?: boolean; aaData?: Record<string, string>[]; Messages?: string[] } | null;
    if (!body?.IsSuccess && !body?.aaData?.length) throw new Error(`L&I ${method}: ${body?.Messages?.join("; ") || "unexpected reply"}`);
    const rows = body?.aaData ?? [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

export function lniDebarHit(r: Record<string, string>): BulkHit | null {
  const name = clean(r.co_name);
  if (!name) return null;
  const license = clean(r.license_id), related = clean(r.related_business), principals = clean(r.principals);
  const due = [r.penalty_due_flg === "Yes" ? "penalties due" : null, r.wage_due_flg === "Yes" ? "wages due" : null].filter(Boolean).join(" and ");
  return enf({
    state: "WA", source: "Washington L&I contractors not allowed to bid on public works (debarred)", sourceUrl: LNI_DEBAR_PAGE,
    category: "debarment", name: [name, related].filter(Boolean).join(" / "), id: license, date: usDate(r.debar_begin_date), endDate: usDate(r.debar_end_date),
    status: clean(r.status_desc), city: null,
    detail: [rcwText(clean(r.rcw_code)), due ? `L&I lists ${due}` : null, clean(r.ubi_num) ? `UBI ${clean(r.ubi_num)}` : null,
      related ? `Related business: ${related}` : null, principals ? `Principals listed by L&I: ${uniqueList(principals)}` : null].filter(Boolean).join(". ") || null,
    amount: null, adverse: true, licenseNumber: license,
  }, [name, related].filter(Boolean).join(" "), { licenses: [license] });
}

export function lniStrikeHit(r: Record<string, string>): BulkHit | null {
  const name = clean(r.co_name);
  if (!name) return null;
  const license = clean(r.license_id), related = clean(r.related_business), principals = clean(r.principals), rcw = clean(r.rcw_code);
  return enf({
    state: "WA", source: "Washington L&I public-works strikes", sourceUrl: LNI_STRIKE_PAGE,
    category: rcw?.startsWith("39.12") ? "wage" : "discipline", name: [name, related].filter(Boolean).join(" / "), id: license,
    date: usDate(r.effective_date), endDate: null, status: "Strike issued", city: null,
    detail: [rcwText(rcw), clean(r.ubi_num) ? `UBI ${clean(r.ubi_num)}` : null, related ? `Related business: ${related}` : null,
      principals ? `Principals listed by L&I: ${uniqueList(principals)}` : null].filter(Boolean).join(". ") || null,
    amount: null, adverse: true, licenseNumber: license,
  }, [name, related].filter(Boolean).join(" "), { licenses: [license] });
}

async function* waDebarmentsLoader(): AsyncIterable<BulkHit> {
  for (const r of await lniList(LNI_DEBAR_PAGE, "GetDebarList", { status_code: "", debar_begin_date: "", debar_end_date: "", penalty_due_flg: "", wage_due_flg: "" })) {
    const h = lniDebarHit(r);
    if (h) yield h;
  }
}

async function* waStrikesLoader(): AsyncIterable<BulkHit> {
  for (const r of await lniList(LNI_STRIKE_PAGE, "GetStrikeList", { effective_date_start: "", effective_date_end: "" })) {
    const h = lniStrikeHit(r);
    if (h) yield h;
  }
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────────────────────
export const BULK_SOURCES: BulkSource[] = [
  { id: "fl-cilb", state: "FL", label: "Florida DBPR construction licenses (CILB)", pageUrl: FL_CILB_PAGE, everyHours: 24, minRows: 200_000,
    load: flLicenseLoader(FL_CILB_FILE, "Florida DBPR construction licenses (CILB)", FL_CILB_PAGE) },
  { id: "fl-eclb", state: "FL", label: "Florida DBPR electrical licenses (ECLB)", pageUrl: FL_ECLB_PAGE, everyHours: 24, minRows: 15_000,
    load: flLicenseLoader(FL_ECLB_FILE, "Florida DBPR electrical licenses (ECLB)", FL_ECLB_PAGE) },
  { id: "fl-dbpr-applicants", state: "FL", label: "Florida DBPR license applicants (construction and electrical)", pageUrl: FL_CILB_PAGE, everyHours: 24 * 7, minRows: 80_000,
    load: flApplicantsLoader },
  // Quarterly file (January, April, July, October): checked monthly so a new quarter is picked up within weeks.
  { id: "fl-sunbiz-officers", state: "FL", label: "Florida Division of Corporations (Sunbiz) filings of licensed contractors", pageUrl: SUNBIZ_QUARTERLY, everyHours: 24 * 30, minRows: 50_000,
    load: flSunbizOfficersLoader },
  { id: "fl-dbpr-complaints", state: "FL", label: "Florida DBPR complaints and discipline (construction and electrical)", pageUrl: FL_COMPLAINTS_PAGE, everyHours: 24, minRows: 34_000,
    load: flComplaintsLoader, companiesOnly: true },
  { id: "fl-stop-work", state: "FL", label: "Florida stop-work orders (Division of Workers' Compensation)", pageUrl: FL_SWO, everyHours: 24, minRows: 40_000,
    load: flStopWorkLoader, companiesOnly: true },
  { id: "fl-tax-liens", state: "FL", label: "Florida federal tax liens on businesses (Sunbiz)", pageUrl: SUNBIZ_PAGE, everyHours: 24 * 7, minRows: 15_000,
    load: flTaxLiensLoader, companiesOnly: true },
  { id: "tx-tsbpe", state: "TX", label: "Texas State Board of Plumbing Examiners licensees", pageUrl: TSBPE_PAGE, everyHours: 24, minRows: 60_000,
    load: txPlumbingLoader },
  // CSLB streams slowly in the daytime and cuts downloads off at about 150 s: fetch it in the small hours, Pacific time.
  { id: "ca-cslb", state: "CA", label: "California CSLB contractor licenses", pageUrl: CSLB, everyHours: 20, minRows: 400_000, utcHours: [9, 10, 11, 12, 13],
    load: caCslbLoader },
  { id: "ca-cslb-revoked", state: "CA", label: "California CSLB revoked licenses (monthly lists)", pageUrl: CSLB_REVOKED_YEARS, everyHours: 24 * 7, minRows: 2_000,
    utcHours: [9, 10, 11, 12, 13], load: caCslbRevokedLoader, companiesOnly: true },
  { id: "ca-dca", state: "CA", label: "California DCA licensees (engineers, architects, pest control)", pageUrl: DCA_PAGE, everyHours: 24 * 7, minRows: 100_000,
    load: caDcaLoader },
  { id: "ca-electricians", state: "CA", label: "California DIR electrician certification", pageUrl: DIR_ECU_PAGE, everyHours: 24 * 7, minRows: 40_000,
    load: caElectriciansLoader },
  { id: "ca-debarments", state: "CA", label: "California Labor Commissioner public-works debarments", pageUrl: DLSE_DEBAR, everyHours: 24, minRows: 20,
    load: caDebarmentsLoader, companiesOnly: true },
  { id: "wa-lni-debarments", state: "WA", label: "Washington L&I contractors not allowed to bid on public works (debarred)", pageUrl: LNI_DEBAR_PAGE, everyHours: 24, minRows: 450,
    load: waDebarmentsLoader, companiesOnly: true },
  // About 19,500 strikes since 2000 (about 200 requests a load, 1.5 s apart): weekly.
  { id: "wa-lni-strikes", state: "WA", label: "Washington L&I public-works strikes", pageUrl: LNI_STRIKE_PAGE, everyHours: 24 * 7, minRows: 13_500,
    load: waStrikesLoader, companiesOnly: true },
];

export const bulkSourcesFor = (state: string) => BULK_SOURCES.filter((s) => s.state === state);
