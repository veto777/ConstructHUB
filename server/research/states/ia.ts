/**
 * Iowa. Every source below was opened and searched live on 2026-10-15; field names, statuses and codes are the
 * publishers' own (CLAUDE.md: never fabricate government data).
 *
 *   ia-contractors      DIAL construction contractor registrations (every active registration; Iowa Data Hub
 *                       dataset 1052, weekly). Registration, owner name, address, phone, primary NAICS activity.
 *   ia-asbestos         DIAL asbestos licenses (workers, contractor/supervisors, inspectors, planners, designers;
 *                       Iowa Data Hub dataset 560, weekly).
 *   ia-asbestos-permits DIAL asbestos abatement business permits (Iowa Data Hub dataset 561, weekly).
 *   ia-sos-active       Iowa Secretary of State active business entities (Iowa Data Hub dataset 554, monthly),
 *                       business standing for companies; the file lists active entities only.
 *   live                Iowa electrical licenses (contractors, masters, journeymen, apprentices, residential,
 *                       special; all statuses), the state's public Visualforce lookup at dps-eeb.my.site.com.
 *   live                DIAL fire protection system and alarm system contractors (the State Fire Marshal's public
 *                       ImageTrend lookup JSON), companies.
 *
 * Iowa has no state general-contractor license: anyone earning $2,000 a year or more from construction registers
 * with DIAL instead (the registration above).
 */
import type { LicenseHit } from "@shared/research-reports";
import { clean, csvRecords, download, usDate, type BulkHit, type BulkSource } from "../bulk";
import type { IdQuery } from "../identifiers";
import { politeFetch } from "../../scrapers/polite-fetch";
import type { LiveLicenseSearch, StatePack } from "./types";
import { Session, fromFile, hiddenInputs, htmlText, isoDay, joinAddr, unzipFirst } from "./lib/g6-common";

// ── Iowa Data Hub bulk files ─────────────────────────────────────────────────────────────────────────────────
/** The Data Hub's own download route (what its "Download as CSV" button opens): a zip holding one CSV. */
const hubCsv = (id: number) => `https://data.iowa.gov/api/dataset-download?path=${encodeURIComponent(`datasets/${id}/rows.csv`)}`;
const hubPage = (id: number) => `https://data.iowa.gov/catalog/dataset/${id}`;

async function* hubRows(id: number): AsyncIterable<Record<string, string>> {
  const csv = await unzipFirst(await download(hubCsv(id)), /\.csv$/i);
  yield* fromFile(csv, (p) => csvRecords(p));
}

const person = (first: string | null | undefined, last: string | null | undefined) => clean([first, last].filter(Boolean).join(" "));
const lic = (h: Omit<LicenseHit, "matchedOn">, business: string | null, personName: string | null, keys: BulkHit["keys"]): BulkHit =>
  ({ kind: "license", hit: { ...h, matchedOn: business ? "business" : "principal" }, business, person: personName, keys });

const IA_CONTRACTORS: BulkSource = {
  id: "ia-contractors", state: "IA", label: "Iowa DIAL construction contractor registrations", pageUrl: hubPage(1052),
  everyHours: 24 * 7, minRows: 12_500, // 18,096 on 2026-10-15
  load: async function* () {
    for await (const r of hubRows(1052)) {
      const business = clean(r.business_name), owner = person(r.first_name, r.last_name);
      const address = joinAddr(r.address_1, r.city, r.state, r.zip_code);
      // The dataset is the publisher's query of registrations with status REGISTERED and an unexpired date.
      yield lic({
        state: "IA", source: "Iowa DIAL construction contractor registrations", sourceUrl: hubPage(1052),
        businessName: business, licenseNumber: clean(r.registration_number), licenseType: "Construction contractor registration",
        specialty: clean(r.primary_activity), status: "Registered", principal: owner, city: clean(r.city), expires: isoDay(r.expire_date),
        address, phone: clean(r.phone), people: owner ? [{ name: owner, role: null }] : [],
      }, business, owner, { licenses: [r.registration_number], phones: [r.phone], addresses: [address] });
    }
  },
};

const IA_ASBESTOS: BulkSource = {
  id: "ia-asbestos", state: "IA", label: "Iowa DIAL asbestos licenses", pageUrl: hubPage(560),
  everyHours: 24 * 7, minRows: 950, // 1,369 on 2026-10-15
  load: async function* () {
    for await (const r of hubRows(560)) {
      const who = person(r.first_name, r.last_name);
      if (!who) continue;
      const address = joinAddr(r.address_1, r.city, r.state, r.zip_code);
      yield lic({
        state: "IA", source: "Iowa DIAL asbestos licenses", sourceUrl: hubPage(560), businessName: null,
        licenseNumber: clean(r.registration_number), licenseType: r.license_type ? `Asbestos ${clean(r.license_type)?.toLowerCase()}` : "Asbestos license",
        specialty: null, status: clean(r.status), principal: who, city: clean(r.city), expires: isoDay(r.expire_date),
        address, phone: clean(r.phone), people: [{ name: who, role: clean(r.license_type) }],
      }, null, who, { licenses: [r.registration_number], phones: [r.phone], addresses: [address] });
    }
  },
};

