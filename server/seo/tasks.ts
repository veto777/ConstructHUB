/**
 * Action plan: the things a customer decided to do about what the SEO tools found — a keyword to
 * move up, a page to write, a lost link to win back, a site to ask for a link, an audit issue to
 * fix — kept per site with a status and a note. Nothing here costs SEO data.
 * A finding added twice is one task (`source` says where it came from).
 */
import { z } from "zod";
import { linkResolverFor, pairOf } from "./link-opportunities";
import { pool } from "../db";
import { SeoCustomerError } from "./public-errors";
import { safeHttpUrl } from "./dataforseo";

export const TASK_KINDS = ["keyword", "page", "link_reclaim", "link_prospect", "audit", "other"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_STATUSES = ["todo", "doing", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Tasks not yet done or dropped that one site may hold. */
export const MAX_OPEN_TASKS = 300;
/** The most done-and-dropped tasks one page of the plan lists (the counts are always of all of them). */
export const MAX_CLOSED_SHOWN = 5000;
export class TaskError extends SeoCustomerError {}

/** A few facts carried from the finding (position, searches a month, authority…): short keys, plain values. */
const facts = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,29}$/), z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null()]))
  .refine((o) => Object.keys(o).length <= 12, "Too many facts");
export const taskInput = z.object({
  kind: z.enum(TASK_KINDS),
  title: z.string().trim().min(1).max(200),
  /** What it is about: a web address, a domain or a keyword. */
  target: z.string().trim().max(500).nullable().default(null),
  facts: facts.default({}),
  /** Where it came from ("kw:roof repair", "audit:missing-title"). The same source for the same site is the same task. */
  source: z.string().trim().min(1).max(200).nullable().default(null),
}).strict();
export const tasksInput = z.object({ tasks: z.array(taskInput).min(1).max(50) }).strict();
export const taskPatch = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
}).strict().refine((p) => p.status !== undefined || p.note !== undefined || p.title !== undefined, "Nothing to change");

export const TASK_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_tasks (
     id serial PRIMARY KEY,
     user_id integer NOT NULL,
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     kind text NOT NULL,
     title text NOT NULL,
     target text,
     detail jsonb NOT NULL DEFAULT '{}'::jsonb,
     source text,
     status text NOT NULL DEFAULT 'todo',
     note text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     done_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS seo_tasks_site ON seo_tasks(site_id, status, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_tasks_source ON seo_tasks(site_id, source) WHERE source IS NOT NULL`,
];

export type Task = {
  id: number; kind: TaskKind; title: string; target: string | null; /** `target` when it is a web address safe to link to. */ url: string | null;
  facts: Record<string, string | number | boolean | null>; source: string | null; status: TaskStatus; note: string | null; createdAt: string; doneAt: string | null;
  /** Audit tasks: a crawl made AFTER the task was added, at least as wide as the one it came from, re-checked this issue and no longer finds it. (The customer still decides when it is done.) */
  resolved?: { on: string | null };
  /** Audit tasks: why nothing can be said yet — no crawl since it was added, the newer crawl covered too little or could not re-check this issue, or the newest crawl failed. */
  recheck?: "none" | "unverifiable" | "not_rechecked" | "failed" | "later" | "unavailable";
};
/** A task row as the page gets it. Pure. */
export function toTask(r: any): Task {
  const target = typeof r.target === "string" && r.target ? r.target : null;
  return {
    id: r.id, kind: (TASK_KINDS as readonly string[]).includes(r.kind) ? r.kind : "other", title: String(r.title ?? ""), target,
    url: target ? safeHttpUrl(target) ?? (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/i.test(target) ? `https://${target.toLowerCase()}` : null) : null,
    facts: r.detail && typeof r.detail === "object" && !Array.isArray(r.detail) ? r.detail : {}, source: r.source ?? null,
    status: (TASK_STATUSES as readonly string[]).includes(r.status) ? r.status : "todo", note: r.note ?? null,
    createdAt: new Date(r.created_at).toISOString(), doneAt: r.done_at ? new Date(r.done_at).toISOString() : null,
  };
}
/** What the crawls say, for judging audit tasks (server/seo/audit.ts auditEvidence). */
export type CrawlEvidence = {
  /** The newest finished crawl, or null when there is none. */ latestId: string | null; scannedAt: string | null;
  /** A newer crawl than that one failed: the picture is older than the customer may think. */ newerFailed: boolean;
  /** For each earlier crawl a task came from: what the newest crawl says about THAT crawl's issues. */
  byCrawl: ReadonlyMap<string, { present: ReadonlySet<string>; fixed: ReadonlySet<string>; notRechecked: ReadonlySet<string> }>;
  /** Crawls left out of this look-up because too many were asked about at once. */
  skipped?: ReadonlySet<string>;
};
/**
 * What can honestly be said about each open audit task. "No longer found" is claimed only on positive evidence: the
 * task records the crawl it came from, a crawl finished AFTER the task was added, and comparing the two shows the
 * issue gone with the check that found it run again on everything it was found on. Absence alone is never evidence — a task with no recorded crawl, a crawl that is
 * gone, or an issue the origin crawl does not list under that name is "cannot be verified". A task is never marked
 * done here; the customer decides. Pure.
 */
