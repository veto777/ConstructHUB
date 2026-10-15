/**
 * City and county contractor licenses and registrations, searched in the reports of the state they're in, and the
 * city enforcement records that name contractors. Same rules and checks as a state pack (./types.ts): every dataset
 * below was opened and searched live on 2026-10-15; field names and status values are the publishers' own.
 *
 *   NY  New York City DOB licenses: general contractors, master plumbers, electrical contractors and firms,
 *       fire-suppression contractors, oil-burner installers, riggers, welders, site safety and other DOB trades (bulk)
 *   NY  New York City DCWP home-improvement contractor and construction-labor-provider licenses (bulk)
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
 *   MD  Montgomery County DPS licenses: building contractors (new-home builders), master and limited master
 *       electricians, limited electrical businesses, fire-system licensees (bulk)
 *   OH  Cleveland Building & Housing contractor registrations (active; bulk)
 *   TN  Nashville Metro Codes registered professional contractors and their licenses (bulk)
 *   PA  Philadelphia L&I trade licenses: contractors, electrical, plumbing, fire suppression, sheet metal, home
 *       improvement, demolition, excavation (bulk; the contractor's address joined from L&I permit contractors)
 *
 * Enforcement (companies only; LOCAL_ENFORCEMENT, for ../registry.ts):
 *   NY  New York City DOB disciplinary actions against licensees (1998 to today)
 *   NY  New York City DOB / ECB (OATH) building-code violations, by respondent
 *   NY  New York City DCWP consumer complaints (Sept 2022 to today)
 *   PA  Philadelphia L&I contractor violations (bulk, companies only)
 */
import type { LicenseHit } from "@shared/research-reports";
import { tokens, type LicenseSource } from "../licenses";
import { clean, type BulkHit, type BulkSource } from "../bulk";
import type { SodaEnforcement } from "../state-records";
import type { LiveEnforcementSearch, LiveLicenseSearch } from "./types";
import { addressLine, arcgisAll, fullName, isoDay, sodaAll, txt } from "./lib/local-fetch";

type Row = Record<string, unknown>;
const soda = (domain: string, id: string) => ({ datasetUrl: `https://${domain}/d/${id}`, url: `https://${domain}/resource/${id}.json` });

/** One license row as a bulk hit, indexed by its business name, its people, license number, phone and address. */
function licenseHit(h: Omit<LicenseHit, "matchedOn" | "people"> & { people: { name: string | null; role: string | null }[] }): BulkHit {
  const people = h.people.filter((p): p is { name: string; role: string | null } => !!p.name);
  return {
    kind: "license",
    hit: { ...h, people, matchedOn: h.businessName ? "business" : "principal" },
    business: h.businessName, person: people[0]?.name ?? null, people: people.slice(1).map((p) => p.name),
    keys: { licenses: [h.licenseNumber], phones: [h.phone], addresses: [h.address] },
  };
}

/** A name that is a company's ("ACME ROOFING LLC"), not a person's. */
const ORG = /\b(INC|INCORPORATED|LLC|L\.L\.C|LLP|LP|CORP|CORPORATION|CO|COMPANY|LTD|GROUP|ENTERPRISES?|SERVICES?|CONSTRUCTION|CONTRACTORS?|CONTRACTING|ROOFING|ELECTRIC(AL)?|PLUMBING|HEATING|MECHANICAL|BUILDERS?|ASSOCIATES|SYSTEMS|PARTNERS|HOLDINGS|SOLUTIONS|INDUSTRIES|DEVELOPMENT|RESTORATION|RENOVATIONS?|REMODELING|HOME|HOMES|TRUST)\b/i;

/** A status field that holds something else (a phone number in a few NYC DOB rows) is no status. */
const statusOf = (v: string | null) => (v && /[A-Za-z]/.test(v) ? v : null);

// ── New York City ────────────────────────────────────────────────────────────────────────────────────────────────
const NYC_DOB_LICENSES = soda("data.cityofnewyork.us", "t8hj-ruu2");
const NYC_DCWP_LICENSES = soda("data.cityofnewyork.us", "w7w3-xahh");

