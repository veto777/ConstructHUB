import { preserveNewerGovernmentCheck } from "./government-seed-status";
import { db } from "./db";
import { permitDatabases, counties } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
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
  let updated = 0, unmatched = 0, inserted = 0;
  for (const p of portals) {
    // permit_databases.jurisdiction is "City, ST" for cities and "Name County, ST"
    // for counties — the string alone identifies the row, so match on it directly.
    const matches = await tx.select().from(permitDatabases).where(eq(permitDatabases.jurisdiction, p.jurisdiction));
    const values = {
      portalUrl: p.url,
      searchUrl: p.url,
      platform: p.platform,
      isActive: !!p.url && ["live", "verified", "unconfirmed"].includes(p.linkStatus || ""),
      linkStatus: p.url ? (p.linkStatus || "unchecked") : (p.linkStatus === "dead" ? "dead" : "none"),
      lastVerifiedAt: p.lastVerifiedAt ? new Date(p.lastVerifiedAt) : null,
    };
    for (const row of matches) {
      await tx.update(permitDatabases).set({ ...values, ...preserveNewerGovernmentCheck(row, values) }).where(eq(permitDatabases.id, row.id));
    }
    if (matches.length) updated += matches.length;
    else {
      // County identity is explicit in the source natural key. Never guess the
      // parent county of an unmatched city or overwrite another jurisdiction.
      const key = p.jurisdiction.match(/^(.+) County, ([A-Z]{2})$/);
      const found = key ? await tx.select().from(counties).where(and(eq(counties.name, key[1]), eq(counties.stateCode, key[2]))) : [];
      if (found.length === 1) {
        await tx.insert(permitDatabases).values({ ...values, name: p.jurisdiction, jurisdiction: p.jurisdiction, jurisdictionType: "county", countyId: found[0].id });
        inserted++;
      } else {
        unmatched++; console.warn(`  permit-portal: no matching row for "${p.jurisdiction}"`);
      }
    }
  }
  if (unmatched) console.log(`  (${unmatched} portals had no matching permit row — jurisdiction naming mismatch)`);
  console.log(`Permit portals: updated ${updated} reference rows, inserted ${inserted} county portals to major jurisdictions.`);
 });
}