const IA_ASBESTOS_PERMITS: BulkSource = {
  id: "ia-asbestos-permits", state: "IA", label: "Iowa DIAL asbestos abatement permits (businesses)", pageUrl: hubPage(561),
  everyHours: 24 * 7, minRows: 95, // 140 on 2026-10-15
  load: async function* () {
    for await (const r of hubRows(561)) {
      // The business name carries its DBA names and the permit number in parentheses, as published.
      const business = clean(r.business_name?.replace(/\s*\(\d+\)\s*$/, ""));
      if (!business) continue;
      const contact = person(r.first_name, r.last_name);
      const address = joinAddr(r.address_1, r.city, r.state, r.zip_code);
      yield lic({
        state: "IA", source: "Iowa DIAL asbestos abatement permits", sourceUrl: hubPage(561), businessName: business,
        licenseNumber: clean(r.permit_number), licenseType: "Asbestos abatement business permit", specialty: null,
        status: clean(r.status), principal: contact, city: clean(r.city), expires: isoDay(r.expire_date),
        address, phone: clean(r.phone), people: contact ? [{ name: contact, role: "Contact" }] : [],
      }, business, contact, { licenses: [r.permit_number], phones: [r.phone], addresses: [address] });
    }
  },
};

const IA_SOS_ACTIVE: BulkSource = {
  id: "ia-sos-active", state: "IA", label: "Iowa Secretary of State active business entities", pageUrl: hubPage(554),
  everyHours: 24 * 7, minRows: 240_000, companiesOnly: true, category: "business_status", // 348,270 on 2026-10-15
  load: async function* () {
    for await (const r of hubRows(554)) {
      const name = clean(r.legal_name);
      if (!name) continue;
      const address = joinAddr(r.ho_address_1, r.ho_city, r.ho_state, r.ho_zip);
      const raAddress = joinAddr(r.ra_address_1, r.ra_city, r.ra_state, r.ra_zip);
      yield {
        kind: "enforcement", business: name, person: null,
        keys: { licenses: [], phones: [], addresses: [address, raAddress] },
        hit: {
          state: "IA", source: "Iowa Secretary of State active business entities", sourceUrl: hubPage(554), category: "business_status",
          name, id: clean(r.corp_number), date: isoDay(r.effective_date), endDate: null,
          status: "Active (on the Secretary of State's list of active entities)", city: clean(r.ho_city),
          detail: [clean(r.corporation_type), r.registered_agent ? `Registered agent: ${clean(r.registered_agent)}` : null].filter(Boolean).join(". ") || null,
          amount: null, adverse: null, address, phone: null, licenseNumber: null,
        },
      };
    }
  },
};

// ── Iowa electrical licenses (Visualforce lookup) ────────────────────────────────────────────────────────────
const IA_EL = "https://dps-eeb.my.site.com/LicenseSearchPage";
const IA_EL_DETAIL = "https://dps-eeb.my.site.com/LicenseSearchDetailPage?licenseId=";
const F = "j_id0:j_id1:j_id14";
const IA_EL_CONTRACTOR = /contractor/i;

type ElRow = { id: string; number: string; name: string | null; street: string | null; city: string | null; state: string | null; expires: string | null; type: string | null; status: string | null };

