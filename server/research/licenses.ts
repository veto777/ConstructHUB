/**
 * State contractor-license records for research reports: official open-data datasets, searched by business name or
 * by the person named on the license. Only datasets checked live are listed (CLAUDE.md: never fabricate government
 * data); a state without one is reported as "no published license data searched", never as "no license".
 */
import { politeFetch } from "./http";
import type { LicenseHit } from "@shared/research-reports";
import { capNote, noteOf, withNote, type Noted } from "./notes";
import { looksLikeBusiness } from "./states/lib/business-name";
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
  /**
   * Where a person's name is searched: one field, first/middle/last fields of ONE person (each word may sit in any
   * of them), or { anyOf } for fields that each hold a different name (a person must match one of them whole).
   */
  personField: Field | string[] | { anyOf: string[] };
  /** The person field lists several people separated by this (NY's business_officers: "Jane Doe, John Roe"). */
  personSplit?: string;
  /** False for a row whose holder is an individual: its name is then the principal, never the business name. */
  isBusiness?: (row: Record<string, unknown>) => boolean;
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
    // The licensee and its responsible managing individual are two names, never one person (audit 2026-10-15).
    personField: { anyOf: ["full_name", "rmi_name"] } },
  { state: "OR", source: "Oregon Building Codes Division trade licenses", ...soda("data.oregon.gov", "vhbr-cuaq"),
    fields: { businessName: "full_name", licenseNumber: "licnbr", licenseType: "lictype", specialty: "profession", status: "lic_status", principal: "full_name", city: "city", expires: "expiration_date" },
    personField: "full_name", filter: "profession in ('Electrical','Plumbing','Boiler','Elevator','Combo License')",
    // Journeyman and other individual licenses (lictype "J-General Journeyman", "JP-Journeyman Plumber", …) name a
    // person; contractor and business licenses ("C-Electrical Contractor", "BB-Boiler Business") a business.
    isBusiness: (r) => /contractor|business/i.test(String(r.lictype ?? "")) || looksLikeBusiness(String(r.full_name ?? "")) },
  { state: "VT", source: "Vermont Division of Fire Safety trade licenses", ...soda("data.vermont.gov", "cy8e-89cz"),
    fields: { businessName: null, licenseNumber: "license_number", licenseType: "type_desc", specialty: "level_desc", status: null, principal: null, city: "city", expires: "license_exp_date" },
    personField: ["first_name", "last_name"],
    filter: "type_desc in ('Electrician','Plumber','Gas Installer','Oil Installer','Elevator Tradesman','Sprinkler Designer')" },
  { state: "IL", source: "Illinois IDFPR roofing contractor licenses", ...soda("data.illinois.gov", "pzzh-kp68"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "license_type", specialty: "description", status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: ["first_name", "middle", "last_name"], filter: "license_type='ROOFING CONTRACTOR'" },
  { state: "NY", source: "New York DOL contractor registry (public work)", ...soda("data.ny.gov", "i4jv-zkey"),
    fields: { businessName: "business_name", licenseNumber: "certificate_number", licenseType: "business_type", specialty: null, status: "status", principal: "business_officers", city: "city", expires: "expiration_date" },
    personField: "business_officers", personSplit: "," },
];

export const LICENSE_SOURCES: Record<string, LicenseSource[]> = {};
for (const src of [WA, ...OTHERS]) (LICENSE_SOURCES[src.state] ??= []).push(src);

export const licenseSourcesFor = (state: string): LicenseSource[] => LICENSE_SOURCES[state] ?? [];

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
/** Words of the name, each required (any order): "Aaron Johnson" also finds "JOHNSON, AARON N". */
export function nameClause(field: string | string[] | { anyOf: string[] }, name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9&' -]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) throw new Error("Name has no searchable words");
  // Separate names: every word in the same field.
  if (!Array.isArray(field) && typeof field === "object") return "(" + field.anyOf.map((f) => "(" + words.map((w) => `upper(${f}) like ${quote(`%${w}%`)}`).join(" AND ") + ")").join(" OR ") + ")";
  const fields = Array.isArray(field) ? field : [field];
  return words.map((w) => "(" + fields.map((f) => `upper(${f}) like ${quote(`%${w}%`)}`).join(" OR ") + ")").join(" AND ");
}

/** One page of a Socrata query. A full page carries a note ("showing the first N"): there may be more. */
export async function sodaRows(url: string, where: string, limit = 200, label = "License data", order?: string, offset = 0): Promise<Noted<Record<string, unknown>>> {
  const q = new URL(url);
  q.searchParams.set("$where", where);
  q.searchParams.set("$limit", String(limit));
  if (offset) q.searchParams.set("$offset", String(offset));
  if (order) q.searchParams.set("$order", order);
  const res = await politeFetch(q.toString(), { headers: { Accept: "application/json" } }, { minDelayMs: 300 });
  if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`${label} returned an unexpected payload`);
  return withNote(rows, rows.length >= limit ? capNote(offset + rows.length, null, "records") : null);
}

