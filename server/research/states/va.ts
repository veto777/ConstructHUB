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
 *   Live (data.virginia.gov CKAN datastore, published there by the State Corporation Commission):
 *     SCC corporations and LLCs: status and status reason (business_status). The open-data copies are dated: the
 *     corporation file was last loaded 2024-11-14 and the LLC file 2026-03-24, and the LLC file stops at 1,048,575 rows.
 *
 * Codes: classification and specialty abbreviations are DPOR's own ("Contractor's License Classifications &
 * Specialties", 18 VAC 50-22-20/30) and the tradesman designations are DPOR's "Combined License" sheet, both linked
 * from the regulant-list page. A code DPOR doesn't define there is shown as "code X".
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { clean, csvRecords, download, usDate, type BulkHit, type BulkSource } from "../bulk";
import type { LiveEnforcementSearch, StatePack } from "./types";
import { capNote, withNote } from "../notes";
import { fromFile, hasAllWords } from "./lib/g3-common";

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
  const who = clean(r["INDIVIDUAL NAME"]);
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

// Row counts on 2026-10-15: contractors 88,119 rows, APELSCIDLA 46,836, ALHI 1,157.
/**
 * A row stored before round 3 (round 4, decision 3): today's holder from the list its license type names, by the same
 * rule as vaRegulantHit (a contractor-class row without a business name is unknown).
 */
export const vaLegacyHolder = (lists: DporList[]) => (h: LicenseHit): LicenseHit["holder"] => {
  const list = lists.find((l) => l.type === h.licenseType);
  return !list ? null : list.holder === "business" && !h.businessName ? null : list.holder;
};

const BULK: BulkSource[] = [
  { id: "va-dpor-contractors", state: "VA", label: CONTRACTORS, pageUrl: DPOR_PAGE, everyHours: 24, minRows: 60_000, load: dporLoader(CONTRACTOR_LISTS, CONTRACTORS), legacyHolder: vaLegacyHolder(CONTRACTOR_LISTS) },
  { id: "va-dpor-apelscidla", state: "VA", label: APELSCIDLA, pageUrl: DPOR_PAGE, everyHours: 24 * 7, minRows: 32_000, load: dporLoader(APELSCIDLA_LISTS, APELSCIDLA), legacyHolder: vaLegacyHolder(APELSCIDLA_LISTS) },
  { id: "va-dpor-alhi", state: "VA", label: ALHI, pageUrl: DPOR_PAGE, everyHours: 24 * 7, minRows: 800, load: dporLoader(ALHI_LISTS, ALHI), legacyHolder: vaLegacyHolder(ALHI_LISTS) },
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

// The SCC copies were searched through data.virginia.gov's CKAN datastore API, which its robots.txt disallows
// (Disallow: /api/ and /datastore/*, checked 2026-10-15), so the search is not registered (HARD RULE 2). The allowed
// path is each dataset's file download (corp.xlsx, ~1M rows), not loaded yet.
export const SCC_SEARCH: LiveEnforcementSearch = { source: "Virginia SCC business entity status (open data)", scope: "Corporations (copy of 2024-11-14) and LLCs (copy of 2026-03-24, first 1,048,575 rows)", category: "business_status", search: searchScc };
const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [];

export const pack: StatePack = {
  state: "VA",
  checked: "2026-10-15",
  bulk: BULK,
  liveEnforcement: LIVE_ENFORCEMENT,
  blocked: [
    "DPOR License Lookup (dporweb.dpor.virginia.gov/LicenseLookup), which also carries board orders: reCAPTCHA on the search",
    "DPOR disciplinary orders: no list or download; published only per licensee in the CAPTCHA lookup and in board minutes on Town Hall (PDF)",
    "eVA Inactive Vendor List (DGS debarred/enjoined contractors, logi.cgieva.com Report9020): robots.txt Disallow: /",
    "SCC business entities on data.virginia.gov (corporation, llc-limited-liability-company): robots.txt disallows /api/ and /datastore/* (checked 2026-10-15), so the datastore search is not used; the datasets' .xlsx downloads are allowed but not loaded yet",
    "SCC Clerk's Information System bulk data: paid subscription ($1,000/month per the SCC page); only the dated open-data copies are used",
    "data.virginia.gov SCC Lien Details: no debtor names, only filing numbers",
  ],
};
