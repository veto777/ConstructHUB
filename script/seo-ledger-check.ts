/**
 * Real-Postgres check of the SEO ledger and rank runs. Not part of the unit suite (it needs a database):
 *   createdb seotest && psql seotest -c "create table users(id serial primary key, email text); insert into users(email) values ('a'),('b')"
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-ledger-check.ts
 * Use a THROWAWAY database: it writes rows for users 1 and 2.
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { budgetDeps, reserveBudget, settleBudget, applySettlement, reconcileReservations, refundReservation, withBudget, SeoBudgetError } from "../server/seo/budget";
import { reserveCredits } from "../server/seo/credits";
import { enqueueRankRun, postQueuedRun, collectRunningRuns, retryOwedRefunds, owedRefunds, seoJobDeps } from "../server/seo/jobs";
import { dataforseoDeps } from "../server/seo/dataforseo";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
const state = async (user = 1) => {
  const u = await one("SELECT coalesce(sum(included_cents),0)::int inc, coalesce(sum(wallet_cents),0)::int wal FROM seo_credit_usage WHERE user_id=$1", [user]);
  const w = await one("SELECT coalesce(max(balance_cents),0)::int bal FROM seo_credit_wallets WHERE user_id=$1", [user]);
  const a = await one("SELECT coalesce(sum(cost_usd),0)::float8 cost FROM seo_api_usage WHERE user_id=$1", [user]);
  const r = await one("SELECT count(*) FILTER (WHERE settled_at IS NULL)::int open FROM seo_reservations WHERE user_id=$1", [user]);
  return { included: u.inc, walletUsed: u.wal, wallet: w.bal, cost: Math.round(a.cost * 1e4) / 1e4, open: r.open };
};

async function main() {
  await ensureSeoSchema();
  // A queued run checks the account's plan again before it is posted (server/seo/jobs.ts); this database has no plans.
  seoJobDeps.entitled = async () => true;
  let allowance = 1000;
  budgetDeps.allowanceCents = async () => allowance;

  // 1. reserve -> settle to a lower actual
  let r = await reserveBudget(1, 0.05);
  eq("1a reserve holds 20c of the allowance and $0.05 of our budget, reservation open", await state(), { included: 20, walletUsed: 0, wallet: 0, cost: 0.05, open: 1 });
  eq("1b the reservation row carries the credit split", (await one("SELECT credit FROM seo_reservations WHERE id=$1", [r.id])).credit.fromIncluded, 20);
  await settleBudget(r, 0.03);
  eq("1c settle to $0.03: 12c charged, reservation closed", await state(), { included: 12, walletUsed: 0, wallet: 0, cost: 0.03, open: 0 });
  eq("1d a second settlement of the same reservation does nothing", await applySettlement(r.id!), false);
  await settleBudget({ ...r, settled: false }, 0);
  eq("1e ...even from a fresh object (a retry after a restart)", await state(), { included: 12, walletUsed: 0, wallet: 0, cost: 0.03, open: 0 });

  // 2. crash between reserve and settle
  r = await reserveBudget(1, 0.05);
  eq("2a reconcile leaves a young reservation alone", await reconcileReservations(), 0);
  await pool.query("UPDATE seo_reservations SET created_at=now()-interval '31 minutes' WHERE id=$1", [r.id]);
  eq("2b reconcile closes the abandoned one", await reconcileReservations(), 1);
  eq("2c customer charged nothing; our ledger keeps the estimate", await state(), { included: 12, walletUsed: 0, wallet: 0, cost: 0.08, open: 0 });

  // 3. settlement recorded but not applied (database error mid-settle)
  r = await reserveBudget(1, 0.05);
  await pool.query("UPDATE seo_reservations SET actual_usd=0.04, customer_usd=0.04, created_at=now()-interval '31 minutes' WHERE id=$1", [r.id]);
  await reconcileReservations();
  eq("3  reconcile applies the recorded numbers (16c, $0.04)", await state(), { included: 28, walletUsed: 0, wallet: 0, cost: 0.12, open: 0 });

  // 4. allowance used up, purchased credit present
  allowance = 28;
  await pool.query("UPDATE seo_credit_wallets SET balance_cents=500 WHERE user_id=1");
  const refused: any = await reserveBudget(1, 0.05, { allowanceOnly: true }).catch((e) => e);
  eq("4a an automatic job is refused rather than touching purchased credit", [refused instanceof SeoBudgetError, refused.code], [true, "seo_credits"]);
  eq("4b ...and nothing is left reserved", await state(), { included: 28, walletUsed: 0, wallet: 500, cost: 0.12, open: 0 });

  // 5. a manual lookup draws on purchased credit; a failed call gives it all back
  const boom: any = await withBudget(1, 0.05, async () => { throw Object.assign(new Error("task failed"), { code: "task_failed", costUsd: 0.01 }); }).catch((e) => e);
  eq("5a failed call: wallet untouched, our ledger keeps the $0.01 the source charged", [boom.message, await state()], ["task failed", { included: 28, walletUsed: 0, wallet: 500, cost: 0.13, open: 0 }]);
  await withBudget(1, 0.05, async () => { throw Object.assign(new Error("timed out"), { code: "timeout", costUsd: 0 }); }).catch(() => {});
  eq("5b timed-out call: customer pays nothing, our ledger keeps the whole estimate", await state(), { included: 28, walletUsed: 0, wallet: 500, cost: 0.18, open: 0 });
  await withBudget(1, 0.05, async () => ({ data: 1, costUsd: 0.05 }));
  eq("5c successful call from purchased credit: 20c off the wallet", await state(), { included: 28, walletUsed: 20, wallet: 480, cost: 0.23, open: 0 });
  await withBudget(1, 0.05, async () => ({ data: 1, costUsd: 0.02, costUnknown: true }));
  eq("5d part of the cost unknown: customer pays the known 8c, our ledger keeps the estimate", await state(), { included: 28, walletUsed: 28, wallet: 472, cost: 0.28, open: 0 });

  // 6. ten at once with room for two
  allowance = 50;                      // user 2: 50c allowance, no wallet
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveBudget(2, 0.05)));
  const won = results.filter((x) => x.status === "fulfilled") as PromiseFulfilledResult<any>[];
  eq("6a ten reservations at once, room for two: exactly two succeed", won.length, 2);
  eq("6b ...and only those two hold anything", await state(2), { included: 40, walletUsed: 0, wallet: 0, cost: 0.1, open: 2 });
  for (const w of won) await settleBudget(w.value, 0);
  eq("6c released", await state(2), { included: 0, walletUsed: 0, wallet: 0, cost: 0, open: 0 });

  // 7. rank runs: one open run per site, and a removed keyword cannot jam the run
  allowance = 1000;
  const site = await one("INSERT INTO seo_sites(user_id,domain,devices) VALUES(2,'example.com','desktop') RETURNING *");
  const kw = await one("INSERT INTO seo_keywords(site_id,user_id,keyword) VALUES($1,2,'roof repair') RETURNING id", [site.id]);
  const kw2 = await one("INSERT INTO seo_keywords(site_id,user_id,keyword) VALUES($1,2,'siding') RETURNING id", [site.id]);
  const both = await Promise.all([enqueueRankRun(site, "manual"), enqueueRankRun(site, "manual"), enqueueRankRun(site, "manual")]);
  eq("7a three requests at once queue one run", [new Set(both.map((b) => b.id)).size, both.filter((b) => !b.reused).length], [1, 1]);
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" });
  seoJobDeps.serpTaskPost = (async (i: any) => ({ data: i.tasks.map((t: any, n: number) => ({ ...t, taskId: `task-${n}` })), costUsd: 0.0012 })) as any;
  await postQueuedRun(both[0].id);
  eq("7b posted: task ids saved, run running", await one("SELECT status, jsonb_array_length(tasks) n FROM seo_rank_runs WHERE id=$1", [both[0].id]), { status: "running", n: 2 });
  await pool.query("DELETE FROM seo_keywords WHERE id=$1", [kw.id]);       // removed while its check is in the queue
  seoJobDeps.serpTaskGet = (async () => ({ status: "done", result: { position: 4, url: "https://example.com/", serpFeatures: [] } })) as any;
  await collectRunningRuns();
  eq("7c the run finishes with the remaining keyword instead of jamming", await one("SELECT status, checked FROM seo_rank_runs WHERE id=$1", [both[0].id]), { status: "done", checked: 1 });
  eq("7d the surviving keyword's position was written", (await one("SELECT position FROM seo_rank_checks WHERE keyword_id=$1", [kw2.id])).position, 4);
  eq("7e a new run can be queued afterwards", (await enqueueRankRun(site, "manual")).reused, false);
  await pool.query("UPDATE seo_rank_runs SET status='running', started_at=now()-interval '4 hours' WHERE site_id=$1 AND status='queued'", [site.id]);
  await collectRunningRuns();
  eq("7f a run stuck for hours is closed, not left blocking the site", (await one("SELECT count(*)::int n FROM seo_rank_runs WHERE site_id=$1 AND status IN ('queued','running')", [site.id])).n, 0);


  // 8. a call that was only slow: closed as abandoned, then finishes after all
  allowance = 100000;
  let base = await state(2);
  const moved = async () => { const n = await state(2); return { included: n.included - base.included, wallet: n.wallet - base.wallet, cost: Math.round((n.cost - base.cost) * 1e4) / 1e4, open: n.open }; };
  r = await reserveBudget(2, 0.05, { label: "slow lookup" });
  await pool.query("UPDATE seo_reservations SET created_at=now()-interval '31 minutes' WHERE id=$1", [r.id]);
  await reconcileReservations();
  eq("8a closed as abandoned: the customer holds nothing, our ledger keeps the estimate", await moved(), { included: 0, wallet: 0, cost: 0.05, open: 0 });
  await settleBudget(r, 0.03);
  eq("8b the call finishes late and is settled for real: 12c charged, our ledger at $0.03", await moved(), { included: 12, wallet: 0, cost: 0.03, open: 0 });
  await settleBudget({ ...r, settled: false }, 0.03);
  eq("8c ...once", await moved(), { included: 12, wallet: 0, cost: 0.03, open: 0 });
  eq("8d the usage label was saved", (await one("SELECT label FROM seo_reservations WHERE id=$1", [r.id])).label, "slow lookup");

  // 9. refunds for paid work that was never delivered
  base = await state(2);
  r = await reserveBudget(2, 0.05);
  await settleBudget(r, 0.05);
  eq("9a refund half of a 20c lookup", [await refundReservation(r.id!, 10, "k1"), await moved()], [10, { included: 10, wallet: 0, cost: 0.05, open: 0 }]);
  eq("9b the same refund again does nothing", [await refundReservation(r.id!, 10, "k1"), await moved()], [0, { included: 10, wallet: 0, cost: 0.05, open: 0 }]);
  eq("9b2 the usage history shows what is left of the charge", (await one("SELECT (credit->>'fromIncluded')::int inc, refunded_cents FROM seo_reservations WHERE id=$1", [r.id])), { inc: 10, refunded_cents: 10 });
  eq("9c a refund can never exceed what was charged", [await refundReservation(r.id!, 500, "k2"), await moved()], [10, { included: 0, wallet: 0, cost: 0.05, open: 0 }]);

  // 10. credit cannot be attached to a reservation that is already closed
  const late: any = await reserveCredits(2, 100000, 20, { reservationId: r.id }).catch((e) => e);
  eq("10 reserving credit onto a closed reservation is refused and takes nothing", [late instanceof Error, (await moved()).included], [true, 0]);

  // 11. rank checks that never come back are refunded
  base = await state(2);
  const site3 = await one("INSERT INTO seo_sites(user_id,domain,devices) VALUES(2,'late.example','desktop') RETURNING *");
  const k1 = await one("INSERT INTO seo_keywords(site_id,user_id,keyword) VALUES($1,2,'a') RETURNING id", [site3.id]);
  await one("INSERT INTO seo_keywords(site_id,user_id,keyword) VALUES($1,2,'b') RETURNING id", [site3.id]);
  seoJobDeps.serpTaskPost = (async (i: any) => ({ data: i.tasks.map((t: any, n: number) => ({ ...t, taskId: `late-${n}` })), costUsd: 0.05 })) as any;
  const lateRun = await enqueueRankRun(site3, "manual");
  await postQueuedRun(lateRun.id);
  eq("11a the run remembers what paid for it", (await one("SELECT posted, reservation_id IS NOT NULL AS has FROM seo_rank_runs WHERE id=$1", [lateRun.id])), { posted: 2, has: true });
  seoJobDeps.serpTaskGet = (async (i: any) => (i.keywordId === k1.id ? { status: "completed", result: { position: 3, url: "u", serpFeatures: [], localPosition: null, localPack: [] } } : { status: "pending" })) as any;
  await collectRunningRuns();
  eq("11b one back, one still waiting", await one("SELECT status, checked, jsonb_array_length(tasks) waiting FROM seo_rank_runs WHERE id=$1", [lateRun.id]), { status: "running", checked: 1, waiting: 1 });
  await pool.query("UPDATE seo_rank_runs SET started_at=now()-interval '91 minutes' WHERE id=$1", [lateRun.id]);
  await collectRunningRuns();
  const closed = await one("SELECT status, error FROM seo_rank_runs WHERE id=$1", [lateRun.id]);
  eq("11c the run closes and says the missing check was refunded", [closed.status, /refunded/.test(closed.error ?? "")], ["done", true]);
  eq("11d half of the 20c came back, to where it was taken from", [(await moved()).included, (await moved()).wallet], [10, 0]);
  await collectRunningRuns();
  eq("11e and only once", (await moved()).included, 10);


  // 12. a late outcome that could not be applied when it arrived is kept and applied by the reconciler
  base = await state(2);
  r = await reserveBudget(2, 0.05);
  await pool.query("UPDATE seo_reservations SET created_at=now()-interval '31 minutes' WHERE id=$1", [r.id]);
  await reconcileReservations();
  await pool.query("UPDATE seo_reservations SET late_actual_usd=0.03, late_customer_usd=0.03 WHERE id=$1", [r.id]);   // what a failed late settlement leaves behind
  await reconcileReservations();
  eq("12a the kept late outcome is applied: 12c charged, our ledger at $0.03", await moved(), { included: 12, wallet: 0, cost: 0.03, open: 0 });
  await reconcileReservations();
  eq("12b ...once", [await moved(), (await one("SELECT reconciled, late_actual_usd FROM seo_reservations WHERE id=$1", [r.id]))], [{ included: 12, wallet: 0, cost: 0.03, open: 0 }, { reconciled: false, late_actual_usd: null }]);

  // 13. a refund that cannot be made yet is owed, and made once the reservation settles
  base = await state(2);
  r = await reserveBudget(2, 0.05);
  const owing = await one("INSERT INTO seo_rank_runs(id,site_id,user_id,trigger,status,reservation_id,posted,cost_usd,refund_due,finished_at) VALUES(gen_random_uuid(),$1,2,'manual','done',$2,2,0.05,10,now()) RETURNING id", [site3.id, r.id]);
  eq("13a still owed while the reservation is open", [await retryOwedRefunds(), (await one("SELECT refund_due FROM seo_rank_runs WHERE id=$1", [owing.id])).refund_due], [0, 10]);
  await settleBudget(r, 0.05);
  eq("13b refunded once it has settled", [await retryOwedRefunds(), (await one("SELECT refund_due FROM seo_rank_runs WHERE id=$1", [owing.id])).refund_due, (await moved()).included], [1, 0, 10]);
  eq("13c and not again", [await retryOwedRefunds(), (await moved()).included], [0, 10]);
  // Money owed never ages out: a refund owed by a run from a month ago is still tried (counted, with the try), and made.
  r = await reserveBudget(2, 0.05);
  const oldOwing = await one("INSERT INTO seo_rank_runs(id,site_id,user_id,trigger,status,reservation_id,posted,cost_usd,refund_due,finished_at,created_at) VALUES(gen_random_uuid(),$1,2,'manual','done',$2,2,0.05,10,now()-interval '30 days',now()-interval '30 days') RETURNING id", [site3.id, r.id]);
  eq("13d a refund owed by a month-old run is still tried while unsettled, and counted as owed", [await retryOwedRefunds(), (await one("SELECT refund_due, refund_tries, refund_tried_at IS NOT NULL AS tried FROM seo_rank_runs WHERE id=$1", [oldOwing.id])), (await owedRefunds()).runs >= 1], [0, { refund_due: 10, refund_tries: 1, tried: true }, true]);
  await settleBudget(r, 0.05);
  eq("13e ...and made once the reservation settles, however old the run", [await retryOwedRefunds(), (await one("SELECT refund_due, refund_tries FROM seo_rank_runs WHERE id=$1", [oldOwing.id])), (await moved()).included], [1, { refund_due: 0, refund_tries: 2 }, 20]);

  // 14. a check the source said it could not do is refunded too
  base = await state(2);
  const site4 = await one("INSERT INTO seo_sites(user_id,domain,devices) VALUES(2,'failed.example','desktop') RETURNING *");
  const f1 = await one("INSERT INTO seo_keywords(site_id,user_id,keyword) VALUES($1,2,'a') RETURNING id", [site4.id]);
  await one("INSERT INTO seo_keywords(site_id,user_id,keyword) VALUES($1,2,'b') RETURNING id", [site4.id]);
  const failRun = await enqueueRankRun(site4, "manual");
  await postQueuedRun(failRun.id);
  seoJobDeps.serpTaskGet = (async (i: any) => (i.keywordId === f1.id ? { status: "completed", result: { position: 3, url: "u", serpFeatures: [], localPosition: null, localPack: [], serpTop: [], rivals: {} } } : { status: "failed", message: "boom" })) as any;
  await collectRunningRuns();
  eq("14 one delivered, one failed: half of the 20c is refunded", [(await one("SELECT status FROM seo_rank_runs WHERE id=$1", [failRun.id])).status, (await moved()).included], ["done", 10]);

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("CRASHED", e); process.exit(2); });
