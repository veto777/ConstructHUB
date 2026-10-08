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
import { mentionWatchDeps, runDueMentionChecks, setMentionWatch, settleMentionAlerts, takeWatchedCheck, mentionWatchView, retryWatchedLinks, newMentionsRequest } from "../server/seo/mention-watch";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const ok20 = (items: unknown[], cost: number) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ total_count: items.length, items }] }] });
const item = (d: string, title: string, path = "/p", date = "2026-10-01 10:00:00 +00:00") => ({ url: `https://${d}${path}`, main_domain: d, domain_rank: 300, content_info: { main_title: title, snippet: "", date_published: date } });
let calls = 0, found = [item("a.com", "Alpine Exteriors opens in Bellingham"), item("b.com", "Alpine Exteriors Tampa"), item("d.com", "Alpine Exteriors Bellingham")];
const charged = async () => Number((await pool.query("SELECT coalesce(sum(included_cents + wallet_cents),0)::int c FROM seo_credit_usage WHERE user_id=1")).rows[0].c);
(async () => {
  await ensureSeoSchema(); await ensureSeoSchema();
  budgetDeps.allowanceCents = async () => 100000;
  mentionWatchDeps.entitled = async () => true;
  mentionWatchDeps.request = (async () => { calls++; return ok20(found, 0.025); }) as any;
  mentionsDeps.request = (async () => { calls++; return ok20([], 0.025); }) as any;   // the link check: nobody links
  const { rows: [s] } = await pool.query("INSERT INTO seo_sites(user_id, domain, business_name, mention_places) VALUES(1,'mwatch.example','Alpine Exteriors',ARRAY['Bellingham']) RETURNING *");
  await pool.query("INSERT INTO seo_mention_verdicts(site_id, user_id, name_key, page_key, page_url, verdict) VALUES($1,1,'alpine exteriors','d.com/p','https://d.com/p','not_mine')", [s.id]);
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
  // 9. A day that already has its check: due again (switched off and on) buys nothing and its next date is put right.
  calls = 0; await setMentionWatch(1, s.id, false); await setMentionWatch(1, s.id, true);
  ok((await runDueMentionChecks()) === 0 && calls === 0 && new Date((await site()).next_mention_at).getTime() - Date.now() > 27 * 864e5, "today already checked: nothing bought, next date a month on");
  // 10. The name changed while the check was being bought: not saved, charged nothing.
  await pool.query("DELETE FROM seo_mention_checks WHERE site_id=$1", [s.id]);
  await pool.query("UPDATE seo_sites SET next_mention_at = now() - interval '1 minute', alerts_enabled = true WHERE id=$1", [s.id]);
  const lease2 = (await pool.query("SELECT next_mention_at::text AS l FROM seo_sites WHERE id=$1", [s.id])).rows[0].l;
  mentionWatchDeps.request = (async () => { calls++; await pool.query("UPDATE seo_sites SET mention_name='Alpine Siding Pros' WHERE id=$1", [s.id]); return ok20(found, 0.025); }) as any;
  before = await charged();
  const renamed: any = await takeWatchedCheck({ id: s.id, user_id: 1, domain: "mwatch.example", name: "Alpine Exteriors", lease: lease2 }).catch((e) => e);
  ok(renamed?.notSaved === true && (await charged()) - before === 0, "name changed meanwhile: not saved, charged nothing");
  await pool.query("UPDATE seo_sites SET mention_name=NULL WHERE id=$1", [s.id]);
  // 11. Windows: every page (not one per website), oldest first; the next window starts a week before the last ended
  // and leaves out pages already seen; a window with more pages than one check reads resumes from the last page read.
  const req = newMentionsRequest("Alpine Exteriors", "mwatch.example", new Date("2026-09-01T00:00:00Z"), new Date("2026-10-08T00:00:00Z"));
  ok(req.search_mode === "as_is" && JSON.stringify(req.order_by) === '["content_info.date_published,asc"]', "pages oldest first, every page");
  let asked: any = null;
  mentionWatchDeps.request = (async (_m: string, _p: string, body: any[]) => { calls++; asked = body[0]; return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.025, result: [{ total_count: 120, items: [item("a.com", "Alpine Exteriors Bellingham", "/one", "2026-09-20 10:00:00 +00:00"), item("a.com", "Alpine Exteriors Bellingham", "/two", "2026-09-25 10:00:00 +00:00")] }] }] }; }) as any;
  const lease3 = (await pool.query("UPDATE seo_sites SET next_mention_at = now() - interval '1 minute' WHERE id=$1 RETURNING next_mention_at::text AS l", [s.id])).rows[0].l;
  await takeWatchedCheck({ id: s.id, user_id: 1, domain: "mwatch.example", name: "Alpine Exteriors", lease: lease3 });
  const w1 = (await pool.query("SELECT complete, page->>'resumeFrom' AS resume, jsonb_array_length(page->'rows') AS n FROM seo_mention_checks WHERE site_id=$1 ORDER BY id DESC LIMIT 1", [s.id])).rows[0];
  ok(w1.n === 2 && w1.complete === false && String(w1.resume).startsWith("2026-09-25"), `two pages of one website kept; more than one check reads: resumes from the last page read (${JSON.stringify(w1)})`);
  // The next window (another day) starts from that page, and the pages already seen are not counted again.
  await pool.query("UPDATE seo_mention_checks SET run_on = run_on - 1, created_at = created_at - interval '1 day' WHERE site_id=$1", [s.id]);
  const lease4 = (await pool.query("UPDATE seo_sites SET next_mention_at = now() - interval '1 minute' WHERE id=$1 RETURNING next_mention_at::text AS l", [s.id])).rows[0].l;
  mentionWatchDeps.request = (async (_m: string, _p: string, body: any[]) => { calls++; asked = body[0]; return ok20([item("a.com", "Alpine Exteriors Bellingham", "/two", "2026-09-25 10:00:00 +00:00"), item("b.com", "Alpine Exteriors Bellingham", "/x", "2026-09-28 10:00:00 +00:00")], 0.025); }) as any;
  mentionsDeps.request = (async () => { throw Object.assign(new Error("down"), { code: "upstream", costUsd: 0 }); }) as any;   // this time the link check fails
  await takeWatchedCheck({ id: s.id, user_id: 1, domain: "mwatch.example", name: "Alpine Exteriors", lease: lease4 });
  const w2 = (await pool.query("SELECT id, complete, page FROM seo_mention_checks WHERE site_id=$1 ORDER BY id DESC LIMIT 1", [s.id])).rows[0];
  ok(String(asked.filters[2][2]).startsWith("2026-09-25") && w2.page.rows.map((r: any) => r.url).join() === "https://b.com/x" && w2.page.skippedSeen === 1, `resumed from the last page read; the page already seen left out (${asked.filters[2][2]})`);
  // The alert says the link is not known (the link check failed), never "does not link".
  const a3 = (await alerts()).filter((x: any) => x.items?.[0]?.checkId === w2.id);
  ok(a3.length === 1 && /not known/.test(a3[0].title) && !/does not link/.test(a3[0].title), `alert wording with an unknown link: ${a3[0]?.title}`);
  // The link check tried again: saved into the check, charged 10c.
  mentionsDeps.request = (async () => ok20([], 0.025)) as any;
  before = await charged();
  const fixed = await retryWatchedLinks(1, s.id, w2.id, 0.025);
  ok(fixed?.linksChecked === true && (await charged()) - before === 10 && (await pool.query("SELECT page->>'linksChecked' AS l FROM seo_mention_checks WHERE id=$1", [w2.id])).rows[0].l === "true", "the link check tried again is saved into the check and charged");
  ok((await retryWatchedLinks(2, s.id, w2.id, 0.025)) === null, "another account cannot touch the check");
  // 12. Fifty pages that share one publication time: the next check moves a second past that moment and says so.
  await pool.query("DELETE FROM seo_mention_checks WHERE site_id=$1", [s.id]);
  mentionWatchDeps.request = (async () => { calls++; return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.025, result: [{ total_count: 80, items: Array.from({ length: 50 }, (_, i) => item(`t${i}.com`, "Alpine Exteriors news", "/p", "2026-09-30 08:00:00 +00:00")) }] }] }; }) as any;
  mentionsDeps.request = (async () => ok20([], 0.025)) as any;
  const lease5 = (await pool.query("UPDATE seo_sites SET next_mention_at = now() - interval '1 minute' WHERE id=$1 RETURNING next_mention_at::text AS l", [s.id])).rows[0].l;
  await takeWatchedCheck({ id: s.id, user_id: 1, domain: "mwatch.example", name: "Alpine Exteriors", lease: lease5 });
  const t1 = (await pool.query("SELECT page->>'resumeFrom' AS r, page->>'resumeOffset' AS o, cardinality(seen_keys) AS n FROM seo_mention_checks WHERE site_id=$1 ORDER BY id DESC LIMIT 1", [s.id])).rows[0];
  ok(String(t1.r).startsWith("2026-09-30T08:00:00") && t1.o === "50" && Number(t1.n) === 50, `ties: the next check reads on INTO that moment, 50 in (${JSON.stringify(t1)})`);
  // The next check (another day) asks for that moment from the 51st page on, and counts on from there.
  await pool.query("UPDATE seo_mention_checks SET run_on = run_on - 1, created_at = created_at - interval '1 day' WHERE site_id=$1", [s.id]);
  let tieAsk: any = null;
  mentionWatchDeps.request = (async (_m: string, _p: string, body: any[]) => { calls++; tieAsk = body[0]; return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.025, result: [{ total_count: 30, items: Array.from({ length: 30 }, (_, i) => item(`u${i}.com`, "Alpine Exteriors news", "/p", "2026-09-30 08:00:00 +00:00")) }] }] }; }) as any;
  const lease5b = (await pool.query("UPDATE seo_sites SET next_mention_at = now() - interval '1 minute' WHERE id=$1 RETURNING next_mention_at::text AS l", [s.id])).rows[0].l;
  await takeWatchedCheck({ id: s.id, user_id: 1, domain: "mwatch.example", name: "Alpine Exteriors", lease: lease5b });
  const t2 = (await pool.query("SELECT complete, jsonb_array_length(page->'rows') AS n FROM seo_mention_checks WHERE site_id=$1 ORDER BY id DESC LIMIT 1", [s.id])).rows[0];
  ok(tieAsk.offset === 50 && tieAsk.filters[2][1] === ">=" && t2.complete === true && t2.n === 30, `the rest of that moment is read: offset ${tieAsk.offset}, ${t2.n} pages, complete ${t2.complete}`);
  // 13. A business name written with two spaces is the same name: its check is saved (not refused forever).
  await pool.query("DELETE FROM seo_mention_checks WHERE site_id=$1", [s.id]);
  await pool.query("UPDATE seo_sites SET business_name='Alpine  Exteriors', mention_name=NULL WHERE id=$1", [s.id]);
  mentionWatchDeps.request = (async () => { calls++; return ok20([], 0.025); }) as any;
  const lease6 = (await pool.query("UPDATE seo_sites SET next_mention_at = now() - interval '1 minute' WHERE id=$1 RETURNING next_mention_at::text AS l", [s.id])).rows[0].l;
  const spaced = await takeWatchedCheck({ id: s.id, user_id: 1, domain: "mwatch.example", name: "Alpine  Exteriors", lease: lease6 }).catch((e) => e);
  ok(spaced && !(spaced instanceof Error) && spaced.id > 0, `a name with double spaces is followed and saved: ${spaced instanceof Error ? spaced.message : "saved"}`);
  // 14. A name that cannot be searched: the watch waits a week and says why.
  await pool.query("DELETE FROM seo_mention_checks WHERE site_id=$1", [s.id]);
  await pool.query("UPDATE seo_sites SET business_name='Alpine \"Exteriors\"', next_mention_at = now() - interval '1 minute' WHERE id=$1", [s.id]);
  calls = 0; await runDueMentionChecks();
  const waiting = await site();
  ok(calls === 0 && waiting.mention_watch_note === "bad_name" && new Date(waiting.next_mention_at).getTime() - Date.now() > 6 * 864e5, "a name that cannot be searched: nothing bought, waits a week, says why");
  await pool.query("UPDATE seo_sites SET business_name='Alpine Exteriors' WHERE id=$1", [s.id]);
  // 8. Turned off: nothing due; another account cannot turn it on.
  await setMentionWatch(1, s.id, false);
  ok((await site()).next_mention_at === null, "turned off: nothing due");
  await setMentionWatch(2, s.id, true);
  ok((await site()).mention_watch === false, "another account cannot turn it on");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s.id]);
  console.log(`mention watch checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