/** Every row of a Socrata query, page by page in a stable order, up to `max` (past that, the note says so). */
export async function sodaAll(url: string, where: string, max = 2000, label = "License data", page = 1000): Promise<Noted<Record<string, unknown>>> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < max; offset += page) {
    const rows = await sodaRows(url, where, Math.min(page, max - offset), label, ":id", offset);
    out.push(...rows);
    if (!noteOf(rows)) return out;
  }
  return withNote(out, capNote(out.length, null, "records"));
}

const str = (row: Record<string, unknown>, field: Field): string | null => {
  if (!field) return null;
  const v = row[field];
  return v == null || v === "" ? null : String(v).trim();
};

/** The person on the row: the name parts of one person joined, or the principal field (never two names joined). */
const personOf = (src: LicenseSource, row: Record<string, unknown>): string | null => {
  const raw = Array.isArray(src.personField) ? src.personField.map((f) => str(row, f)).filter(Boolean).join(" ") || null : str(row, src.fields.principal);
  return raw && src.personSplit ? raw.split(src.personSplit).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)[0] ?? null : raw;
};
/** Everyone a split person field names, each on their own. */
const splitPeople = (src: LicenseSource, row: Record<string, unknown>): { name: string; role: string | null }[] | undefined => {
  if (!src.personSplit || Array.isArray(src.personField) || typeof src.personField !== "string") return undefined;
  const names = (str(row, src.personField) ?? "").split(src.personSplit).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  return names.length ? names.map((name) => ({ name, role: null })) : undefined;
};

function toHit(src: LicenseSource, row: Record<string, unknown>, matchedOn: LicenseHit["matchedOn"], principal?: string | null): LicenseHit {
  const expires = str(row, src.fields.expires);
  const business = src.isBusiness && !src.isBusiness(row) ? null : str(row, src.fields.businessName);
  const people = splitPeople(src, row);
  return {
    state: src.state, source: src.source, sourceUrl: src.datasetUrl,
    businessName: business, licenseNumber: str(row, src.fields.licenseNumber),
    licenseType: str(row, src.fields.licenseType), specialty: str(row, src.fields.specialty),
    status: str(row, src.fields.status), principal: principal ?? personOf(src, row) ?? (business ? null : str(row, src.fields.businessName)),
    city: str(row, src.fields.city), expires: expires ? expires.slice(0, 10) : null, matchedOn,
    ...(people ? { people } : {}),
    ...(src.address ? { address: [...(Array.isArray(src.address) ? src.address : [src.address]), ...(src.zip ? [src.zip] : [])].map((f) => str(row, f)).filter(Boolean).join(" ") || null } : {}),
    ...(src.phone ? { phone: str(row, src.phone) } : {}),
  };
}

/**
 * Licenses in one dataset with this license number, phone or street address. Phones are matched on their digit
 * groups ("%206%555%0142%", since datasets store them in any format) and re-checked digit for digit; addresses on
 * the house number and first street word, re-checked through ./identifiers.ts.
 */
export async function searchLicensesBy(src: LicenseSource, q: IdQuery): Promise<Noted<LicenseHit> | null> {
  const extra = src.filter ? ` AND (${src.filter})` : "";
  let where: string | null = null;
  if (q.type === "license" && src.fields.licenseNumber) {
    const n = normLicense(q.value);
    if (n) where = `upper(${src.fields.licenseNumber}::text) in (${Array.from(new Set([q.value.trim().toUpperCase(), n])).map(quote).join(",")})`;
  } else if (q.type === "phone" && src.phone) {
    const n = normPhone(q.value);
    if (n) where = `${src.phone}::text like ${quote(`%${n.slice(0, 3)}%${n.slice(3, 6)}%${n.slice(6)}%`)}`;
  } else if (q.type === "address" && src.address) {
    const key = addressKeys(q.value).find((k) => k.startsWith("a:"));
    const fields = Array.isArray(src.address) ? src.address : [src.address];
    if (key && !key.startsWith("a:POBOX")) {
      const [num, word] = key.slice(2).split(" ");
      // One street field, or the house number and the street in two ("400" + "RELLA BLVD"): try both shapes.
      const like = quote(`${num} %${word}%`);
      where = fields.length > 1
        ? `(upper(${fields[0]}::text) like ${like} OR upper(${fields[0]}::text || ' ' || ${fields[1]}::text) like ${like})`
        : `upper(${fields[0]}::text) like ${like}`;
    }
  }
  // The dataset has no such field (or the value isn't a usable one): not searched, which is not "0 found".
  if (!where) return null;
  const matchedOn = q.type;
  const rows = await sodaAll(src.url, where + extra, 2000);
  return withNote(rows.map((row) => toHit(src, row, matchedOn)).filter((h) => {
    if (q.type === "license") return normLicense(h.licenseNumber) === normLicense(q.value);
    if (q.type === "address") return addressMatches(q.value, h.address);
    return idWords({ phones: [h.phone] }).includes(`t:${normPhone(q.value)}`);
  }), noteOf(rows));
}

