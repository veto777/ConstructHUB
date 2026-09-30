import { db } from "./db";
import { counties, permitDatabases, searchResults, scrapeSchedules } from "@shared/schema";
import { and, inArray, isNull, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildCountyIndex, resolveCountyId, seededCityNote, seededCountyNote } from "./city-county-resolver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CityData {
  city: string;
  county: string;
  stateCode: string;
  state: string;
  /** Id from the old Replit counties table — NOT valid here. Only used to recognise rows seeded with it. */
  countyId: number;
}

// Same lock as seedPermitPortals: both rewrite permit_databases rows at boot.
const PERMIT_ROWS_LOCK = 8159002;
const CHUNK = 1000;

function loadCities(): CityData[] | null {
  const dataPath = path.join(__dirname, "data", "all-cities.json");
  if (!fs.existsSync(dataPath)) {
    console.log("City data file not found at " + dataPath);
    return null;
  }
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function seedAllCities() {
  const allCities = loadCities();
  if (!allCities) return;
  console.log(`Loaded ${allCities.length} cities from data file...`);

  // Rows seeded by an earlier version carry the old Replit county ids; fix them first
  // so the duplicate check below compares like with like.
  await repairSeededPermitRows();

  // County comes from the JSON's county name + state, resolved against THIS database.
  const index = buildCountyIndex(await db.select({ id: counties.id, name: counties.name, stateCode: counties.stateCode }).from(counties));

  const existingResult = await db.execute(
    sql`SELECT jurisdiction, county_id FROM permit_databases WHERE jurisdiction_type = 'city'`
  );
  const existingKeys = new Set(existingResult.rows.map((r: any) => `${r.jurisdiction}|${r.county_id}`));

  const unmatched: string[] = [];
  const newCities: { city: CityData; countyId: number }[] = [];
  for (const c of allCities) {
    const countyId = resolveCountyId(index, c.county, c.stateCode);
    if (countyId === null) { unmatched.push(`${c.city}, ${c.stateCode} (${c.county} County)`); continue; }
    const key = `${c.city}, ${c.stateCode}|${countyId}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    newCities.push({ city: c, countyId });
  }
  if (unmatched.length) {
    // Never guess a parent county: an unmatched city is skipped, not filed somewhere else.
    console.warn(`  ${unmatched.length} cities skipped — county not found in this database: ${unmatched.slice(0, 10).join("; ")}${unmatched.length > 10 ? "; …" : ""}`);
  }

  if (newCities.length === 0) {
    console.log("All cities already seeded.");
    return;
  }

  console.log(`Inserting ${newCities.length} new city permit databases...`);

  let inserted = 0;
  for (const batch of chunks(newCities, 200)) {
    await db.insert(permitDatabases).values(batch.map(({ city: c, countyId }) => ({
      // A census place is listed by its own name only — no invented "City of …" office,
      // department note or searchable fields. Portal data comes solely from
      // server/data/permit-portals.json (seed-permit-portals.ts). Unknown = null.
      name: `${c.city}, ${c.stateCode}`,
      jurisdiction: `${c.city}, ${c.stateCode}`,
      jurisdictionType: "city" as const,
      countyId,
      portalUrl: null as string | null,
      searchUrl: null as string | null,
      platform: null as string | null,
      phone: null as string | null,
      email: null as string | null,
      address: null as string | null,
      searchableFields: null as string[] | null,
      isActive: false,
      linkStatus: "none",
      notes: null as string | null,
    })));
    inserted += batch.length;

    if (inserted % 2000 === 0 || inserted >= newCities.length) {
      console.log(`  Inserted ${inserted} / ${newCities.length} cities`);
    }
  }

  const totalResult = await db.execute(sql`SELECT COUNT(*) as count FROM permit_databases`);
  const cityResult = await db.execute(sql`SELECT COUNT(*) as count FROM permit_databases WHERE jurisdiction_type = 'city'`);
  console.log(`\nDone! Total permit databases: ${totalResult.rows[0].count} (${cityResult.rows[0].count} cities)`);
}

export interface PermitRowRepairReport {
  /** City rows moved from an old-Replit county id to the county named in all-cities.json. */
  repointed: number;
  /** Seeded city rows whose county could not be matched (left untouched, logged). */
  unmatched: number;
  /** Seeded city rows that duplicated another row for the same jurisdiction + county, removed. */
  duplicatesRemoved: number;
  /** Duplicates kept because saved search results or schedules point at them. */
  duplicatesKept: number;
  /** Seeded rows whose templated note / office name / searchable field / Active flag was cleared. */
  placeholdersCleaned: number;
}

/**
 * Idempotent repair of rows written by earlier versions of this seeder and
 * seed-all-counties.ts:
 *  1. City rows seeded with all-cities.json's old Replit `countyId` are moved to the
 *     county the same JSON row names (Glendale, CA → Los Angeles, not Fairfield, CT).
 *  2. A seeded row that then duplicates another row for the same jurisdiction and county
 *     is removed, unless saved results or schedules reference it.
 *  3. Templated placeholders are made honest: the invented "Contact … Building
 *     Department" note is cleared; a row with no portal gets its jurisdiction as its
 *     name, no searchable fields, isActive=false and link status "none".
 * Only rows that still match the seeders' exact templates are touched; hand-entered
 * and portal data is left alone. `dryRun` reports without writing.
 */
export async function repairSeededPermitRows(opts: { dryRun?: boolean } = {}): Promise<PermitRowRepairReport> {
  const report: PermitRowRepairReport = { repointed: 0, unmatched: 0, duplicatesRemoved: 0, duplicatesKept: 0, placeholdersCleaned: 0 };
  const allCities = loadCities();
  if (!allCities) return report;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PERMIT_ROWS_LOCK})`);

    const countyRows = await tx.select({ id: counties.id, name: counties.name, stateCode: counties.stateCode }).from(counties);
    const countyById = new Map(countyRows.map((c) => [c.id, c]));
    const index = buildCountyIndex(countyRows);

    // A seeded row is recognised by its jurisdiction plus either the county it resolves
    // to (already placed) or the old Replit county id it was written with (needs moving).
    // A place can span counties, so one jurisdiction may have several entries.
    const byJurisdiction = new Map<string, { city: CityData; resolved: number | null }[]>();
    for (const c of allCities) {
      const key = `${c.city}, ${c.stateCode}`;
      const entry = { city: c, resolved: resolveCountyId(index, c.county, c.stateCode) };
      const list = byJurisdiction.get(key);
      if (list) list.push(entry); else byJurisdiction.set(key, [entry]);
    }

    const rows = await tx.select({
      id: permitDatabases.id,
      name: permitDatabases.name,
      jurisdiction: permitDatabases.jurisdiction,
      jurisdictionType: permitDatabases.jurisdictionType,
      countyId: permitDatabases.countyId,
      portalUrl: permitDatabases.portalUrl,
      searchUrl: permitDatabases.searchUrl,
      notes: permitDatabases.notes,
      searchableFields: permitDatabases.searchableFields,
      isActive: permitDatabases.isActive,
      linkStatus: permitDatabases.linkStatus,
    }).from(permitDatabases);

    const repoint: { id: number; countyId: number }[] = [];
    const clearNote: number[] = [];
    const placeholder: number[] = [];
    const seededIds = new Set<number>();
    const target = new Map<number, number>();

    for (const row of rows) {
      target.set(row.id, row.countyId);
      // A portal-less seeded row still showing any placeholder trait (invented name,
      // "address" chip, Active, unchecked instead of none). Clean rows are skipped.
      const noPortal = !row.portalUrl && !row.searchUrl && (
        row.name !== row.jurisdiction || row.isActive || row.linkStatus === null || row.linkStatus === "unchecked" ||
        (row.searchableFields?.length === 1 && row.searchableFields[0] === "address"));
      if (row.jurisdictionType === "city") {
        const entries = byJurisdiction.get(row.jurisdiction);
        if (!entries) continue;
        const placed = entries.some((e) => e.resolved === row.countyId);
        const fromOldId = entries.find((e) => e.city.countyId === row.countyId);
        if (!placed && !fromOldId) continue;
        const cityName = entries[0].city.city;
        const templated = row.notes !== null && entries.some((e) => seededCityNote(e.city) === row.notes);
        const seeded = (row.name === `City of ${cityName}` || row.name === row.jurisdiction) && (templated || row.notes === null);
        if (!seeded) continue;
        seededIds.add(row.id);
        if (!placed) {
          const resolved = fromOldId!.resolved;
          if (resolved === null) report.unmatched++;
          else { repoint.push({ id: row.id, countyId: resolved }); target.set(row.id, resolved); }
        }
        if (templated) clearNote.push(row.id);
        if (noPortal) placeholder.push(row.id);
      } else if (row.jurisdictionType === "county") {
        const county = countyById.get(row.countyId);
        if (!county || row.jurisdiction !== `${county.name} County, ${county.stateCode}`) continue;
        const note = seededCountyNote(county.name);
        const seeded = (row.name === `${county.name} County Building Department` || row.name === row.jurisdiction) && (row.notes === note || row.notes === null);
        if (!seeded) continue;
        if (row.notes === note) clearNote.push(row.id);
        if (noPortal) placeholder.push(row.id);
      }
    }

    // Duplicates once every city row sits in its real county: keep hand-entered rows,
    // otherwise the oldest; drop the other seeded copies.
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      if (row.jurisdictionType !== "city") continue;
      const key = `${row.jurisdiction}|${target.get(row.id)}`;
      const list = groups.get(key);
      if (list) list.push(row.id); else groups.set(key, [row.id]);
    }
    const dropCandidates: number[] = [];
    for (const ids of Array.from(groups.values())) {
      if (ids.length < 2) continue;
      ids.sort((a, b) => a - b);
      const keep = ids.find((id) => !seededIds.has(id)) ?? ids[0];
      for (const id of ids) if (id !== keep && seededIds.has(id)) dropCandidates.push(id);
    }
    const referenced = new Set<number>();
    for (const part of chunks(dropCandidates)) {
      const r1 = await tx.selectDistinct({ id: searchResults.databaseId }).from(searchResults).where(inArray(searchResults.databaseId, part));
      const r2 = await tx.selectDistinct({ id: scrapeSchedules.databaseId }).from(scrapeSchedules).where(inArray(scrapeSchedules.databaseId, part));
      for (const r of [...r1, ...r2]) referenced.add(r.id);
    }
    const drop = dropCandidates.filter((id) => !referenced.has(id));
    const dropSet = new Set(drop);
    report.duplicatesRemoved = drop.length;
    report.duplicatesKept = dropCandidates.length - drop.length;
    report.repointed = repoint.filter((r) => !dropSet.has(r.id)).length;
    report.placeholdersCleaned = new Set([...clearNote, ...placeholder].filter((id) => !dropSet.has(id))).size;

    if (opts.dryRun) return;

    for (const part of chunks(drop)) {
      await tx.delete(permitDatabases).where(inArray(permitDatabases.id, part));
    }
    for (const part of chunks(repoint.filter((r) => !dropSet.has(r.id)))) {
      const values = sql.join(part.map((r) => sql`(${r.id}::int, ${r.countyId}::int)`), sql`, `);
      await tx.execute(sql`UPDATE permit_databases AS p SET county_id = v.county_id FROM (VALUES ${values}) AS v(id, county_id) WHERE p.id = v.id`);
    }
    for (const part of chunks(clearNote.filter((id) => !dropSet.has(id)))) {
      await tx.update(permitDatabases).set({ notes: null }).where(inArray(permitDatabases.id, part));
    }
    for (const part of chunks(placeholder.filter((id) => !dropSet.has(id)))) {
      await tx.update(permitDatabases).set({
        name: sql`${permitDatabases.jurisdiction}`,
        searchableFields: sql`CASE WHEN ${permitDatabases.searchableFields} = ARRAY['address']::text[] THEN NULL ELSE ${permitDatabases.searchableFields} END`,
        isActive: false,
        linkStatus: sql`CASE WHEN ${permitDatabases.linkStatus} IS NULL OR ${permitDatabases.linkStatus} = 'unchecked' THEN 'none' ELSE ${permitDatabases.linkStatus} END`,
      }).where(and(inArray(permitDatabases.id, part), isNull(permitDatabases.portalUrl), isNull(permitDatabases.searchUrl)));
    }
  });

  const changed = report.repointed + report.duplicatesRemoved + report.placeholdersCleaned;
  if (changed || report.unmatched || report.duplicatesKept || opts.dryRun) {
    console.log(`${opts.dryRun ? "[dry run] " : ""}Permit rows: ${report.repointed} cities moved to their real county, ${report.duplicatesRemoved} seeded duplicates removed` +
      `${report.duplicatesKept ? ` (${report.duplicatesKept} kept — referenced by results/schedules)` : ""}, ${report.placeholdersCleaned} placeholders cleaned` +
      `${report.unmatched ? `, ${report.unmatched} seeded cities with no matching county left as-is` : ""}.`);
  }
  return report;
}
