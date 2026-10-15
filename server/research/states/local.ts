/**
 * City and county contractor licenses and registrations, searched in the reports of the state they're in, and the
 * city enforcement records that name contractors. Same rules and checks as a state pack (./types.ts): every dataset
 * below was opened and searched live on 2026-10-15; field names and status values are the publishers' own.
 *
 *   DC  District of Columbia DLCP basic business licenses: contractor and construction services (general
 *       contractors / construction managers, home-improvement contractors), with owners and registered agents (bulk)
 *   CA  Los Angeles Office of Finance active business tax registrations, construction NAICS codes (23…) (bulk)
 *   CA  San Francisco registered business locations, self-reported construction NAICS (23…), with the owner (bulk)
 *   WA  Seattle active business license tax certificates, construction NAICS codes (23…) (bulk)
 *   CA  Long Beach business licenses in the "Contracting" categories (bulk)
 *   CO  Boulder licensed contractors (bulk)
 *   TX  Arlington registered contractors (bulk)
 *   LA  New Orleans occupational business licenses, construction business types (bulk)
 *   LA  East Baton Rouge Parish business registrations, NAICS group "Construction" (bulk)
 *   MO  Kansas City business license holders, construction business types (bulk)
 *   VA  Norfolk business licenses, construction NAICS (bulk)
 *   FL  Miami-Dade County contractor licenses with their tradesmen (the county's layer, last updated 2024-10-25; bulk)
 *   CA  Sacramento County (unincorporated) business licenses whose activity is construction work (bulk)
 *   KY  Louisville Metro active contractors (Office of Construction Review; the layer as of 2022-06-19; bulk)
 *   NV  City of Las Vegas business licenses of type "Contractor", with owners and their titles (bulk)
 *   AZ  Tucson active business licenses, construction NAICS codes (23…) (bulk)
 *   IL  Chicago BACP home-repair licenses, with every owner and officer from the city's Business Owners dataset (bulk)
 *   OH  Cleveland Building & Housing contractor registrations (active; bulk)
 *   TN  Nashville Metro Codes registered professional contractors (bulk; the layer publishes no status)
 *   PA  Philadelphia L&I trade licenses: contractors, electrical, plumbing, fire suppression, sheet metal, home
 *       improvement, demolition, excavation (bulk; the contractor's address joined from L&I permit contractors)
 *
 * NYC DOB and DCWP licenses, DOB discipline and DCWP complaints, and the Montgomery County (MD) licenses are searched
 * by the NY and MD packs (./ny.ts, ./md.ts).
 *
 * Enforcement (companies only; LOCAL_ENFORCEMENT, for ../registry.ts):
 *   NY  New York City DOB / ECB (OATH) building-code violations, by respondent
 *   PA  Philadelphia L&I contractor violations (bulk, companies only)
 */
import type { LicenseHit } from "@shared/research-reports";
import { entityHolder, tokens, type LicenseSource } from "../licenses";
import { clean, type BulkHit, type BulkSource } from "../bulk";
import type { SodaEnforcement } from "../state-records";
import type { LiveEnforcementSearch, LiveLicenseSearch } from "./types";
import { addressLine, arcgisAll, fullName, isoDay, sodaAll, txt } from "./lib/local-fetch";
import { looksLikeBusiness } from "./lib/business-name";

type Row = Record<string, unknown>;
const soda = (domain: string, id: string) => ({ datasetUrl: `https://${domain}/d/${id}`, url: `https://${domain}/resource/${id}.json` });

/**
 * One license row as a bulk hit, indexed by its business name, its people, license number, phone and address. The
 * holder comes from what the publisher says (license class, entity or ownership type; audit round 2, decision 2):
 * only a business holder keeps its street address and phone. An individual's row, or one whose holder the publisher
 * doesn't state, keeps its city only, even with a trade name attached: its street and phone may be a home address
 * and phone, so they are neither shown nor indexed.
 */
export function licenseHit(h: Omit<LicenseHit, "matchedOn" | "people" | "holder"> & { holder: "business" | "individual" | null; people: { name: string | null; role: string | null }[] }): BulkHit {
  const people = h.people.filter((p): p is { name: string; role: string | null } => !!p.name);
  const biz = h.holder === "business";
  return {
    kind: "license",
    hit: { ...h, ...(biz ? {} : { address: null, phone: null }), people, matchedOn: h.businessName ? "business" : "principal" },
    business: h.businessName, person: people[0]?.name ?? null, people: people.slice(1).map((p) => p.name),
    keys: biz ? { licenses: [h.licenseNumber], phones: [h.phone], addresses: [h.address] } : { licenses: [h.licenseNumber] },
  };
}

/*
 * Holders (round 3, decision 3): an entity or ownership type goes through the shared entityHolder (../privacy.ts)
 * with the values each dataset publishes (checked 2026-10-15), anything unlisted unknown. A file that is a register of
 * businesses by the publisher's own definition (a city's contractor registrations or business licenses in the
 * business's legal name) is "business". A name that reads like a company never makes a holder a business: such
 * datasets publish no type, so their holder is null.
 */

/** More keys for a row made by licenseHit; address and phone keys only on a business row (decision 4, as above). */
function addKeys(h: BulkHit, k: { licenses?: (string | null)[]; addresses?: (string | null)[]; phones?: (string | null)[] }): void {
  if (!h.keys) return;
  if (k.licenses) h.keys.licenses = k.licenses;
  if (h.kind !== "license" || h.hit.holder !== "business") return;
  if (k.addresses) h.keys.addresses = k.addresses;
  if (k.phones) h.keys.phones = k.phones;
}

/**
 * A name that is a company's ("ACME ROOFING LLC"), not a person's ("David Power" is a person): ./lib/business-name.ts.
 * It decides which column a name is shown in (business or principal), never the holder.
 */
const ORG = { test: (v: string) => looksLikeBusiness(v) };

/** A status field that holds something else (a phone number in a few NYC DOB rows) is no status. */
const statusOf = (v: string | null) => (v && /[A-Za-z]/.test(v) ? v : null);

// ── New York City ────────────────────────────────────────────────────────────────────────────────────────────────
// NYC DOB/DCWP licenses, DOB discipline and DCWP complaints are searched by the NY pack (states/ny.ts); only the
// DOB / ECB violations are searched from here.
const nycEnforcement: SodaEnforcement[] = [
  {
    state: "NY", source: "New York City DOB / ECB building-code violations", scope: "Violations where the company is the respondent, 1980s to today",
    // No server-side $order: sorting this dataset's word matches by date takes the server about 60 s (1.4 s without,
    // checked 2026-10-15); the report sorts by date itself, and a full page says that more rows exist.
    ...soda("data.cityofnewyork.us", "6bgk-3dad"), nameFields: ["respondent_name"],
    toHit: (r: Row) => {
      const hearing = txt(r, "hearing_status");
      const penalty = Number(r.penality_imposed);
      return {
        category: "discipline", name: txt(r, "respondent_name"), id: txt(r, "ecb_violation_number"), date: ymd(txt(r, "issue_date")), endDate: null,
        status: [`ECB violation ${txt(r, "ecb_violation_status")?.toLowerCase() ?? ""}`.trim(), hearing ? `hearing: ${hearing}` : null].filter(Boolean).join(", "),
        city: "New York City",
        detail: [txt(r, "violation_type") ? `${txt(r, "violation_type")} violation` : null, txt(r, "severity"), txt(r, "violation_description"),
          txt(r, "section_law_description1")?.replace(/\s{2,}/g, " "), Number(r.balance_due) > 0 ? `balance due $${Number(r.balance_due).toLocaleString("en-US")}` : null]
          .filter(Boolean).join(". ").slice(0, 800) || null,
        amount: Number.isFinite(penalty) && penalty > 0 ? penalty : null,
        adverse: hearing === "DISMISSED" ? false : hearing && /IN VIOLATION|IN-VIO|DEFAULT/.test(hearing) ? true : null,
        address: addressLine([txt(r, "respondent_house_number"), txt(r, "respondent_street")], txt(r, "respondent_city"), null, txt(r, "respondent_zip")),
      };
    },
  },
];

