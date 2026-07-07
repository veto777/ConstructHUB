import { db } from "./db";
import { permitDatabases } from "@shared/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

// Verified real municipal permit portals for major jurisdictions
// (built by scripts/build-permit-portals.ts — every URL liveness-checked and
// confirmed permit-specific). Applied on top of the city permit rows.
interface PermitPortal { jurisdiction: string; url: string; platform: string; }

export async function seedPermitPortals() {
  let portals: PermitPortal[];
  try {
    const filePath = join(import.meta.dirname || __dirname, "data", "permit-portals.json");
    portals = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e: any) {
    console.warn(`permit-portals.json not found (${e?.message}); skipping permit-portal enrichment.`);
    return;
  }

  let updated = 0, unmatched = 0;
  for (const p of portals) {
    // permit_databases.jurisdiction is "City, ST" for cities and "Name County, ST"
    // for counties — the string alone identifies the row, so match on it directly.
    const res = await db
      .update(permitDatabases)
      .set({
        portalUrl: p.url,
        searchUrl: p.url,
        platform: p.platform,
        isActive: true,
        linkStatus: "live", // verified live at build time; re-checked by verify-links.ts
        lastVerifiedAt: new Date(),
      })
      .where(eq(permitDatabases.jurisdiction, p.jurisdiction))
      .returning({ id: permitDatabases.id });
    if (res.length) updated += res.length;
    else { unmatched++; console.warn(`  permit-portal: no matching row for "${p.jurisdiction}"`); }
  }
  if (unmatched) console.log(`  (${unmatched} portals had no matching permit row — jurisdiction naming mismatch)`);
  console.log(`Permit portals: applied ${updated} verified real portals to major jurisdictions.`);
}
