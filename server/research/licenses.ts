/**
 * State contractor-license records for research reports: official open-data datasets, searched by business name or
 * by the person named on the license. Only datasets checked live are listed (CLAUDE.md: never fabricate government
 * data); a state without one is reported as "no published license data searched", never as "no license".
 */
import { politeFetch } from "../scrapers/polite-fetch";
import type { LicenseHit } from "@shared/research-reports";
import { addressKeys, addressMatches, idWords, normLicense, normPhone, type IdQuery } from "./identifiers";

type Field = string | null;

export type LicenseSource = {
  state: string;
  source: string;
  /** The dataset's public page (what the report links to). */
  datasetUrl: string;
  /** SODA resource endpoint. */
  url: string;
  fields: {
    businessName: Field; licenseNumber: Field; licenseType: Field; specialty: Field;
    status: Field; principal: Field; city: Field; expires: Field;
  };
  /** Where a person's name is searched: one field, or first/middle/last fields (each word may sit in any of them). */
  personField: Field | string[];
  /** A second dataset listing every principal of a license, joined on licenseNumber. */
  principals?: { url: string; nameField: string; licenseField: string; businessField?: string };
  /** Optional identifier fields, so a report can search and cross-reference by them (./identifiers.ts). */
  address?: string | string[]; phone?: string; zip?: string;
  /** Extra SoQL restricting rows to construction trades. */
  filter?: string;
};

// Washington L&I, checked 2026-10-14 (data.wa.gov, updated daily).
const WA: LicenseSource = {
  state: "WA",
  source: "Washington L&I contractor licenses",
  datasetUrl: "https://data.wa.gov/d/m8qx-ubtq",
  url: "https://data.wa.gov/resource/m8qx-ubtq.json",
  fields: {
    businessName: "businessname", licenseNumber: "contractorlicensenumber", licenseType: "contractorlicensetypecodedesc",
    specialty: "specialtycode1desc", status: "contractorlicensestatus", principal: "primaryprincipalname", city: "city",
    expires: "licenseexpirationdate",
  },
  personField: "primaryprincipalname",
  principals: { url: "https://data.wa.gov/resource/4xk5-x9j6.json", nameField: "principalname", licenseField: "contractorlicensenumber", businessField: "businessname" },
};

const soda = (domain: string, id: string) => ({ datasetUrl: `https://${domain}/d/${id}`, url: `https://${domain}/resource/${id}.json` });

