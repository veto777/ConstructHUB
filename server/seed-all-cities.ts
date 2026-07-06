import { db } from "./db";
import { permitDatabases } from "@shared/schema";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CityData {
  city: string;
  county: string;
  stateCode: string;
  state: string;
  countyId: number;
}

export async function seedAllCities() {
  const dataPath = path.join(__dirname, "data", "all-cities.json");
  if (!fs.existsSync(dataPath)) {
    console.log("City data file not found at " + dataPath);
    return;
  }

  const allCities: CityData[] = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Loaded ${allCities.length} cities from data file...`);

  const existingResult = await db.execute(
    sql`SELECT name, jurisdiction_type, county_id FROM permit_databases WHERE jurisdiction_type = 'city'`
  );
  const existingKeys = new Set(
    existingResult.rows.map((r: any) => `${r.name}|${r.county_id}`)
  );

  const newCities = allCities.filter(c => {
    const name = `City of ${c.city}`;
    return !existingKeys.has(`${name}|${c.countyId}`);
  });

  if (newCities.length === 0) {
    console.log("All cities already seeded.");
    return;
  }

  console.log(`Inserting ${newCities.length} new city permit databases...`);

  const batchSize = 200;
  let inserted = 0;

  for (let i = 0; i < newCities.length; i += batchSize) {
    const batch = newCities.slice(i, i + batchSize).map((c, idx) => ({
      name: `City of ${c.city}`,
      jurisdiction: `${c.city}, ${c.stateCode}`,
      jurisdictionType: "city" as const,
      countyId: c.countyId,
      portalUrl: null as string | null,
      searchUrl: null as string | null,
      // No fabrication: platform/phone are only set from verified sources
      // (server/data/permit-portals.json via seed-permit-portals.ts). Unknown = null.
      platform: null as string | null,
      phone: null as string | null,
      email: null as string | null,
      address: null as string | null,
      searchableFields: ["address"] as string[],
      isActive: true,
      notes: `Contact ${c.city} Building Department for permit information. Located in ${c.county} County, ${c.state}.`,
    }));

    await db.insert(permitDatabases).values(batch);
    inserted += batch.length;

    if (inserted % 2000 === 0 || inserted >= newCities.length) {
      console.log(`  Inserted ${inserted} / ${newCities.length} cities`);
    }
  }

  const totalResult = await db.execute(sql`SELECT COUNT(*) as count FROM permit_databases`);
  const cityResult = await db.execute(sql`SELECT COUNT(*) as count FROM permit_databases WHERE jurisdiction_type = 'city'`);
  console.log(`\nDone! Total permit databases: ${totalResult.rows[0].count} (${cityResult.rows[0].count} cities)`);
}
