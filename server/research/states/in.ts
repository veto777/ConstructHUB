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
 * Indianapolis license contractors. The PLA's statewide plumber lookup answers searches but sits under the IN.gov
 * Terms of Use (personal use only, no retrieval systems), so it is not used: see `blocked` (re-checked 2026-10-15).
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
      // A city contractor license (the business named on it holds it).
      holder: "business",
    },
    business, person: null, keys: { licenses: [r["License Number"], r["Business License #"]], addresses: [address] },
  };
}

async function* indyLoader(): AsyncIterable<BulkHit> {
  for (const type of INDY_TYPES) {
    const path = await accelaExport("INDY", type);
    try {
      let n = 0;
      // Each license type's export is a component: one that falls far short of its last count keeps the old load (decision 10).
      for await (const r of csvRecords(path)) { const h = indyRow(r); if (h) { n++; yield { ...h, component: type }; } }
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
    "Professional Licensing Agency Search and Verify (mylicense.in.gov/EVerification), re-checked 2026-10-15: robots.txt has content-signal comments only (no rules), the search form's Recaptcha1 field is an empty hidden input and a Plumbing Commission search answers (Plumbing Contractor, Journeyman Plumber, Plumbing Corporation with its related plumbing contractor, asbestos and lead contractors); not used because the site carries the IN.gov portal header and the IN.gov Terms of Use (in.gov/core/terms_of_use.html) say: \"the viewing, printing, or downloading of any content ... from the Portal grants you only a limited, nonexclusive license for use solely by you for your own personal use, and not for republication, distribution, ... sale, preparation of derivative works or other use. No part of any content ... may be reproduced in any form or incorporated into any information retrieval system, electronic or mechanical, other than for your personal use (not for resale or redistribution)\" and bar using the Portal to \"exploit any information ... for advertising or commercial purposes\"",
    "PLA licensee list download (in.gov/pla/license/download-license-files), re-checked 2026-10-15: sold through the IN.gov portal, \"$150 for the first record ... $10 for each additional 1,000 records\"",
    "PLA Discipline Search (in.gov/ai/appfiles/pla-litigation → in.gov/apps/pla/litigation/advancedsearch.aspx): \"disciplinary actions taken against individual licensees\", searched by first and last name or license number only (no business name), so no company search (FCRA: companies only); IN.gov Terms of Use as above",
    "PLA Indiana Active Licenses Map (in.gov/pla/data/indiana-active-licenses-map): counts per county only, no names",
    "Secretary of State INBiz bulk business data: paid ($9,500) and needs an INBiz account",
    "Indiana Data Hub (hub.mph.in.gov), re-checked 2026-10-15: its search finds no dataset for \"plumbing\" or \"contractor\" (robots.txt disallows /api/)",
  ],
};
