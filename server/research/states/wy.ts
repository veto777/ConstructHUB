/**
 * Wyoming. Checked live 2026-10-15.
 *
 *   Live license search:
 *     Department of Fire Prevention & Electrical Safety licensing portal (ImageTrend License Management,
 *       wyelectrician.imagetrendlicense.com): electrical contractors (company search) and electricians, apprentices
 *       and low-voltage technicians (person search), with each license's own status from the portal's certification
 *       record. The portal's public lookup has its reCAPTCHA switched off (the portal's own configuration says
 *       recaptcha_enabled: false) and publishes no robots.txt. Complaints are hidden by the portal (hide_complaints).
 *
 * Wyoming has no statewide contractor-licensing board; the state licenses electrical work only.
 */
import type { LicenseHit } from "@shared/research-reports";
import { clean } from "../bulk";
import type { LiveLicenseSearch, StatePack } from "./types";
import { normLicense, type IdQuery } from "../identifiers";
import { anyDay, fetchJson, nameMatches, postJson } from "./lib/g8-common";
import { capNote, withNote } from "../notes";

const PORTAL = "https://wyelectrician.imagetrendlicense.com/lms/public/portal#/lookup";
const API = "https://wyelectrician.imagetrendlicense.com/lms/admin/api/api";
/** The portal's enterprise id, from its public configuration (api/enterprise/getbyaddress). */
const ENTERPRISE = "d2c7a1cc-784a-4c54-b1eb-2a53d890b205";
const SOURCE = "Wyoming Fire Prevention & Electrical Safety licenses";
const MAX = 15;

type Cert = { number?: string | null; status?: string | null; license_category_name?: string | null };

async function certs(kind: "users" | "services", id: string): Promise<Cert[]> {
  const q = new URLSearchParams({ [kind === "users" ? "user_id" : "service_id"]: id, detail: "false", enterprise_id: ENTERPRISE });
  const rows = await fetchJson<Cert[]>(`${API}/${kind}/${kind === "users" ? "getusercertifications" : "getservicecertifications"}?${q}`, {}, "Wyoming licensing portal");
  return Array.isArray(rows) ? rows : [];
}

const PAGE = 50;
const MAX_PAGES = 6;

/**
 * Every row of one lookup, a page of 50 at a time (records_offset) until a short page. Past MAX_PAGES pages the rest
 * is not read and `more` says so (the portal gives no total).
 */
export async function lookupAll(post: (offset: number) => Promise<unknown>): Promise<{ rows: any[]; more: boolean }> {
  const rows: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const got = await post(page * PAGE);
    if (!Array.isArray(got)) throw new Error("Wyoming licensing portal returned an unexpected payload");
    rows.push(...got);
    if (got.length < PAGE) return { rows, more: false };
  }
  return { rows, more: true };
}
const lookupServices = (body: Record<string, unknown>) =>
  lookupAll((offset) => postJson<any[]>(`${API}/services/PublicLookupService`, { enterprise_id: ENTERPRISE, records_offset: offset, records_total: PAGE, ...body }, "Wyoming licensing portal"));
const lookupUsers = (body: Record<string, unknown>) =>
  lookupAll((offset) => postJson<any[]>(`${API}/users/PublicLookupUser`, { enterprise_id: ENTERPRISE, records_offset: offset, records_total: PAGE, from_search: true, ...body }, "Wyoming licensing portal"));

/** What a capped search left out, for the report. */
function capped(found: number, more: boolean): string | null {
  const notes: string[] = [];
  if (found > MAX) notes.push(capNote(MAX, found, "matching licenses (details read for these)"));
  if (more) notes.push(`the portal had more than ${MAX_PAGES * PAGE} name matches; the rest were not read`);
  return notes.join("; ") || null;
}