/** When the crawls could not be read at all: every open audit task says so, instead of saying nothing. Pure. */
export const markUnavailable = (tasks: Task[]): Task[] => tasks.map((t) => (t.kind === "audit" && (t.status === "todo" || t.status === "doing") ? { ...t, recheck: "unavailable" as const } : t));
export function markResolved(tasks: Task[], crawl: CrawlEvidence | null): Task[] {
  return tasks.map((t) => {
    if (t.kind !== "audit" || (t.status !== "todo" && t.status !== "doing")) return t;
    // An audit task that does not say which issue it came from (added by hand) cannot be checked against a crawl: say so.
    if (!t.source?.startsWith("audit:")) return { ...t, recheck: "unverifiable" as const };
    const key = t.source.slice(6), from = typeof t.facts.crawlId === "string" ? t.facts.crawlId : null;
    const failed = crawl?.newerFailed ? { recheck: "failed" as const } : {};
    if (!from) return { ...t, recheck: "unverifiable" as const };
    if (!crawl?.latestId || crawl.latestId === from) return { ...t, recheck: crawl?.newerFailed ? "failed" as const : "none" as const };
    // The recheck must have happened AFTER the task was added: a crawl that finished before that is not a recheck of it.
    if (!crawl.scannedAt || new Date(crawl.scannedAt).getTime() <= new Date(t.createdAt).getTime()) return { ...t, recheck: crawl.newerFailed ? "failed" as const : "none" as const };
    if (crawl.skipped?.has(from)) return { ...t, recheck: "later" as const };
    const verdict = crawl.byCrawl.get(from);
    if (!verdict) return { ...t, recheck: "unverifiable" as const };
    if (verdict.present.has(key)) return { ...t, ...failed }; // still there
    if (verdict.fixed.has(key)) return { ...t, resolved: { on: crawl.scannedAt }, ...failed };
    if (verdict.notRechecked.has(key)) return { ...t, recheck: "not_rechecked" as const };
    return { ...t, recheck: "unverifiable" as const }; // the origin crawl does not list it under this name
  });
}

const OPEN = "status IN ('todo','doing')";
export type TaskCounts = { todo: number; doing: number; done: number; dropped: number; /** Finished in the last 30 days. */ doneRecently: number };
/**
 * The plan as the page shows it: every open task (never more than the limit), the newest `closedLimit` done or dropped
 * ones, and counts of everything — so a long history is neither silently cut nor miscounted.
 */
export async function listTasks(userId: number, siteId: number, closedLimit = 100): Promise<{ tasks: Task[]; counts: TaskCounts; closedShown: number }> {
  const limit = Math.min(MAX_CLOSED_SHOWN, Math.max(1, Math.floor(closedLimit)));
  const [{ rows: open }, { rows: closed }, { rows: [c] }] = await Promise.all([
    pool.query(`SELECT * FROM seo_tasks WHERE site_id=$1 AND user_id=$2 AND ${OPEN} ORDER BY CASE status WHEN 'doing' THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT ${MAX_OPEN_TASKS + 50}`, [siteId, userId]),
    pool.query(`SELECT * FROM seo_tasks WHERE site_id=$1 AND user_id=$2 AND NOT (${OPEN}) ORDER BY coalesce(done_at, updated_at) DESC, id DESC LIMIT $3`, [siteId, userId, limit]),
    pool.query(
      `SELECT count(*) FILTER (WHERE status='todo')::int AS todo, count(*) FILTER (WHERE status='doing')::int AS doing, count(*) FILTER (WHERE status='done')::int AS done,
              count(*) FILTER (WHERE status='dropped')::int AS dropped, count(*) FILTER (WHERE status='done' AND done_at > now() - interval '30 days')::int AS "doneRecently"
         FROM seo_tasks WHERE site_id=$1 AND user_id=$2`, [siteId, userId]),
  ]);
  return { tasks: [...open, ...closed].map(toTask), counts: c, closedShown: closed.length };
}
/**
 * Add findings to the plan. One that is already there (same source) is left as it is and does not count against the
 * limit. The limit holds across requests: the site's row is locked for the count and the inserts.
 */
