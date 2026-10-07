/**
 * The one-time fold of duplicate issues (docs/ops/ISSUE-DESK.md → Fingerprints).
 *
 * Until 2026-10-07 a thrown failure's fingerprint included its top stack
 * frames, and the server ships minified — `at wlt (dist/index.cjs:2938:27264)`
 * names a different function at a different position after every build. So
 * each deploy recorded every recurring failure as a NEW issue, the tower
 * inspected it again, and the admins' bell said so again.
 *
 * mergeDuplicateIssues recomputes every row's key the way fingerprint.ts does
 * now (from its stored detail) and, per new fingerprint:
 *   - keeps the OLDEST row (first_seen, then id) — its id stays valid;
 *   - sums `count`, takes the earliest first_seen and the latest last_seen,
 *     the worst severity, and the title/detail of the latest occurrence
 *     (a browser report an admin approved keeps its approved text);
 *   - keeps the most advanced status — triage < new < inspecting < inspected
 *     < fix_ready < ignored < fixed — with one honest exception: "fixed" only
 *     counts when nothing was seen after it (a duplicate that kept happening
 *     after the fix means it is not fixed), together with that row's report,
 *     branch, inspected_at and claimed_at; a report found on another duplicate
 *     is kept when the chosen row has none;
 *   - appends one history line ("merged", with the folded row ids);
 *   - deletes the other rows.
 * A row that is alone under its new fingerprint just gets the new fingerprint.
 * Rows whose key never came from their detail (fixed keys) are left alone.
 *
 * Idempotent: once folded, every row already carries its recomputed
 * fingerprint and the next call changes nothing. Boot runs it after the schema
 * is ensured (server/routes.ts); `npx tsx scripts/merge-ops-issues.ts [--dry-run]`
 * runs it by hand. One transaction with the table locked against writers, so
 * a failure the app records meanwhile waits a moment and then upserts into the
 * merged row.
 */
import { ISSUE_SEVERITIES, type IssueStatus } from "@shared/ops-issues";
import { issueFingerprint, stableKeyForRow } from "./fingerprint";
import { NOTIFY_SIG_SQL, type Queryable } from "./schema";

type Row = {
  id: string | number; fingerprint: string; source: string; severity: string; title: string; detail: unknown;
  count: number; first_seen: Date; last_seen: Date; status: IssueStatus; report: string | null; branch: string | null;
  inspected_at: Date | null; claimed_at: Date | null; history: unknown; notified_sig: string | null;
};

export type MergeGroup = { fingerprint: string; keep: number; folded: number[]; status: IssueStatus; count: number };
export type MergeResult = {
  /** Rows read. */
  scanned: number;
  /** Rows deleted into an older row. */
  folded: number;
  /** Rows that only took their new fingerprint (no duplicate). */
  rekeyed: number;
  groups: MergeGroup[];
  dryRun: boolean;
};

const STATUS_RANK: Record<IssueStatus, number> = { triage: 0, new: 1, inspecting: 2, inspected: 3, fix_ready: 4, ignored: 5, fixed: 6 };
const SEVERITY_ORDER = ISSUE_SEVERITIES as readonly string[];
const ms = (d: Date | null) => (d ? new Date(d).getTime() : 0);
const num = (v: string | number) => Number(v);

/** The row whose status (and report) the merged issue takes. */
export function statusSource<T extends Pick<Row, "status" | "last_seen" | "inspected_at" | "id">>(rows: T[]): T {
  const latest = Math.max(...rows.map((r) => ms(r.last_seen)));
  // "fixed" stands only if no duplicate was seen after that row: otherwise it came back.
  const eligible = rows.filter((r) => r.status !== "fixed" || ms(r.last_seen) >= latest);
  return [...(eligible.length ? eligible : rows)].sort((a, b) =>
    STATUS_RANK[b.status] - STATUS_RANK[a.status] || ms(b.inspected_at) - ms(a.inspected_at) || ms(b.last_seen) - ms(a.last_seen) || num(a.id) - num(b.id))[0];
}

type Plan = { fingerprint: string; keep: Row; fold: Row[]; set: Record<string, unknown> | null };

