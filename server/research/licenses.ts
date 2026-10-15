/**
 * State contractor-license records for research reports: official open-data datasets, searched by business name or
 * by the person named on the license. Only datasets checked live are listed (CLAUDE.md: never fabricate government
 * data); a state without one is reported as "no published license data searched", never as "no license".
 *
 * Identifiers and people (re-checked 2026-10-15 against each dataset's /api/views/<id>.json columns): every source
 * sets the address, ZIP and phone fields it publishes, and the people it names with the publisher's role. WA joins
 * every principal (4xk5-x9j6, past ones with their end date) and every authorized signer (s7ge-wicw) onto each hit.
 * Austin publishes only names, numbers and dates; CO, DE and IL publish a city and ZIP but no street; CT, DE, OR
 * BCD, VT, CO and IL publish no phone.
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
  /** False for a row whose holder is an individual: its name is then the principal, never the business name. */
  isBusiness?: (row: Record<string, unknown>) => boolean;
  /** A second dataset listing every principal of a license, joined on licenseNumber. */
  principals?: { url: string; nameField: string; licenseField: string; businessField?: string };
  /** Optional identifier fields, so a report can search and cross-reference by them (./identifiers.ts): the street
   *  fields first, then city/state (the first field is the one searched), the ZIP, and one or more phone fields. */
  address?: string | string[]; phone?: string | string[]; zip?: string;
  /** People the row names, each with the role the publisher gives them (one field, or name parts; `split` for a list). */
  people?: PeopleField[];
  /** Datasets naming more people per license (principals, signers), joined on licenseNumber onto every hit. */
  peopleFrom?: PeopleDataset[];
  /** Extra SoQL restricting rows to construction trades. */
  filter?: string;
};

export type PeopleField = { field: string | string[]; role: string; roleField?: string; split?: string };
export type PeopleDataset = {
  url: string; licenseField: string; nameField: string;
  /** The role: fixed, or "<role> (<value of roleField>)". */
  role: string; roleField?: string;
  /** Start and end dates of the person's tie to the license (an ended tie is shown as former). */
  startField?: string; endField?: string;
};

// Washington L&I, checked 2026-10-14 (data.wa.gov, updated daily); address, phone and people 2026-10-15.
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
  address: ["address1", "address2", "city", "state"], zip: "zip", phone: "phonenumber",
  people: [{ field: "primaryprincipalname", role: "Primary principal" }],
  // Every principal (past ones carry an end date) and every authorized signer, checked 2026-10-15.
  peopleFrom: [
    { url: "https://data.wa.gov/resource/4xk5-x9j6.json", licenseField: "contractorlicensenumber", nameField: "principalname", role: "Principal", startField: "startdate", endField: "enddate" },
    { url: "https://data.wa.gov/resource/s7ge-wicw.json", licenseField: "contractorlicensenumber", nameField: "authorizedsigner", role: "Authorized signer", roleField: "signerrole" },
  ],
};

const soda = (domain: string, id: string) => ({ datasetUrl: `https://${domain}/d/${id}`, url: `https://${domain}/resource/${id}.json` });

