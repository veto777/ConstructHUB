import { db } from "./db";
import { counties, propertyAppraisers } from "@shared/schema";
import { sql, like } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

const REAL_DATA_MARKER = "Sourced from NETR Online.";

// Real assessor / property-appraiser office data scraped from NETR Online
// (see scripts/scrape-netronline.ts). No fabrication: an office with no online
// portal on record is stored with portalUrl: null.
interface AppraiserRecord {
  stateCode: string;
  county: string;
  name: string;
  phone: string | null;
  portalUrl: string | null;
  platform: string | null;
  source: string;
}

// Normalize a county name for matching NETR display names against the counties
// table (handles "St." vs "Saint", punctuation, "County"/"Parish" suffixes, case).
function normCounty(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bst\.?\b/g, "saint")
    .replace(/\bste\.?\b/g, "sainte")
    .replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

const SEARCHABLE_FIELDS = ["Address", "Owner", "Parcel"];

export async function seedAllAppraisers() {
  console.log("Seeding property appraisers from real NETR data...");

  let records: AppraiserRecord[];
  try {
    const filePath = join(import.meta.dirname || __dirname, "data", "appraisers.json");
    records = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e: any) {
    console.warn(`appraisers.json not found (${e?.message}); skipping appraiser seed.`);
    return;
  }
  console.log(`Loaded ${records.length} real appraiser records.`);

  // Idempotency + one-time migration off the fabricated data. The previous
  // seeder populated the ENTIRE table with fabricated rows (guessed URLs, hashed
  // phones), so once real data is present we skip; otherwise we wipe the table
  // wholesale and reinsert from NETR. A full replace avoids fragile URL-pattern
  // matching that could clip real portals whose path contains "/assessor".
  const [already] = await db
    .select({ id: propertyAppraisers.id })
    .from(propertyAppraisers)
    .where(like(propertyAppraisers.notes, `${REAL_DATA_MARKER}%`))
    .limit(1);
  if (already) {
    console.log("Real appraiser data already seeded; skipping.");
    return;
  }
  const wiped = await db.delete(propertyAppraisers).returning({ id: propertyAppraisers.id });
  if (wiped.length) console.log(`Cleared ${wiped.length} fabricated appraiser rows for replacement.`);

  // Build county lookup: `${stateCode}|${normName}` -> countyId.
  const allCounties = await db.select().from(counties);
  const countyMap = new Map<string, number>();
  for (const c of allCounties) countyMap.set(`${c.stateCode}|${normCounty(c.name)}`, c.id);

  const covered = new Set<number>();
  const toInsert: (typeof propertyAppraisers.$inferInsert)[] = [];
  let unmatched = 0;
  for (const r of records) {
    const countyId = countyMap.get(`${r.stateCode}|${normCounty(r.county)}`);
    if (!countyId) { unmatched++; continue; }
    if (covered.has(countyId)) continue;
    covered.add(countyId);
    toInsert.push({
      name: r.name,
      countyId,
      portalUrl: r.portalUrl,
      searchUrl: r.portalUrl, // NETR exposes a single portal link per office
      platform: r.platform,
      phone: r.phone,
      address: null, // never fabricated; NETR county pages carry no street address
      searchableFields: SEARCHABLE_FIELDS,
      isActive: true,
      linkStatus: r.portalUrl ? "unchecked" : "none",
      notes: `Sourced from NETR Online. Contact for property records in ${r.county} County.`,
    });
  }

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    await db.insert(propertyAppraisers).values(toInsert.slice(i, i + BATCH));
    inserted += Math.min(BATCH, toInsert.length - i);
  }

  const finalCount = await db.select({ count: sql<number>`count(*)` }).from(propertyAppraisers);
  console.log(`Appraisers: inserted ${inserted} real rows (${unmatched} unmatched counties). Total: ${Number(finalCount[0].count)}.`);
}
