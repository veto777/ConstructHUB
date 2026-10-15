/**
 * Indiana, checked live 2026-10-15.
 *
 *   in-indy   City of Indianapolis (Business and Neighborhood Services) contractor licenses, from its Accela Citizen
 *             Access licensee search (aca-prod.accela.com/INDY, "Download results"; ./lib/g5-aspnet.ts): general,
 *             electrical, HVAC, plumbing, wrecking, asbestos-removal and utility contractors, every year on file. The
 *             export names a person by first name only, so only rows with a business name are kept, and it has no
 *             status column (the expiration and insurance-expiration dates are shown).
 *
 * Indiana licenses no general contractors statewide: the Professional Licensing Agency's boards (its Search and
 * Verify board list) include the Plumbing Commission but no contractor board; cities and counties such as
 * Indianapolis license contractors.
 */
import { promises as fs } from "node:fs";
import { clean, csvRecords, usDate, type BulkHit } from "../bulk";
import type { StatePack } from "./types";
import { accelaExport, accelaLookupUrl } from "./lib/g5-aspnet";

const INDY = accelaLookupUrl("INDY");
const INDY_SOURCE = "Indianapolis contractor licenses (Business and Neighborhood Services)";
/** The license types of the INDY licensee search (its License Type list, 2026-10-15), "Agent" left out. */
export const INDY_TYPES = ["Gen. Contractor", "Electrical", "HVAC", "Plumbing", "Wrecking", "Asbestos Removal Contractor", "Utility"];

/** "108 E EPLER  AV                INDIANAPOLIS IN 46227" → street and "INDIANAPOLIS IN 46227". */
export function indyAddress(v: string | undefined): { address: string | null; city: string | null } {
  const parts = (v ?? "").split(/\s{3,}/).map((p) => clean(p)).filter((p): p is string => !!p);
  if (!parts.length) return { address: null, city: null };
  const tail = parts.length > 1 ? parts[parts.length - 1] : null;
  const m = tail?.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  const street = clean(parts.slice(0, tail ? -1 : undefined).join(" "));
  return { address: clean([street, tail].filter(Boolean).join(", ")), city: m ? clean(`${m[1]}${m[2] !== "IN" ? `, ${m[2]}` : ""}`) : null };
}

export function indyRow(r: Record<string, string>): BulkHit | null {
  const business = clean(r["Business Name"]);
  if (!business) return null;
  const { address, city } = indyAddress(r.Address);
  const ins = usDate(r["Insurance Expiration Date"]);
  return {
    kind: "license",
    hit: {
      state: "IN", source: INDY_SOURCE, sourceUrl: INDY, businessName: business, licenseNumber: clean(r["License Number"]),
      licenseType: clean(r["License Type"]) ? `Indianapolis ${clean(r["License Type"])} license` : null,
      specialty: ins ? `Insurance on file until ${ins}` : null, status: null, principal: null, city, expires: usDate(r["License Expiration Date"]),
      matchedOn: "business", address, phone: null,
    },
    business, person: null, keys: { licenses: [r["License Number"], r["Business License #"]], addresses: [address] },
  };
}

async function* indyLoader(): AsyncIterable<BulkHit> {
  for (const type of INDY_TYPES) {
    const path = await accelaExport("INDY", type);
    try {
      let n = 0;
      for await (const r of csvRecords(path)) { const h = indyRow(r); if (h) { n++; yield h; } }
      if (!n) throw new Error(`INDY export for ${type} was empty`);
    } finally {
      await fs.rm(path, { force: true });
    }
  }
}

export const pack: StatePack = {
  state: "IN",
  checked: "2026-10-15",
  bulk: [
    { id: "in-indy", state: "IN", label: INDY_SOURCE, pageUrl: INDY, everyHours: 24 * 7, minRows: 38_000, load: indyLoader },
  ],
  noStatewideGcLicense:
    "Indiana does not license general contractors statewide; the Plumbing Commission licenses plumbers, and cities and counties such as Indianapolis license contractors (Indianapolis is searched above)",
  blocked: [
    "Professional Licensing Agency Search and Verify (mylicense.in.gov/EVerification): reCAPTCHA; plumbers, home inspectors, asbestos and lead licensees not searchable",
    "PLA licensee list download (in.gov/pla): sold per record through the IN.gov portal",
    "Secretary of State INBiz bulk business data: paid ($9,500) and needs an INBiz account",
    "Indiana Data Hub (hub.mph.in.gov): no license or enforcement dataset for construction",
  ],
};