/** Search-index words: two letters and up (the index can't use single letters). Identity checks use nameWords. */
export const tokens = (v: string) => v.toUpperCase().split(/[^A-Z0-9&']+/).filter((w) => w.length >= 2);
/** Words for an identity check: single letters kept ("D & S" is not "A & B"), "&" and punctuation dropped. */
export const nameWords = (v: string) => v.toUpperCase().split(/[^A-Z0-9']+/).filter(Boolean);
const GENERATION = new Set(["JR", "SR", "II", "III", "IV", "V"]);

/** The business name holds every word of the searched name, single letters included ("Smith" is not "Locksmith"). */
export function companyNamed(name: string, business: string | null | undefined): boolean {
  if (!tokens(name).length || !business) return false;
  const have = new Set(nameWords(business));
  return nameWords(name).every((w) => have.has(w));
}

/**
 * ONE person's name holds every full word of the searched name, and a middle initial given on both sides agrees:
 * "John A Smith" is not "John B Smith" (or "John Bert Smith"); "John A Smith" and "John Smith" stay candidates.
 */
export function personMatches(name: string, person: string | null | undefined): boolean {
  const want = nameWords(name), have = nameWords(person ?? "");
  const full = want.filter((w) => w.length >= 2);
  if (!full.length || !full.every((w) => have.includes(w))) return false;
  const initials = want.filter((w) => w.length === 1);
  const rest = have.filter((w) => !full.includes(w) && !GENERATION.has(w));
  return !initials.length || !rest.length || initials.every((i) => rest.some((w) => w[0] === i));
}

/** The searched name is the business name, or the name of one person on the record (never words of two names). */
export function wholeWordMatch(name: string, hit: Pick<LicenseHit, "businessName" | "principal"> & { people?: LicenseHit["people"] }): boolean {
  return companyNamed(name, hit.businessName) || [hit.principal, ...(hit.people ?? []).map((p) => p.name)].some((v) => personMatches(name, v));
}

/** Every license in one source matching the name: business name for a company, principal(s) for a person. */
export async function searchLicenses(src: LicenseSource, name: string, kind: "person" | "company"): Promise<Noted<LicenseHit>> {
  const raw = await searchLicensesRaw(src, name, kind);
  return withNote(raw.filter((h) => wholeWordMatch(name, h)), noteOf(raw));
}

async function searchLicensesRaw(src: LicenseSource, name: string, kind: "person" | "company"): Promise<Noted<LicenseHit>> {
  const extra = src.filter ? ` AND (${src.filter})` : "";
  const hits: LicenseHit[] = [];
  let note: string | null = null;
  if (kind === "company" && src.fields.businessName) {
    const rows = await sodaAll(src.url, nameClause(src.fields.businessName, name) + extra);
    for (const row of rows) hits.push(toHit(src, row, "business"));
    return withNote(hits, noteOf(rows));
  }
  if (src.personField) {
    const rows = await sodaAll(src.url, nameClause(src.personField, name) + extra);
    note = noteOf(rows);
    for (const row of rows) hits.push(toHit(src, row, "principal"));
  }
  if (src.principals && src.fields.licenseNumber) {
    const people = await sodaAll(src.principals.url, nameClause(src.principals.nameField, name), 500);
    if (noteOf(people)) note = noteOf(people);
    const seen = new Set(hits.map((h) => h.licenseNumber));
    const byLicense = new Map<string, { person: string; business: string | null }>();
    for (const p of people) {
      const lic = str(p, src.principals.licenseField);
      if (lic && !seen.has(lic)) byLicense.set(lic, { person: str(p, src.principals.nameField) ?? name, business: str(p, src.principals.businessField ?? null) });
    }
    const all = Array.from(byLicense.keys());
    if (all.length > 50) { note = `the licenses of the first 50 of ${all.length} matching principals are shown`; for (const k of all.slice(50)) byLicense.delete(k); }
    const ids = all.slice(0, 50);
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
  return withNote(hits, note);
}