/** "20090217" → "2009-02-17". */
function ymd(v: string | null): string | null {
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m && m[1] !== "0000" ? `${m[1]}-${m[2]}-${m[3]}` : isoDay(v);
}

// ── Philadelphia ─────────────────────────────────────────────────────────────────────────────────────────────────
const PHL = "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services";
const PHL_TRADE = `${PHL}/TRADE_LICENSES/FeatureServer/0`;
const PHL_PERMIT_CONTRACTORS = `${PHL}/PERMIT_CONTRACTORS/FeatureServer/0`;
const PHL_VIOLATIONS = `${PHL}/CONTRACTOR_VIOLATIONS/FeatureServer/0`;
const PHL_PAGE = "https://opendataphilly.org/datasets/licenses-and-inspections-trade-licenses/";
const PHL_VIOLATIONS_PAGE = "https://www.arcgis.com/home/item.html?id=dbc8c4b06d3c40aab87d48a5fcdafc58"; // published by maps.phl.data
const PHL_TRADES = ["CONTRACTOR", "ELECTRICAL CONTRACTOR", "PLUMBER MASTER", "PLUMBER JOURNEYMAN", "PLUMBER APPRENTICE", "FIRE SUPPRESSION CONTRACTOR",
  "FIRE SUPPRESSION WORKER", "FIRE SUPPRESSION WORKER-SPECIALTY", "FIRE SUPPRESSION WORKER-KITCHEN FIRE EXTINGUISHING SYSTEM", "FIRE SUPPRESSION APPRENTICE",
  "SHEET METAL TECHNICIAN", "SHEET METAL APPRENTICE", "PA HOME IMPROVEMENT", "DEMOLITION", "EXCAVATION CONTRACTOR", "CURB SETTER"];

/** "NAME\r\n1000 MAIN ST\r\nNORRISTOWN, PA  19401\r\nUSA" → "1000 MAIN ST, NORRISTOWN, PA 19401" (the first line is the name). */
export function phlAddress(v: string | null): string | null {
  const lines = (v ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim()).filter(Boolean);
  const rest = lines.slice(1).filter((l) => !/^USA$/i.test(l));
  return rest.length && /\d/.test(rest[0]) ? rest.join(", ") : null;
}

/** "JOHN WEITORT DBA: JW ELECTRICAL CONTRACTORS INC" → the licensee and the trade name. */
/** Philadelphia license types that are a business's (contractors, home improvement, demolition, curb setting); the rest (plumbers, fire suppression workers, sheet metal technicians, apprentices) are a person's own. */
export const PHL_BUSINESS_TYPES = /^(?:CONTRACTOR|ELECTRICAL CONTRACTOR|FIRE SUPPRESSION CONTRACTOR|PA HOME IMPROVEMENT|DEMOLITION|EXCAVATION CONTRACTOR|CURB SETTER)$/;
export const PHL_INDIVIDUAL_TYPES = /^(?:PLUMBER MASTER|PLUMBER JOURNEYMAN|PLUMBER APPRENTICE|FIRE SUPPRESSION WORKER(?:-SPECIALTY|-KITCHEN FIRE EXTINGUISHING SYSTEM)?|FIRE SUPPRESSION APPRENTICE|SHEET METAL TECHNICIAN|SHEET METAL APPRENTICE)$/;
const phlDba = (v: string | null) => { const m = v?.match(/^(.*?)\s+DBA:\s*(.*)$/i); return m ? { who: m[1].trim() || null, dba: m[2].trim() || null } : { who: v, dba: null }; };

const phlTrade: BulkSource = {
  id: "pa-phl-trade-licenses", state: "PA", label: "Philadelphia L&I trade and contractor licenses", pageUrl: PHL_PAGE,
  everyHours: 24 * 7, minRows: 28_000,
  load: async function* () {
    // An address the contractor gave on a permit, by commercial activity license number. The layer has no date, so
    // which permit is newest is unknown: the one kept is the last in object-id order, shown as an address on file,
    // never called the latest.
    const addr = new Map<string, string>();
    for await (const r of arcgisAll(PHL_PERMIT_CONTRACTORS, "cal_number IS NOT NULL", "cal_number,contractor_address,objectid")) {
      const a = phlAddress(r.contractor_address == null ? null : String(r.contractor_address));
      if (a) addr.set(txt(r, "cal_number")!, a);
    }
    for await (const r of arcgisAll(PHL_TRADE, `licensetype IN (${PHL_TRADES.map((t) => `'${t}'`).join(",")})`)) {
      const { who: holder, dba } = phlDba(txt(r, "contactname"));
      // The licensee is a person or, on many contractor licenses, the company itself.
      const holderIsOrg = !!holder && ORG.test(holder);
      const company = txt(r, "companyname") ?? dba ?? (holderIsOrg ? holder : null);
      const who = holderIsOrg ? null : holder;
      if (!who && !company) continue;
      const cal = txt(r, "commercialactivitylicense");
      const h = licenseHit({
        state: "PA", source: "Philadelphia L&I trade licenses", sourceUrl: PHL_PAGE,
        businessName: company, licenseNumber: txt(r, "licensenumber"), licenseType: txt(r, "licensetype"), specialty: null,
        holder: entityHolder(txt(r, "licensetype"), { business: PHL_BUSINESS_TYPES, individual: PHL_INDIVIDUAL_TYPES }),
        status: txt(r, "licensestatus"), principal: who, city: "Philadelphia", expires: isoDay(r.expirationdate),
        address: cal ? addr.get(cal) ?? null : null, phone: null,
        people: [{ name: who, role: "Licensee" }],
      });
      addKeys(h, { licenses: [txt(r, "licensenumber"), cal] });
      yield h;
    }
  },
};

const phlViolations: BulkSource = {
  id: "pa-phl-contractor-violations", state: "PA", label: "Philadelphia L&I contractor violations", pageUrl: PHL_VIOLATIONS_PAGE,
  everyHours: 24 * 7, minRows: 16_000, companiesOnly: true,
  load: async function* () {
    for await (const r of arcgisAll(PHL_VIOLATIONS)) {
      const name = txt(r, "responsibleparty");
      if (!name) continue;
      const lic = txt(r, "licensenumber");
      yield {
        kind: "enforcement", business: name, person: null, keys: { licenses: [lic] },
        hit: {
          state: "PA", source: "Philadelphia L&I contractor violations", sourceUrl: PHL_VIOLATIONS_PAGE, category: "discipline",
          name, id: txt(r, "violationnumber"), date: isoDay(r.violationdate), endDate: null, status: "Violation issued", city: "Philadelphia",
          detail: [txt(r, "violationcodetitle"), txt(r, "violationcode") ? `code ${txt(r, "violationcode")}` : null, txt(r, "casenumber") ? `case ${txt(r, "casenumber")}` : null,
            txt(r, "licensetype") ? `${txt(r, "licensetype")} license${lic ? ` ${lic}` : ""}` : null].filter(Boolean).join(", ") || null,
          amount: null, adverse: null, licenseNumber: lic,
        },
      };
    }
  },
};

