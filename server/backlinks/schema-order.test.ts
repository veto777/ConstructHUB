/**
 * Fresh-database boot: in every server bootstrap file, an ALTER TABLE must come after the CREATE of the
 * table it alters when that CREATE lives in the same file. 2026-10-15: `ALTER TABLE backlink_queries …` sat
 * above `CREATE TABLE IF NOT EXISTS backlink_queries` (server/backlinks/schema.ts) and three
 * `ALTER TABLE crm_client_comments …` sat 170 lines above their CREATE (server/crm/schema-ensure.ts), so a
 * new database (not production, which already had the tables) died at startup with
 * "relation … does not exist". A table with no CREATE in the file is created elsewhere and is not checked.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") yield* walk(p); }
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) yield p;
  }
}

describe("schema bootstrap order (fresh database)", () => {
  it("never alters a table before the same file creates it", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of walk(SERVER)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("CREATE TABLE IF NOT EXISTS")) continue;
      for (const m of src.matchAll(/ALTER TABLE (?:IF EXISTS )?(\w+)/g)) {
        const table = m[1];
        const created = src.search(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
        if (created === -1) continue;
        checked++;
        if (created > m.index!) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${relative(SERVER, file)}:${line} alters ${table} before its CREATE`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
