/** Real-Postgres check of Search Console by page / by search (server/seo/gsc-breakdown.ts): windows anchored at the newest synced day, counts merged, the account's own property only. THROWAWAY database. */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { gscBreakdown } from "../server/seo/gsc-breakdown";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
(async () => {
  await ensureSeoSchema();
  // The three Search Console tables this reads, as server/cloudflare/schema.ts creates them (the rest of that schema
  // needs tables a throwaway database does not have).
  await pool.query(`CREATE TABLE IF NOT EXISTS edge_connections (id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider text NOT NULL, subject text NOT NULL, UNIQUE(id,user_id));
    CREATE TABLE IF NOT EXISTS edge_assets (id serial PRIMARY KEY, user_id integer NOT NULL, connection_id integer NOT NULL, provider text NOT NULL, external_id text NOT NULL, name text NOT NULL, domain text NOT NULL,
      account_id text, status text NOT NULL, synced_at timestamptz, data jsonb, error text, FOREIGN KEY(connection_id,user_id) REFERENCES edge_connections(id,user_id) ON DELETE CASCADE, UNIQUE(connection_id,external_id), UNIQUE(id,user_id));
    CREATE TABLE IF NOT EXISTS gsc_analytics (asset_id integer NOT NULL REFERENCES edge_assets(id) ON DELETE CASCADE, dimension text NOT NULL, date date NOT NULL, key text NOT NULL, clicks double precision NOT NULL, impressions double precision NOT NULL, position double precision NOT NULL, PRIMARY KEY(asset_id,dimension,date,key));`);
  await pool.query("DELETE FROM seo_sites WHERE domain='gscb.example'");
  const { rows: [site] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'gscb.example') RETURNING id, domain");
  await pool.query("INSERT INTO seo_keywords(site_id, user_id, keyword) VALUES($1,1,'roof repair')", [site.id]);
  const { rows: [conn] } = await pool.query("INSERT INTO edge_connections(user_id, provider, subject) VALUES(1,'gsc','s') RETURNING id");
  const { rows: [asset] } = await pool.query("INSERT INTO edge_assets(user_id, connection_id, provider, external_id, name, domain, status) VALUES(1,$1,'gsc','sc-domain:gscb.example','x','gscb.example','ok') RETURNING id", [conn.id]);
  // 56 days of data ending 3 days ago: /a every day (2 clicks now, 1 before); /old only in the earlier window; one search.
  const ins = (dim: string, ago: number, key: string, clicks: number) => pool.query("INSERT INTO gsc_analytics(asset_id,dimension,date,key,clicks,impressions,position) VALUES($1,$2,current_date - $3::int,$4,$5::float8,$5::float8*10,5)", [asset.id, dim, ago, key, clicks]);
  for (let d = 3; d < 59; d++) {
    await ins("date", d, "", 3);
    await ins("page", d, "https://gscb.example/a", d < 31 ? 2 : 1);
    if (d >= 31) await ins("page", d, "https://gscb.example/old", 1);
    await ins("query", d, "Roof Repair", 1);
  }
  const p = (await gscBreakdown(1, site, "page"))!;
  ok(p.days === 28 && p.previousDays === 28 && p.comparable, `two full windows (${p.days}/${p.previousDays})`);
  const a = p.rows.find((r) => r.key.endsWith("/a"))!, old = p.rows.find((r) => r.key.endsWith("/old"))!;
  ok(a.clicks === 56 && a.prevClicks === 28 && old.clicks === 0 && old.prevClicks === 28, `merged: /a 28 -> 56, /old 28 -> 0 (${JSON.stringify([a.clicks, a.prevClicks, old.clicks, old.prevClicks])})`);
  const q = (await gscBreakdown(1, site, "query"))!;
  ok(q.rows[0].tracked === true, "a search that is a tracked keyword (any letter case) is marked");
  ok((await gscBreakdown(2, site, "page")) === null, "another account has no property for it");
  await pool.query("DELETE FROM edge_connections WHERE id=$1", [conn.id]); await pool.query("DELETE FROM seo_sites WHERE id=$1", [site.id]);
  console.log(`gsc breakdown checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
