import { preserveNewerGovernmentCheck } from "./government-seed-status";
import { db } from "./db";
import { permitDatabases } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

// Verified real municipal permit portals for major jurisdictions
// (built by scripts/build-permit-portals.ts — every URL liveness-checked and
// confirmed permit-specific). Applied on top of the city permit rows.
export interface PermitPortal { jurisdiction: string; url: string | null; platform: string | null; linkStatus?: string; lastVerifiedAt?: string | null; }

export async function seedPermitPortals() {
  let portals: PermitPortal[];
  try {
    const filePath = join(import.meta.dirname || __dirname, "data", "permit-portals.json");
    portals = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e: any) {
    console.warn(`permit-portals.json not found (${e?.message}); skipping permit-portal enrichment.`);
    return;
  }

  await syncPermitPortals(portals);
}

export async function syncPermitPortals(portals: PermitPortal[]) {
 await db.transaction(async tx => {
  await tx.execute(sql`select pg_advisory_xact_lock(8159002)`);
  let updated = 0, unmatched = 0;
  for (const p of portals) {
    // permit_databases.jurisdiction is "City, ST" for cities and "Name County, ST"
    // for counties — the string alone identifies the row, so match on it directly.
    const matches = await tx.select().from(permitDatabases).where(eq(permitDatabases.jurisdiction, p.jurisdiction));
    const values = {
      portalUrl: p.url,
      searchUrl: p.url,
      platform: p.platform,
      isActive: !!p.url && p.linkStatus === "live",
      linkStatus: p.url ? (p.linkStatus || "unchecked") : "none",
      lastVerifiedAt: p.lastVerifiedAt ? new Date(p.lastVerifiedAt) : null,
    };
    for (const row of matches) {
      await tx.update(permitDatabases).set({ ...values, ...preserveNewerGovernmentCheck(row, values) }).where(eq(permitDatabases.id, row.id));
    }
    const res = matches;
    if (res.length) updated += res.length;
    else { unmatched++; console.warn(`  permit-portal: no matching row for "${p.jurisdiction}"`); }
  }
  if (unmatched) console.log(`  (${unmatched} portals had no matching permit row — jurisdiction naming mismatch)`);
  console.log(`Permit portals: applied ${updated} verified real portals to major jurisdictions.`);
 });
}
