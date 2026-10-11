import { expect, it } from "vitest";
import fs from "node:fs";
import pg from "pg";

const sql = fs.readFileSync(new URL("../../script/feature-shots/seed/30-ads.sql", import.meta.url), "utf8");
const linkSql = sql.match(/INSERT INTO edge_location_links \(asset_id, user_id, location_id\)[\s\S]*?ON CONFLICT DO NOTHING;/)?.[0];
it("ships sample location linking inside the guarded seed transaction", () => {
  expect(linkSql).toBeTruthy();
  expect(sql.indexOf(linkSql!)).toBeLessThan(sql.lastIndexOf("COMMIT;"));
  expect(sql).toContain("current_database()");
});

it.skipIf(!process.env.DATABASE_URL)("sample linking is idempotent and isolates owner, sample IDs, and normalized host", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE edge_assets(id integer,user_id integer,domain text);
      CREATE TEMP TABLE business_locations(id integer,user_id integer,website text);
      CREATE TEMP TABLE edge_location_links(asset_id integer,user_id integer,location_id integer,PRIMARY KEY(asset_id,location_id));
      INSERT INTO edge_assets VALUES (930111,1,'summitroofing.example'),(930121,1,'summitroofing.example'),(999,1,'summitroofing.example');
      INSERT INTO business_locations VALUES (910001,1,'https://www.summitroofing.example'),(910002,1,'https://summitroofing.example/aurora'),(910003,2,'https://summitroofing.example'),(910004,1,'https://summitroofing.example');`);
    await client.query(linkSql!); await client.query(linkSql!);
    const { rows } = await client.query("SELECT * FROM edge_location_links ORDER BY asset_id,location_id");
    expect(rows).toEqual([930111,930121].flatMap(asset_id => [910001,910002].map(location_id => ({ asset_id, user_id: 1, location_id }))));
    await client.query("UPDATE business_locations SET website='https://other.example' WHERE id=910002; DELETE FROM edge_location_links;");
    await client.query(linkSql!);
    expect((await client.query("SELECT * FROM edge_location_links")).rows).toHaveLength(2);
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});
