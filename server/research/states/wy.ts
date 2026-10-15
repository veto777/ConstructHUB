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

async function lookupServices(body: Record<string, unknown>): Promise<any[]> {
  const rows = await postJson<any[]>(`${API}/services/PublicLookupService`, { enterprise_id: ENTERPRISE, records_offset: 0, records_total: 50, ...body }, "Wyoming licensing portal");
  if (!Array.isArray(rows)) throw new Error("Wyoming licensing portal returned an unexpected payload");
  return rows;
}
async function lookupUsers(body: Record<string, unknown>): Promise<any[]> {
  const rows = await postJson<any[]>(`${API}/users/PublicLookupUser`, { enterprise_id: ENTERPRISE, records_offset: 0, records_total: 50, from_search: true, ...body }, "Wyoming licensing portal");
  if (!Array.isArray(rows)) throw new Error("Wyoming licensing portal returned an unexpected payload");
  return rows;
}

/** A licensed business (electrical contractor): the portal gives its address, phone and primary contact. */
async function serviceHit(r: any, matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit> {
  const own = (await certs("services", r.id)).find((c) => c.number === r.primary_license_number);
  const contact = clean(r.primary_contact_full_name) ?? clean(`${r.primary_contact_first_name ?? ""} ${r.primary_contact_last_name ?? ""}`);
  return {
    state: "WY", source: SOURCE, sourceUrl: PORTAL, businessName: clean(String(r.service_name ?? "").replace(/^\*/, "")),
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
    for (const r of (await lookupServices({ serviceName: words })).filter((x) => nameMatches(name, String(x.service_name ?? "").replace(/^\*/, ""))).slice(0, MAX)) hits.push(await serviceHit(r, "business"));
    return hits;
  }
  // People: the portal searches first and last name fields; the last word is the surname.
  const parts = words.split(" ");
  const last = parts[parts.length - 1], first = parts.length > 1 ? parts[0] : undefined;
  for (const r of (await lookupUsers({ last_name: last, ...(first ? { first_name: first } : {}) })).filter((x) => x.primary_license_number && nameMatches(name, `${x.first_name ?? ""} ${x.last_name ?? ""}`)).slice(0, MAX)) {
    hits.push(await userHit(r, "principal"));
  }
  return hits;
}

/** The portal searches license numbers (businesses and people); phone and address are not searchable there. */
async function searchBy(q: IdQuery): Promise<LicenseHit[]> {
  const want = q.type === "license" ? normLicense(q.value) : null;
  if (!want) return [];
  const v = q.value.trim().toUpperCase();
  const hits: LicenseHit[] = [];
  for (const r of (await lookupServices({ primaryCertificationNumber: v })).filter((x) => normLicense(x.primary_license_number) === want).slice(0, 5)) hits.push(await serviceHit(r, "license"));
  for (const r of (await lookupUsers({ primaryCertification: v })).filter((x) => normLicense(x.primary_license_number) === want).slice(0, 5)) hits.push(await userHit(r, "license"));
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
