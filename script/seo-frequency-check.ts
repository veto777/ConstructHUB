/**
 * Real-Postgres check of the rank-check frequency (server/seo/jobs.ts scheduleWeeklyRuns): each site's next automatic
 * check is its own gap on; a daily site already checked today is moved to tomorrow, not checked twice; the database
 * refuses an unknown frequency. The data source is left unconfigured, so nothing is bought. THROWAWAY database.
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { dataforseoDeps } from "../server/seo/dataforseo";
import { scheduleWeeklyRuns } from "../server/seo/jobs";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
(async () => {
  await ensureSeoSchema();
  dataforseoDeps.env = () => ({}) as any;   // not configured: the schedule moves dates and buys nothing
  const site = async (freq: string, lastToday: boolean) => {
    const { rows: [s] } = await pool.query(`INSERT INTO seo_sites(user_id, domain, rank_frequency, next_rank_check_at, last_rank_check_at) VALUES(1, $1, $2, now() - interval '1 minute', ${lastToday ? "now() - interval '1 minute'" : "now() - interval '8 days'"}) RETURNING id`, [`freq-${freq}-${lastToday}.example`, freq]);
    await pool.query("INSERT INTO seo_keywords(site_id, user_id, keyword) VALUES($1, 1, 'roof repair')", [s.id]);
    return s.id as number;
  };
  await pool.query("DELETE FROM seo_sites WHERE domain LIKE 'freq-%'");
  const weekly = await site("weekly", false), twice = await site("twice_weekly", false), daily = await site("daily", false), dailyToday = await site("daily", true);
  await scheduleWeeklyRuns();
  const hoursTo = async (id: number) => Number((await pool.query("SELECT extract(epoch FROM next_rank_check_at - now())/3600 AS h FROM seo_sites WHERE id=$1", [id])).rows[0].h);
  ok(Math.round(await hoursTo(weekly)) === 168 && Math.round(await hoursTo(twice)) === 84 && Math.round(await hoursTo(daily)) === 24, `each site's own gap (${Math.round(await hoursTo(weekly))}/${Math.round(await hoursTo(twice))}/${Math.round(await hoursTo(daily))} h)`);
  const { rows: [t] } = await pool.query("SELECT next_rank_check_at = (current_date + 1)::timestamp AT TIME ZONE 'UTC' AS tomorrow FROM seo_sites WHERE id=$1", [dailyToday]);
  ok(t.tomorrow === true, "a daily site already checked today waits for tomorrow");
  ok(await pool.query("UPDATE seo_sites SET rank_frequency='hourly' WHERE id=$1", [weekly]).then(() => false, () => true), "the database refuses an unknown frequency");
  await pool.query("DELETE FROM seo_sites WHERE domain LIKE 'freq-%'");
  console.log(`frequency checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
