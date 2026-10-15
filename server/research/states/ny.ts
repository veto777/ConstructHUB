/**
 * New York. Checked live 2026-10-15. New York licenses no general or home-improvement contractor statewide: cities and
 * counties do (New York City's are searched here). The state licenses a few construction trades through the
 * Department of Labor. The NY DOL contractor registry (public work) is already in ../licenses.ts.
 *
 * Licenses (open data, Socrata):
 *   NY DOL elevator contractor licenses               data.ny.gov jrac-r9vc   (businesses)
 *   NY DOL elevator mechanic and inspector licenses   data.ny.gov cxfs-ya8e   (people)
 *   NY DOL mold contractor licenses (4-year window)   data.ny.gov ikqx-ispy   (businesses)
 *   NY DOL mold individual licenses (4-year window)   data.ny.gov h6jr-vxqt   (people)
 *   NY DOL asbestos certificates (2-year window)      data.ny.gov 95bk-87hc   (people)
 *   NY DOL crane operator certificates                data.ny.gov bu6a-ty84   (people)
 *   NY DOL blaster certificates                       data.ny.gov 65tz-hymq   (people)
 *   NY DOS licensed home inspectors                   data.ny.gov r9fr-48vu   (people)
 *   NYC DOB licenses (GC registrations, master plumbers, electricians, riggers, site safety, …)  data.cityofnewyork.us t8hj-ruu2
 *   NYC DCWP home improvement contractor licenses     data.cityofnewyork.us w7w3-xahh (business_category filter)
 *
 * Enforcement and standing (companies only):
 *   NY DOL / WCB public-work debarment list (Labor Law Articles 8 and 9; Workers' Comp Law 141-b), live search form
 *   NYS non-responsible entities (Executive Order 192)  data.ny.gov jhxt-dfv6
 *   NY Department of State active corporations          data.ny.gov n9v6-gdp6 (business_status, not adverse)
 *   NYC DOB disciplinary actions against licensees      data.cityofnewyork.us ndq3-kuef (searched by the company named)
 *   NYC DCWP charges (violations from inspections)      data.cityofnewyork.us 5fn4-dr26
 *
 * Complaints:
 *   NYC DCWP consumer complaints                        data.cityofnewyork.us nre2-6m2s
 */
import type { EnforcementHit } from "@shared/research-reports";
import type { LicenseSource } from "../licenses";
import type { SodaEnforcement } from "../state-records";
import type { ComplaintSource } from "../records";
import { politeFetch } from "../http";
import { adverseFrom, hasEnded } from "../adverse";
import { withNote } from "../notes";
import { decodeEntities } from "../bulk-sources";
import { clean, usDate } from "../bulk";
import type { LiveEnforcementSearch, StatePack } from "./types";

const soda = (domain: string, id: string) => ({ datasetUrl: `https://${domain}/d/${id}`, url: `https://${domain}/resource/${id}.json` });
const NY = "data.ny.gov";
const NYC = "data.cityofnewyork.us";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => clean(v == null ? null : String(v));
const day = (v: unknown): string | null => { const t = s(v); if (!t) return null; const m = t.match(/^(\d{4})-\d{2}-\d{2}/); return m && +m[1] >= 1900 ? t.slice(0, 10) : usDate(t); };
const num = (v: unknown): number | null => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };

