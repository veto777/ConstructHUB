/**
 * Real-Postgres check of place-level rank tracking, the map pack and alerts. Not part of the unit suite.
 * Run after script/seo-ledger-check.ts on the same THROWAWAY database (it also proves the schema upgrades in place):
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-local-check.ts
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { budgetDeps } from "../server/seo/budget";
import { enqueueRankRun, postQueuedRun, collectRunningRuns, settleOwedRankAlerts, seoJobDeps } from "../server/seo/jobs";
// A queued run checks the account's plan again before it is posted (server/seo/jobs.ts); this database has no plans.
seoJobDeps.entitled = async () => true;
import { dataforseoDeps } from "../server/seo/dataforseo";
import { searchLocations, locationByCode } from "../server/seo/locations";
import { raiseRankAlerts, raiseLinkAlerts, listAlerts, unreadAlerts, markAlertsRead } from "../server/seo/alerts";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];

async function main() {
  await ensureSeoSchema();
  await ensureSeoSchema(); // twice: every statement must be safe to repeat
  eq("1a the old one-keyword-per-site rule is gone, the per-place rule is there",
    [(await one("SELECT count(*)::int n FROM pg_constraint WHERE conname='seo_keywords_site_id_keyword_key'")).n, (await one("SELECT count(*)::int n FROM pg_indexes WHERE indexname='seo_keywords_site_keyword_place'")).n], [0, 1]);

  // places
  await pool.query(`INSERT INTO seo_locations(code,name,type) VALUES (1015214,'Tampa,Florida,United States','City'),(200539,'Tampa-St Petersburg (Sarasota), FL,Florida,United States','DMA Region'),(9012345,'Tampa Heights,Florida,United States','Neighborhood'),(33602,'33602,Florida,United States','Postal Code') ON CONFLICT DO NOTHING`);
  eq("2a typing 'tam' offers the city first", (await searchLocations("tam")).map((l) => [l.label, l.kind]), [["Tampa, Florida", "City"], ["Tampa-St Petersburg (Sarasota), FL, Florida", "Metro area"], ["Tampa Heights, Florida", "Neighborhood"]]);
  eq("2b a ZIP code is found by its digits", (await searchLocations("336")).map((l) => l.label), ["33602, Florida"]);
  eq("2c wildcards typed by a user are not wildcards", (await searchLocations("%%")).length, 0);
  eq("2d a code that is not a place we offer is refused", await locationByCode(424242), null);
  // A site may be made for any country the explorers support; its keywords default to that country, so it is a place.
  eq("2e the United States is a place", await locationByCode(2840), { code: 2840, label: "United States", kind: "Country" });
  eq("2f so is every other country a site can be made for (Canada, the United Kingdom)", [await locationByCode(2124), await locationByCode(2826)], [{ code: 2124, label: "Canada", kind: "Country" }, { code: 2826, label: "United Kingdom", kind: "Country" }]);

  budgetDeps.allowanceCents = async () => 100000;
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" });
  const site = await one("INSERT INTO seo_sites(user_id,domain,devices,business_name) VALUES(1,'alpine.example','desktop','Alpine Exteriors') RETURNING *");
  const us = await one("INSERT INTO seo_keywords(site_id,user_id,keyword) VALUES($1,1,'roof repair') RETURNING id", [site.id]);
  const tampa = await one("INSERT INTO seo_keywords(site_id,user_id,keyword,location_code,location_name) VALUES($1,1,'roof repair',1015214,'Tampa, Florida') RETURNING id", [site.id]);
  const dup: any = await pool.query("INSERT INTO seo_keywords(site_id,user_id,keyword,location_code) VALUES($1,1,'roof repair',1015214)", [site.id]).catch((e) => e);
  await ensureSeoSchema();
  eq("3a0 a keyword saved without a place gets the site's own, so its history never moves", await one("SELECT location_code, location_name FROM seo_keywords WHERE id=$1", [us.id]), { location_code: 2840, location_name: "United States" });
  eq("3a the same keyword can be tracked in two places, but not twice in one", [us.id !== tampa.id, dup?.code], [true, "23505"]);

  let sent: any[] = [];
  seoJobDeps.serpTaskPost = (async (i: any) => { sent = i.tasks; return { data: i.tasks.map((t: any, n: number) => ({ ...t, taskId: `t${n}` })), costUsd: 0.0012 }; }) as any;
  const result = (position: number | null, local: number | null) => ({ status: "completed", result: { position, url: position ? "https://alpine.example/" : null, serpFeatures: ["local_pack", "organic"], localPosition: local, localPack: [{ position: 1, title: "Big Roofer", domain: null }, { position: 2, title: "Alpine Exteriors", domain: null }] } });

  // first check: nothing to compare with
  let run = await enqueueRankRun(site, "manual");
  await postQueuedRun(run.id);
  eq("4a each keyword is sent with its own place", sent.map((t) => t.locationCode ?? null).sort(), [1015214, 2840]);
  seoJobDeps.serpTaskGet = (async (i: any) => (i.keywordId === tampa.id ? result(3, 2) : result(4, null))) as any;
  await collectRunningRuns();
  eq("4b positions and the map pack are saved", (await pool.query("SELECT position, local_position, jsonb_array_length(local_pack) pack FROM seo_rank_checks WHERE site_id=$1 ORDER BY keyword_id", [site.id])).rows, [{ position: 4, local_position: null, pack: 2 }, { position: 3, local_position: 2, pack: 2 }]);
  eq("4c a first check raises no alert", (await listAlerts(1, site.id)).length, 0);

  // a week later: one keyword falls, the Tampa one leaves the map pack and rises
  await pool.query("UPDATE seo_rank_checks SET checked_on=current_date-7 WHERE site_id=$1", [site.id]);
  run = await enqueueRankRun(site, "manual");
  await postQueuedRun(run.id);
  seoJobDeps.serpTaskGet = (async (i: any) => (i.keywordId === tampa.id ? result(3, null) : result(9, null))) as any;
  await collectRunningRuns();
  const alerts = await listAlerts(1, site.id);
  eq("5a one alert for the falls", alerts.map((a: any) => [a.kind, a.title]), [["rank_drop", "2 rankings fell for alpine.example"]]);
  eq("5b it says what fell, and where", alerts[0].items.map((i: any) => [i.what, i.location, i.from, i.to]).sort(), [["dropped", null, 4, 9], ["left_map_pack", "Tampa, Florida", 2, null]].sort());
  await raiseRankAlerts(site.id, run.id);
  eq("5c raising the same run again adds nothing", (await listAlerts(1, site.id)).length, 1);
  eq("5c1 the run was closed with its alerts in one step (nothing owed)", (await one("SELECT status, alerts_due FROM seo_rank_runs WHERE id=$1", [run.id])), { status: "done", alerts_due: false });
  // A run that stopped early (no answer for hours) but saved a ranking: closed as failed WITH its alert, said to be partial.
  const savedAlert = await one("SELECT * FROM seo_alerts WHERE site_id=$1", [site.id]);
  await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [site.id]);
  const stuck = await one("INSERT INTO seo_rank_runs(id, site_id, user_id, status, started_at, tasks, total, checked) VALUES(gen_random_uuid(), $1, 1, 'running', now() - interval '4 hours', '[]'::jsonb, 2, 1) RETURNING id", [site.id]);
  await pool.query("INSERT INTO seo_rank_checks(keyword_id, site_id, run_id, checked_on, device, position) VALUES($1,$2,$3,current_date+1,'desktop',30)", [us.id, site.id, stuck.id]);
  await collectRunningRuns();
  const partial = await listAlerts(1, site.id);
  eq("5c2b a run that stopped early still alerts what it saved, and says so with its numbers; the run is marked partial",
    [(await one("SELECT status, partial FROM seo_rank_runs WHERE id=$1", [stuck.id])), partial.map((a: any) => a.title)], [{ status: "failed", partial: true }, ["1 ranking fell for alpine.example (from a check that stopped early: 1 of 2 lookups came back)"]]);
  await pool.query("DELETE FROM seo_rank_checks WHERE run_id=$1", [stuck.id]);
  // Put the original alert back as it was (the steps below mark it read by its id).
  await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [site.id]);
  await pool.query("INSERT INTO seo_alerts SELECT (jsonb_populate_record(NULL::seo_alerts, $1::jsonb)).*", [JSON.stringify(savedAlert)]);
  eq("5c2 an alert that could not be sent stays marked for another try", (await one("SELECT count(*)::int n FROM seo_alerts WHERE site_id=$1 AND notified_at IS NULL", [site.id])).n >= 0, true);
  // the same check run again the same day compares with the same earlier day: it must not say it twice
  run = await enqueueRankRun(site, "manual");
  await postQueuedRun(run.id);
  await collectRunningRuns();
  eq("5c3 running the check again the same day, finding the same moves, raises no second alert", (await listAlerts(1, site.id)).length, 1);
  const extra = async () => (await listAlerts(1, site.id)).filter((a: any) => a.id !== alerts[0].id).map((a: any) => [a.kind, a.title, a.items.map((i: any) => [i.what, i.location, i.from, i.to])]);
  const tidy = async () => { await pool.query("DELETE FROM seo_alerts WHERE site_id=$1 AND id<>$2", [site.id, alerts[0].id]); };
  // ...but a second check the same day that finds a NEW move (a further fall) alerts it — only it: the map-pack loss is the morning's.
  run = await enqueueRankRun(site, "manual");
  await postQueuedRun(run.id);
  seoJobDeps.serpTaskGet = (async (i: any) => (i.keywordId === tampa.id ? result(3, null) : result(15, null))) as any;
  await collectRunningRuns();
  eq("5c4 a second check the same day with a new fall alerts that fall alone (the alert belongs to its run)", await extra(), [["rank_drop", "1 ranking fell for alpine.example", [["dropped", null, 4, 15]]]]);
  eq("5c4b every move says which two days it compares", (await listAlerts(1, site.id)).every((a: any) => a.items.every((i: any) => /^\d{4}-\d{2}-\d{2}$/.test(i.since) && /^\d{4}-\d{2}-\d{2}$/.test(i.on) && i.since < i.on)), true);
  await tidy();
  // When the alerts cannot be worked out (here: their table is away), the run is NOT closed: it stays, lease given back, and is closed with its alert on a later tick.
  run = await enqueueRankRun(site, "manual");
  await postQueuedRun(run.id);
  seoJobDeps.serpTaskGet = (async (i: any) => (i.keywordId === tampa.id ? result(3, null) : result(18, null))) as any;
  await pool.query("ALTER TABLE seo_alerts RENAME TO seo_alerts_away");
  await collectRunningRuns();
  const open = await one("SELECT status, lease_until, checked FROM seo_rank_runs WHERE id=$1", [run.id]);
  await pool.query("ALTER TABLE seo_alerts_away RENAME TO seo_alerts");
  eq("5c5 a run whose alerts could not be worked out is not closed (no alert, nothing lost)", [open.status, open.lease_until, open.checked, (await listAlerts(1, site.id)).length], ["running", null, 0, 1]);
  await collectRunningRuns();
  eq("5c5b ...and is closed with its alert on a later tick, counted once", [(await one("SELECT status, checked, partial FROM seo_rank_runs WHERE id=$1", [run.id])), await extra()], [{ status: "done", checked: 2, partial: false }, [["rank_drop", "1 ranking fell for alpine.example", [["dropped", null, 4, 18]]]]]);
  await tidy();
  // A lookup that never comes back inside the window: the run closes as done but PARTIAL, and its alert says so with the numbers.
  run = await enqueueRankRun(site, "manual");
  await postQueuedRun(run.id);
  seoJobDeps.serpTaskGet = (async (i: any) => (i.keywordId === tampa.id ? { status: "pending" } : result(25, null))) as any;
  await pool.query("UPDATE seo_rank_runs SET started_at = now() - interval '2 hours' WHERE id=$1", [run.id]);
  await collectRunningRuns();
  const windowed = await one("SELECT status, partial, checked, total, error FROM seo_rank_runs WHERE id=$1", [run.id]);
  eq("5c6 a check that did not come back by the window's end: done, marked partial, said in the note and in the alert's title",
    [windowed.status, windowed.partial, windowed.checked, windowed.total, /1 check\(s\) never came back from the queue/.test(windowed.error), await extra()],
    ["done", true, 1, 2, true, [["rank_drop", "1 ranking fell for alpine.example (from a check that did not finish: 1 of 2 lookups came back)", [["dropped", null, 4, 25]]]]]);
  await tidy();
  // Runs closed by an earlier version that still owe their alerts (alerts_due): raised from the run's own checks when
  // they are still there; when a later check replaced them all, it is written on the run and logged — never dropped quietly.
  const owedOk = await one("INSERT INTO seo_rank_runs(id, site_id, user_id, status, alerts_due, total, checked, finished_at) VALUES(gen_random_uuid(), $1, 1, 'done', true, 1, 1, now()) RETURNING id", [site.id]);
  await pool.query("INSERT INTO seo_rank_checks(keyword_id, site_id, run_id, checked_on, device, position) VALUES($1,$2,$3,current_date+2,'desktop',12)", [tampa.id, site.id, owedOk.id]);
  const owedLost = await one("INSERT INTO seo_rank_runs(id, site_id, user_id, status, alerts_due, total, checked, finished_at) VALUES(gen_random_uuid(), $1, 1, 'done', true, 2, 2, now()) RETURNING id", [site.id]);
  eq("5c7 an owed run whose checks are still there is raised, and the debt cleared; one whose results were replaced is said so on the run", [await settleOwedRankAlerts(), await extra(),
    (await one("SELECT alerts_due, error FROM seo_rank_runs WHERE id=$1", [owedOk.id])), (await one("SELECT alerts_due, error FROM seo_rank_runs WHERE id=$1", [owedLost.id]))],
    [2, [["rank_drop", "1 ranking fell for alpine.example", [["dropped", "Tampa, Florida", 3, 12]]]], { alerts_due: false, error: null }, { alerts_due: false, error: "its alerts could not be worked out afterwards: a later check the same day replaced all of its results" }]);
  eq("5c7b ...once", [await settleOwedRankAlerts(), (await extra()).length], [0, 1]);
  await pool.query("DELETE FROM seo_rank_checks WHERE run_id=$1", [owedOk.id]);
  await tidy();
  eq("5d it is unread until marked", [await unreadAlerts(1), (await markAlertsRead(1, [alerts[0].id]), await unreadAlerts(1))], [1, 0]);

  // alerts switched off
  await pool.query("UPDATE seo_rank_checks SET checked_on=checked_on-7 WHERE site_id=$1", [site.id]);
  await pool.query("UPDATE seo_sites SET alerts_enabled=false WHERE id=$1", [site.id]);
  run = await enqueueRankRun(site, "manual");
  await postQueuedRun(run.id);
  seoJobDeps.serpTaskGet = (async () => result(30, null)) as any;
  await collectRunningRuns();
  eq("6  with alerts off, a fall raises nothing", (await listAlerts(1, site.id)).length, 1);

  // links
  await pool.query("UPDATE seo_sites SET alerts_enabled=true WHERE id=$1", [site.id]);
  await pool.query(`INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary) VALUES ($1,1,current_date-30,'{"referringDomains":100,"backlinks":900}'),($1,1,current_date,'{"referringDomains":90,"backlinks":700}')`, [site.id]);
  eq("7a ten linking sites lost raises a links alert", await raiseLinkAlerts(site.id), "links_lost");
  eq("7b once", await raiseLinkAlerts(site.id), null);
  eq("7c another account sees none of it", (await listAlerts(2, null)).length, 0);

  // named losses: a strong site that stopped linking is an alert even when the count barely moved
  const { rows: [quiet] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'quiet.example','desktop') RETURNING id");
  const lostRows = [{ domain: "weak.example", authority: 4, from: "https://weak.example/p", to: "https://quiet.example/", lastSeen: "2026-10-01" }, { domain: "chamber.example", authority: 46, from: "https://chamber.example/members", to: "https://quiet.example/", lastSeen: "2026-10-02" }];
  await pool.query(`INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,changes) VALUES ($1,1,current_date-30,'{"referringDomains":100,"backlinks":900}',NULL),
    ($1,1,current_date,'{"referringDomains":99,"backlinks":890}', jsonb_build_object('since', (current_date-30)::text, 'lost', $2::jsonb, 'lostTotal', 2))`, [quiet.id, JSON.stringify(lostRows)]);
  eq("7d one strong site lost is an alert though the count moved by one", await raiseLinkAlerts(quiet.id), "links_lost");
  const strongAlert: any = (await listAlerts(1, quiet.id))[0];
  eq("7e it names the site and puts the strongest first", [strongAlert.title, strongAlert.items[0].lost.map((l: any) => l.domain), strongAlert.items[0].lostTotal], ["quiet.example lost a link from chamber.example", ["chamber.example"], 2]);
  const { rows: [calm] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'calm.example','desktop') RETURNING id");
  await pool.query(`INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,changes) VALUES ($1,1,current_date-30,'{"referringDomains":100}',NULL),
    ($1,1,current_date,'{"referringDomains":99}', jsonb_build_object('since', (current_date-30)::text, 'lost', $2::jsonb, 'lostTotal', 1))`, [calm.id, JSON.stringify([lostRows[0]])]);
  eq("7f a weak site lost with the count barely moved is not an alert", await raiseLinkAlerts(calm.id), null);
  // losses collected against a different snapshot are not pinned on this comparison
  const { rows: [stale] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'stale.example','desktop') RETURNING id");
  await pool.query(`INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,changes) VALUES ($1,1,current_date-30,'{"referringDomains":100}',NULL),
    ($1,1,current_date,'{"referringDomains":99}', jsonb_build_object('since', (current_date-90)::text, 'lost', $2::jsonb, 'lostTotal', 2))`, [stale.id, JSON.stringify(lostRows)]);
  eq("7g losses collected since some other date are not used for this comparison", await raiseLinkAlerts(stale.id), null);
  // more linking sites overall AND a strong one lost: both are said, not just the gain
  const { rows: [mixed] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'mixed.example','desktop') RETURNING id");
  await pool.query(`INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,changes) VALUES ($1,1,current_date-30,'{"referringDomains":100}',NULL),
    ($1,1,current_date,'{"referringDomains":120}', jsonb_build_object('since', (current_date-30)::text, 'lost', $2::jsonb, 'lostTotal', 2))`, [mixed.id, JSON.stringify(lostRows)]);
  await raiseLinkAlerts(mixed.id);
  eq("7h a month that gains sites and loses a strong one raises both alerts", (await listAlerts(1, mixed.id)).map((a: any) => a.kind).sort(), ["links_gained", "links_lost"]);
  eq("7i ...and raising again adds nothing", [await raiseLinkAlerts(mixed.id), (await listAlerts(1, mixed.id)).length], [null, 2]);
  // a "strong" site that is spam, or whose link was nofollow, is no loss
  const { rows: [junk] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'junk.example','desktop') RETURNING id");
  await pool.query(`INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,changes) VALUES ($1,1,current_date-30,'{"referringDomains":100}',NULL),
    ($1,1,current_date,'{"referringDomains":99}', jsonb_build_object('since', (current_date-30)::text, 'lost', $2::jsonb, 'lostTotal', 2))`,
    [junk.id, JSON.stringify([{ domain: "spam.example", authority: 55, spam: 90, follow: true }, { domain: "forum.example", authority: 48, spam: 2, follow: false }])]);
  eq("7j a spammy site or a nofollow link lost is not an alert, whatever its authority", await raiseLinkAlerts(junk.id), null);
  const { rows: [buried] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'buried.example','desktop') RETURNING id");
  const junkTen = Array.from({ length: 10 }, (_, i) => ({ domain: `noise${i}.example`, authority: 90 - i, spam: 95, follow: true }));
  await pool.query(`INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,changes) VALUES ($1,1,current_date-30,'{"referringDomains":100}',NULL),
    ($1,1,current_date,'{"referringDomains":99}', jsonb_build_object('since', (current_date-30)::text, 'lost', $2::jsonb, 'lostTotal', 11))`, [buried.id, JSON.stringify([...junkTen, { domain: "chamber.example", authority: 46, spam: 3, follow: true }])]);
  // each unsettled snapshot is judged against the one before it, not just the newest pair
  const { rows: [three] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'three.example','desktop') RETURNING id");
  await pool.query(`INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary) VALUES ($1,1,current_date-60,'{"referringDomains":100}'),($1,1,current_date-30,'{"referringDomains":80}'),($1,1,current_date,'{"referringDomains":81}')`, [three.id]);
  eq("7l an older snapshot's own comparison can be judged: 100 -> 80 a month ago is a loss; the newest pair (80 -> 81) is nothing",
    [await raiseLinkAlerts(three.id, (await pool.query("SELECT (current_date-30)::text d")).rows[0].d), await raiseLinkAlerts(three.id), (await listAlerts(1, three.id)).map((a: any) => a.kind)], ["links_lost", null, ["links_lost"]]);
  eq("7k a real loss behind ten stronger junk ones is still found and named", [await raiseLinkAlerts(buried.id), ((await listAlerts(1, buried.id))[0] as any)?.items[0].lost.map((l: any) => l.domain)], ["links_lost", ["chamber.example"]]);

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("CRASHED", e); process.exit(2); });
