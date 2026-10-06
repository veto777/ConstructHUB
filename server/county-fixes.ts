/**
 * County directory repair (2026-10-05 audit against the Census Bureau's county list, SUB-EST2024).
 *
 * The original seed stored some counties under a city's name ("Pittsburgh, PA" was Allegheny County's row, showing
 * the city's portal as a county's), skipped 97 counties entirely (Dallas, Cuyahoga, Los Angeles, Wayne…), kept retired
 * names (Wade Hampton, Shannon, Valdez-Cordova) and called parishes, boroughs, census areas and independent cities
 * "<name> County". server/data/county-fixes.json lists every correction; this applies it at boot, idempotently, in
 * one transaction, before portals are seeded (seed.ts). A duplicate row is removed only after search results, scrape
 * schedules and CRM projects that point at it are moved to the row that stays.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "./db";

type Fixes = {
  renames: { from: string; to: string; countyName: string; state: string; clearPortal: boolean }[];
  adds: { jurisdiction: string; countyName: string; state: string }[];
  deletes: { jurisdiction: string; countyName: string; state: string; keep: string }[];
  countyRenames: { state: string; from: string; to: string }[];
  countyAdds: { state: string; name: string; jurisdiction: string }[];
  moveCities: { jurisdiction: string; toCounty: string }[];
};

export function loadCountyFixes(): Fixes {
  return JSON.parse(readFileSync(join(import.meta.dirname || __dirname, "data", "county-fixes.json"), "utf8"));
}

export async function applyCountyFixes(fx: Fixes = loadCountyFixes()) {
  const stats = { countiesRenamed: 0, countiesAdded: 0, rowsRenamed: 0, portalsCleared: 0, rowsAdded: 0, rowsDeleted: 0, rowsMerged: 0, citiesMoved: 0 };
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const renamedCounty = new Map(fx.countyRenames.map((r) => [`${r.state}:${r.from}`, r.to]));
    const countyId = async (name: string, st: string): Promise<number | null> => {
      for (const n of [name, renamedCounty.get(`${st}:${name}`)].filter(Boolean)) {
        const { rows } = await c.query("SELECT id FROM counties WHERE state_code=$1 AND name=$2 ORDER BY id LIMIT 1", [st, n]);
        if (rows[0]) return rows[0].id;
      }
      return null;
    };
    const countyRow = async (jurisdiction: string) =>
      (await c.query("SELECT * FROM permit_databases WHERE jurisdiction=$1 AND jurisdiction_type='county' ORDER BY id LIMIT 1", [jurisdiction])).rows[0];
    // Move everything that points at `fromId` to `toId`, then remove `fromId`.
    const merge = async (fromId: number, toId: number) => {
      await c.query("UPDATE search_results SET database_id=$2 WHERE database_id=$1", [fromId, toId]);
      await c.query("UPDATE scrape_schedules SET database_id=$2 WHERE database_id=$1", [fromId, toId]);
      const crm = await c.query("SELECT 1 FROM information_schema.columns WHERE table_name='crm_projects' AND column_name='permit_portal_id'");
      if (crm.rowCount) await c.query("UPDATE crm_projects SET permit_portal_id=$2 WHERE permit_portal_id=$1", [fromId, toId]);
      await c.query("DELETE FROM permit_databases WHERE id=$1", [fromId]);
    };
    const NO_PORTAL = "portal_url=NULL, search_url=NULL, platform=NULL, link_status='none', is_active=false, last_verified_at=NULL";

    // 1. The counties table: retired names, and the census area split off in 2019.
    for (const r of fx.countyRenames) {
      const res = await c.query(`UPDATE counties SET name=$3 WHERE state_code=$1 AND name=$2
        AND NOT EXISTS (SELECT 1 FROM counties WHERE state_code=$1 AND name=$3)`, [r.state, r.from, r.to]);
      stats.countiesRenamed += res.rowCount ?? 0;
    }
    for (const a of fx.countyAdds) {
      const res = await c.query(`INSERT INTO counties (name, state, state_code)
        SELECT $1, (SELECT state FROM counties WHERE state_code=$2 LIMIT 1), $2
        WHERE NOT EXISTS (SELECT 1 FROM counties WHERE state_code=$2 AND name=$1)`, [a.name, a.state]);
      stats.countiesAdded += res.rowCount ?? 0;
      fx.adds.push({ jurisdiction: a.jurisdiction, countyName: a.name, state: a.state });
    }

    // 2. County rows: official names; a city-named row loses the city's portal unless it is one government.
    for (const r of fx.renames) {
      const from = await countyRow(r.from);
      if (!from) continue;
      const to = await countyRow(r.to);
      if (to) {
        if (!to.portal_url && from.portal_url && !r.clearPortal) {
          await c.query("UPDATE permit_databases SET portal_url=$2, search_url=$3, platform=$4, link_status=$5, is_active=$6, last_verified_at=$7 WHERE id=$1",
            [to.id, from.portal_url, from.search_url, from.platform, from.link_status, from.is_active, from.last_verified_at]);
        }
        await merge(from.id, to.id); stats.rowsMerged++;
        continue;
      }
      await c.query(`UPDATE permit_databases SET jurisdiction=$2, name=$2${r.clearPortal ? `, ${NO_PORTAL}` : ""} WHERE id=$1`, [from.id, r.to]);
      stats.rowsRenamed++; if (r.clearPortal && from.portal_url) stats.portalsCleared++;
    }

    // 3. Missing counties.
    for (const a of fx.adds) {
      if (await countyRow(a.jurisdiction)) continue;
      const id = await countyId(a.countyName, a.state);
      if (!id) { console.warn(`[county-fixes] no counties row for ${a.countyName}, ${a.state}`); continue; }
      await c.query(`INSERT INTO permit_databases (name, jurisdiction, jurisdiction_type, county_id, is_active, link_status)
        VALUES ($1, $1, 'county', $2, false, 'none')`, [a.jurisdiction, id]);
      stats.rowsAdded++;
    }

    // 4. Second county rows stored under a city's name: the city keeps its own row; references move to the county.
    for (const d of fx.deletes) {
      const row = await countyRow(d.jurisdiction);
      const keep = await countyRow(d.keep);
      if (!row || !keep) continue;
      const city = await c.query("SELECT 1 FROM permit_databases WHERE jurisdiction=$1 AND jurisdiction_type='city' LIMIT 1", [d.jurisdiction]);
      if (city.rowCount) { await merge(row.id, keep.id); stats.rowsDeleted++; }
      else { await c.query("UPDATE permit_databases SET jurisdiction_type='city' WHERE id=$1", [row.id]); stats.rowsDeleted++; }
    }

    // 5. Towns of the 2019 split into their new census area.
    for (const m of fx.moveCities) {
      const st = m.jurisdiction.slice(-2);
      const id = await countyId(m.toCounty, st);
      if (!id) continue;
      const res = await c.query("UPDATE permit_databases SET county_id=$2 WHERE jurisdiction=$1 AND jurisdiction_type='city' AND county_id<>$2", [m.jurisdiction, id]);
      stats.citiesMoved += res.rowCount ?? 0;
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return stats;
}