// Checked live 2026-10-14 (metadata updated Sept–Oct 2026 and a name search returned real rows).
const OTHERS: LicenseSource[] = [
  { state: "TX", source: "Texas TDLR licenses (electrical, A/C, appliance, elevator, well)", ...soda("data.texas.gov", "7358-krk7"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "license_type", specialty: "license_subtype", status: null, principal: "owner_name", city: "business_city_state_zip", expires: "license_expiration_date_mmddccyy" },
    personField: "owner_name",
    filter: "license_type in ('Electrical Contractor','Master Electrician','Journeyman Electrician','Residential Wireman','Apprentice Electrician','Journeyman Industrial Electrician','Maintenance Electrician','Journeyman Lineman Electrician','Electrical Sign Contractor','Master Sign Electrician','Journeyman Sign Electrician','A/C Contractor','A/C Technician','Appliance Installation Contractor','Appliance Installer','Elevator Contractor','Water Well Driller/Pump Installer')" },
  { state: "TX", source: "Austin right-of-way contractor licenses", ...soda("data.austintexas.gov", "8d92-wsiw"),
    fields: { businessName: "contractor_name", licenseNumber: "license_number", licenseType: null, specialty: null, status: null, principal: null, city: null, expires: "expiration_date" },
    personField: null },
  { state: "CO", source: "Colorado DORA licenses (electrical, plumbing, water well)", ...soda("data.colorado.gov", "7s5z-vewr"),
    fields: { businessName: "entityname", licenseNumber: "licensenumber", licenseType: "licensetype", specialty: "subcategory", status: "licensestatusdescription", principal: null, city: "city", expires: "licenseexpirationdate" },
    personField: ["firstname", "middlename", "lastname"],
    filter: "licensetype in ('EC','ME','JW','RW','APE','PC','MP','JP','RP','AP','WC','WI','WP')" },
  { state: "CT", source: "Connecticut DCP licenses and credentials (home improvement and trades)", ...soda("data.ct.gov", "ngch-56tr"),
    fields: { businessName: "businessname", licenseNumber: "fullcredentialcode", licenseType: "credential", specialty: "credentialsubcategory", status: "status", principal: "name", city: "city", expires: "expirationdate" },
    personField: "name",
    filter: "credentialtype in ('HIC','NHC','MCO','ELC','PLM','HTG','SHM','MEC','FRP','ELV','STC','GLZ','DMCR')" },
  { state: "DE", source: "Delaware Division of Professional Regulation (electrical, plumbing/HVACR)", ...soda("data.delaware.gov", "pjnv-eaih"),
    fields: { businessName: null, licenseNumber: "license_no", licenseType: "license_type", specialty: "profession_id", status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: ["first_name", "last_name"],
    filter: "profession_id in ('Electrical Examiners','Plumbing/HVACR','Elevator Mechanics','Manufactured Home Installation')" },
  { state: "OR", source: "Oregon Construction Contractors Board (active licenses)", ...soda("data.oregon.gov", "g77e-6bhs"),
    fields: { businessName: "full_name", licenseNumber: "license_number", licenseType: "license_type", specialty: "endorsement_text", status: null, principal: "rmi_name", city: "city", expires: "lic_exp_date" },
    personField: ["full_name", "rmi_name"] },
  { state: "OR", source: "Oregon Building Codes Division trade licenses", ...soda("data.oregon.gov", "vhbr-cuaq"),
    fields: { businessName: "full_name", licenseNumber: "licnbr", licenseType: "lictype", specialty: "profession", status: "lic_status", principal: "full_name", city: "city", expires: "expiration_date" },
    personField: "full_name", filter: "profession in ('Electrical','Plumbing','Boiler','Elevator','Combo License')" },
  { state: "VT", source: "Vermont Division of Fire Safety trade licenses", ...soda("data.vermont.gov", "cy8e-89cz"),
    fields: { businessName: null, licenseNumber: "license_number", licenseType: "type_desc", specialty: "level_desc", status: null, principal: null, city: "city", expires: "license_exp_date" },
    personField: ["first_name", "last_name"],
    filter: "type_desc in ('Electrician','Plumber','Gas Installer','Oil Installer','Elevator Tradesman','Sprinkler Designer')" },
  { state: "IL", source: "Illinois IDFPR roofing contractor licenses", ...soda("data.illinois.gov", "pzzh-kp68"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "license_type", specialty: "description", status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: ["first_name", "middle", "last_name"], filter: "license_type='ROOFING CONTRACTOR'" },
  { state: "NY", source: "New York DOL contractor registry (public work)", ...soda("data.ny.gov", "i4jv-zkey"),
    fields: { businessName: "business_name", licenseNumber: "certificate_number", licenseType: "business_type", specialty: null, status: "status", principal: "business_officers", city: "city", expires: "expiration_date" },
    personField: "business_officers" },
];

export const LICENSE_SOURCES: Record<string, LicenseSource[]> = {};
for (const src of [WA, ...OTHERS]) (LICENSE_SOURCES[src.state] ??= []).push(src);

export const licenseSourcesFor = (state: string): LicenseSource[] => LICENSE_SOURCES[state] ?? [];

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
/** Words of the name, each required (any order): "Aaron Johnson" also finds "JOHNSON, AARON N". */
export function nameClause(field: string | string[], name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9&' -]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) throw new Error("Name has no searchable words");
  const fields = Array.isArray(field) ? field : [field];
  return words.map((w) => "(" + fields.map((f) => `upper(${f}) like ${quote(`%${w}%`)}`).join(" OR ") + ")").join(" AND ");
}

export async function sodaRows(url: string, where: string, limit = 200, label = "License data", order?: string): Promise<Record<string, unknown>[]> {
  const q = new URL(url);
  q.searchParams.set("$where", where);
  q.searchParams.set("$limit", String(limit));
  if (order) q.searchParams.set("$order", order);
  const res = await politeFetch(q.toString(), { headers: { Accept: "application/json" } }, { minDelayMs: 300 });
  if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`${label} returned an unexpected payload`);
  return rows;
}

const str = (row: Record<string, unknown>, field: Field): string | null => {
  if (!field) return null;
  const v = row[field];
  return v == null || v === "" ? null : String(v).trim();
};

const personOf = (src: LicenseSource, row: Record<string, unknown>): string | null =>
  Array.isArray(src.personField) ? src.personField.map((f) => str(row, f)).filter(Boolean).join(" ") || null : str(row, src.fields.principal);

function toHit(src: LicenseSource, row: Record<string, unknown>, matchedOn: LicenseHit["matchedOn"], principal?: string | null): LicenseHit {
  const expires = str(row, src.fields.expires);
  return {
    state: src.state, source: src.source, sourceUrl: src.datasetUrl,
    businessName: str(row, src.fields.businessName), licenseNumber: str(row, src.fields.licenseNumber),
    licenseType: str(row, src.fields.licenseType), specialty: str(row, src.fields.specialty),
    status: str(row, src.fields.status), principal: principal ?? personOf(src, row),
    city: str(row, src.fields.city), expires: expires ? expires.slice(0, 10) : null, matchedOn,
    ...(src.address ? { address: [...(Array.isArray(src.address) ? src.address : [src.address]), ...(src.zip ? [src.zip] : [])].map((f) => str(row, f)).filter(Boolean).join(" ") || null } : {}),
    ...(src.phone ? { phone: str(row, src.phone) } : {}),
  };
}

/**
 * Licenses in one dataset with this license number, phone or street address. Phones are matched on their digit
 * groups ("%206%555%0142%", since datasets store them in any format) and re-checked digit for digit; addresses on
 * the house number and first street word, re-checked through ./identifiers.ts.
 */
export async function searchLicensesBy(src: LicenseSource, q: IdQuery): Promise<LicenseHit[]> {
  const extra = src.filter ? ` AND (${src.filter})` : "";
  let where: string | null = null;
  if (q.type === "license" && src.fields.licenseNumber) {
    const n = normLicense(q.value);
    if (n) where = `upper(${src.fields.licenseNumber}) in (${Array.from(new Set([q.value.trim().toUpperCase(), n])).map(quote).join(",")})`;
  } else if (q.type === "phone" && src.phone) {
    const n = normPhone(q.value);
    if (n) where = `${src.phone} like ${quote(`%${n.slice(0, 3)}%${n.slice(3, 6)}%${n.slice(6)}%`)}`;
  } else if (q.type === "address" && src.address) {
    const key = addressKeys(q.value).find((k) => k.startsWith("a:"));
    const field = Array.isArray(src.address) ? src.address[0] : src.address;
    if (key && !key.startsWith("a:POBOX")) {
      const [num, word] = key.slice(2).split(" ");
      where = `upper(${field}) like ${quote(`${num} %${word}%`)}`;
    }
  }
  if (!where) return [];
  const matchedOn = q.type;
  return (await sodaRows(src.url, where + extra, 200)).map((row) => toHit(src, row, matchedOn)).filter((h) => {
    if (q.type === "license") return normLicense(h.licenseNumber) === normLicense(q.value);
    if (q.type === "address") return addressMatches(q.value, h.address);
    return idWords({ phones: [h.phone] }).includes(`t:${normPhone(q.value)}`);
  });
}

export const tokens = (v: string) => v.toUpperCase().split(/[^A-Z0-9&']+/).filter((w) => w.length >= 2);
/** Every word of the searched name is a whole word of the matched name ("Smith" is not "Locksmith"). */
export function wholeWordMatch(name: string, hit: Pick<LicenseHit, "businessName" | "principal">): boolean {
  const want = tokens(name);
  return [hit.businessName, hit.principal].some((v) => { const have = new Set(tokens(v ?? "")); return want.every((w) => have.has(w)); });
}

/** Every license in one source matching the name: business name for a company, principal(s) for a person. */
export async function searchLicenses(src: LicenseSource, name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  return (await searchLicensesRaw(src, name, kind)).filter((h) => wholeWordMatch(name, h));
}

async function searchLicensesRaw(src: LicenseSource, name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const extra = src.filter ? ` AND (${src.filter})` : "";
  const hits: LicenseHit[] = [];
  if (kind === "company" && src.fields.businessName) {
    for (const row of await sodaRows(src.url, nameClause(src.fields.businessName, name) + extra)) hits.push(toHit(src, row, "business"));
    return hits;
  }
  if (src.personField) {
    for (const row of await sodaRows(src.url, nameClause(src.personField, name) + extra)) hits.push(toHit(src, row, "principal"));
  }
  if (src.principals && src.fields.licenseNumber) {
    const people = await sodaRows(src.principals.url, nameClause(src.principals.nameField, name), 50);
    const seen = new Set(hits.map((h) => h.licenseNumber));
    const byLicense = new Map<string, { person: string; business: string | null }>();
    for (const p of people) {
      const lic = str(p, src.principals.licenseField);
      if (lic && !seen.has(lic)) byLicense.set(lic, { person: str(p, src.principals.nameField) ?? name, business: str(p, src.principals.businessField ?? null) });
    }
    const ids = Array.from(byLicense.keys()).slice(0, 50);
    if (ids.length) {
      const rows = await sodaRows(src.url, `${src.fields.licenseNumber} in (${ids.map(quote).join(",")})${extra}`, 50);
      const found = new Set<string>();
      for (const row of rows) {
        const lic = str(row, src.fields.licenseNumber);
        if (lic) found.add(lic);
        hits.push(toHit(src, row, "principal", lic ? byLicense.get(lic)?.person : null));
      }
      // A principal whose license is no longer in the current list: still a real record of the person.
      for (const [lic, who] of byLicense) {
        if (!found.has(lic)) hits.push({
          state: src.state, source: src.source, sourceUrl: src.datasetUrl, businessName: who.business, licenseNumber: lic,
          licenseType: null, specialty: null, status: "Not in the current license list", principal: who.person, city: null,
          expires: null, matchedOn: "principal",
        });
      }
    }
  }
  return hits;
}