// ── Cleveland, Ohio ──────────────────────────────────────────────────────────────────────────────────────────────
const CLE = "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Active_Contractor_Registrations/FeatureServer/0";
const CLE_PAGE = "https://www.arcgis.com/home/item.html?id=92e169a99d7b42ae97f6c28a7f7e9a19";
const cleveland: BulkSource = {
  id: "oh-cleveland-contractors", state: "OH", label: "Cleveland contractor registrations", pageUrl: CLE_PAGE, everyHours: 24, minRows: 2_300,
  load: async function* () {
    for await (const r of arcgisAll(CLE)) {
      const name = txt(r, "BUSINESS_NAME");
      if (!name) continue;
      const rrp = txt(r, "RRP_CERTIFICATION_NO");
      const h = licenseHit({
        state: "OH", source: "Cleveland contractor registrations", sourceUrl: CLE_PAGE,
        businessName: name, licenseNumber: txt(r, "B1_ALT_ID"), licenseType: txt(r, "CONTRACTOR_LICENSE_TYPE"),
        specialty: rrp ? `EPA lead-safe (RRP) certification ${rrp}` : null, status: txt(r, "STATUS"), principal: null, city: txt(r, "B1_CITY"), expires: null,
        holder: "business", // the city's register of contractor registrations, in the business's name (publisher's definition)
        address: addressLine([txt(r, "B1_ADDRESS1"), txt(r, "B1_ADDRESS2")], txt(r, "B1_CITY"), txt(r, "B1_STATE"), txt(r, "B1_ZIP")),
        phone: txt(r, "B1_PHONE1"), people: [],
      });
      addKeys(h, { licenses: [txt(r, "B1_ALT_ID"), rrp] });
      yield h;
    }
  },
};

// ── Nashville (Metro Codes) ──────────────────────────────────────────────────────────────────────────────────────
const NASH = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Registered_Professional_Contractors_view_2/FeatureServer/0";
const NASH_PAGE = "https://www.arcgis.com/home/item.html?id=ac877684ad8b45e8b539af65ce475fe2";
const nashville: BulkSource = {
  id: "tn-nashville-contractors", state: "TN", label: "Nashville registered professional contractors", pageUrl: NASH_PAGE, everyHours: 24, minRows: 4_900,
  load: async function* () {
    for await (const r of arcgisAll(NASH)) {
      const name = txt(r, "Company_Name");
      if (!name) continue;
      yield licenseHit({
        state: "TN", source: "Nashville registered professional contractors", sourceUrl: NASH_PAGE,
        // The layer publishes no status field: what it is (Metro Codes' registered contractors) goes in the specialty line.
        businessName: name, licenseNumber: null, licenseType: txt(r, "Prof__Type"), specialty: "Listed in Metro Codes' registered professional contractors", status: null,
        holder: "business", // a company's contractor registration (Company_Name)
        principal: null, city: txt(r, "City"), expires: null,
        address: addressLine([txt(r, "Address")], txt(r, "City"), txt(r, "ST"), txt(r, "ZIP")), phone: null, people: [],
      });
    }
  },
};

// ── Chicago ──────────────────────────────────────────────────────────────────────────────────────────────────────
const CHI_LICENSES = soda("data.cityofchicago.org", "r5kz-chrr");
const CHI_OWNERS = soda("data.cityofchicago.org", "ezma-pppn");
// license_status codes, from the dataset's own description.
const CHI_STATUS: Record<string, string> = { AAI: "Issued", AAC: "Cancelled during its term", REV: "Revoked", REA: "Revocation appealed" };

const chicagoHomeRepair: BulkSource = {
  id: "il-chicago-home-repair", state: "IL", label: "Chicago home-repair business licenses", pageUrl: CHI_LICENSES.datasetUrl,
  everyHours: 24, minRows: 7_500,
  load: async function* () {
    // One row per application (issue, renewals, moves): keep each license's latest term.
    const latest = new Map<string, Row>();
    for await (const r of sodaAll(CHI_LICENSES.url, "license_description='Home Repair'")) {
      const no = txt(r, "license_number");
      if (!no) continue;
      const prev = latest.get(no);
      if (!prev || String(r.expiration_date ?? "") >= String(prev.expiration_date ?? "")) latest.set(no, r);
    }
    const owners = new Map<string, { name: string; role: string | null }[]>();
    const accounts = Array.from(new Set(Array.from(latest.values()).map((r) => txt(r, "account_number")).filter((a): a is string => !!a)));
    for (let i = 0; i < accounts.length; i += 300) {
      const batch = accounts.slice(i, i + 300).map((a) => `'${a.replace(/'/g, "''")}'`).join(",");
      for await (const o of sodaAll(CHI_OWNERS.url, `account_number in (${batch})`)) {
        const name = txt(o, "owner_name") ?? fullName(txt(o, "owner_first_name"), txt(o, "owner_middle_initial"), txt(o, "owner_last_name"));
        const acct = txt(o, "account_number");
        if (!name || !acct) continue;
        const list = owners.get(acct) ?? [];
        if (!list.some((p) => p.name === name)) list.push({ name, role: txt(o, "owner_title") });
        owners.set(acct, list);
      }
    }
    for (const r of Array.from(latest.values())) {
      const legal = txt(r, "legal_name"), dba = txt(r, "doing_business_as_name");
      if (!legal && !dba) continue;
      const business = legal && dba && dba.toUpperCase() !== legal.toUpperCase() ? `${legal} (d/b/a ${dba})` : legal ?? dba;
      const people = owners.get(txt(r, "account_number") ?? "") ?? [];
      const code = txt(r, "license_status");
      yield licenseHit({
        state: "IL", source: "Chicago business licenses (home repair)", sourceUrl: CHI_LICENSES.datasetUrl,
        businessName: business, licenseNumber: txt(r, "license_number"), licenseType: txt(r, "license_description"), specialty: null,
        status: code ? CHI_STATUS[code] ?? `code ${code}` : null, principal: people[0]?.name ?? null, city: txt(r, "city"), expires: isoDay(r.expiration_date),
        holder: "business", // a business license, in the legal name of the business
        address: addressLine([txt(r, "address")], txt(r, "city"), txt(r, "state"), txt(r, "zip_code")), phone: null, people,
      });
    }
  },
};

