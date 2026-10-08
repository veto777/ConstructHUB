/**
 * Real-Postgres check of the rank-check frequency (server/seo/jobs.ts scheduleWeeklyRuns): each site's next automatic
 * check is its own gap on, moved in the same transaction that queues its run; a daily site already checked today is
 * moved to tomorrow, not checked twice; a check whose run cannot be queued stays due; a plan without the tools skips
 * the period on purpose; with the data source not set up the checks wait; the database refuses an unknown frequency.
 * Runs are queued, never posted, so nothing is bought. THROWAWAY database.
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { dataforseoDeps } from "../server/seo/dataforseo";
import { scheduleWeeklyRuns, seoJobDeps } from "../server/seo/jobs";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
(async () => {
  await ensureSeoSchema();
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" });   // configured: runs are queued (and never posted here)
  seoJobDeps.entitled = async () => true;
  const site = async (freq: string, lastToday: boolean, name = `freq-${freq}-${lastToday}`) => {
    const { rows: [s] } = await pool.query(`INSERT INTO seo_sites(user_id, domain, rank_frequency, next_rank_check_at, last_rank_check_at) VALUES(1, $1, $2, now() - interval '1 minute', ${lastToday ? "now() - interval '1 minute'" : "now() - interval '8 days'"}) RETURNING id`, [`${name}.example`, freq]);
    await pool.query("INSERT INTO seo_keywords(site_id, user_id, keyword) VALUES($1, 1, 'roof repair')", [s.id]);
    return s.id as number;
  };
  await pool.query("DELETE FROM seo_sites WHERE domain LIKE 'freq-%'");
  const weekly = await site("weekly", false), twice = await site("twice_weekly", false), daily = await site("daily", false), dailyToday = await site("daily", true);
  await scheduleWeeklyRuns();
  const hoursTo = async (id: number) => Number((await pool.query("SELECT extract(epoch FROM next_rank_check_at - now())/3600 AS h FROM seo_sites WHERE id=$1", [id])).rows[0].h);
  const queued = async (id: number) => Number((await pool.query("SELECT count(*)::int n FROM seo_rank_runs WHERE site_id=$1 AND trigger='weekly' AND status='queued'", [id])).rows[0].n);
  ok(Math.round(await hoursTo(weekly)) === 168 && Math.round(await hoursTo(twice)) === 84 && Math.round(await hoursTo(daily)) === 24, `each site's own gap (${Math.round(await hoursTo(weekly))}/${Math.round(await hoursTo(twice))}/${Math.round(await hoursTo(daily))} h)`);
  ok((await queued(weekly)) === 1 && (await queued(twice)) === 1 && (await queued(daily)) === 1, "...and each has its automatic run queued (the date moved on with the run, in one step)");
  const { rows: [t] } = await pool.query("SELECT next_rank_check_at = (current_date + 1)::timestamp AT TIME ZONE 'UTC' AS tomorrow FROM seo_sites WHERE id=$1", [dailyToday]);
  ok(t.tomorrow === true && (await queued(dailyToday)) === 0, "a daily site already checked today waits for tomorrow");
  await scheduleWeeklyRuns();
  ok((await queued(weekly)) === 1, "a second pass queues nothing more (the dates moved on)");
  // A check whose run cannot be queued (the insert is refused) is not consumed: the site stays due and is queued on a later pass.
  const refused = await site("weekly", false, "freq-refused");
  await pool.query("CREATE OR REPLACE FUNCTION freq_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue refused'; END $$");
  await pool.query(`CREATE TRIGGER freq_refuse BEFORE INSERT ON seo_rank_runs FOR EACH ROW WHEN (NEW.site_id = ${Number(refused)}) EXECUTE FUNCTION freq_refuse()`);
  await scheduleWeeklyRuns();
  const { rows: [still] } = await pool.query("SELECT next_rank_check_at <= now() AS due FROM seo_sites WHERE id=$1", [refused]);
  ok(still.due === true && (await queued(refused)) === 0, "a check whose run could not be queued stays due — not skipped to the next period");
  await pool.query("DROP TRIGGER freq_refuse ON seo_rank_runs");
  await scheduleWeeklyRuns();
  ok(Math.round(await hoursTo(refused)) === 168 && (await queued(refused)) === 1, "...and is queued, its date moved on, as soon as it can be");
  // The plan no longer includes the tools: the period is skipped on purpose, no run is queued.
  seoJobDeps.entitled = async () => false;
  const lapsed = await site("daily", false, "freq-lapsed");
  await scheduleWeeklyRuns();
  ok(Math.round(await hoursTo(lapsed)) === 24 && (await queued(lapsed)) === 0, "a plan without the tools skips the period on purpose (no run, the date moved on)");
  seoJobDeps.entitled = async () => true;
  // The data source is not set up: nothing can be checked, so the checks wait as due.
  dataforseoDeps.env = () => ({}) as any;
  const waiting = await site("weekly", false, "freq-waiting");
  await scheduleWeeklyRuns();
  const { rows: [w] } = await pool.query("SELECT next_rank_check_at <= now() AS due FROM seo_sites WHERE id=$1", [waiting]);
  ok(w.due === true && (await queued(waiting)) === 0, "with the data source not set up the check waits as due (nothing is skipped)");
  ok(await pool.query("UPDATE seo_sites SET rank_frequency='hourly' WHERE id=$1", [weekly]).then(() => false, () => true), "the database refuses an unknown frequency");
  await pool.query("DELETE FROM seo_sites WHERE domain LIKE 'freq-%'");
  await pool.query("DROP FUNCTION IF EXISTS freq_refuse()");
  console.log(`frequency checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