const nycDob: BulkSource = {
  id: "ny-nyc-dob-licenses", state: "NY", label: "New York City Department of Buildings licenses (contractors and trades)",
  pageUrl: NYC_DOB_LICENSES.datasetUrl, everyHours: 24, minRows: 72_000,
  load: async function* () {
    for await (const r of sodaAll(NYC_DOB_LICENSES.url)) {
      const person = fullName(txt(r, "first_name"), txt(r, "last_name"));
      const business = txt(r, "business_name");
      if (!person && !business) continue;
      yield licenseHit({
        state: "NY", source: "New York City DOB licenses", sourceUrl: NYC_DOB_LICENSES.datasetUrl,
        businessName: business, licenseNumber: txt(r, "license_number"), licenseType: txt(r, "license_type"), specialty: null,
        status: statusOf(txt(r, "license_status")), principal: person, city: txt(r, "license_business_city"), expires: null,
        address: addressLine([txt(r, "business_house_number"), txt(r, "business_street_name")], txt(r, "license_business_city"), txt(r, "business_state"), txt(r, "business_zip_code")),
        phone: txt(r, "business_phone_number"),
        people: [{ name: person, role: "Licensee" }],
      });
    }
  },
};

const nycDcwp: BulkSource = {
  id: "ny-nyc-dcwp-hic", state: "NY", label: "New York City DCWP home-improvement contractor licenses",
  pageUrl: NYC_DCWP_LICENSES.datasetUrl, everyHours: 24, minRows: 13_000,
  load: async function* () {
    for await (const r of sodaAll(NYC_DCWP_LICENSES.url, "business_category in ('Home Improvement Contractor','Construction Labor Provider')")) {
      const name = txt(r, "business_name"), dba = txt(r, "dba_trade_name");
      if (!name) continue;
      const business = dba && dba.toUpperCase() !== name.toUpperCase() ? `${name} (d/b/a ${dba})` : name;
      yield licenseHit({
        state: "NY", source: "New York City DCWP licenses", sourceUrl: NYC_DCWP_LICENSES.datasetUrl,
        businessName: business, licenseNumber: txt(r, "license_nbr"), licenseType: txt(r, "business_category"), specialty: null,
        status: txt(r, "license_status"), principal: null, city: txt(r, "address_city"), expires: isoDay(r.lic_expir_dd),
        address: addressLine([txt(r, "address_building"), txt(r, "address_street_name")], txt(r, "address_city"), txt(r, "address_state"), txt(r, "address_zip")),
        phone: txt(r, "contact_phone"), people: [],
      });
    }
  },
};