const LICENSES: LicenseSource[] = [
  { state: "NY", source: "New York DOL elevator contractor licenses", ...soda(NY, "jrac-r9vc"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "license_type", specialty: null, status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: null, address: "address", zip: "zip_code", phone: "phone" },
  { state: "NY", source: "New York DOL elevator mechanic and inspector licenses", ...soda(NY, "cxfs-ya8e"),
    fields: { businessName: null, licenseNumber: "license_number", licenseType: "license_type", specialty: null, status: "license_status", principal: null, city: null, expires: "expiration_date" },
    personField: ["first_name", "last_name"] },
  { state: "NY", source: "New York DOL mold contractor licenses", ...soda(NY, "ikqx-ispy"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "license_type", specialty: "dba_name", status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: null, address: ["address", "address_2"], zip: "zip_code", phone: "phone" },
  { state: "NY", source: "New York DOL mold individual licenses", ...soda(NY, "h6jr-vxqt"),
    fields: { businessName: null, licenseNumber: "license_number", licenseType: "license_type", specialty: null, status: "license_status", principal: null, city: null, expires: "expiration_date" },
    personField: ["first_name", "last_name"] },
  { state: "NY", source: "New York DOL asbestos certificates", ...soda(NY, "95bk-87hc"),
    fields: { businessName: null, licenseNumber: "certificate_number", licenseType: "endorsement_type", specialty: null, status: "certificate_status", principal: null, city: null, expires: "expiration_date" },
    personField: ["first_name", "last_name"] },
  { state: "NY", source: "New York DOL crane operator certificates", ...soda(NY, "bu6a-ty84"),
    fields: { businessName: null, licenseNumber: "certificate_number", licenseType: "class", specialty: null, status: "certificate_status", principal: null, city: null, expires: "expiration_date" },
    personField: ["first_name", "last_name"] },
  { state: "NY", source: "New York DOL blaster certificates", ...soda(NY, "65tz-hymq"),
    fields: { businessName: null, licenseNumber: "certificate_number", licenseType: "class", specialty: null, status: "certificate_status", principal: null, city: null, expires: "expiration_date" },
    personField: ["first_name", "last_name"] },
  { state: "NY", source: "New York DOS licensed home inspectors", ...soda(NY, "r9fr-48vu"),
    fields: { businessName: "hi_business_name", licenseNumber: "uid", licenseType: null, specialty: null, status: null, principal: null, city: "business_city", expires: "current_expire_date" },
    personField: ["first_name", "middle_initial", "last_name"], address: ["business_street", "business_apt_unit"], zip: "business_zip_code" },
  { state: "NY", source: "New York City DOB licenses (contractors and trades)", ...soda(NYC, "t8hj-ruu2"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "license_type", specialty: null, status: "license_status", principal: null, city: "license_business_city", expires: null },
    personField: ["first_name", "last_name"], address: ["business_house_number", "business_street_name"], zip: "business_zip_code", phone: "business_phone_number" },
  { state: "NY", source: "New York City DCWP home improvement contractor licenses", ...soda(NYC, "w7w3-xahh"),
    fields: { businessName: "business_name", licenseNumber: "license_nbr", licenseType: "business_category", specialty: "dba_trade_name", status: "license_status", principal: null, city: "address_city", expires: "lic_expir_dd" },
    personField: null, address: ["address_building", "address_street_name"], zip: "address_zip", phone: "contact_phone",
    filter: "business_category='Home Improvement Contractor'" },
];

const ENFORCEMENT: SodaEnforcement[] = [
  {
    state: "NY", source: "New York State non-responsible entities (Executive Order 192)", scope: "Vendors found non-responsible by a state agency or authority, 2019 to today",
    ...soda(NY, "jhxt-dfv6"), nameFields: ["nonresponsiblecontractor"],
    toHit: (r: Row) => ({
      category: "debarment", name: s(r.nonresponsiblecontractor), id: null,
      // The dataset stores the year as two digits ("0024-10-01"); a date that can't be read as published is not given.
      date: day(r.datenonresponsibilitydetermination), endDate: null, status: "Found non-responsible",
      city: null,
      detail: [s(r.agencyauthorityname) ? `Determination by ${s(r.agencyauthorityname)}` : null,
        s(r.datenonresponsibilitydetermination) && !day(r.datenonresponsibilitydetermination) ? `determination date as published: ${s(r.datenonresponsibilitydetermination)?.slice(0, 10)}` : null].filter(Boolean).join("; ") || null,
      amount: null, adverse: true,
    }),
  },
  {
    state: "NY", source: "New York Department of State active corporations", scope: "Every entity on file as active, updated monthly",
    ...soda(NY, "n9v6-gdp6"), nameFields: ["current_entity_name"],
    toHit: (r: Row) => ({
      category: "business_status", name: s(r.current_entity_name), id: s(r.dos_id), date: day(r.initial_dos_filing_date), endDate: null,
      status: "Active (on the Department of State's active-entity list)", city: s(r.county) ? `${s(r.county)} County` : null,
      detail: [s(r.entity_type), s(r.jurisdiction) ? `jurisdiction ${s(r.jurisdiction)}` : null].filter(Boolean).join(", ") || null,
      amount: null, adverse: null,
      // The entity's location when it filed one, else its address for service of process.
      address: s(r.location_address_1)
        ? [s(r.location_address_1), s(r.location_address_2), s(r.location_city), s(r.location_state), s(r.location_zip)].filter(Boolean).join(" ")
        : [s(r.dos_process_address_1), s(r.dos_process_address_2), s(r.dos_process_city), s(r.dos_process_state), s(r.dos_process_zip)].filter(Boolean).join(" ") || null,
    }),
  },
  {
    state: "NY", source: "New York City DOB disciplinary actions", scope: "Actions against DOB licensees, by the company named, 1998 to today",
    ...soda(NYC, "ndq3-kuef"), nameFields: ["company"], order: "year DESC",
    toHit: (r: Row) => {
      // "date" is MM/DD/YY; the row's own "year" column gives the century.
      const m = s(r.date)?.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
      const y = s(r.year);
      const date = m && y && y.slice(2) === m[3] ? `${y}-${m[1]}-${m[2]}` : null;
      return {
        category: "discipline", name: s(r.company), id: s(r.license_no), date, endDate: null, status: "Disciplinary action",
        city: null,
        detail: [s(r.license_type) ? `Against a ${s(r.license_type)} licensee of the company` : null, s(r.disposition), !date && y ? `year ${y}` : null].filter(Boolean).join(". ") || null,
        // From DOB's own disposition ("Fine.", "Revoked.", "Voluntary surrender."; "Warning Letter." or "ACD." say
        // neither way): unknown is null, never assumed adverse (decision 2).
        amount: null, adverse: adverseFrom(s(r.disposition)), licenseNumber: s(r.license_no)?.replace(/^#/, "") ?? null,
      };
    },
  },
  {
    state: "NY", source: "New York City DCWP charges", scope: "Charges from DCWP inspections, by business name",
    ...soda(NYC, "5fn4-dr26"), nameFields: ["business_name", "dba_trade_name"], order: "violation_date DESC",
    toHit: (r: Row) => {
      const guilty = num(r.guilty), notGuilty = num(r.not_guilty), dismissed = num(r.dismissed), count = num(r.charge_count);
      return {
        category: "discipline", name: [s(r.business_name), s(r.dba_trade_name)].filter(Boolean).join(" / ") || null, id: s(r.record_id),
        date: day(r.violation_date), endDate: null, status: s(r.outcome) ? `Outcome: ${s(r.outcome)}` : "Charged",
        city: null,
        detail: [s(r.business_category), s(r.charge)?.slice(0, 400), count != null ? `${count} count(s)` : null,
          guilty ? `${guilty} guilty` : null, notGuilty ? `${notGuilty} not guilty` : null, dismissed ? `${dismissed} dismissed` : null].filter(Boolean).join(". ") || null,
        amount: null, adverse: guilty ? true : count && ((notGuilty ?? 0) + (dismissed ?? 0)) >= count ? false : null,
      };
    },
  },
];

const COMPLAINTS: ComplaintSource[] = [
  {
    state: "NY", source: "New York City DCWP consumer complaints", scope: "Complaints to the city's Department of Consumer and Worker Protection",
    ...soda(NYC, "nre2-6m2s"), nameField: "business_name", dateField: "intake_date",
    toHit: (r: Row) => ({
      id: s(r.record_id), opened: day(r.intake_date), closed: day(r.result_date), status: s(r.result), business: s(r.business_name),
      city: s(r.city), category: s(r.business_category), description: s(r.complaint_code),
      resolution: [num(r.refund_amount) ? `refund $${num(r.refund_amount)}` : null, num(r.contract_cancelled_amount) ? `contract cancelled $${num(r.contract_cancelled_amount)}` : null].filter(Boolean).join(", ") || null,
      savings: num(r.refund_amount),
    }),
  },
];

// ── NY DOL / WCB public-work debarment list (live search form) ──────────────────────────────────────────────────
const EDLIST = "https://apps.labor.ny.gov/EDList/searchPage.do";
const EDLIST_RESULTS = "https://apps.labor.ny.gov/EDList/searchResults.do";
const EDLIST_HOST = "https://apps.labor.ny.gov";

/** Rows of one result page. DOL rows have a "Fiscal Officer" column (DOL, NYC, AG or DA); WCB rows don't. */
export function parseEdList(html: string, agency: "DOL" | "WCB"): EnforcementHit[] {
  const text = (v: string) => clean(decodeEntities(v.replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, " ")));
  const table = html.match(/<table id="ResultsTable"[\s\S]*?<\/table>/)?.[0] ?? "";
  const out: EnforcementHit[] = [];
  for (const m of Array.from(table.matchAll(/<tr class="(?:odd|even)">([\s\S]*?)<\/tr>/g))) {
    const raw = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    const cells = raw.map(text);
    const c = agency === "DOL" ? cells : [cells[0], null, ...cells.slice(1)];
    if (c.length < 8) continue;
    const [ag, fiscal, , name, dba, address, start, end] = c;
    if (!name) continue;
    const endDate = usDate(end);
    const ended = hasEnded(endDate);
    // The address cell's last line is "CITY, ST ZIP": the city is that line without the ZIP (never "NY, 12203").
    const lastLine = text((raw[agency === "DOL" ? 5 : 4] ?? "").split(/<br\s*\/?>/i).pop() ?? "");
    const city = lastLine ? clean(lastLine.replace(/[,\s]*\d{5}(?:-\d{4})?\s*$/, "").replace(/,\s*$/, "")) : null;
    out.push({
      state: "NY", source: "New York DOL / Workers' Compensation Board public-work debarments", sourceUrl: EDLIST, category: "debarment",
      name: [name, dba].filter(Boolean).join(" / "), id: null, date: usDate(start), endDate,
      status: ended ? "Debarment period over" : "Debarred from public work",
      city: city && /[A-Za-z]/.test(city) ? city : null, address,
      detail: agency === "DOL"
        ? `Debarred under NYS Labor Law Article 8 or 9 (prevailing wage)${fiscal ? `; determination by ${fiscal === "DOL" ? "the NYS Department of Labor" : fiscal === "NYC" ? "the New York City Comptroller" : fiscal === "AG" ? "the NYS Attorney General" : fiscal === "DA" ? "a county District Attorney" : fiscal}` : ""}`
        : `Debarred by the Workers' Compensation Board under Workers' Compensation Law section 141-b${ag && ag !== "WCB" ? ` (agency ${ag})` : ""}`,
      // On the list is the agency's finding; once the debarment period is over it no longer applies (decision 2).
      amount: null, adverse: !ended,
    });
  }
  return out;
}

const EDLIST_MAX_PAGES = 6;

/** The form matches names from the start: search the first two words, then the caller keeps whole-name matches. */
async function searchEdList(name: string): Promise<EnforcementHit[]> {
  const words = name.toUpperCase().replace(/[^A-Z0-9&' -]/g, " ").split(/\s+/).filter(Boolean);
  const prefix = words.slice(0, words[0]?.length >= 4 ? 2 : 3).join(" ");
  if (prefix.length < 3) return [];
  const hits: EnforcementHit[] = [];
  const notes: string[] = [];
  const page = await politeFetch(EDLIST, {}, { minDelayMs: 1500 });
  if (!page.ok) throw new Error(`NY DOL debarment search returned HTTP ${page.status}`);
  await page.text();
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  for (const agency of ["DOL", "WCB"] as const) {
    const body = new URLSearchParams({
      dolDisplay: agency === "DOL" ? "inline" : "none", wcbDisplay: agency === "WCB" ? "inline" : "none",
      searchRadioBox: agency === "DOL" ? "dolSearch" : "wcbSearch", tin: "", employerName: prefix, employerDBAName: "", city: "", state: "", zip: "",
      debarrmentStartDate: "", debarrmentEndDate: "", ...(agency === "DOL" ? { article: "both" } : {}), agencyKey: "",
    });
    let res = await politeFetch(EDLIST_RESULTS, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) } }, { minDelayMs: 1500 });
    for (let p = 0; ; p++) {
      if (!res.ok) throw new Error(`NY DOL debarment search returned HTTP ${res.status}`);
      const html = await res.text();
      if (!/Nothing found to display|items? found|One item found/i.test(html)) throw new Error("NY DOL debarment search returned an unexpected page");
      hits.push(...parseEdList(html, agency));
      const next = html.match(/<a href="([^"]+)" title="Go to page \d+">Next<\/a>/)?.[1] ?? html.match(/\[<a href="([^"]+)"[^>]*>Next<\/a>/)?.[1];
      if (!next) break;
      if (p + 1 >= EDLIST_MAX_PAGES) { notes.push(`${agency} list: read the first ${EDLIST_MAX_PAGES} pages of names starting "${prefix}"; the rest were not read`); break; }
      res = await politeFetch(new URL(decodeEntities(next), EDLIST_HOST).toString(), { headers: cookie ? { cookie } : {} }, { minDelayMs: 1500 });
    }
  }
  return withNote(hits, notes.join("; ") || null);
}

const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [
  { source: "New York DOL / Workers' Compensation Board public-work debarments", scope: "Contractors barred from public work (prevailing-wage and workers' comp violations)", category: "debarment", search: searchEdList },
];

export const pack: StatePack = {
  state: "NY",
  checked: "2026-10-15",
  licenses: LICENSES,
  enforcement: ENFORCEMENT,
  liveEnforcement: LIVE_ENFORCEMENT,
  complaints: COMPLAINTS,
  noStatewideGcLicense: "New York does not license general or home-improvement contractors statewide; cities and counties do (New York City's DOB and DCWP licenses are searched above), and the state licenses only some trades (elevator, mold, asbestos, crane and blasting), which are searched above",
  blocked: [
    "NY DOL debarment list PDF (dol.ny.gov/debarred-list): same data as the EDList search form, which is used instead",
    "NY Unified Court System WebCivil (iapps.courts.state.ny.us): Cloudflare challenge page (HTTP 403), no bulk data or API",
    "NYS Attorney General consumer complaints: no dataset on data.ny.gov",
    "NY Workers' Compensation Board stop-work orders: no dataset on data.ny.gov; WCB 141-b debarments are in the EDList search above",
  ],
};