/** Result rows. The name search and the number search return different columns, so cells are read by header. */
export function parseIaElectricalRows(html: string): ElRow[] {
  const heads = Array.from(html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)).map((h) => (htmlText(h[1]) ?? "").toLowerCase());
  const out: ElRow[] = [];
  for (const m of Array.from(html.matchAll(/<tr class="trRecord">([\s\S]*?)<\/tr>/g))) {
    const link = m[1].match(/licenseId=([A-Za-z0-9]+)"[^>]*>([^<]*)<\/a>/);
    if (!link) continue;
    const cells = [htmlText(link[2]), ...Array.from(m[1].matchAll(/licensefield">([^<]*)<\/span>/g)).map((x) => htmlText(x[1]))];
    const get = (label: string) => { const i = heads.indexOf(label); return i >= 0 ? cells[i] ?? null : null; };
    out.push({
      id: link[1], number: get("number") ?? "", name: get("display name (business or name)"), street: get("address street"),
      city: get("address city"), state: get("address state"), expires: usDate(get("expiration date")), type: get("license type"), status: get("license status"),
    });
  }
  return out;
}

/** The detail page: the contact named on the license and the business phone. */
export function parseIaElectricalDetail(html: string): { contact: string | null; phone: string | null; status: string | null } {
  const t = htmlText(html.replace(/<script[\s\S]*?<\/script>/g, "")) ?? "";
  return {
    contact: clean(t.match(/Contact Full Name (.+?) (?:Business Phone Number|Address City|Licensee Information)/)?.[1]),
    phone: clean(t.match(/Business Phone Number (\(\d{3}\) \d{3}-\d{4})/)?.[1]),
    status: clean(t.match(/License Status (.+?) Disciplines/)?.[1]),
  };
}

const SUFFIX = /\b(INC|INCORPORATED|LLC|L L C|CO|CORP|CORPORATION|COMPANY|LTD|LC|L C|PLLC|LLP)\b\.?/gi;
const searchName = (name: string) => clean(name.replace(/[.,]/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ")) ?? name;

async function iaElectricalSearch(fields: Record<string, string>, button: string): Promise<LicenseHit[]> {
  const s = new Session(1500);
  let html = await s.text(IA_EL, {}, "Iowa electrical lookup");
  const values: Record<string, string> = { firstName: "", lastName: "", licenseStatus: "", BusinessName: "", city: "", state: "", County: "", LicenseType: "", licenseNumber: "", ...fields };
  const post = async (extra: [string, string][]) => {
    const body = new URLSearchParams();
    body.set(F, F);
    for (const k of ["firstName", "lastName", "licenseStatus", "BusinessName", "city", "state", "County", "LicenseType"]) body.set(`${F}:${k}`, values[k]);
    for (const [k, v] of extra) body.set(k, v);
    body.set(`${F}:licenseNumber`, values.licenseNumber);
    for (const [k, v] of hiddenInputs(html)) if (k.startsWith("com.salesforce.visualforce")) body.set(k, v);
    html = await s.text(IA_EL, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", referer: IA_EL } }, "Iowa electrical lookup");
    if (!html.includes(`id="${F}"`)) throw new Error("Iowa electrical lookup returned an unexpected page");
  };
  await post([[`${F}:${button}`, "Search"]]);
  const rows: ElRow[] = [];
  for (let page = 0; page < 4; page++) {
    rows.push(...parseIaElectricalRows(html));
    const next = html.match(/jsfcljs\(document\.getElementById\('[^']+'\),'([^',]+),[^']+'[^)]*\);\}return false">Next Page/)?.[1];
    if (!next) break;
    await post([[next, next]]);
  }
  const hits: LicenseHit[] = [];
  let details = 0;
  for (const r of rows) {
    const isBusiness = IA_EL_CONTRACTOR.test(r.type ?? "");
    let contact: string | null = null, phone: string | null = null, status = r.status;
    if ((isBusiness || !status) && details < 6) {
      details++;
      try {
        const d = parseIaElectricalDetail(await s.text(IA_EL_DETAIL + r.id, {}, "Iowa electrical detail"));
        ({ contact, phone } = d);
        status ??= d.status;
      } catch { /* the row stands without it */ }
    }
    hits.push({
      state: "IA", source: "Iowa electrical licenses", sourceUrl: IA_EL_DETAIL + r.id,
      businessName: isBusiness ? r.name : null, licenseNumber: r.number || null, licenseType: r.type, specialty: null,
      status, principal: isBusiness ? contact : r.name,
      city: [r.city, r.state].filter(Boolean).join(", ") || null, expires: r.expires,
      matchedOn: isBusiness ? "business" : "principal", phone, address: r.street ? joinAddr(r.street, r.city, r.state) : null,
      people: contact ? [{ name: contact, role: "Contact" }] : !isBusiness && r.name ? [{ name: r.name, role: r.type }] : [],
    });
  }
  return hits;
}

const IA_ELECTRICAL: LiveLicenseSearch = {
  source: "Iowa electrical licenses", sourceUrl: IA_EL,
  search: async (name, kind) => {
    if (kind === "company") return iaElectricalSearch({ BusinessName: searchName(name) }, "j_id69");
    const words = name.trim().split(/\s+/);
    if (words.length < 2) return [];
    return iaElectricalSearch({ firstName: words[0], lastName: words[words.length - 1] }, "j_id69");
  },
  searchBy: async (q: IdQuery) => {
    if (q.type !== "license") return [];
    return (await iaElectricalSearch({ licenseNumber: q.value.trim().toUpperCase() }, "j_id75")).map((h) => ({ ...h, matchedOn: "license" as const }));
  },
};

// ── DIAL fire protection and alarm contractors (ImageTrend public lookup) ────────────────────────────────────
const IT_API = "https://iowa.imagetrendlicense.com/lms/admin/api/api/services/PublicLookupService";
const IT_PAGE = "https://iowa.imagetrendlicense.com/lms/public/portal#/lookup/service";
const IT_ENTERPRISE = "4fe2bd07-f06d-432c-8c60-28f385d9e747";
/** The lookup's classifications for the two construction trades (the rest are tanks, fireworks, explosives, plan review). */
const IT_TRADES = new Set(["Fire Protection", "Alarm"]);

type ItRow = Record<string, unknown>;
const sv = (v: unknown) => clean(v == null ? null : String(v));

export function itToHit(r: ItRow, matchedOn: LicenseHit["matchedOn"]): LicenseHit | null {
  const cls = sv(r.classification);
  if (!cls || !IT_TRADES.has(cls)) return null;
  // The service name ends in " - <classification>" ("Blackhawk Automatic Sprinklers, Inc. - Fire Protection").
  const name = clean(sv(r.service_name)?.replace(new RegExp(`\\s*-\\s*${cls}$`, "i"), ""));
  return {
    state: "IA", source: "Iowa DIAL fire protection and alarm system contractors", sourceUrl: IT_PAGE,
    businessName: name, licenseNumber: sv(r.primary_license_number), licenseType: cls === "Alarm" ? "Alarm system contractor" : "Fire protection system contractor",
    specialty: sv(r.primary_license_level), status: sv(r.primary_license_status), principal: null,
    city: [sv(r.city), sv(r.abbrev)].filter(Boolean).join(", ") || null, expires: isoDay(r.primary_license_expiration_date),
    matchedOn, address: joinAddr(sv(r.address_line_1), sv(r.city), sv(r.abbrev), sv(r.postal_code)), phone: sv(r.phone), people: [],
  };
}

async function itLookup(criteria: Record<string, string>): Promise<ItRow[]> {
  const res = await politeFetch(IT_API, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ enterprise_id: IT_ENTERPRISE, ...criteria, records_offset: 0, records_total: 300, sort_fields: null }),
  }, { minDelayMs: 1200 });
  if (!res.ok) throw new Error(`Iowa DIAL lookup returned HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("Iowa DIAL lookup returned an unexpected payload");
  return rows;
}

const IA_FIRE_ALARM: LiveLicenseSearch = {
  source: "Iowa DIAL fire protection and alarm system contractors", sourceUrl: IT_PAGE,
  search: async (name, kind) => {
    if (kind === "person") return []; // the business lookup names companies only
    const n = searchName(name);
    let rows = await itLookup({ serviceName: n });
    if (!rows.length) {
      // The lookup matches the whole phrase; fall back to its longest word, the runner keeps whole-name matches.
      const word = n.split(/\s+/).sort((a, b) => b.length - a.length)[0];
      if (word && word.length >= 4 && word !== n) rows = await itLookup({ serviceName: word });
    }
    return rows.map((r) => itToHit(r, "business")).filter((h): h is LicenseHit => !!h);
  },
  searchBy: async (q) => {
    if (q.type !== "license") return [];
    return (await itLookup({ primaryCertificationNumber: q.value.trim().toUpperCase() })).map((r) => itToHit(r, "license")).filter((h): h is LicenseHit => !!h);
  },
};

export const pack: StatePack = {
  state: "IA",
  checked: "2026-10-15",
  bulk: [IA_CONTRACTORS, IA_ASBESTOS, IA_ASBESTOS_PERMITS, IA_SOS_ACTIVE],
  liveLicenses: [IA_ELECTRICAL, IA_FIRE_ALARM],
  noStatewideGcLicense:
    "Iowa does not license general contractors statewide; contractors earning $2,000 a year or more register with the Division of Inspections, Appeals and Licensing (searched above), and electricians, plumbers and mechanical trades are licensed separately",
  blocked: [
    "Iowa Plumbing & Mechanical Systems Board (amanda-portal.idph.state.ia.us/adpereh): AWS WAF challenge and reCAPTCHA on the public search",
    "Iowa Workforce Development labor portal contractor search (laborportal.iwd.iowa.gov): a JavaScript app with no documented public endpoint; the Data Hub file above carries the same registrations",
    "Iowa electrical license detail pages show a 'Disciplines' section that reads 'No Discipline or Board Actions' even on revoked licenses, so it is not used as discipline data",
    "Iowa Secretary of State inactive/dissolved entities: no free bulk file (dataset 554 lists active entities only)",
  ],
};