// ── Washington, DC (Department of Licensing and Consumer Protection) ─────────────────────────────────────────────
const DC_BBL = "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/0";
const DC_PAGE = "https://www.arcgis.com/home/item.html?id=85bf98d3915f412c8a4de706f2d13513";
/** ENTITYTYPE values of the contractor rows, checked 2026-10-15; "For Profit", "Unknown", "Trade Name" and "Name Registration" are on neither list. */
export const DC_BUSINESS_TYPES = /^(?:(?:domestic |foreign )?(?:business corporation|nonprofit corporation|limited liability company|limited liability partnership|limited partnership)|corporation \((?:for|non)[- ]profit\)|limited liability company \(llc\)|limited liability partnership \(llp\)|limited partnership \(lp\)|partnership|general partnership|limited cooperative association|joint venture|government|federal government)$/i;
export const DC_INDIVIDUAL_TYPES = /^(?:(?:domestic |foreign )?sole proprietor|sole proprietorship)$/i;
const dcAddress = (v: string | null) => clean(v?.replace(/,\s*USA$/i, "").replace(/\s+,/g, ",") ?? null);
const dcContractors: BulkSource = {
  id: "dc-dlcp-contractors", state: "DC", label: "DC basic business licenses (contractors and construction)", pageUrl: DC_PAGE,
  everyHours: 24, minRows: 14_000,
  load: async function* () {
    for await (const r of arcgisAll(DC_BBL, "CATEGORYSERVICETYPE='Contractor and Construction Services'")) {
      const entity = txt(r, "ENTITYNAME"), trade = txt(r, "ENTITYTRADENAME");
      if (!entity) continue;
      const owner = fullName(txt(r, "BUSINESSOWNERFIRSTNAME"), txt(r, "BUSINESSOWNERMIDDLENAME"), txt(r, "BUSINESSOWNERLASTNAME"));
      const agent = fullName(txt(r, "AGENTFIRSTNAME"), txt(r, "AGENTMIDDLENAME"), txt(r, "AGENTLASTNAME")) ?? txt(r, "AGENTENTITY");
      const sole = /sole proprietor/i.test(txt(r, "ENTITYTYPE") ?? "");
      const premise = dcAddress(txt(r, "PREMISEADDRESS")), billing = dcAddress(txt(r, "BILLINGADDRESS"));
      const business = trade && !/^N\/?A$/i.test(trade) && trade.toUpperCase() !== entity.toUpperCase() ? `${entity} (t/a ${trade})` : entity;
      // The dataset has no separate license-number field; CUSTOMERNUMBER is the record's number.
      const h = licenseHit({
        state: "DC", source: "DC basic business licenses", sourceUrl: DC_PAGE,
        businessName: sole && !trade ? null : business, licenseNumber: txt(r, "CUSTOMERNUMBER"), licenseType: txt(r, "BUSINESSACTIVITY"),
        specialty: txt(r, "ENTITYTYPE"), status: txt(r, "LICENSESTATUS"), principal: owner ?? (sole ? entity : null),
        holder: entityHolder(txt(r, "ENTITYTYPE"), { business: DC_BUSINESS_TYPES, individual: DC_INDIVIDUAL_TYPES }),
        city: premise?.split(",")[1]?.trim() ?? null, expires: isoDay(r.LICENSEENDDATE), address: premise, phone: null,
        people: [{ name: owner ?? (sole ? entity : null), role: "Owner" }, { name: agent && agent !== owner ? agent : null, role: "Registered agent" }],
      });
      addKeys(h, { addresses: [premise, billing] });
      yield h;
    }
  },
};

