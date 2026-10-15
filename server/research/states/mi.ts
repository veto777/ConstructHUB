/**
 * Michigan, checked live 2026-10-15.
 *
 *   mi-lara  LARA licensee lists (Accela Citizen Access, aca-prod.accela.com/LARA): residential builders and
 *            maintenance & alteration contractors (companies and individuals), electrical, mechanical, plumbing,
 *            elevator, boiler and manufactured-home installer licenses. One "Download
 *            results" export per license type (../lib/g5-aspnet.ts). The export has no status column: the report shows
 *            the expiration date LARA publishes, and status stays null.
 *
 * Not usable (see `blocked`): michigan.gov itself (Akamai answers our bot with 403 Access Denied, so LARA's final
 * orders, the Corporations Division and the BCC pages were not used), no Michigan open-data license or enforcement
 * dataset exists on data.michigan.gov.
 */
import { promises as fs } from "node:fs";
import { clean, csvRecords, usDate, type BulkHit } from "../bulk";
import type { StatePack } from "./types";
import { accelaExport, accelaLookupUrl } from "./lib/g5-aspnet";

const LARA = accelaLookupUrl("LARA");

/** LARA license types in the public search's own wording (its License Type list, 2026-10-15). */
export const MI_LICENSE_TYPES = [
  "Residential Builder Company", "Residential Builder Individual", "Residential Builder M and A Company",
  "Residential Builder M and A Individual", "Residential Builder Branch Office",
  "Electrical Contractor", "Electrical Master", "Electrical Journey", "Electrical Fire Alarm Contractor",
  "Electrical Fire Alarm Specialty Tech", "Electrical Sign Contractor", "Electrical Sign Specialist",
  "Electrical Registered Fire Alarm Cont", "Electrical Registered Sign Contractor",
  "Mechanical Contractor", "Plumbing Contractor", "Plumbing Master", "Plumbing Journey",
  "Elevator Contractor", "Elevator Journeyperson", "Boiler Installer", "Boiler Repairer",
  "Manufactured Home Installer Servicer",
];

/** One row of a LARA export (columns: License Number, License Type, Business Name, First Name, Middle Initial, Last Name, License Expiration Date, City, State, Zip). */
export function miRow(r: Record<string, string>): BulkHit | null {
  const business = clean(r["Business Name"]);
  const who = clean([r["First Name"], r["Middle Initial"], r["Last Name"]].map((v) => v?.trim()).filter(Boolean).join(" "));
  if (!business && !who) return null;
  const st = clean(r.State);
  return {
    kind: "license",
    hit: {
      state: "MI", source: "Michigan LARA licenses (builders and trades)", sourceUrl: LARA,
      businessName: business, licenseNumber: clean(r["License Number"]), licenseType: clean(r["License Type"]), specialty: null,
      status: null, principal: who, city: [clean(r.City), st && st !== "MI" ? st : null].filter(Boolean).join(", ") || null,
      expires: usDate(r["License Expiration Date"]), matchedOn: business ? "business" : "principal",
      // The export names one person per license without a role; no street address or phone is published.
      address: null, phone: null, ...(who ? { people: [{ name: who, role: null }] } : {}),
    },
    business, person: who, keys: { licenses: [r["License Number"]] },
  };
}

async function* laraLoader(): AsyncIterable<BulkHit> {
  for (const type of MI_LICENSE_TYPES) {
    const path = await accelaExport("LARA", type);
    try {
      let n = 0;
      for await (const r of csvRecords(path)) { const h = miRow(r); if (h) { n++; yield h; } }
      if (!n) throw new Error(`LARA export for ${type} was empty`);
    } finally {
      await fs.rm(path, { force: true });
    }
  }
}

export const pack: StatePack = {
  state: "MI",
  checked: "2026-10-15",
  bulk: [
    { id: "mi-lara", state: "MI", label: "Michigan LARA licenses (builders and trades)", pageUrl: LARA,
      everyHours: 24 * 7, minRows: 158_000, load: laraLoader },
  ],
  blocked: [
    "michigan.gov (LARA BCC pages, final orders, Corporations Division): Akamai returns 403 Access Denied to our bot, not used",
    "data.michigan.gov: no license, enforcement or business-entity dataset (only performance measures)",
    "LARA Architect and Engineer licensee exports (aca-prod.accela.com/LARA): the search answers with a server error page for these two types, left out",
    "LARA disciplinary actions: published only on michigan.gov (blocked above); the Accela export carries no discipline",
  ],
};