export async function addTasks(userId: number, siteId: number, tasks: z.infer<typeof taskInput>[]): Promise<{ added: number; already: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [site] } = await client.query("SELECT id, domain FROM seo_sites WHERE id=$1 AND user_id=$2 FOR UPDATE", [siteId, userId]);
    if (!site) throw new TaskError("Site not found", 404);
    // What is really new: not already in the plan, and not twice in this request.
    const sources = [...new Set(tasks.map((t) => t.source).filter((s): s is string => !!s))];
    const { rows: have } = sources.length ? await client.query("SELECT source FROM seo_tasks WHERE site_id=$1 AND source = ANY($2::text[])", [siteId, sources]) : { rows: [] as any[] };
    const known = new Set<string>(have.map((r: any) => r.source));
    // A suggested internal link is the same link however it was found or written: every link task already in the plan
    // (old "link-opp:" ones included) is compared with the new one by its two pages — through the aliases of the
    // site's newest crawl, read now, under the same lock as the insert. Stored tasks are never rewritten, so a later
    // crawl that knows more aliases compares them afresh.
    let pairs = new Set<string>(), linkPair = (_f: unknown, _t: unknown) => "";
    if (tasks.some((t) => t.source?.startsWith("link-pair:"))) {
      const resolve = await linkResolverFor(userId, site.domain, client);
      linkPair = (from, to) => pairOf(resolve(String(from ?? "")), resolve(String(to ?? "")));
      pairs = new Set((await client.query("SELECT target, detail->>'linkTo' AS link_to FROM seo_tasks WHERE site_id=$1 AND (source LIKE 'link-opp:%' OR source LIKE 'link-pair:%') AND target IS NOT NULL", [siteId])).rows
        .filter((r: any) => typeof r.link_to === "string").map((r: any) => linkPair(r.target, r.link_to)));
    }
    const fresh = tasks.filter((t) => {
      if (!t.source) return true;
      if (known.has(t.source)) return false;
      if (t.source.startsWith("link-pair:")) { const pr = linkPair(t.target, t.facts.linkTo); if (pairs.has(pr)) return false; pairs.add(pr); }
      known.add(t.source); return true;
    });
    const { rows: [{ n }] } = await client.query(`SELECT count(*)::int n FROM seo_tasks WHERE site_id=$1 AND ${OPEN}`, [siteId]);
    if (n + fresh.length > MAX_OPEN_TASKS) throw new TaskError(`The plan holds up to ${MAX_OPEN_TASKS} open tasks${fresh.length > 1 ? ` and these would make ${n + fresh.length}` : ""}. Finish or drop some first.`, 403);
    let added = 0;
    for (const t of fresh) {
      const { rowCount } = await client.query(
        `INSERT INTO seo_tasks(user_id, site_id, kind, title, target, detail, source) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (site_id, source) WHERE source IS NOT NULL DO NOTHING`,
        [userId, siteId, t.kind, t.title, t.target, JSON.stringify(t.facts), t.source]);
      added += rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { added, already: tasks.length - added };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}
/**
 * Change a task's status, note or title. Finishing stamps the day; reopening clears it — and reopening counts
 * against the same limit as adding, under the same lock on the site's row, so the plan cannot be overfilled that way.
 */
export async function updateTask(userId: number, taskId: number, patch: z.infer<typeof taskPatch>): Promise<Task> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Which site (not locked, only to know which row to lock)…
    const { rows: [mine] } = await client.query("SELECT site_id FROM seo_tasks WHERE id=$1 AND user_id=$2", [taskId, userId]);
    if (!mine) throw new TaskError("That task is no longer there.", 404);
    if (patch.status !== undefined) {
      // …then the site's row first, always, for any change of status — the same order addTasks takes its locks in — and
      // only then the task's status as it is NOW. Two requests can no longer both believe there is room.
      await client.query("SELECT id FROM seo_sites WHERE id=$1 FOR UPDATE", [mine.site_id]);
      const { rows: [cur] } = await client.query("SELECT status FROM seo_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE", [taskId, userId]);
      if (!cur) throw new TaskError("That task is no longer there.", 404);
      const opening = (patch.status === "todo" || patch.status === "doing") && cur.status !== "todo" && cur.status !== "doing";
      if (opening) {
        const { rows: [{ n }] } = await client.query(`SELECT count(*)::int n FROM seo_tasks WHERE site_id=$1 AND ${OPEN}`, [mine.site_id]);
        if (n >= MAX_OPEN_TASKS) throw new TaskError(`The plan holds up to ${MAX_OPEN_TASKS} open tasks. Finish or drop one before reopening this.`, 403);
      }
    }
    const { rows: [row] } = await client.query(
      `UPDATE seo_tasks SET
         status = coalesce($3, status),
         done_at = CASE WHEN $3 IS NULL THEN done_at WHEN $3 = 'done' THEN coalesce(done_at, now()) ELSE NULL END,
         note = CASE WHEN $4 THEN $5 ELSE note END,
         title = coalesce($6, title),
         updated_at = now()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [taskId, userId, patch.status ?? null, patch.note !== undefined, patch.note || null, patch.title ?? null]);
    if (!row) throw new TaskError("That task is no longer there.", 404);
    await client.query("COMMIT");
    return toTask(row);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}
export async function deleteTask(userId: number, taskId: number): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM seo_tasks WHERE id=$1 AND user_id=$2", [taskId, userId]);
  return (rowCount ?? 0) > 0;
}
/** Open tasks per site, for the dashboard. */
export async function openTaskCounts(userId: number, siteIds: number[]): Promise<Map<number, number>> {
  if (!siteIds.length) return new Map();
  const { rows } = await pool.query("SELECT site_id, count(*)::int n FROM seo_tasks WHERE user_id=$1 AND site_id = ANY($2::int[]) AND status IN ('todo','doing') GROUP BY site_id", [userId, siteIds]);
  return new Map(rows.map((r: any) => [r.site_id, r.n]));
}
