/**
 * Action plan: the things a customer decided to do about what the SEO tools found — a keyword to
 * move up, a page to write, a lost link to win back, a site to ask for a link, an audit issue to
 * fix — kept per site with a status and a note. Nothing here costs SEO data.
 * A finding added twice is one task (`source` says where it came from).
 */
import { z } from "zod";
import { pool } from "../db";
import { SeoCustomerError } from "./public-errors";
import { safeHttpUrl } from "./dataforseo";

export const TASK_KINDS = ["keyword", "page", "link_reclaim", "link_prospect", "audit", "other"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_STATUSES = ["todo", "doing", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Tasks not yet done or dropped that one site may hold. */
export const MAX_OPEN_TASKS = 300;
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
  /** Audit tasks: the newest crawl no longer has this issue (it is not marked done for the customer — they decide). */
  resolved?: { on: string | null };
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
/**
 * Which open audit tasks the newest crawl no longer finds. `issueKeys` are the issues that crawl DID find; a task
 * whose issue is not among them is resolved as far as the crawl can see. Pure.
 */
export function markResolved(tasks: Task[], issueKeys: ReadonlySet<string> | null, scannedAt: string | null): Task[] {
  if (!issueKeys) return tasks;
  return tasks.map((t) => (t.kind === "audit" && t.source?.startsWith("audit:") && (t.status === "todo" || t.status === "doing") && !issueKeys.has(t.source.slice(6)) ? { ...t, resolved: { on: scannedAt } } : t));
}

const ORDER = `CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 ELSE 3 END`;
export async function listTasks(userId: number, siteId: number): Promise<Task[]> {
  const { rows } = await pool.query(`SELECT * FROM seo_tasks WHERE site_id=$1 AND user_id=$2 ORDER BY ${ORDER}, coalesce(done_at, created_at) DESC, id DESC LIMIT 600`, [siteId, userId]);
  return rows.map(toTask);
}
/** Add findings to the plan. One that is already there (same source) is left as it is. The limit holds across requests: the site's row is locked for the count and the inserts. */
export async function addTasks(userId: number, siteId: number, tasks: z.infer<typeof taskInput>[]): Promise<{ added: number; already: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [site] } = await client.query("SELECT id FROM seo_sites WHERE id=$1 AND user_id=$2 FOR UPDATE", [siteId, userId]);
    if (!site) throw new TaskError("Site not found", 404);
    const { rows: [{ n }] } = await client.query("SELECT count(*)::int n FROM seo_tasks WHERE site_id=$1 AND status IN ('todo','doing')", [siteId]);
    let added = 0;
    for (const t of tasks) {
      if (n + added >= MAX_OPEN_TASKS) throw new TaskError(`The plan holds up to ${MAX_OPEN_TASKS} open tasks. Finish or drop some first.`, 403);
      const { rowCount } = await client.query(
        `INSERT INTO seo_tasks(user_id, site_id, kind, title, target, detail, source) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (site_id, source) WHERE source IS NOT NULL DO NOTHING`,
        [userId, siteId, t.kind, t.title, t.target, JSON.stringify(t.facts), t.source]);
      added += rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { added, already: tasks.length - added };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}
/** Change a task's status, note or title. Finishing stamps the day; reopening clears it. */
export async function updateTask(userId: number, taskId: number, patch: z.infer<typeof taskPatch>): Promise<Task> {
  const { rows: [row] } = await pool.query(
    `UPDATE seo_tasks SET
       status = coalesce($3, status),
       done_at = CASE WHEN $3 IS NULL THEN done_at WHEN $3 = 'done' THEN coalesce(done_at, now()) ELSE NULL END,
       note = CASE WHEN $4 THEN $5 ELSE note END,
       title = coalesce($6, title),
       updated_at = now()
     WHERE id=$1 AND user_id=$2 RETURNING *`,
    [taskId, userId, patch.status ?? null, patch.note !== undefined, patch.note || null, patch.title ?? null]);
  if (!row) throw new TaskError("That task is no longer there.", 404);
  return toTask(row);
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