const nycEnforcement: SodaEnforcement[] = [
  {
    state: "NY", source: "New York City DOB disciplinary actions", scope: "Actions against DOB licensees' companies, 1998 to today",
    ...soda("data.cityofnewyork.us", "ndq3-kuef"), nameFields: ["company"],
    toHit: (r: Row) => {
      const lic = txt(r, "license_no")?.replace(/^#/, "") ?? null;
      return {
        category: "discipline", name: txt(r, "company"), id: null, date: isoDay(r.date), endDate: null,
        status: "DOB disciplinary action", city: "New York City",
        detail: [txt(r, "license_type") ? `${txt(r, "license_type")} license${lic ? ` #${lic}` : ""}` : null, txt(r, "disposition")].filter(Boolean).join(". ").slice(0, 800) || null,
        amount: null, adverse: true, licenseNumber: lic,
      };
    },
  },
  {
    state: "NY", source: "New York City DOB / ECB building-code violations", scope: "Violations where the company is the respondent, 1980s to today",
    ...soda("data.cityofnewyork.us", "6bgk-3dad"), nameFields: ["respondent_name"], order: "issue_date DESC",
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
  {
    state: "NY", source: "New York City DCWP consumer complaints", scope: "Complaints filed with the Department of Consumer and Worker Protection, Sept 2022 to today",
    ...soda("data.cityofnewyork.us", "nre2-6m2s"), nameFields: ["business_name"], order: "intake_date DESC",
    toHit: (r: Row) => {
      const refund = Number(r.refund_amount);
      return {
        category: "complaint", name: txt(r, "business_name"), id: txt(r, "record_id"), date: isoDay(r.intake_date), endDate: isoDay(r.result_date),
        status: txt(r, "result") ? `Complaint: ${txt(r, "result")}` : "Complaint", city: txt(r, "city"),
        detail: [txt(r, "business_category"), txt(r, "complaint_code"), Number.isFinite(refund) && refund > 0 ? `refund $${refund.toLocaleString("en-US")}` : null].filter(Boolean).join(". ") || null,
        amount: null, adverse: null,
        address: addressLine([txt(r, "building_nbr"), txt(r, "street1")], txt(r, "city"), txt(r, "state"), txt(r, "postcode")),
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
const phlDba = (v: string | null) => { const m = v?.match(/^(.*?)\s+DBA:\s*(.*)$/i); return m ? { who: m[1].trim() || null, dba: m[2].trim() || null } : { who: v, dba: null }; };

const phlTrade: BulkSource = {
  id: "pa-phl-trade-licenses", state: "PA", label: "Philadelphia L&I trade and contractor licenses", pageUrl: PHL_PAGE,
  everyHours: 24 * 7, minRows: 28_000,
  load: async function* () {
    // The latest address each contractor gave on a permit, by commercial activity license number.
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
        status: txt(r, "licensestatus"), principal: who, city: "Philadelphia", expires: isoDay(r.expirationdate),
        address: cal ? addr.get(cal) ?? null : null, phone: null,
        people: [{ name: who, role: "Licensee" }],
      });
      if (h.keys) h.keys.licenses = [txt(r, "licensenumber"), cal];
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

// ── Montgomery County, Maryland (Department of Permitting Services) ─────────────────────────────────────────────
type MocoSet = { id: string; slug: string; label: string; floor: number; f: { no: string; type: string; who: string; extra?: string; trade?: string; addr: string; addr2: string; zip: string; phone?: string; expires: string } };
const MOCO_STD = { no: "licenseno", type: "licensetype", who: "applicant", addr: "addr1", addr2: "addr2", zip: "zip", expires: "expiredate" };
const MOCO: MocoSet[] = [
  { id: "c7hs-c9qq", slug: "builders", label: "Montgomery County (MD) building contractor licenses", floor: 1_700, f: { ...MOCO_STD, extra: "additionalapplicant", trade: "businessname", phone: "telephone" } },
  { id: "v8mn-6i2r", slug: "master-electricians", label: "Montgomery County (MD) master electrician licenses", floor: 2_900, f: MOCO_STD },
  { id: "f637-ajic", slug: "limited-master-electricians", label: "Montgomery County (MD) limited master electrician licenses", floor: 400, f: MOCO_STD },
  { id: "rmjr-4zb9", slug: "limited-electrical-businesses", label: "Montgomery County (MD) limited electrical business licenses", floor: 290, f: MOCO_STD },
  { id: "yjd7-guhd", slug: "fire-systems", label: "Montgomery County (MD) fire-system licenses", floor: 560,
    f: { no: "license_number", type: "license_type", who: "applicant", addr: "address1", addr2: "address2", zip: "zip_code", expires: "expired_date" } },
];

const mocoSource = (m: MocoSet): BulkSource => {
  const ds = soda("data.montgomerycountymd.gov", m.id);
  return {
    id: `md-moco-${m.slug}`, state: "MD", label: m.label, pageUrl: ds.datasetUrl, everyHours: 24 * 7, minRows: m.floor,
    load: async function* () {
      for await (const r of sodaAll(ds.url)) {
        const raw = txt(r, m.f.who);
        if (!raw || /^TEST ONLY/i.test(raw)) continue;
        // A few names carry the county's own markers ("BAD - ", "EXPIRED - ", " - INACTIVE LIMITED MASTER"): searched
        // without them, and shown as published in the specialty line.
        const marked = /\b(BAD|EXPIRED)\s+-\s|\s-\s+INACTIVE\b/i.test(raw);
        const applicant = clean(raw.replace(/^[_\s]+/, "").replace(/\b(BAD|EXPIRED)\s+-\s+/gi, " ").replace(/\s+-\s+INACTIVE\b.*$/i, ""));
        if (!applicant) continue;
        const trade = m.f.trade ? txt(r, m.f.trade) : null;
        const extra = m.f.extra ? txt(r, m.f.extra) : null;
        const isOrg = ORG.test(applicant) || !!trade || m.slug === "limited-electrical-businesses";
        const business = isOrg ? (trade && trade.toUpperCase() !== applicant.toUpperCase() ? `${applicant} (${trade})` : applicant) : null;
        yield licenseHit({
          state: "MD", source: m.label, sourceUrl: ds.datasetUrl,
          businessName: business, licenseNumber: txt(r, m.f.no), licenseType: txt(r, m.f.type), specialty: [txt(r, "scope_limitation"), marked ? `name as published: ${raw}` : null].filter(Boolean).join("; ") || null,
          status: null, principal: isOrg ? extra : applicant, city: txt(r, "city"), expires: isoDay(r[m.f.expires]),
          address: addressLine([txt(r, m.f.addr)], txt(r, "city"), txt(r, "state"), txt(r, m.f.zip)),
          phone: m.f.phone ? txt(r, m.f.phone) : null,
          people: [{ name: isOrg ? extra : applicant, role: isOrg ? "Additional applicant" : "Licensee" }],
        });
      }
    },
  };
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
        address: addressLine([txt(r, "B1_ADDRESS1"), txt(r, "B1_ADDRESS2")], txt(r, "B1_CITY"), txt(r, "B1_STATE"), txt(r, "B1_ZIP")),
        phone: txt(r, "B1_PHONE1"), people: [],
      });
      if (h.keys) h.keys.licenses = [txt(r, "B1_ALT_ID"), rrp];
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
        businessName: name, licenseNumber: null, licenseType: txt(r, "Prof__Type"), specialty: null, status: "Active (registered with Metro Codes)",
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
        address: addressLine([txt(r, "address")], txt(r, "city"), txt(r, "state"), txt(r, "zip_code")), phone: null, people,
      });
    }
  },
};

// ── Washington, DC (Department of Licensing and Consumer Protection) ─────────────────────────────────────────────
const DC_BBL = "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/0";
const DC_PAGE = "https://www.arcgis.com/home/item.html?id=85bf98d3915f412c8a4de706f2d13513";
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
        city: premise?.split(",")[1]?.trim() ?? null, expires: isoDay(r.LICENSEENDDATE), address: premise, phone: null,
        people: [{ name: owner ?? (sole ? entity : null), role: "Owner" }, { name: agent && agent !== owner ? agent : null, role: "Registered agent" }],
      });
      if (h.keys) h.keys.addresses = [premise, billing];
      yield h;
    }
  },
};