// Checked live 2026-10-14 (metadata updated Sept–Oct 2026 and a name search returned real rows).
const OTHERS: LicenseSource[] = [
  { state: "TX", source: "Texas TDLR licenses (electrical, A/C, appliance, elevator, well)", ...soda("data.texas.gov", "7358-krk7"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "license_type", specialty: "license_subtype", status: null, principal: "owner_name", city: "business_city_state_zip", expires: "license_expiration_date_mmddccyy" },
    personField: "owner_name",
    address: ["business_address_line1", "business_address_line2", "business_city_state_zip"], phone: ["business_telephone", "owner_telephone"],
    people: [{ field: "owner_name", role: "Owner" }],
    filter: "license_type in ('Electrical Contractor','Master Electrician','Journeyman Electrician','Residential Wireman','Apprentice Electrician','Journeyman Industrial Electrician','Maintenance Electrician','Journeyman Lineman Electrician','Electrical Sign Contractor','Master Sign Electrician','Journeyman Sign Electrician','A/C Contractor','A/C Technician','Appliance Installation Contractor','Appliance Installer','Elevator Contractor','Water Well Driller/Pump Installer')" },
  { state: "TX", source: "Austin right-of-way contractor licenses", ...soda("data.austintexas.gov", "8d92-wsiw"),
    fields: { businessName: "contractor_name", licenseNumber: "license_number", licenseType: null, specialty: null, status: null, principal: null, city: null, expires: "expiration_date" },
    personField: null },
  { state: "CO", source: "Colorado DORA licenses (electrical, plumbing, water well)", ...soda("data.colorado.gov", "7s5z-vewr"),
    fields: { businessName: "entityname", licenseNumber: "licensenumber", licenseType: "licensetype", specialty: "subcategory", status: "licensestatusdescription", principal: null, city: "city", expires: "licenseexpirationdate" },
    personField: ["firstname", "middlename", "lastname"],
    people: [{ field: ["firstname", "middlename", "lastname", "suffix"], role: "Licensee" }],
    filter: "licensetype in ('EC','ME','JW','RW','APE','PC','MP','JP','RP','AP','WC','WI','WP')" },
  { state: "CT", source: "Connecticut DCP licenses and credentials (home improvement and trades)", ...soda("data.ct.gov", "ngch-56tr"),
    fields: { businessName: "businessname", licenseNumber: "fullcredentialcode", licenseType: "credential", specialty: "credentialsubcategory", status: "status", principal: "name", city: "city", expires: "expirationdate" },
    personField: "name",
    address: ["address", "city", "state"], zip: "zip", people: [{ field: "name", role: "Credential holder" }],
    filter: "credentialtype in ('HIC','NHC','MCO','ELC','PLM','HTG','SHM','MEC','FRP','ELV','STC','GLZ','DMCR')" },
  { state: "DE", source: "Delaware Division of Professional Regulation (electrical, plumbing/HVACR)", ...soda("data.delaware.gov", "pjnv-eaih"),
    fields: { businessName: null, licenseNumber: "license_no", licenseType: "license_type", specialty: "profession_id", status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: ["first_name", "last_name"],
    people: [{ field: ["first_name", "last_name"], role: "Licensee" }],
    filter: "profession_id in ('Electrical Examiners','Plumbing/HVACR','Elevator Mechanics','Manufactured Home Installation')" },
  { state: "OR", source: "Oregon Construction Contractors Board (active licenses)", ...soda("data.oregon.gov", "g77e-6bhs"),
    fields: { businessName: "full_name", licenseNumber: "license_number", licenseType: "license_type", specialty: "endorsement_text", status: null, principal: "rmi_name", city: "city", expires: "lic_exp_date" },
    // The licensee and its responsible managing individual are two names, never one person (audit 2026-10-15).
    personField: { anyOf: ["full_name", "rmi_name"] },
    address: ["address", "city", "state"], zip: "zip_code", phone: "phone_number",
    people: [{ field: "rmi_name", role: "Responsible managing individual" }] },
  { state: "OR", source: "Oregon Building Codes Division trade licenses", ...soda("data.oregon.gov", "vhbr-cuaq"),
    fields: { businessName: "full_name", licenseNumber: "licnbr", licenseType: "lictype", specialty: "profession", status: "lic_status", principal: "full_name", city: "city", expires: "expiration_date" },
    personField: "full_name",
    // addr4 (and sometimes addr2/addr3) repeats "CITY ST  ZIP"; such a line, and placeholder lines ("---", "."), are dropped.
    address: ["addr1", "addr2", "addr3", "city", "state"], zip: "zipcode", people: [{ field: "full_name", role: "Licensee" }],
    filter: "profession in ('Electrical','Plumbing','Boiler','Elevator','Combo License')",
    // Journeyman and other individual licenses (lictype "J-General Journeyman", "JP-Journeyman Plumber", …) name a
    // person; contractor and business licenses ("C-Electrical Contractor", "BB-Boiler Business") a business.
    isBusiness: (r) => /contractor|business/i.test(String(r.lictype ?? "")) || looksLikeBusiness(String(r.full_name ?? "")) },
  { state: "VT", source: "Vermont Division of Fire Safety trade licenses", ...soda("data.vermont.gov", "cy8e-89cz"),
    fields: { businessName: null, licenseNumber: "license_number", licenseType: "type_desc", specialty: "level_desc", status: null, principal: null, city: "city", expires: "license_exp_date" },
    personField: ["first_name", "last_name"],
    address: ["street_address", "city", "state"], zip: "zip_code", people: [{ field: ["first_name", "last_name"], role: "Licensee" }],
    filter: "type_desc in ('Electrician','Plumber','Gas Installer','Oil Installer','Elevator Tradesman','Sprinkler Designer')" },
  { state: "IL", source: "Illinois IDFPR roofing contractor licenses", ...soda("data.illinois.gov", "pzzh-kp68"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "license_type", specialty: "description", status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: ["first_name", "middle", "last_name"],
    people: [{ field: ["first_name", "middle", "last_name", "suffix"], role: "Licensee", roleField: "description" }],
    filter: "license_type='ROOFING CONTRACTOR'" },
  { state: "NY", source: "New York DOL contractor registry (public work)", ...soda("data.ny.gov", "i4jv-zkey"),
    fields: { businessName: "business_name", licenseNumber: "certificate_number", licenseType: "business_type", specialty: null, status: "status", principal: "business_officers", city: "city", expires: "expiration_date" },
    personField: "business_officers",
    address: ["address", "address_2", "city", "state"], zip: "zip_code", phone: "phone",
    // One field listing several officers: each is a person of their own (the principal is the first one listed).
    people: [{ field: "business_officers", role: "Business officer", split: "," }] },
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

/**
 * The person on the row: the name parts of one person joined, or the principal field (never two names joined).
 * When `people` splits the principal field into several people (NY's business_officers), the first one listed.
 */
const personOf = (src: LicenseSource, row: Record<string, unknown>): string | null => {
  const raw = Array.isArray(src.personField) ? src.personField.map((f) => str(row, f)).filter(Boolean).join(" ") || null : str(row, src.fields.principal);
  const split = src.people?.find((p) => p.split && p.field === src.fields.principal)?.split;
  return raw && split ? raw.split(split).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)[0] ?? null : raw;
};

const fieldsOf = (f: string | string[] | undefined): string[] => (f == null ? [] : Array.isArray(f) ? f : [f]);
/** "981011234" → "98101-1234" (some datasets drop the dash, which hides the ZIP from ./identifiers.ts). */
const zipOf = (v: string | null) => (v && /^\d{9}$/.test(v) ? `${v.slice(0, 5)}-${v.slice(5)}` : v);
const words = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
/** "LAST, FIRST M" → "FIRST M LAST"; other forms unchanged. */
const flip = (v: string): string => { const m = v.match(/^([^,]+),\s*([^,]+)$/); return m ? `${m[2]} ${m[1]}`.replace(/\s+/g, " ").trim() : v.replace(/\s+/g, " ").trim(); };

/** The address fields joined; a street line that only repeats the city, state and ZIP, or has no letter or digit, is left out. */
function addressOf(src: LicenseSource, row: Record<string, unknown>): string | null {
  const fields = fieldsOf(src.address);
  const zip = zipOf(str(row, src.zip ?? null));
  const tail = [...fields.slice(-2).map((f) => str(row, f)), zip].filter(Boolean).join(" ");
  const parts = fields.map((f, i) => {
    const v = str(row, f);
    if (!v || !/[A-Za-z0-9]/.test(v)) return null;
    return i < fields.length - 2 && fields.length > 2 && words(v) && words(tail).startsWith(words(v).replace(/ \d{5}( \d{4})?$/, "")) && /\d{5}/.test(v) ? null : v;
  });
  return [...parts, zip].filter(Boolean).join(" ") || null;
}

/** The row's phones, in field order, as published. */
const phonesOf = (src: LicenseSource, row: Record<string, unknown>) => fieldsOf(src.phone).map((f) => str(row, f)).filter((v): v is string => !!v);

/** Everyone the row itself names (not the joined datasets), with roles; a "person" that is just the business name is left out. */
function rowPeople(src: LicenseSource, row: Record<string, unknown>, business: string | null): { name: string; role: string | null }[] {
  const out: { name: string; role: string | null }[] = [];
  for (const p of src.people ?? []) {
    const raw = fieldsOf(p.field).map((f) => str(row, f)).filter(Boolean).join(" ");
    const role = (p.roleField && str(row, p.roleField)) || p.role;
    for (const part of p.split ? raw.split(p.split) : [raw]) {
      const name = part.replace(/\s+/g, " ").trim();
      // A name that is only the business name again is not a person, unless the publisher gives it its own role.
      if (name && (words(name) !== words(business) || (p.roleField && str(row, p.roleField)))) out.push({ name, role });
    }
  }
  return out;
}

function toHit(src: LicenseSource, row: Record<string, unknown>, matchedOn: LicenseHit["matchedOn"], principal?: string | null): LicenseHit {
  const expires = str(row, src.fields.expires);
  // One field that is both the business and the person (an "applicant"): a business only when it reads as one.
  const sameField = !src.isBusiness && !!src.fields.businessName && src.fields.businessName === src.fields.principal;
  const holder = str(row, src.fields.businessName);
  const business = (src.isBusiness ? !src.isBusiness(row) : sameField && !looksLikeBusiness(holder)) ? null : holder;
  const people = rowPeople(src, row, business);
  return {
    state: src.state, source: src.source, sourceUrl: src.datasetUrl,
    businessName: business, licenseNumber: str(row, src.fields.licenseNumber),
    licenseType: str(row, src.fields.licenseType), specialty: str(row, src.fields.specialty),
    status: str(row, src.fields.status), principal: principal ?? personOf(src, row) ?? (business ? null : str(row, src.fields.businessName)),
    city: str(row, src.fields.city), expires: expires ? expires.slice(0, 10) : null, matchedOn,
    ...(src.address ? { address: addressOf(src, row) } : {}),
    ...(src.phone ? { phone: phonesOf(src, row)[0] ?? null } : {}),
    ...(people.length ? { people } : {}),
  };
}

/** Adds the people of src.peopleFrom (every principal, every signer) to each hit, joined on the license number. */
export async function withPeople(src: LicenseSource, hits: LicenseHit[]): Promise<LicenseHit[]> {
  const ids = Array.from(new Set(hits.map((h) => h.licenseNumber).filter((v): v is string => !!v))).slice(0, 50);
  if (!src.peopleFrom?.length || !ids.length) return hits;
  const byLicense = new Map<string, { name: string; role: string | null }[]>();
  for (const ds of src.peopleFrom) {
    let rows: Record<string, unknown>[];
    try { rows = await sodaRows(ds.url, `${ds.licenseField} in (${ids.map(quote).join(",")}) AND ${ds.nameField} IS NOT NULL`, 1000, "People data"); }
    catch { continue; } // the license rows stand on their own; the people are extra
    for (const r of rows) {
      const lic = str(r, ds.licenseField), raw = str(r, ds.nameField);
      if (!lic || !raw) continue;
      const end = ds.endField ? str(r, ds.endField)?.slice(0, 10) : null;
      const kind = ds.roleField && str(r, ds.roleField) ? `${ds.role} (${str(r, ds.roleField)})` : ds.role;
      const role = end ? `Former ${kind.toLowerCase()} (until ${end})` : kind;
      (byLicense.get(lic) ?? byLicense.set(lic, []).get(lic)!).push({ name: flip(raw), role });
    }
  }
  return hits.map((h) => {
    const extra = h.licenseNumber ? byLicense.get(h.licenseNumber) ?? [] : [];
    if (!extra.length) return h;
    const all = [...(h.people ?? []).map((p) => ({ ...p, name: flip(p.name) })), ...extra];
    // One entry per person and role; the primary principal (also in the principals list) keeps that label.
    const seen = new Set<string>();
    const people = all.filter((p) => { const k = `${words(p.name).split(" ").sort().join(" ")}|${p.role}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .filter((p, _, list) => p.role !== "Principal" || !list.some((q) => q !== p && q.role === "Primary principal" && words(q.name).split(" ").sort().join(" ") === words(p.name).split(" ").sort().join(" ")));
    return { ...h, people };
  });
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
    if (n) where = "(" + fieldsOf(src.phone).map((f) => `${f}::text like ${quote(`%${n.slice(0, 3)}%${n.slice(3, 6)}%${n.slice(6)}%`)}`).join(" OR ") + ")";
  } else if (q.type === "address" && src.address) {
    const key = addressKeys(q.value).find((k) => k.startsWith("a:"));
    const fields = fieldsOf(src.address);
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
  // Every row up to the cap, re-checked on the publisher's own values; a cut-off search says so.
  const rows = await sodaAll(src.url, where + extra, 2000);
  const hits = rows.filter((row) => {
    if (q.type === "license") return normLicense(str(row, src.fields.licenseNumber)) === normLicense(q.value);
    if (q.type === "address") return addressMatches(q.value, toHit(src, row, matchedOn).address);
    return idWords({ phones: phonesOf(src, row) }).includes(`t:${normPhone(q.value)}`);
  }).map((row) => toHit(src, row, matchedOn));
  return withNote(await withPeople(src, hits), noteOf(rows));
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
  return withNote(await withPeople(src, raw.filter((h) => wholeWordMatch(name, h))), noteOf(raw));
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
