/**
 * Real-Postgres check of the mentions watch (server/seo/mention-watch.ts): the scheduler buys a due check once, from
 * the included data, saves it with the next date inside the charged call, raises one alert for the likely new pages,
 * respects the customer's marks and the alerts-off setting, and charges nothing when the save cannot happen.
 * THROWAWAY database (users 1, 2).  DATABASE_URL=postgres://.../seotest npx tsx script/seo-mention-watch-check.ts
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { budgetDeps } from "../server/seo/budget";
import { mentionsDeps } from "../server/seo/mentions";
import { mentionWatchDeps, runDueMentionChecks, setMentionWatch, settleMentionAlerts, takeWatchedCheck, mentionWatchView } from "../server/seo/mention-watch";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const ok20 = (items: unknown[], cost: number) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ total_count: items.length, items }] }] });
const item = (d: string, title: string) => ({ url: `https://${d}/p`, main_domain: d, domain_rank: 300, content_info: { main_title: title, snippet: "", date_published: "2026-10-01 10:00:00 +00:00" } });
let calls = 0, found = [item("a.com", "Alpine Exteriors opens in Bellingham"), item("b.com", "Alpine Exteriors Tampa"), item("d.com", "Alpine Exteriors Bellingham")];
const charged = async () => Number((await pool.query("SELECT coalesce(sum(included_cents + wallet_cents),0)::int c FROM seo_credit_usage WHERE user_id=1")).rows[0].c);
(async () => {
  await ensureSeoSchema(); await ensureSeoSchema();
  budgetDeps.allowanceCents = async () => 100000;
  mentionWatchDeps.entitled = async () => true;
  mentionWatchDeps.request = (async () => { calls++; return ok20(found, 0.025); }) as any;
  mentionsDeps.request = (async () => { calls++; return ok20([], 0.025); }) as any;   // the link check: nobody links
  const { rows: [s] } = await pool.query("INSERT INTO seo_sites(user_id, domain, business_name, mention_places) VALUES(1,'mwatch.example','Alpine Exteriors',ARRAY['Bellingham']) RETURNING *");
  await pool.query("INSERT INTO seo_mention_marks(site_id, user_id, name_key, domain, verdict) VALUES($1,1,'alpine exteriors','d.com','not_mine')", [s.id]);
  const site = () => pool.query("SELECT * FROM seo_sites WHERE id=$1", [s.id]).then((r) => r.rows[0]);
  const alerts = () => pool.query("SELECT kind, title, items FROM seo_alerts WHERE site_id=$1", [s.id]).then((r) => r.rows);
  // 1. Off: nothing is bought.
  ok((await runDueMentionChecks()) === 0 && calls === 0, "watch off: nothing bought");
  // 2. On: due at once; one check bought (search + link check = 20c), saved with the next date a month on.
  await setMentionWatch(1, s.id, true);
  let before = await charged();
  ok((await runDueMentionChecks()) === 1 && calls === 2, `due: one check bought (calls ${calls})`);
  ok((await charged()) - before === 20, `charged ${(await charged()) - before}c for the whole check`);
  const next = new Date((await site()).next_mention_at).getTime() - Date.now();
  ok(next > 27 * 864e5, "the next check is a month on");
  // 3. One alert: a.com (names Bellingham, no link). b.com names no place; d.com is marked not us.
  const a1 = await alerts();
  ok(a1.length === 1 && a1[0].kind === "mention_new" && a1[0].items[0].pages.map((p: any) => p.domain).join() === "a.com", `one alert, for a.com only: ${JSON.stringify(a1.map((a) => a.items?.[0]?.pages?.map((p: any) => p.domain)))}`);
  ok((await settleMentionAlerts(s.id)) === 0 && (await alerts()).length === 1, "settling again raises nothing");
  // 4. A second pass buys nothing (not due).
  calls = 0;
  ok((await runDueMentionChecks()) === 0 && calls === 0, "a second pass buys nothing");
  // 5. The view shows the newest watched check with its pages.
  const v = await mentionWatchView(1, await site(), "Alpine Exteriors");
  ok(v.watch && v.latest?.page.rows.length === 3, "the view shows the watched check");
  // 6. The occurrence's date moved while it was buying (a newer pass leased it): nothing saved, nothing charged.
  await pool.query("DELETE FROM seo_mention_checks WHERE site_id=$1", [s.id]);
  await pool.query("UPDATE seo_sites SET next_mention_at = now() - interval '1 minute' WHERE id=$1", [s.id]);
  const lease = (await pool.query("SELECT next_mention_at::text AS l FROM seo_sites WHERE id=$1", [s.id])).rows[0].l;
  mentionWatchDeps.request = (async () => { calls++; await pool.query("UPDATE seo_sites SET next_mention_at = now() + interval '2 hours' WHERE id=$1", [s.id]); return ok20(found, 0.025); }) as any;
  before = await charged();
  const moved: any = await takeWatchedCheck({ id: s.id, user_id: 1, domain: "mwatch.example", name: "Alpine Exteriors", lease }).catch((e) => e);
  ok(moved?.notSaved === true && (await charged()) - before === 0 && (await pool.query("SELECT count(*)::int n FROM seo_mention_checks WHERE site_id=$1", [s.id])).rows[0].n === 0, "date moved meanwhile: not saved, charged nothing");
  // 7. Alerts off: the check is saved and settled, no alert.
  mentionWatchDeps.request = (async () => { calls++; return ok20([item("z.com", "Alpine Exteriors Bellingham")], 0.025); }) as any;
  await pool.query("UPDATE seo_sites SET alerts_enabled=false, next_mention_at = now() - interval '1 minute' WHERE id=$1", [s.id]);
  await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [s.id]);
  ok((await runDueMentionChecks()) === 1 && (await alerts()).length === 0 && (await pool.query("SELECT bool_and(alerts_done) d FROM seo_mention_checks WHERE site_id=$1", [s.id])).rows[0].d === true, "alerts off: saved and settled, no alert");
  // 8. Turned off: nothing due; another account cannot turn it on.
  await setMentionWatch(1, s.id, false);
  ok((await site()).next_mention_at === null, "turned off: nothing due");
  await setMentionWatch(2, s.id, true);
  ok((await site()).mention_watch === false, "another account cannot turn it on");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s.id]);
  console.log(`mention watch checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