/** A licensed business (electrical contractor): the portal gives its address, phone and primary contact. */
async function serviceHit(r: any, matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit> {
  const own = (await certs("services", r.id)).find((c) => c.number === r.primary_license_number);
  const contact = clean(r.primary_contact_full_name) ?? clean(`${r.primary_contact_first_name ?? ""} ${r.primary_contact_last_name ?? ""}`);
  return {
        // A few names start with "*" (e.g. "*Intermountain Electric Service Inc", license C-29, expired 2023). The portal
    // doesn't say what it means, so the name is shown as published rather than with the mark silently dropped.
    state: "WY", source: SOURCE, sourceUrl: PORTAL, businessName: clean(String(r.service_name ?? "")),
    licenseNumber: clean(r.primary_license_number), licenseType: clean(r.primary_license_level) ?? clean(own?.license_category_name), specialty: null,
    status: clean(own?.status), principal: contact, city: clean(r.city), expires: anyDay(r.primary_license_expiration_date), matchedOn,
    address: [clean(r.address_line_1), clean(r.city)].filter(Boolean).join(" ") || null, phone: clean(r.phone),
    people: contact ? [{ name: contact, role: "Primary contact" }] : [],
  };
}

async function userHit(r: any, matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit> {
  const own = (await certs("users", r.id)).find((c) => c.number === r.primary_license_number);
  return {
    state: "WY", source: SOURCE, sourceUrl: PORTAL, businessName: null, licenseNumber: clean(r.primary_license_number),
    licenseType: clean(r.primary_license_levels) ?? clean(own?.license_category_name), specialty: null, status: clean(own?.status),
    principal: clean(`${r.first_name ?? ""} ${r.last_name ?? ""}`), city: null, expires: anyDay(r.primary_license_expiration_date), matchedOn,
  };
}

async function search(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const words = name.replace(/[^A-Za-z0-9&'. -]/g, " ").replace(/\s+/g, " ").trim();
  if (words.length < 2) return [];
  const hits: LicenseHit[] = [];
  if (kind === "company") {
    const { rows, more } = await lookupServices({ serviceName: words });
    const found = rows.filter((x) => nameMatches(name, String(x.service_name ?? "")));
    for (const r of found.slice(0, MAX)) hits.push(await serviceHit(r, "business"));
    return withNote(hits, capped(found.length, more));
  }
  // People: the portal searches first and last name fields; the last word is the surname.
  const parts = words.split(" ");
  const last = parts[parts.length - 1], first = parts.length > 1 ? parts[0] : undefined;
  const { rows, more } = await lookupUsers({ last_name: last, ...(first ? { first_name: first } : {}) });
  const found = rows.filter((x) => x.primary_license_number && nameMatches(name, `${x.first_name ?? ""} ${x.last_name ?? ""}`));
  for (const r of found.slice(0, MAX)) hits.push(await userHit(r, "principal"));
  return withNote(hits, capped(found.length, more));
}

/** The portal searches license numbers (businesses and people); phone and address are not searchable there. */
async function searchBy(q: IdQuery): Promise<LicenseHit[] | null> {
  const want = q.type === "license" ? normLicense(q.value) : null;
  if (!want) return null;
  const v = q.value.trim().toUpperCase();
  const hits: LicenseHit[] = [];
  for (const r of (await lookupServices({ primaryCertificationNumber: v })).rows.filter((x) => normLicense(x.primary_license_number) === want).slice(0, 5)) hits.push(await serviceHit(r, "license"));
  for (const r of (await lookupUsers({ primaryCertification: v })).rows.filter((x) => normLicense(x.primary_license_number) === want).slice(0, 5)) hits.push(await userHit(r, "license"));
  return hits;
}

const liveLicenses: LiveLicenseSearch[] = [{ source: SOURCE, sourceUrl: PORTAL, search, searchBy }];

export const pack: StatePack = {
  state: "WY",
  checked: "2026-10-15",
  liveLicenses,
  noStatewideGcLicense: "Wyoming does not license general contractors statewide (cities and counties license them, where they do); the state licenses electrical work, which is searched above",
  blocked: [
    "Secretary of State business search (wyobiz.wyo.gov): a JavaScript bot challenge on every page",
    "Electrical licensing complaints: hidden by the portal (hide_complaints)",
  ],
};