/** What to do with these rows — pure, so the rules are unit-tested without a database. */
export function planMerge(rows: Row[], nowIso = new Date().toISOString()): Plan[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = stableKeyForRow(r.source, r.detail);
    // A row with a fixed key keeps its fingerprint — and still claims it, so no rekeyed row can collide with it.
    const fp = key === null ? r.fingerprint : issueFingerprint(r.source, key);
    const g = groups.get(fp);
    if (g) g.push(r); else groups.set(fp, [r]);
  }
  const plans: Plan[] = [];
  for (const [fingerprint, group] of groups) {
    group.sort((a, b) => ms(a.first_seen) - ms(b.first_seen) || num(a.id) - num(b.id));
    const [keep, ...fold] = group;
    if (!fold.length) {
      if (keep.fingerprint !== fingerprint) plans.push({ fingerprint, keep, fold, set: null });
      continue;
    }
    const src = statusSource(group);
    const latest = [...group].sort((a, b) => ms(b.last_seen) - ms(a.last_seen) || num(b.id) - num(a.id))[0];
    // An approved browser report keeps the text the admin approved (issues.ts UPSERT_SQL does the same).
    const text = keep.source === "client" && src.status !== "triage" ? src : latest;
    const reported = src.report ? src : [...group].filter((r) => r.report).sort((a, b) => ms(b.inspected_at) - ms(a.inspected_at))[0] ?? src;
    const history = [
      ...(Array.isArray(keep.history) ? keep.history : []),
      {
        at: nowIso, event: "merged", by: "issue desk",
        note: `Folded in ${fold.length === 1 ? "issue" : "issues"} ${fold.map((r) => `#${r.id}`).join(", ")}: the same failure, recorded again after a deploy.`,
      },
    ].slice(-50);
    plans.push({
      fingerprint, keep, fold,
      set: {
        count: Math.min(group.reduce((n, r) => n + Number(r.count || 0), 0), 2147483647),
        first_seen: new Date(Math.min(...group.map((r) => ms(r.first_seen)))),
        last_seen: new Date(Math.max(...group.map((r) => ms(r.last_seen)))),
        severity: group.map((r) => r.severity).sort((a, b) => SEVERITY_ORDER.indexOf(b) - SEVERITY_ORDER.indexOf(a))[0],
        title: text.title, detail: JSON.stringify(text.detail ?? {}),
        status: src.status, claimed_at: src.claimed_at,
        report: reported.report, branch: src.branch ?? reported.branch, inspected_at: src.inspected_at ?? reported.inspected_at,
        // The admins were told about this issue if they were told about the row its status comes from.
        notified_sig: src.notified_sig ?? keep.notified_sig,
        history: JSON.stringify(history),
      },
    });
  }
  return plans;
}

type Client = Queryable & { release?: () => void };
type Connectable = Queryable & { connect?: () => Promise<Client> };

export async function mergeDuplicateIssues(q?: Connectable, opts: { dryRun?: boolean } = {}): Promise<MergeResult> {
  const pool: Connectable = q ?? (await import("../db")).pool;
  const dryRun = !!opts.dryRun;
  // A transaction needs one connection; a bare Queryable (a client the caller already holds) is used as it is.
  const client: Client = typeof pool.connect === "function" ? await pool.connect() : pool;
  try {
    await client.query("BEGIN");
    if (!dryRun) await client.query("LOCK TABLE ops_issues IN SHARE ROW EXCLUSIVE MODE");
    const { rows } = await client.query(
      `SELECT id, fingerprint, source, severity, title, detail, count, first_seen, last_seen, status, report, branch,
              inspected_at, claimed_at, history, notified_sig FROM ops_issues ORDER BY id`);
    const plans = planMerge(rows as Row[]);
    const result: MergeResult = {
      scanned: rows.length, dryRun,
      folded: plans.reduce((n, p) => n + p.fold.length, 0),
      rekeyed: plans.filter((p) => !p.fold.length).length,
      groups: plans.filter((p) => p.fold.length).map((p) => ({
        fingerprint: p.fingerprint, keep: num(p.keep.id), folded: p.fold.map((r) => num(r.id)),
        status: p.set!.status as IssueStatus, count: p.set!.count as number,
      })),
    };
    if (!dryRun) {
      // Deletes first: a duplicate may already hold the fingerprint its keeper is about to take.
      const gone = plans.flatMap((p) => p.fold.map((r) => r.id));
      if (gone.length) await client.query(`DELETE FROM ops_issues WHERE id = ANY($1::bigint[])`, [gone]);
      // Two passes over the fingerprints: a keeper's new fingerprint can be the OLD one of a row that is
      // itself being rekeyed, so park every changing row on a placeholder first.
      const moving = plans.filter((p) => p.keep.fingerprint !== p.fingerprint);
      for (const p of moving) await client.query(`UPDATE ops_issues SET fingerprint = $2 WHERE id = $1`, [p.keep.id, `moving:${p.keep.id}`]);
      for (const p of plans) {
        if (p.set) {
          const s = p.set;
          await client.query(
            `UPDATE ops_issues SET fingerprint = $2, count = $3, first_seen = $4, last_seen = $5, severity = $6, title = $7,
                    detail = $8::jsonb, status = $9, claimed_at = $10, report = $11, branch = $12, inspected_at = $13,
                    notified_sig = $14, history = $15::jsonb, updated_at = now()
              WHERE id = $1`,
            [p.keep.id, p.fingerprint, s.count, s.first_seen, s.last_seen, s.severity, s.title, s.detail, s.status, s.claimed_at,
              s.report, s.branch, s.inspected_at, s.notified_sig, s.history]);
          // Told before → still told: restate it over the merged status and history, so the merge announces nothing.
          if (s.notified_sig !== null && s.notified_sig !== undefined) {
            await client.query(`UPDATE ops_issues SET notified_sig = ${NOTIFY_SIG_SQL} WHERE id = $1`, [p.keep.id]);
          }
        } else {
          await client.query(`UPDATE ops_issues SET fingerprint = $2 WHERE id = $1`, [p.keep.id, p.fingerprint]);
        }
      }
    }
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* the connection is gone */ }
    throw e;
  } finally {
    client.release?.();
  }
}