// ── Long Beach, California ───────────────────────────────────────────────────────────────────────────────────────
const LB = "https://services6.arcgis.com/yCArG7wGXGyWLqav/arcgis/rest/services/Business_Licenses_Public_View/FeatureServer/0";
const LB_PAGE = "https://www.arcgis.com/home/item.html?id=54d45ca9c4554062a02df49ec1ea2b2a";
const longBeach: BulkSource = {
  id: "ca-long-beach-contractors", state: "CA", label: "Long Beach business licenses (contracting)", pageUrl: LB_PAGE, everyHours: 24, minRows: 25_000,
  load: async function* () {
    const seen = new Set<string>();
    for await (const r of arcgisAll(LB, "LICCATDESC LIKE 'Contracting%'")) {
      const no = txt(r, "LICENSENO"), cat = txt(r, "LICCATDESC");
      const key = `${no}|${cat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const full = txt(r, "FULLNAME"), dba = txt(r, "DBANAME");
      if (!full && !dba) continue;
      const sole = txt(r, "COMPANYTYPE") === "SOLE";
      const site = clean(txt(r, "SITELOCATION")?.replace(/^OUTSIDE LONG BEACH\s*/i, "") ?? null);
      const outside = txt(r, "OUTSIDECITY") === "Yes";
      const zip = txt(r, "ZIP");
      yield licenseHit({
        state: "CA", source: "Long Beach business licenses", sourceUrl: LB_PAGE,
        businessName: sole ? dba : dba && full && dba.toUpperCase() !== full.toUpperCase() ? `${full} (d/b/a ${dba})` : full ?? dba,
        licenseNumber: no, licenseType: cat, specialty: txt(r, "COMPANYTYPE"), status: txt(r, "LICSTATUS"), principal: sole ? full : null,
        // COMPANYTYPE, checked 2026-10-15: CORP, LLC, LLP, PARTNER, NON-PROFIT, SOLE (or blank).
        holder: entityHolder(txt(r, "COMPANYTYPE"), { business: /^(?:CORP|LLC|LLP|PARTNER|NON-PROFIT)$/, individual: /^SOLE$/ }),
        city: outside ? null : "Long Beach", expires: null,
        address: site ? (outside ? site : addressLine([site], "LONG BEACH", "CA", zip)) : null, phone: null,
        people: [{ name: sole ? full : null, role: "Owner (sole proprietor)" }],
      });
    }
  },
};

// ── Boulder, Colorado ────────────────────────────────────────────────────────────────────────────────────────────
const BOULDER = "https://services.arcgis.com/ePKBjXrBZ2vEEgWd/arcgis/rest/services/Licensed_Contractors/FeatureServer/0";
const BOULDER_PAGE = "https://www.arcgis.com/home/item.html?id=ef02bbe733464632aa0d2628177d6c9e";
const boulder: BulkSource = {
  id: "co-boulder-contractors", state: "CO", label: "Boulder licensed contractors", pageUrl: BOULDER_PAGE, everyHours: 24, minRows: 2_100,
  load: async function* () {
    for await (const r of arcgisAll(BOULDER)) {
      const name = txt(r, "CompanyName");
      if (!name) continue;
      yield licenseHit({
        state: "CO", source: "Boulder licensed contractors", sourceUrl: BOULDER_PAGE,
        businessName: name, licenseNumber: txt(r, "LicenseNumber"), licenseType: txt(r, "LicenseType"), specialty: txt(r, "LicenseClassification"),
        status: txt(r, "LicenseStatus"), principal: null, city: null, expires: isoDay(r.ExpirationDate),
        holder: "business", // a contractor license in the company's name (CompanyName)
        address: txt(r, "Address"), phone: txt(r, "BusinessPhone"), people: [],
      });
    }
  },
};

// ── Arlington, Texas ─────────────────────────────────────────────────────────────────────────────────────────────
const ARL = "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Table/MapServer/8";
const ARL_PAGE = "https://www.arcgis.com/home/item.html?id=5fd231ff8afa49b9809552337697ded3";
const arlington: BulkSource = {
  id: "tx-arlington-contractors", state: "TX", label: "Arlington (TX) registered contractors", pageUrl: ARL_PAGE, everyHours: 24 * 7, minRows: 2_700,
  load: async function* () {
    // "Home Owner Registration" rows are homeowners pulling their own permits, not contractors.
    for await (const r of arcgisAll(ARL, "ContractorType <> 'Home Owner Registration'")) {
      const name = txt(r, "BusinessName"), contact = txt(r, "Contact");
      if (!name && !contact) continue;
      yield licenseHit({
        state: "TX", source: "Arlington registered contractors", sourceUrl: ARL_PAGE,
        businessName: name, licenseNumber: null, licenseType: txt(r, "ContractorType"), specialty: null, status: "Registered",
        principal: contact, city: null, expires: null, address: txt(r, "Address"), phone: txt(r, "Phone"),
        holder: null, // no entity type published; a business name being present doesn't make the holder a business
        people: [{ name: contact, role: "Contact" }],
      });
    }
  },
};

// ── Los Angeles and Seattle: business tax registrations, construction trades by NAICS code ────────────────────────
const LA_BUSINESSES = soda("data.lacity.org", "6rrh-rzua");
const losAngeles: BulkSource = {
  id: "ca-la-construction-businesses", state: "CA", label: "Los Angeles business tax registrations (construction)", pageUrl: LA_BUSINESSES.datasetUrl,
  everyHours: 24 * 7, minRows: 38_000,
  load: async function* () {
    for await (const r of sodaAll(LA_BUSINESSES.url, "starts_with(naics,'23')")) {
      const name = txt(r, "business_name"), dba = txt(r, "dba_name");
      if (!name && !dba) continue;
      const address = addressLine([txt(r, "street_address")], txt(r, "city"), "CA", txt(r, "zip_code"));
      const mailing = addressLine([txt(r, "mailing_address")], txt(r, "mailing_city"), null, txt(r, "mailing_zip_code"));
      const h = licenseHit({
        state: "CA", source: "Los Angeles business tax registrations", sourceUrl: LA_BUSINESSES.datasetUrl,
        businessName: name && dba && dba.toUpperCase() !== name.toUpperCase() ? `${name} (d/b/a ${dba})` : name ?? dba,
        licenseNumber: txt(r, "location_account"), licenseType: "Business tax registration", specialty: txt(r, "primary_naics_description"),
        status: "Active", principal: null, city: txt(r, "city"), expires: null, address, phone: null, people: [],
        holder: "business", // a business tax registration (the dataset names no owner)
      });
      addKeys(h, { addresses: [address, mailing] });
      yield h;
    }
  },
};

const SF_BUSINESSES = soda("data.sfgov.org", "g8m3-pdis");
const sanFrancisco: BulkSource = {
  id: "ca-sf-construction-businesses", state: "CA", label: "San Francisco registered businesses (construction)", pageUrl: SF_BUSINESSES.datasetUrl,
  everyHours: 24, minRows: 8_700,
  load: async function* () {
    for await (const r of sodaAll(SF_BUSINESSES.url, "starts_with(self_reported_naics_code,'23')")) {
      const owner = txt(r, "ownership_name"), dba = txt(r, "dba_name");
      if (!owner && !dba) continue;
      const ownerIsOrg = !!owner && ORG.test(owner);
      const closed = isoDay(r.location_end_date);
      const address = addressLine([txt(r, "full_business_address")], txt(r, "city"), txt(r, "state"), txt(r, "business_zip"));
      const mailing = addressLine([txt(r, "mailing_address_1")], txt(r, "mail_city"), txt(r, "mail_state"), txt(r, "mail_zipcode"));
      const h = licenseHit({
        state: "CA", source: "San Francisco registered businesses", sourceUrl: SF_BUSINESSES.datasetUrl,
        businessName: ownerIsOrg ? (dba && dba.toUpperCase() !== owner!.toUpperCase() ? `${owner} (d/b/a ${dba})` : owner) : dba,
        licenseNumber: txt(r, "certificate_number"), licenseType: "Business registration certificate", specialty: "Construction (self-reported NAICS 23)",
        status: closed ? `Location closed ${closed}` : "Location open", principal: ownerIsOrg ? null : owner, city: txt(r, "city"), expires: null,
        // The dataset has no ownership type: a person-named owner is a person's; a company-named one is unknown (a name
        // never makes a holder a business).
        holder: ownerIsOrg ? null : owner ? "individual" : null,
        address, phone: null, people: [{ name: ownerIsOrg ? null : owner, role: "Owner" }],
      });
      addKeys(h, { licenses: [txt(r, "certificate_number"), txt(r, "ttxid")], addresses: [address, mailing] });
      yield h;
    }
  },
};

const SEA_BUSINESSES = soda("cos-data.seattle.gov", "wnbq-64tb");
const seattle: BulkSource = {
  id: "wa-seattle-construction-businesses", state: "WA", label: "Seattle business license tax certificates (construction)", pageUrl: SEA_BUSINESSES.datasetUrl,
  everyHours: 24, minRows: 6_400,
  load: async function* () {
    for await (const r of sodaAll(SEA_BUSINESSES.url, "starts_with(naics_code,'23')")) {
      const legal = txt(r, "business_legal_name"), trade = txt(r, "trade_name");
      if (!legal) continue;
      const sole = txt(r, "ownership_type") === "Sole proprietorship";
      const h = licenseHit({
        state: "WA", source: "Seattle business license tax certificates", sourceUrl: SEA_BUSINESSES.datasetUrl,
        businessName: sole ? (trade && !namesMatch(trade, legal) ? trade : null) : trade && trade.toUpperCase() !== legal.toUpperCase() ? `${legal} (${trade})` : legal,
        licenseNumber: txt(r, "city_account_number"), licenseType: "Business license tax certificate (active)", specialty: txt(r, "naics_description"),
        status: "Active", principal: sole ? legal : null, city: txt(r, "city"), expires: null,
        // ownership_type, checked 2026-10-15; "Other" is on neither list.
        holder: entityHolder(txt(r, "ownership_type"), {
          business: /^(?:corporation|non profit corporation|association|joint venture|general partnership|limited partnership|limited liability ptrs llp|limited liability limited ptrs|llc - (?:multi|single) member|llc limited liability co)$/i,
          individual: /^sole proprietorship$/i,
        }),
        address: addressLine([txt(r, "street_address")], txt(r, "city"), txt(r, "state"), txt(r, "zip")), phone: txt(r, "business_phone"),
        people: [{ name: sole ? legal : null, role: "Owner (sole proprietor)" }],
      });
      // The state UBI ties the certificate to Washington L&I and Secretary of State records.
      addKeys(h, { licenses: [txt(r, "city_account_number"), txt(r, "ubi")] });
      yield h;
    }
  },
};
/** "RASUL ABDURAKHMANOV" and "ABDURAKHMANOV RASUL" are one name. */
const namesMatch = (a: string, b: string) => tokens(a).sort().join(" ") === tokens(b).sort().join(" ");

// ── Business-license registries labeled with NAICS titles: kept to construction contractors ───────────────────────
const CONSTRUCTION_TITLE = /\b(contractors?|construction|builders)\b/i;
const NOT_CONSTRUCTION = /food service|apparel|cut and sew|wholesal|material|machinery|equipment rental|leasing|manufactur|dealers|retail|stores/i;
export const isConstruction = (title: string | null) => !!title && CONSTRUCTION_TITLE.test(title) && !NOT_CONSTRUCTION.test(title);
const TITLE_WHERE = (f: string) => `${f} like '%Contractor%' OR ${f} like '%Construction%' OR ${f} like '%Builders%'`;

const NOLA = soda("data.nola.gov", "hjcd-grvu");
const newOrleans: BulkSource = {
  id: "la-new-orleans-contractors", state: "LA", label: "New Orleans occupational business licenses (contractors)", pageUrl: NOLA.datasetUrl,
  everyHours: 24, minRows: 1_000,
  load: async function* () {
    for await (const r of sodaAll(NOLA.url, TITLE_WHERE("businesstype"))) {
      if (!isConstruction(txt(r, "businesstype"))) continue;
      const biz = txt(r, "businessname"), owner = txt(r, "ownername");
      const named = biz && biz !== "0" ? biz : null;
      const ownerIsOrg = !!owner && ORG.test(owner);
      const business = named ?? (ownerIsOrg ? owner : null);
      const person = owner && !ownerIsOrg && owner !== business ? owner : null;
      if (!business && !person) continue;
      const address = addressLine([txt(r, "address")], txt(r, "city"), txt(r, "state"), txt(r, "zip"));
      const mailing = addressLine([txt(r, "mailaddress"), txt(r, "mailsuite")], txt(r, "mailcity"), txt(r, "mailstate"), txt(r, "mailzip"));
      const h = licenseHit({
        state: "LA", source: "New Orleans occupational business licenses", sourceUrl: NOLA.datasetUrl,
        businessName: business, licenseNumber: txt(r, "businesslicensenumber"), licenseType: "Occupational business license", specialty: txt(r, "businesstype"),
        status: "Licensed", principal: person, city: txt(r, "city"), expires: null, address, phone: txt(r, "phonenumber"),
        // No ownership type: a person owner with no business name is a person's; anything else is unknown.
        holder: ownerIsOrg || named ? null : "individual",
        people: [{ name: person, role: "Owner" }],
      });
      addKeys(h, { addresses: [address, mailing] });
      yield h;
    }
  },
};

const EBR = soda("data.brla.gov", "xw6s-bcqm");
// tstatus, from the column description: "O - Open or C - Closed".
const EBR_STATUS: Record<string, string> = { O: "Open", C: "Closed" };
const batonRouge: BulkSource = {
  id: "la-ebr-construction-businesses", state: "LA", label: "East Baton Rouge Parish business registrations (construction)", pageUrl: EBR.datasetUrl,
  everyHours: 24 * 7, minRows: 4_300,
  load: async function* () {
    for await (const r of sodaAll(EBR.url, "naicgroupname='Construction'")) {
      const name = txt(r, "tname"), legal = txt(r, "tlegalname");
      if (!name && !legal) continue;
      const contact = txt(r, "tcontactperson");
      const code = txt(r, "tstatus");
      const address = addressLine([txt(r, "tphysicaladdress1"), txt(r, "tphysicaladdress2")], txt(r, "tphysicalcity"), txt(r, "tphysicalstate"), txt(r, "tphysicalzipcode5"));
      const mailing = addressLine([txt(r, "tmailaddress1"), txt(r, "tmailaddress2")], txt(r, "tmailcity"), txt(r, "tmailstate"), txt(r, "tmailzipcode5"));
      const h = licenseHit({
        state: "LA", source: "East Baton Rouge Parish business registrations", sourceUrl: EBR.datasetUrl,
        businessName: legal && name && legal.toUpperCase() !== name.toUpperCase() ? `${legal} (${name})` : legal ?? name,
        licenseNumber: txt(r, "taccount"), licenseType: txt(r, "typename"), specialty: txt(r, "naicname"),
        status: code ? EBR_STATUS[code] ?? `code ${code}` : null, principal: contact && !ORG.test(contact) ? contact : null,
        holder: null, // no ownership type published
        city: txt(r, "tphysicalcity"), expires: null, address: address ?? mailing, phone: null,
        people: [{ name: contact && !ORG.test(contact) ? contact : null, role: "Account contact" }],
      });
      addKeys(h, { addresses: [address, mailing] });
      yield h;
    }
  },
};

const KCMO = soda("data.kcmo.org", "pnm4-68wg");
const kansasCity: BulkSource = {
  id: "mo-kansas-city-contractors", state: "MO", label: "Kansas City business license holders (construction)", pageUrl: KCMO.datasetUrl,
  everyHours: 24 * 7, minRows: 3_300,
  load: async function* () {
    for await (const r of sodaAll(KCMO.url, TITLE_WHERE("business_type"))) {
      if (!isConstruction(txt(r, "business_type"))) continue;
      const name = txt(r, "business_name"), dba = txt(r, "dba_name");
      if (!name && !dba) continue;
      const valid = txt(r, "valid_license_for");
      yield licenseHit({
        state: "MO", source: "Kansas City business license holders", sourceUrl: KCMO.datasetUrl,
        businessName: name && dba && dba.toUpperCase() !== name.toUpperCase() ? `${name} (d/b/a ${dba})` : name ?? dba,
        licenseNumber: null, licenseType: "Business license", specialty: txt(r, "business_type"), status: "Licensed", principal: null,
        city: txt(r, "city"), expires: valid ? ymd(valid) : null,
        holder: null, // no ownership type published
        address: addressLine([txt(r, "address")], txt(r, "city"), txt(r, "state"), txt(r, "zipcode")), phone: null, people: [],
      });
    }
  },
};

const NORFOLK = soda("data.norfolk.gov", "dpi6-sct5");
const norfolk: BulkSource = {
  id: "va-norfolk-contractors", state: "VA", label: "Norfolk business licenses (construction)", pageUrl: NORFOLK.datasetUrl, everyHours: 24 * 7, minRows: 1_100,
  load: async function* () {
    for await (const r of sodaAll(NORFOLK.url, TITLE_WHERE("naics"))) {
      if (!isConstruction(txt(r, "naics"))) continue;
      const trade = txt(r, "trading_as_name"), owner = txt(r, "primary_owner");
      if (!trade && !owner) continue;
      const ownerIsOrg = !!owner && ORG.test(owner);
      // "NO NORFOLK ADDRESS REQUIRED 99999": a business without a Norfolk location; its mailing address is its address.
      const loc = txt(r, "location_address");
      const location = loc && !/^NO NORFOLK ADDRESS/i.test(loc) ? loc.replace(/\s+(\d{5})$/, ", NORFOLK, VA $1") : null;
      const mailing = txt(r, "mailing_address");
      const h = licenseHit({
        state: "VA", source: "Norfolk business licenses", sourceUrl: NORFOLK.datasetUrl,
        businessName: ownerIsOrg && trade && owner!.toUpperCase() !== trade.toUpperCase() ? `${owner} (t/a ${trade})` : ownerIsOrg ? owner : trade,
        licenseNumber: null, licenseType: "Business license", specialty: txt(r, "naics"), status: null,
        principal: ownerIsOrg ? null : owner, city: null, expires: null,
        holder: ownerIsOrg ? null : owner ? "individual" : null, // no ownership type: a person owner is a person's; a company-named one unknown
        address: location ?? mailing, phone: null,
        people: [{ name: ownerIsOrg ? null : owner, role: "Primary owner" }],
      });
      addKeys(h, { addresses: [location, mailing] });
      yield h;
    }
  },
};

// ── Miami-Dade County ────────────────────────────────────────────────────────────────────────────────────────────
// The county's "Contractor" layer stopped updating on 2024-10-25 (its newest renewal and issue dates); still the
// county's own record of every contractor license, its tradesman, phones and addresses. Status letters are
// unexplained by the publisher, so they are shown as codes.
const MDC = "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/contractor_daily_data/FeatureServer/0";
const MDC_PAGE = "https://www.arcgis.com/home/item.html?id=1a2cb89e4c134eae80074395fd90d5b0";
/** Area code and a seven-digit number stored as integers (305, 6650239) → "3056650239"; null unless both are whole. */
export const mdcPhone = (area: unknown, num: unknown) => {
  const a = Number(area), n = Number(num);
  return a >= 200 && a <= 999 && n >= 2_000_000 && n <= 9_999_999 ? `${a}${n}` : null;
};
const mdcZip = (v: unknown) => { const t = v == null ? "" : String(v); return t.length === 9 ? t.slice(0, 5) : t.length === 5 ? t : null; };
const miamiDade: BulkSource = {
  id: "fl-miami-dade-contractors", state: "FL", label: "Miami-Dade County contractor licenses", pageUrl: MDC_PAGE, everyHours: 24 * 7, minRows: 15_000,
  load: async function* () {
    for await (const r of arcgisAll(MDC)) {
      const name = txt(r, "CONTRACTOR_NAME"), dba = txt(r, "CONTR_DBA_NAME");
      if (!name) continue;
      const tradesman = txt(r, "TRADESMEN_NAME"); // published last name first ("PERAZA GEORGE")
      const code = txt(r, "CONTRACTOR_STATUS");
      const trades = Array.from({ length: 10 }, (_, i) => txt(r, `TRADE_CATEGORY_DESC_${i + 1}`)).filter(Boolean);
      const phone = mdcPhone(r.CONTRACTOR_AREA_CODE, r.CONTRACTOR_PHONE);
      const address = addressLine([txt(r, "CONTRACTOR_ADDRESS")], txt(r, "CONTRACTOR_CITY"), txt(r, "CONTRACTOR_STATE"), mdcZip(r.CONTRACTOR_ZIPCODE));
      const h = licenseHit({
        state: "FL", source: "Miami-Dade County contractor licenses", sourceUrl: MDC_PAGE,
        businessName: dba && dba.toUpperCase() !== name.toUpperCase() ? `${name} (d/b/a ${dba})` : name,
        licenseNumber: txt(r, "CONTRACTOR_NUMBER"), licenseType: txt(r, "TRADE_CLASS_DESC"), specialty: trades.join(", ") || null,
        status: code ? `code ${code} (as of 2024-10-25)` : null, principal: tradesman, city: txt(r, "CONTRACTOR_CITY"), expires: null,
        holder: null, // no entity type published
        address, phone, people: [{ name: tradesman, role: "Tradesman" }],
      });
      // The tradesman's own phone and address are an individual's: never indexed (round 2, decision 2).
      addKeys(h, { phones: [phone], addresses: [address] });
      yield h;
    }
  },
};

// ── Las Vegas ────────────────────────────────────────────────────────────────────────────────────────────────────
const LV = "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/Business_Licenses_OpenData/FeatureServer/0";
const LV_PAGE = "https://www.arcgis.com/home/item.html?id=f6b923ee5eb9450baf6adebaf0f307ed";
const lasVegas: BulkSource = {
  id: "nv-las-vegas-contractors", state: "NV", label: "City of Las Vegas contractor business licenses", pageUrl: LV_PAGE, everyHours: 24, minRows: 9_800,
  load: async function* () {
    // One row per owner of a license: gather each license's owners ("Donald Terry - Manager").
    const byLicense = new Map<string, { row: Row; people: { name: string; role: string | null }[] }>();
    let oid: string | null = null;
    for await (const r of arcgisAll(LV, "Type_of_Business = 'Contractor'", "*", 2000, { onMeta: (m) => { oid = m.oid; } })) {
      // A row without a license number is its own record, keyed by the layer's real object-id field (from its metadata).
      const rowId = oid ? txt(r, oid) : null;
      const no = txt(r, "License__") ?? (rowId ? `row ${rowId}` : null);
      if (!no) throw new Error("Las Vegas business licenses: a row has neither a license number nor an object id");
      const entry = byLicense.get(no) ?? { row: r, people: [] };
      const owner = txt(r, "Owner_and_Owner_Title");
      const m = owner?.match(/^(.*?)\s+-\s+([^-]+)$/);
      const name = m ? m[1].trim() : owner;
      if (name && !entry.people.some((p) => p.name === name)) entry.people.push({ name, role: m ? m[2].trim() : null });
      byLicense.set(no, entry);
    }
    for (const { row: r, people } of Array.from(byLicense.values())) {
      const name = txt(r, "Business_Name");
      if (!name) continue;
      const zip = txt(r, "Zip_Code");
      yield licenseHit({
        state: "NV", source: "City of Las Vegas business licenses", sourceUrl: LV_PAGE,
        businessName: name, licenseNumber: txt(r, "License__"), licenseType: txt(r, "Type_of_Business"), specialty: null,
        status: txt(r, "Status"), principal: people.find((p) => !ORG.test(p.name))?.name ?? null, city: null, expires: null,
        holder: null, // no ownership type published (sole proprietors are licensed under their own names)
        address: addressLine([txt(r, "Address")], null, "NV", zip), phone: txt(r, "Phone"), people,
      });
    }
  },
};

// ── Tucson ───────────────────────────────────────────────────────────────────────────────────────────────────────
const TUCSON = "https://gis.tucsonaz.gov/arcgis/rest/services/PublicMaps/OpenData_EconomicDevelopment/MapServer/3";
const TUCSON_PAGE = "https://www.arcgis.com/home/item.html?id=b0e8f873aaeb4375b481979be334fbf2";
const tucson: BulkSource = {
  id: "az-tucson-contractors", state: "AZ", label: "Tucson business licenses (construction)", pageUrl: TUCSON_PAGE, everyHours: 24 * 7, minRows: 4_900,
  load: async function* () {
    for await (const r of arcgisAll(TUCSON, "NAIC_CODE LIKE '23%'")) {
      const name = txt(r, "ACC_NAME");
      if (!name) continue;
      yield licenseHit({
        state: "AZ", source: "Tucson business licenses", sourceUrl: TUCSON_PAGE,
        businessName: name, licenseNumber: txt(r, "ACC_NUM"), licenseType: "Business license", specialty: txt(r, "NAIC_DESC"),
        status: txt(r, "LIC_STATUS"), principal: null, city: txt(r, "CITY"), expires: null,
        holder: null, // no ownership type published
        address: addressLine([txt(r, "ADDRESS")], txt(r, "CITY"), txt(r, "STATE"), txt(r, "ZIP_CODE")), phone: null, people: [],
      });
    }
  },
};

// ── Sacramento County ────────────────────────────────────────────────────────────────────────────────────────────
// LicenseActivity is the applicant's own description ("General Contracting Services, Electrician Services"): kept
// when it names construction work, and shown as written.
const SAC = "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Business_Licenses/FeatureServer/0";
const SAC_PAGE = "https://www.arcgis.com/home/item.html?id=31a6cfbc26b9434093bc59b01b454b87";
const SAC_WORK = /contract|construct|electrician|electrical|plumb|roof|hvac|heating|air condition|carpent|drywall|concrete|mason|flooring|remodel|handyman|home repair|painting services|solar|framing|insulation|stucco|paving|excavat|demolition|fence|gutter|tile|cabinet install|window install|door install/i;
const SAC_NOT = /face painting|art |artist|auto|vehicle|boat|rental|wholesal|manufactur|supply|supplies|dealers|architect|inspection|estimat|drafting|computer|stereo|food|janitorial only/i;
const sacramentoCounty: BulkSource = {
  id: "ca-sacramento-county-contractors", state: "CA", label: "Sacramento County business licenses (construction work)", pageUrl: SAC_PAGE,
  everyHours: 24 * 7, minRows: 2_000,
  load: async function* () {
    for await (const r of arcgisAll(SAC)) {
      const activity = txt(r, "LicenseActivity");
      if (!activity || !SAC_WORK.test(activity) || SAC_NOT.test(activity)) continue;
      const name = txt(r, "Business_Name");
      if (!name) continue;
      const [city, st] = (txt(r, "CityState") ?? "").split(",").map((x) => x.trim());
      yield licenseHit({
        state: "CA", source: "Sacramento County business licenses", sourceUrl: SAC_PAGE,
        businessName: name, licenseNumber: txt(r, "Record_number"), licenseType: "Business license", specialty: activity,
        status: null, principal: null, city: city || null, expires: isoDay(r.ExpirationDate),
        holder: null, // no ownership type published (home-based licenses are common)
        // Home-based licenses are published without a street ("0") and with "Home Based Business" for the phone.
        address: txt(r, "StName") && txt(r, "stNumber") !== "0" ? addressLine([txt(r, "stNumber"), txt(r, "StName"), txt(r, "Suite")], city || null, st || null, txt(r, "Zip")) : null,
        phone: /\d{3}/.test(txt(r, "Business_Phone") ?? "") ? txt(r, "Business_Phone") : null, people: [],
      });
    }
  },
};

// ── Louisville Metro ─────────────────────────────────────────────────────────────────────────────────────────────
// Last updated 2022-06-19; kept for its names, license numbers, phones and addresses, with that date on the status.
const LOU = "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/Louisville_Metro_KY_Active_Contractors/FeatureServer/0";
const LOU_PAGE = "https://www.arcgis.com/home/item.html?id=267c8cf7a9254e5aaf6c22cfa43f4122";
const louisville: BulkSource = {
  id: "ky-louisville-contractors", state: "KY", label: "Louisville Metro contractor licenses (as of 2022-06-19)", pageUrl: LOU_PAGE, everyHours: 24 * 7, minRows: 2_200,
  load: async function* () {
    for await (const r of arcgisAll(LOU)) {
      const name = txt(r, "FULLNAME");
      if (!name) continue;
      const isOrg = ORG.test(name);
      yield licenseHit({
        state: "KY", source: "Louisville Metro contractor licenses", sourceUrl: LOU_PAGE,
        businessName: isOrg ? name : null, licenseNumber: txt(r, "LICENSENO"), licenseType: txt(r, "DESCRIPTION"), specialty: txt(r, "CATEGORY"),
        status: "Listed as active on 2022-06-19 (the layer's last update)", principal: isOrg ? null : name, city: txt(r, "CITY"), expires: isoDay(r.EXPIRATIONDATE),
        holder: isOrg ? null : "individual", // no type published: a person-named licensee is a person's; a company-named one unknown
        address: addressLine([txt(r, "ADDRESS1"), txt(r, "ADDRESS2")], txt(r, "CITY"), txt(r, "STATE"), txt(r, "ZIPCODE")), phone: txt(r, "DAYTIMEPHONE"),
        people: [{ name: isOrg ? null : name, role: "Licensee" }],
      });
    }
  },
};

/** Socrata datasets; `state` is the state the city or county is in. */
export const LOCAL_LICENSES: LicenseSource[] = [];
/** Bulk files; `state` is the state the city or county is in. */
// NYC DOB/DCWP licenses, the Montgomery County (MD) licenses, NYC DOB discipline and DCWP complaints are searched
// live by the NY and MD packs (states/ny.ts, states/md.ts), so they aren't listed here twice.
export const LOCAL_BULK: BulkSource[] = [chicagoHomeRepair, phlTrade, phlViolations, cleveland, nashville, dcContractors, longBeach, boulder, arlington, losAngeles, sanFrancisco, seattle, newOrleans, batonRouge, kansasCity, norfolk, miamiDade, lasVegas, tucson, sacramentoCounty, louisville];
/** Other live lookups, by state. */
export const LOCAL_LIVE: Record<string, LiveLicenseSearch[]> = {};
/** City and county enforcement datasets (companies only), searched like a state pack's `enforcement`. */
export const LOCAL_ENFORCEMENT: SodaEnforcement[] = nycEnforcement; // ECB violations only (see above)
/** Other city and county enforcement searches, by state. */
export const LOCAL_LIVE_ENFORCEMENT: Record<string, LiveEnforcementSearch[]> = {};

/**
 * City and county sources looked at on 2026-10-15 and not used (for the next person; not shown in reports). Cities
 * missing from both lists publish no contractor license or registration data we could find on their portals.
 */
export const LOCAL_BLOCKED: string[] = [
  "Pittsburgh PLI licensed contractors and trade licenses, Allegheny County registered master plumbers (data.wprdc.org): robots.txt disallows /datastore/dump/ and /api/ for every agent",
  "Henderson NV business licenses (maps.cityofhenderson.com OpenDataGovernment/0): a 2022 snapshot, every contractor license expired in 2023",
  "Howard County MD electric and utility trade licenses (opendata.howardcountymd.gov qa5k-m2n2): license numbers only, no names",
  "Dallas active contractors (dallasopendata.com jhgk-eg9m): last updated 2017-03-31",
  "Denver business licenses (data.colorado.gov s9wt-dsfz, ArcGIS ODC_active_business_licenses): no contractor license types; Denver's contractor licenses are not published",
  "Detroit BSEED business licenses (current): no contractor license types",
  "Cincinnati business licenses (data.cincinnati-oh.gov 7dk3-gngs): no contractor license types",
  "St. Louis business licenses 2024 (ArcGIS Business_License_2024): no business type to keep construction to",
  "Atlanta business licenses (ArcGIS GBL_WFL1): last updated 2023-04-24; the 2026 layer covers Main Street districts only",
  "San Diego County building permits - contractors (data.sandiegocounty.gov 76h4-nnmj): contractors on permits, not a license list (CSLB numbers already searched statewide)",
  "New York City stop-work orders: DOB publishes them only on complaint dispositions by property, never naming the contractor",
  "Chicago contractor violations: no dataset names contractors (Building Violations are by property); Chicago general-contractor and trade licenses are not on the portal",
];
