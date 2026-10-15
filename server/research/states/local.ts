/**
 * City and county contractor licenses and registrations, searched in the reports of the state they're in, and the
 * city enforcement records that name contractors. Same rules and checks as a state pack (./types.ts): every dataset
 * below was opened and searched live on 2026-10-15; field names and status values are the publishers' own.
 *
 *   NY  New York City DOB licenses: general contractors, master plumbers, electrical contractors and firms,
 *       fire-suppression contractors, oil-burner installers, riggers, welders, site safety and other DOB trades (bulk)
 *   NY  New York City DCWP home-improvement contractor and construction-labor-provider licenses (bulk)
 *
 * Enforcement (companies only; LOCAL_ENFORCEMENT, for ../registry.ts):
 *   NY  New York City DOB disciplinary actions against licensees (1998 to today)
 *   NY  New York City DOB / ECB (OATH) building-code violations, by respondent
 *   NY  New York City DCWP consumer complaints (Sept 2022 to today)
 */
import type { LicenseHit } from "@shared/research-reports";
import type { LicenseSource } from "../licenses";
import type { BulkHit, BulkSource } from "../bulk";
import type { SodaEnforcement } from "../state-records";
import type { LiveEnforcementSearch, LiveLicenseSearch } from "./types";
import { addressLine, fullName, isoDay, sodaAll, txt } from "./lib/local-fetch";

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

/** Socrata datasets; `state` is the state the city or county is in. */
export const LOCAL_LICENSES: LicenseSource[] = [];
/** Bulk files; `state` is the state the city or county is in. */
export const LOCAL_BULK: BulkSource[] = [nycDob, nycDcwp];
/** Other live lookups, by state. */
export const LOCAL_LIVE: Record<string, LiveLicenseSearch[]> = {};
/** City and county enforcement datasets (companies only), searched like a state pack's `enforcement`. */
export const LOCAL_ENFORCEMENT: SodaEnforcement[] = [...nycEnforcement];
/** Other city and county enforcement searches, by state. */
export const LOCAL_LIVE_ENFORCEMENT: Record<string, LiveEnforcementSearch[]> = {};
