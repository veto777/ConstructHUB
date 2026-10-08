/**
 * Real-Postgres check of the action plan. Not part of the unit suite.
 * Run on a THROWAWAY database after the other checks:
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-tasks-check.ts
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { addTasks, listTasks, updateTask, deleteTask, openTaskCounts, taskInput, taskPatch, MAX_OPEN_TASKS } from "../server/seo/tasks";

let failed = 0;
const tasksOf = async (user: number, siteId: number) => (await listTasks(user, siteId, 1000)).tasks;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const t = (o: object) => taskInput.parse(o);

async function main() {
  await ensureSeoSchema(); await ensureSeoSchema();
  const { rows: [s] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'plan.example','desktop') ON CONFLICT(user_id,domain) DO UPDATE SET devices=EXCLUDED.devices RETURNING id");
  const { rows: [other] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(2,'theirs.example','desktop') ON CONFLICT(user_id,domain) DO UPDATE SET devices=EXCLUDED.devices RETURNING id");
  await pool.query("DELETE FROM seo_tasks WHERE site_id = ANY($1::int[])", [[s.id, other.id]]);

  const first = await addTasks(1, s.id, [t({ kind: "keyword", title: "Move \"roof repair\" up from position 7", target: "https://plan.example/roofing", facts: { position: 7, volume: 880 }, source: "kw:roof repair" }), t({ kind: "audit", title: "Fix: Missing title", source: "audit:missing-title" }), t({ kind: "other", title: "Call the chamber" })]);
  const again = await addTasks(1, s.id, [t({ kind: "keyword", title: "Move it again", source: "kw:roof repair" }), t({ kind: "other", title: "Call the chamber" })]);
  eq("1 a finding added twice is one task; a task with no source is always new", [first, again, (await tasksOf(1, s.id)).length], [{ added: 3, already: 0 }, { added: 1, already: 1 }, 4]);
  const kw = (await tasksOf(1, s.id)).find((x) => x.source === "kw:roof repair")!;
  eq("1b the first copy is the one kept, with its facts and a safe link", [kw.title, kw.facts, kw.url], ["Move \"roof repair\" up from position 7", { volume: 880, position: 7 }, "https://plan.example/roofing"]);

  const foreign: any = await addTasks(2, s.id, [t({ kind: "other", title: "x" })]).catch((e) => e);
  eq("2 another account cannot add to, read, change or delete this site's plan", [foreign?.status, (await tasksOf(2, s.id)).length, (await updateTask(2, kw.id, taskPatch.parse({ status: "done" })).catch((e: any) => e?.status)), await deleteTask(2, kw.id), (await tasksOf(1, s.id)).find((x) => x.id === kw.id)?.status], [404, 0, 404, false, "todo"]);

  const doing = await updateTask(1, kw.id, taskPatch.parse({ status: "doing", note: "rewrote the intro" }));
  const done = await updateTask(1, kw.id, taskPatch.parse({ status: "done" }));
  const reopened = await updateTask(1, kw.id, taskPatch.parse({ status: "todo" }));
  const cleared = await updateTask(1, kw.id, taskPatch.parse({ note: null }));
  eq("3 start, finish (the day is stamped), reopen (it is cleared); a note is kept until it is removed", [doing.status, doing.note, !!done.doneAt, done.note, reopened.doneAt, reopened.note, cleared.note], ["doing", "rewrote the intro", true, "rewrote the intro", null, "rewrote the intro", null]);
  await updateTask(1, kw.id, taskPatch.parse({ status: "done" }));
  eq("4 open tasks are counted per site, for this account only", [[...(await openTaskCounts(1, [s.id, other.id])).entries()], [...(await openTaskCounts(2, [s.id])).entries()]], [[[s.id, 3]], []]);
  eq("4b the order is in progress, to do, done", (await tasksOf(1, s.id)).map((x) => x.status).join(","), "todo,todo,todo,done");

  // the limit of open tasks, also with two requests at once
  await pool.query("INSERT INTO seo_tasks(user_id, site_id, kind, title) SELECT 1, $1, 'other', 'filler ' || g FROM generate_series(1, $2) g", [s.id, MAX_OPEN_TASKS - 3 - 1]);
  const both = await Promise.allSettled([addTasks(1, s.id, [t({ kind: "other", title: "last one a" })]), addTasks(1, s.id, [t({ kind: "other", title: "last one b" })])]);
  const openNow = (await pool.query("SELECT count(*)::int n FROM seo_tasks WHERE site_id=$1 AND status IN ('todo','doing')", [s.id])).rows[0].n;
  eq("5 the plan stops at its limit, even with two requests at once", [both.filter((r) => r.status === "fulfilled").length, openNow, (both.find((r) => r.status === "rejected") as any)?.reason?.status], [1, MAX_OPEN_TASKS, 403]);
  // at the limit: a finding that is already in the plan is still "already there", not an error; reopening counts like adding
  eq("5a at the limit, sending a finding that is already there is not an error", await addTasks(1, s.id, [t({ kind: "keyword", title: "again", source: "kw:roof repair" })]), { added: 0, already: 1 });
  const closedOne = (await tasksOf(1, s.id)).find((x) => x.status === "done")!;
  const reopen: any = await updateTask(1, closedOne.id, taskPatch.parse({ status: "todo" })).catch((e) => e);
  eq("5b reopening a finished task cannot overfill the plan", [reopen?.status, (await pool.query("SELECT count(*)::int n FROM seo_tasks WHERE site_id=$1 AND status IN ('todo','doing')", [s.id])).rows[0].n], [403, MAX_OPEN_TASKS]);
  const some = (await tasksOf(1, s.id)).filter((x) => x.status === "todo").slice(0, 2);
  eq("5c a finished task makes room again — for a new one or a reopened one", [(await updateTask(1, some[0].id, taskPatch.parse({ status: "done" }))).status, (await addTasks(1, s.id, [t({ kind: "other", title: "fits now" })])).added, (await updateTask(1, some[1].id, taskPatch.parse({ status: "dropped" }))).status, (await updateTask(1, closedOne.id, taskPatch.parse({ status: "todo" }))).status], ["done", 1, "dropped", "todo"]);
  // two status changes at once at the limit: only one may take the last place
  const full = (await tasksOf(1, s.id));
  const closedTwo = full.filter((x) => x.status === "done" || x.status === "dropped").slice(0, 2);
  if (closedTwo.length === 2) {
    const openNowN = full.filter((x) => x.status === "todo" || x.status === "doing").length;
    const spare = (await tasksOf(1, s.id)).filter((x) => x.status === "todo").slice(0, Math.max(0, openNowN - (MAX_OPEN_TASKS - 1)));
    for (const sp of spare) await updateTask(1, sp.id, taskPatch.parse({ status: "done" }));
    const race = await Promise.allSettled(closedTwo.map((c) => updateTask(1, c.id, taskPatch.parse({ status: "todo" }))));
    eq("5e two reopenings at once with one place left: one succeeds", [race.filter((r) => r.status === "fulfilled").length, (await pool.query("SELECT count(*)::int n FROM seo_tasks WHERE site_id=$1 AND status IN ('todo','doing')", [s.id])).rows[0].n], [1, MAX_OPEN_TASKS]);
  }
  // a long history is counted in full and shown newest first, a page at a time
  await pool.query("INSERT INTO seo_tasks(user_id, site_id, kind, title, status, done_at) SELECT 1, $1, 'other', 'old ' || g, 'done', now() - make_interval(days => 40 + g) FROM generate_series(1, 130) g", [s.id]);
  const page = await listTasks(1, s.id, 100), more = await listTasks(1, s.id, 500);
  eq("5d the history is not cut silently: all are counted, the newest hundred are shown, more on request", [page.counts.done >= 131, page.closedShown, more.closedShown >= 131, page.counts.doneRecently < page.counts.done, page.tasks.filter((x) => x.status === "todo" || x.status === "doing").length], [true, 100, true, true, MAX_OPEN_TASKS]);
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s.id]);
  eq("6 deleting the site takes its plan with it", (await pool.query("SELECT count(*)::int n FROM seo_tasks WHERE site_id=$1", [s.id])).rows[0].n, 0);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
