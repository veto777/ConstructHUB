/**
 * Real-Postgres check of the Alerts page's paging and kind filter, complete evidence, and deliveries that are given up
 * visibly instead of forgotten (server/seo/alerts.ts), plus what is still owed for the operator. Not part of the unit
 * suite. THROWAWAY database (it writes rows for users 1 and 2, and removes them at the end):
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-alerts-check.ts
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { alertDeps, alertPage, countAlerts, deliverAlert, deliverPendingAlerts, DELIVERY_TRIES, EMAIL_TRIES, listAlerts, retryAlertEmails, saveAlert, undeliveredAlerts } from "../server/seo/alerts";
import { owedRefunds } from "../server/seo/jobs";

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
  await pool.query("DELETE FROM seo_sites WHERE domain IN ('pages.example','theirs.example')");
  const site = await one("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'pages.example','desktop') RETURNING id");
  const other = await one("INSERT INTO seo_sites(user_id,domain,devices) VALUES(2,'theirs.example','desktop') RETURNING id");
  // Seven alerts of mixed kinds, a minute apart (the page is newest first), and one that is another account's.
  const kinds = ["rank_drop", "rank_gain", "links_lost", "rank_drop", "grid_down", "kw_new", "rank_drop"];
  const ids: number[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const id = (await saveAlert(1, site.id, kinds[i], `t${i}`, `alert ${i}`, [{ n: i }]))!;
    ids.push(id);
    await pool.query("UPDATE seo_alerts SET created_at = now() - make_interval(mins => $2) WHERE id=$1", [id, kinds.length - i]);
  }
  await saveAlert(2, other.id, "rank_drop", "x", "theirs", []);

  // 1. paging, newest first, nothing twice or missing
  const p1 = await alertPage(1, site.id, { limit: 3 });
  const p2 = await alertPage(1, site.id, { limit: 3, before: p1.alerts[2].id });
  const p3 = await alertPage(1, site.id, { limit: 3, before: p2.alerts[2].id });
  eq("1a three pages of three, three and one, newest first, nothing twice or missing",
    [p1.alerts.length, p1.hasMore, p2.alerts.length, p2.hasMore, p3.alerts.length, p3.hasMore, [...p1.alerts, ...p2.alerts, ...p3.alerts].map((a: any) => a.id)], [3, true, 3, true, 1, false, [...ids].reverse()]);
  eq("1b every page says how many there are in all", [p1.total, p1.totalAll, p3.total, p1.pageSize], [7, 7, 7, 3]);
  eq("1c the page size has a floor and a ceiling", [(await alertPage(1, site.id, { limit: 0 })).pageSize, (await alertPage(1, site.id, { limit: 10_000 })).pageSize], [1, 200]);

  // 2. the kind is filtered by the database before the page is cut
  const drops = await alertPage(1, site.id, { kind: "rank_drop", limit: 2 });
  eq("2a a kind is filtered before the page is cut, and counted whole", [drops.alerts.map((a: any) => a.kind), drops.hasMore, drops.total, drops.totalAll], [["rank_drop", "rank_drop"], true, 3, 7]);
  const none = await alertPage(1, site.id, { kind: "mention_new" });
  eq("2b 'no alerts of this kind' rests on a count of none, not on the newest page", [none.alerts.length, none.total, none.totalAll], [0, 0, 7]);
  // (User 1 may have alerts from the other check scripts on this database: the account-wide count is at least the site's.)
  eq("2c the whole account, or one site; another account sees its own", [(await countAlerts(1, site.id)).totalAll, (await countAlerts(1, null)).totalAll >= 7, (await countAlerts(2, null)).totalAll, (await alertPage(2, null)).alerts.map((a: any) => a.title)], [7, true, 1, ["theirs"]]);

  // 3. paging from an alert that is not the account's
  const theirs = await one("SELECT id FROM seo_alerts WHERE user_id=2");
  eq("3 paging from another account's alert shows nothing (an empty page, nothing of theirs)", (await alertPage(1, site.id, { before: theirs.id })).alerts.length, 0);

  // 4. the evidence is kept whole
  const big = await saveAlert(1, site.id, "rank_gain", "big", "many", Array.from({ length: 1200 }, (_, i) => ({ keyword: `k${i}` })));
  eq("4 every movement is kept with its alert (none is cut)", (await one("SELECT jsonb_array_length(items)::int n FROM seo_alerts WHERE id=$1", [big])).n, 1200);

  // 5. a delivery that keeps failing is given up visibly: marked, counted, listed as not sent — and not tried again
  alertDeps.notify = async () => { throw new Error("bell down"); };
  const dead = ids[0];
  await pool.query("UPDATE seo_alerts SET delivery_tries=$2 WHERE id=$1", [dead, DELIVERY_TRIES - 1]);
  eq("5a the last failed try gives the delivery up: marked, counted for the account, listed as not sent",
    [await deliverAlert(dead), await one("SELECT delivery_failed_at IS NOT NULL AS gone, delivery_tries FROM seo_alerts WHERE id=$1", [dead]), await undeliveredAlerts(1), await undeliveredAlerts(2), await undeliveredAlerts(null), (await listAlerts(1, site.id)).find((a: any) => a.id === dead)?.notSent],
    [false, { gone: true, delivery_tries: DELIVERY_TRIES }, 1, 0, 1, true]);
  await deliverPendingAlerts();
  eq("5b ...and it is not tried again, by a direct send or by the retry pass", [await deliverAlert(dead), (await one("SELECT delivery_tries FROM seo_alerts WHERE id=$1", [dead])).delivery_tries], [false, DELIVERY_TRIES]);

  // 6. an undelivered alert is tried however old it is; a failed try is counted and the next one put off
  const old = ids[1];
  await pool.query("UPDATE seo_alerts SET created_at = now() - interval '10 days' WHERE id=$1", [old]);
  await deliverPendingAlerts();
  eq("6a an alert ten days old is still tried; the failed try is counted and the next put off (not given up)",
    await one("SELECT delivery_tries, next_try_at > now() + interval '9 minutes' AS later, delivery_failed_at FROM seo_alerts WHERE id=$1", [old]), { delivery_tries: 1, later: true, delivery_failed_at: null });
  await deliverPendingAlerts();
  eq("6b not before its next try is due", (await one("SELECT delivery_tries FROM seo_alerts WHERE id=$1", [old])).delivery_tries, 1);
  alertDeps.notify = async () => ({ inApp: true, email: "sent" as const });
  await pool.query("UPDATE seo_alerts SET next_try_at = now() - interval '1 minute' WHERE id=$1", [old]);
  await deliverPendingAlerts();
  eq("6c ...and it goes out once the bell is back", await one("SELECT notified_at IS NOT NULL AS sent, delivery_failed_at FROM seo_alerts WHERE id=$1", [old]), { sent: true, delivery_failed_at: null });

  // 7. an email that fails its last try is marked on the alert (the bell entry went out), not just dropped
  alertDeps.notify = async () => ({ inApp: true, email: "failed" as const });
  const mail = ids[2];
  await pool.query("UPDATE seo_alerts SET notified_at=now(), email_retry_at=now() - interval '1 minute', email_tries=$2 WHERE id=$1", [mail, EMAIL_TRIES - 1]);
  await retryAlertEmails();
  eq("7 the last failed email try is marked on the alert; the page says the email was not sent",
    [await one("SELECT email_failed_at IS NOT NULL AS gone, email_retry_at, email_tries FROM seo_alerts WHERE id=$1", [mail]), (await listAlerts(1, site.id)).find((a: any) => a.id === mail)?.emailFailed], [{ gone: true, email_retry_at: null, email_tries: EMAIL_TRIES }, true]);

  // 8. what is still owed back to customers is counted for the operator, however old (the ledger check proves the refund itself)
  await pool.query("INSERT INTO seo_rank_runs(id, site_id, user_id, status, refund_due, created_at) VALUES(gen_random_uuid(), $1, 1, 'done', 10, now() - interval '40 days'), (gen_random_uuid(), $1, 1, 'done', 25, now() - interval '2 days')", [site.id]);
  const owed = await owedRefunds();
  eq("8 refunds still owed are counted with their total, the oldest included", [owed.runs, owed.cents, owed.oldest !== null && new Date(owed.oldest).getTime() < Date.now() - 39 * 86_400_000], [2, 35, true]);

  await pool.query("DELETE FROM seo_sites WHERE id IN ($1, $2)", [site.id, other.id]);
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("CRASHED", e); process.exit(2); });
