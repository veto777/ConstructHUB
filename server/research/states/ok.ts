/**
 * Oklahoma. Every source here was opened and read live on 2026-10-15; field names, statuses and their labels are
 * the Construction Industries Board's own (CLAUDE.md: never fabricate government data).
 *
 *   CIB roofing contractor registrations (verify.cib.hbesystems.com, the board's "Verify Roofing" lookup, linked
 *     from verifyroofing.cib.ok.gov), bulk, daily: every registration the lookup's own JSON API returns
 *     (/api/roofing/search, paged), with status, registration number, expiration date (renewalDate, labelled
 *     "Expiration Date" on the lookup), company, DBA, address, phone, the person named on the registration and the
 *     commercial endorsement.
 */
import type { LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../../scrapers/polite-fetch";
import { clean, type BulkHit, type BulkSource } from "../bulk";
import type { StatePack } from "./types";

const VERIFY_PAGE = "https://verifyroofing.cib.ok.gov/roofing/search";
const API = "https://verify.cib.hbesystems.com/api/roofing";
const PAGE_SIZE = 1000;

type Reg = Record<string, unknown>;
const s = (v: unknown) => clean(v == null ? null : String(v));

export function roofingHit(r: Reg): BulkHit | null {
  const company = s(r.company_name);
  const dba = s(r.company_trade);
  const person = clean([s(r.person_firstName), s(r.person_middleName), s(r.person_lastName)].filter(Boolean).join(" "));
  if (!company && !person) return null;
  const street = [s(r.company_address1), s(r.company_address2)].filter(Boolean).join(" ");
  const address = [street, s(r.company_city), [s(r.company_state), s(r.company_zipcode)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const number = s(r.licenseNumber);
  const hit: LicenseHit = {
    state: "OK", source: "Oklahoma Construction Industries Board roofing contractor registrations", sourceUrl: VERIFY_PAGE,
    businessName: [company, dba ? `DBA ${dba}` : null].filter(Boolean).join(" ") || null, licenseNumber: number,
    licenseType: s(r.tradeName), specialty: r.commercialEndorsement === true ? "Commercial endorsement" : null,
    status: s(r.statusName), principal: person, city: [s(r.company_city), s(r.company_state)].filter(Boolean).join(", ") || null,
    expires: s(r.renewalDate)?.slice(0, 10) ?? null, matchedOn: company ? "business" : "principal",
    address, phone: s(r.company_telephone), people: person ? [{ name: person, role: null }] : [],
  };
  return { kind: "license", hit, business: [company, dba].filter(Boolean).join(" ") || null, person, keys: { licenses: [number], phones: [hit.phone], addresses: [address] } };
}

async function* okRoofing(): AsyncIterable<BulkHit> {
  const countRes = await politeFetch(`${API}/count`, { headers: { accept: "application/json" } }, { minDelayMs: 2000 });
  if (!countRes.ok) throw new Error(`CIB roofing count returned HTTP ${countRes.status}`);
  const total = Number(await countRes.text());
  const seen = new Set<string>();
  for (let offset = 0; offset < total + PAGE_SIZE; offset += PAGE_SIZE) {
    const res = await politeFetch(`${API}/search?limit=${PAGE_SIZE}&offset=${offset}`, { headers: { accept: "application/json" } }, { minDelayMs: 2000, timeoutMs: 120_000 });
    if (!res.ok) throw new Error(`CIB roofing search returned HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("CIB roofing search returned an unexpected payload");
    for (const r of rows as Reg[]) {
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const h = roofingHit(r);
      if (h) yield h;
    }
    if (rows.length < PAGE_SIZE) break;
  }
  if (seen.size < total * 0.95) throw new Error(`CIB roofing paging returned ${seen.size} of ${total} registrations`);
}

const BULK: BulkSource[] = [
  {
    id: "ok-cib-roofing", state: "OK", label: "Oklahoma Construction Industries Board roofing contractor registrations",
    pageUrl: VERIFY_PAGE, everyHours: 24, minRows: 4200, load: okRoofing,
  },
];

export const pack: StatePack = {
  state: "OK",
  checked: "2026-10-15",
  bulk: BULK,
  noStatewideGcLicense:
    "Oklahoma does not license general contractors statewide; the Construction Industries Board licenses electrical, plumbing and mechanical trades and registers roofing contractors",
  blocked: [
    "CIB electrical, plumbing and mechanical license search (cibverify.ok.gov GL Suite licensee search): answered HTTP 503 with Retry-After 3600 for over an hour on 2026-10-15, from tower1 and from vb11",
    "CIB disciplinary actions: the board's site (oklahoma.gov/cib) publishes no list or file of orders",
    "Department of Labor alarm, locksmith and fire sprinkler licensees (oklahoma.gov/labor compliance lists): PDF lists only, and the production server has no PDF text tool (pdftotext)",
    "data.ok.gov: no CIB, contractor, debarment or business-entity dataset newer than 2019",
  ],
};