// ── Long Beach, California ───────────────────────────────────────────────────────────────────────────────────────
const LB = "https://services6.arcgis.com/yCArG7wGXGyWLqav/arcgis/rest/services/Business_Licenses_Public_View/FeatureServer/0";
const LB_PAGE = "https://www.arcgis.com/home/item.html?id=54d45ca9c4554062a02df49ec1ea2b2a";
const longBeach: BulkSource = {
  id: "ca-long-beach-contractors", state: "CA", label: "Long Beach business licenses (contracting)", pageUrl: LB_PAGE, everyHours: 24, minRows: 20_000,
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
      });
      if (h.keys) h.keys.addresses = [address, mailing];
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
        address, phone: null, people: [{ name: ownerIsOrg ? null : owner, role: "Owner" }],
      });
      if (h.keys) { h.keys.licenses = [txt(r, "certificate_number"), txt(r, "ttxid")]; h.keys.addresses = [address, mailing]; }
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
        address: addressLine([txt(r, "street_address")], txt(r, "city"), txt(r, "state"), txt(r, "zip")), phone: txt(r, "business_phone"),
        people: [{ name: sole ? legal : null, role: "Owner (sole proprietor)" }],
      });
      // The state UBI ties the certificate to Washington L&I and Secretary of State records.
      if (h.keys) h.keys.licenses = [txt(r, "city_account_number"), txt(r, "ubi")];
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
        people: [{ name: person, role: "Owner" }],
      });
      if (h.keys) h.keys.addresses = [address, mailing];
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
        city: txt(r, "tphysicalcity"), expires: null, address: address ?? mailing, phone: null,
        people: [{ name: contact && !ORG.test(contact) ? contact : null, role: "Account contact" }],
      });
      if (h.keys) h.keys.addresses = [address, mailing];
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
        address: location ?? mailing, phone: null,
        people: [{ name: ownerIsOrg ? null : owner, role: "Primary owner" }],
      });
      if (h.keys) h.keys.addresses = [location, mailing];
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
      const tPhone = mdcPhone(r.TRADESMAN_AREA_CODE, r.TRADESMAN_PHONE);
      const address = addressLine([txt(r, "CONTRACTOR_ADDRESS")], txt(r, "CONTRACTOR_CITY"), txt(r, "CONTRACTOR_STATE"), mdcZip(r.CONTRACTOR_ZIPCODE));
      const tAddress = addressLine([txt(r, "TRADESMEN_ADDRESS")], txt(r, "TRADESMAN_CITY"), txt(r, "TRADESMAN_STATE"), mdcZip(r.TRADESMAN_ZIPCODE));
      const h = licenseHit({
        state: "FL", source: "Miami-Dade County contractor licenses", sourceUrl: MDC_PAGE,
        businessName: dba && dba.toUpperCase() !== name.toUpperCase() ? `${name} (d/b/a ${dba})` : name,
        licenseNumber: txt(r, "CONTRACTOR_NUMBER"), licenseType: txt(r, "TRADE_CLASS_DESC"), specialty: trades.join(", ") || null,
        status: code ? `code ${code} (as of 2024-10-25)` : null, principal: tradesman, city: txt(r, "CONTRACTOR_CITY"), expires: null,
        address, phone, people: [{ name: tradesman, role: "Tradesman" }],
      });
      if (h.keys) { h.keys.phones = [phone, tPhone]; h.keys.addresses = [address, tAddress]; }
      yield h;
    }
  },
};

