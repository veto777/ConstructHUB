import { preserveNewerGovernmentCheck } from "./government-seed-status";
import { db } from "./db";
import { counties, propertyAppraisers } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

const REAL_DATA_MARKER = "Sourced from NETR Online.";

// Real assessor / property-appraiser office data scraped from NETR Online
// (see scripts/scrape-netronline.ts). No fabrication: an office with no online
// portal on record is stored with portalUrl: null.
export interface AppraiserRecord {
  stateCode: string;
  county: string;
  name: string;
  phone: string | null;
  portalUrl: string | null;
  platform: string | null;
  source: string;
  linkStatus?: string;
  lastVerifiedAt?: string | null;
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

  await syncAppraiserRecords(records);
}

// Update only source-owned fields. Keep IDs, notes, custom offices and related records.
export async function syncAppraiserRecords(records: AppraiserRecord[]) {
 await db.transaction(async tx => {
  await tx.execute(sql`select pg_advisory_xact_lock(8159001)`);
  const existing = await tx.select().from(propertyAppraisers);
  // Build county lookup: `${stateCode}|${normName}` -> countyId.
  const allCounties = await tx.select().from(counties);
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
    const values = {
      name: r.name,
      countyId,
      portalUrl: r.portalUrl,
      searchUrl: r.portalUrl, // NETR exposes a single portal link per office
      platform: r.platform,
      phone: r.phone,
      address: null, // never fabricated; NETR county pages carry no street address
      searchableFields: SEARCHABLE_FIELDS,
      isActive: !!r.portalUrl && ["live", "verified", "unconfirmed"].includes(r.linkStatus || ""),
      linkStatus: r.portalUrl ? (r.linkStatus || "unchecked") : (r.linkStatus === "dead" ? "dead" : "none"),
      lastVerifiedAt: r.lastVerifiedAt ? new Date(r.lastVerifiedAt) : null,
      notes: `Sourced from NETR Online. Contact for property records in ${r.county} County.`,
    };
    const matches = existing.filter(e => e.countyId === countyId && e.notes?.startsWith(REAL_DATA_MARKER));
    if (matches.length) {
      const { notes, address, searchableFields, ...sourceFields } = values;
      for (const row of matches) await tx.update(propertyAppraisers).set({ ...sourceFields, ...preserveNewerGovernmentCheck(row, sourceFields) }).where(eq(propertyAppraisers.id, row.id));
    } else if (!existing.some(e => e.countyId === countyId)) {
      toInsert.push(values);
    }
  }

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    await tx.insert(propertyAppraisers).values(toInsert.slice(i, i + BATCH));
    inserted += Math.min(BATCH, toInsert.length - i);
  }

  const finalCount = await tx.select({ count: sql<number>`count(*)` }).from(propertyAppraisers);
  console.log(`Appraisers: inserted ${inserted} real rows (${unmatched} unmatched counties). Total: ${Number(finalCount[0].count)}.`);
 });
}
