import { preserveNewerGovernmentCheck } from "./government-seed-status";
import { db, pool } from "./db";
import { createHash } from "crypto";
import { permitDatabases, counties } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

// Verified real municipal permit portals for major jurisdictions
// (built by scripts/build-permit-portals.ts — every URL liveness-checked and
// confirmed permit-specific). Applied on top of the city permit rows.
export interface PermitPortal { jurisdiction: string; url: string | null; platform: string | null; linkStatus?: string; lastVerifiedAt?: string | null; }

/**
 * Boot applies the portal file to the directory. That is ~13,000 row-by-row updates in one transaction (about 70
 * seconds on production), and the port only opens afterwards — so every restart was a 70-second outage for a file
 * that had not changed. The file's hash and the directory's row count are remembered in `seed_state`; when both are
 * the same as the last successful apply, the sync is skipped. A new file, new directory rows (added cities need
 * their portals), a fresh database or FORCE_PORTAL_SEED=1 run it as before.
 */
const SEED_KEY = "permit-portals";
async function portalSeedState(): Promise<{ hash: string | null; rows: number }> {
  await pool.query(`CREATE TABLE IF NOT EXISTS seed_state (
    key text PRIMARY KEY, hash text NOT NULL, row_count integer NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows: [prev] } = await pool.query("SELECT hash, row_count FROM seed_state WHERE key=$1", [SEED_KEY]);
  const { rows: [now] } = await pool.query("SELECT count(*)::int AS n FROM permit_databases");
  return { hash: prev && prev.row_count === now.n ? prev.hash : null, rows: now.n };
}

export async function seedPermitPortals() {
  let portals: PermitPortal[];
  let hash: string;
  try {
    const filePath = join(import.meta.dirname || __dirname, "data", "permit-portals.json");
    const raw = readFileSync(filePath, "utf8");
    portals = JSON.parse(raw);
    hash = createHash("sha256").update(raw).digest("hex");
  } catch (e: any) {
    console.warn(`permit-portals.json not found (${e?.message}); skipping permit-portal enrichment.`);
    return;
  }

  if (process.env.FORCE_PORTAL_SEED !== "1") {
    const state = await portalSeedState();
    if (state.hash === hash) {
      console.log(`Permit portals: file and directory unchanged since the last apply (${portals.length} entries, ${state.rows} rows); skipped.`);
      return;
    }
  }
  await syncPermitPortals(portals);
  // Recorded only after a successful apply, with the row count the apply left behind.
  await pool.query(`INSERT INTO seed_state(key, hash, row_count) VALUES($1, $2, (SELECT count(*)::int FROM permit_databases))
    ON CONFLICT (key) DO UPDATE SET hash=EXCLUDED.hash, row_count=EXCLUDED.row_count, applied_at=now()`, [SEED_KEY, hash]);
}

export async function syncPermitPortals(portals: PermitPortal[]) {
 await db.transaction(async tx => {
  await tx.execute(sql`select pg_advisory_xact_lock(8159002)`);
  let updated = 0, unmatched = 0, inserted = 0;
  for (const p of portals) {
    // permit_databases.jurisdiction is "City, ST" for cities and "Name County, ST"
    // for counties — the string alone identifies the row, so match on it directly.
    let matches = await tx.select().from(permitDatabases).where(eq(permitDatabases.jurisdiction, p.jurisdiction));
    if (!matches.length && p.url && !/ County, [A-Z]{2}$/.test(p.jurisdiction)) {
      // The directory's city rows carry postal spellings ("Mckinney, TX", "Coeur D Alene, ID", "Saint Charles, MO");
      // the portal file the proper ones. Exactly one city row with the same letters is the same place: apply the
      // portal and give the row its proper name.
      const loose = (j: string) => j.toLowerCase().replace(/\bsaint\b/g, "st").replace(/[^a-z0-9]/g, "");
      const state = p.jurisdiction.slice(-2);
      const same = (await tx.select().from(permitDatabases).where(and(eq(permitDatabases.jurisdictionType, "city"),
        sql`right(${permitDatabases.jurisdiction}, 2) = ${state}`, sql`lower(regexp_replace(regexp_replace(${permitDatabases.jurisdiction}, '\\mSaint\\M', 'St', 'gi'), '[^A-Za-z0-9]', '', 'g')) = ${loose(p.jurisdiction)}`)));
      if (same.length === 1) {
        await tx.update(permitDatabases).set({ jurisdiction: p.jurisdiction, name: p.jurisdiction }).where(eq(permitDatabases.id, same[0].id));
        matches = [{ ...same[0], jurisdiction: p.jurisdiction }];
      }
    }
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