// ── Las Vegas ────────────────────────────────────────────────────────────────────────────────────────────────────
const LV = "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/Business_Licenses_OpenData/FeatureServer/0";
const LV_PAGE = "https://www.arcgis.com/home/item.html?id=f6b923ee5eb9450baf6adebaf0f307ed";
const lasVegas: BulkSource = {
  id: "nv-las-vegas-contractors", state: "NV", label: "City of Las Vegas contractor business licenses", pageUrl: LV_PAGE, everyHours: 24, minRows: 7_000,
  load: async function* () {
    // One row per owner of a license: gather each license's owners ("Donald Terry - Manager").
    const byLicense = new Map<string, { row: Row; people: { name: string; role: string | null }[] }>();
    for await (const r of arcgisAll(LV, "Type_of_Business = 'Contractor'")) {
      const no = txt(r, "License__") ?? `row ${txt(r, "ObjectId")}`;
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
        address: addressLine([txt(r, "ADDRESS1"), txt(r, "ADDRESS2")], txt(r, "CITY"), txt(r, "STATE"), txt(r, "ZIPCODE")), phone: txt(r, "DAYTIMEPHONE"),
        people: [{ name: isOrg ? null : name, role: "Licensee" }],
      });
    }
  },
};

/** Socrata datasets; `state` is the state the city or county is in. */
export const LOCAL_LICENSES: LicenseSource[] = [];
/** Bulk files; `state` is the state the city or county is in. */
export const LOCAL_BULK: BulkSource[] = [chicagoHomeRepair, nycDob, nycDcwp, phlTrade, phlViolations, ...MOCO.map(mocoSource), cleveland, nashville, dcContractors, longBeach, boulder, arlington, losAngeles, sanFrancisco, seattle, newOrleans, batonRouge, kansasCity, norfolk, miamiDade, lasVegas, tucson, sacramentoCounty, louisville];
/** Other live lookups, by state. */
export const LOCAL_LIVE: Record<string, LiveLicenseSearch[]> = {};
/** City and county enforcement datasets (companies only), searched like a state pack's `enforcement`. */
export const LOCAL_ENFORCEMENT: SodaEnforcement[] = [...nycEnforcement];
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
