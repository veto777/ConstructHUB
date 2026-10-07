/**
 * The issue desk's capture side (docs/ops/ISSUE-DESK.md).
 *
 *   recordIssue({ source, key, title, detail, severity })
 *
 * upserts one ops_issues row per fingerprint (sha256 of source + key): a
 * repeat bumps `count` and `last_seen`, keeps the worst severity, refreshes
 * the title/detail to the latest occurrence, and reopens a `fixed` issue as
 * `new` (a regression). Detail and title are scrubbed (scrub.ts) before they
 * reach the database.
 *
 * Logging must never break the caller: recordIssue never throws and its
 * promise never rejects. It is rate-limited per fingerprint — at most one
 * write per fingerprint per `minIntervalMs` (repeats in between are counted
 * and folded into one delayed write) — and globally (`maxWritesPerMinute`),
 * so an error storm costs the database a handful of upserts, not thousands.
 *
 * The store functions below (list/get/claim/report/…) back the admin page
 * and the tower's internal API (routes.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import {
  ISSUE_SEVERITIES, isIssueSeverity, isIssueSource,
  type IssueAdminStatus, type IssueHistoryEntry, type IssueReportStatus, type IssueSeverity, type IssueSource,
  type IssueStatus, type OpsIssue, type OpsIssueRow,
} from "@shared/ops-issues";
import { ensureOpsIssuesSchema, NOTIFY_SIG_SQL, type Queryable } from "./schema";
import { failureKey, issueFingerprint } from "./fingerprint";
import { errorFacts, scrubDetail, scrubText } from "./scrub";

export type IssueInput = {
  source: IssueSource;
  /**
   * What makes two occurrences "the same issue" (hashed with the source into
   * the fingerprint): a fixed string, or a function of the scrubbed detail —
   * the form fingerprint.ts uses, so a stored row's key can be recomputed.
   * Never put anything build-specific in it (stack frames, bundle positions,
   * hashed asset names): see fingerprint.ts.
   */
  key: string | ((detail: Record<string, unknown>) => string);
  title: string;
  detail?: unknown;
  severity?: IssueSeverity;
};

export {
  issueFingerprint, normalizeForKey, normalizePath, errorIdentity, failureKey, serverErrorKey, processFailureKey,
  clientErrorKey, stableKeyForRow,
} from "./fingerprint";

const safeJson = (v: unknown) => { try { return JSON.stringify(v); } catch { return "[object]"; } };

/** One line of an error message for a title. */
export function shortMessage(err: unknown, max = 120): string {
  const m = err instanceof Error ? err.message : typeof err === "string" ? err : safeJson(err);
  return scrubText(String(m ?? "").split("\n")[0], max);
}

// ── The recorder ──────────────────────────────────────────────────────────────

type Prepared = { fingerprint: string; source: IssueSource; severity: IssueSeverity; title: string; detail: Record<string, unknown> };
type Slot = { lastWriteAt: number; pending: { rec: Prepared; count: number } | null; timer: ReturnType<typeof setTimeout> | null };

export type IssueRecorder = {
  record: (input: IssueInput) => Promise<void>;
  /** Write every folded-in repeat now (tests; the next tick would do it anyway). */
  flush: () => Promise<void>;
  /** Writes skipped by the global cap since start. */
  readonly dropped: number;
};

export type RecorderOptions = {
  pool?: Queryable;
  /** At most one write per fingerprint per this window (default 60 s). */
  minIntervalMs?: number;
  /** All fingerprints together (default 120). */
  maxWritesPerMinute?: number;
  now?: () => number;
  warn?: (line: string) => void;
};

const SEVERITY_ORDER = ISSUE_SEVERITIES as readonly string[];
const MAX_SLOTS = 2000;

/** SQL that appends one entry to a history column, keeping the last 50. */
const appendHistory = (col: string, entry: string) =>
  `((CASE WHEN jsonb_array_length(${col}) >= 50 THEN ${col} - 0 ELSE ${col} END) || jsonb_build_array(${entry}))`;
/** One timeline entry; `eventSql` / `bySql` are SQL expressions (a quoted literal or a $n parameter). */
const historyEntry = (eventSql: string, bySql?: string) =>
  `jsonb_build_object('at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'event', ${eventSql}${bySql ? `, 'by', ${bySql}` : ""})`;

const UPSERT_SQL = `
  INSERT INTO ops_issues AS i (fingerprint, source, severity, title, detail, count, history, status)
  VALUES ($1, $2, $3, $4, $5::jsonb, $6, jsonb_build_array(${historyEntry("'reported'")}),
          CASE WHEN $2 = 'client' THEN 'triage' ELSE 'new' END)
  ON CONFLICT (fingerprint) DO UPDATE SET
    count = LEAST(i.count::bigint + EXCLUDED.count, 2147483647)::int,
    last_seen = now(),
    updated_at = now(),
    -- a browser report's text is frozen once an admin approved it: a later anonymous post can't rewrite what Claude reads
    title = CASE WHEN i.source = 'client' AND i.status <> 'triage' THEN i.title ELSE EXCLUDED.title END,
    detail = CASE WHEN i.source = 'client' AND i.status <> 'triage' THEN i.detail ELSE EXCLUDED.detail END,
    severity = CASE WHEN array_position($7::text[], EXCLUDED.severity) > array_position($7::text[], i.severity)
                    THEN EXCLUDED.severity ELSE i.severity END,
    status = CASE WHEN i.status = 'fixed' THEN (CASE WHEN i.source = 'client' THEN 'triage' ELSE 'new' END) ELSE i.status END,
    claimed_at = CASE WHEN i.status = 'fixed' THEN NULL ELSE i.claimed_at END,
    history = CASE WHEN i.status = 'fixed' THEN ${appendHistory("i.history", historyEntry("'reopened'"))} ELSE i.history END
  RETURNING id`;

function prepare(input: IssueInput): Prepared {
  const source: IssueSource = isIssueSource(input?.source) ? input.source : "server";
  const severity: IssueSeverity = isIssueSeverity(input?.severity) ? input.severity : "error";
  const detail = scrubDetail(input?.detail ?? {});
  const rawKey = typeof input?.key === "function" ? input.key(detail) : input?.key;
  const key = String(rawKey ?? "").slice(0, 1000) || "unkeyed";
  const title = scrubText(String(input?.title ?? "").replace(/\s+/g, " ").trim(), 200) || "Untitled issue";
  return { fingerprint: issueFingerprint(source, key), source, severity, title, detail };
}

export function createIssueRecorder(opts: RecorderOptions = {}): IssueRecorder {
  const minInterval = Math.max(0, opts.minIntervalMs ?? 60_000);
  const cap = Math.max(1, opts.maxWritesPerMinute ?? 120);
  const clock = opts.now ?? Date.now;
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const slots = new Map<string, Slot>();
  let windowStart = 0;
  let windowWrites = 0;
  let dropped = 0;
  let lastDropWarn = 0;
  let schemaReady: Promise<void> | null = null;

  const poolFor = async (): Promise<Queryable> => opts.pool ?? (await import("../db")).pool;

  async function write(rec: Prepared, count: number): Promise<void> {
    try {
      const q = await poolFor();
      schemaReady ??= ensureOpsIssuesSchema(q).catch((e) => { schemaReady = null; throw e; });
      await schemaReady;
      await q.query(UPSERT_SQL, [rec.fingerprint, rec.source, rec.severity, rec.title, JSON.stringify(rec.detail), count, SEVERITY_ORDER]);
    } catch (e) {
      // Never recurse into recordIssue from here; one short line is all a failed write gets.
      try { warn(`[issues] could not record "${rec.title.slice(0, 80)}": ${scrubText((e as Error)?.message ?? e, 200)}`); } catch { /* nothing */ }
    }
  }

  function takeGlobal(now: number): boolean {
    if (now - windowStart >= 60_000) { windowStart = now; windowWrites = 0; }
    if (windowWrites >= cap) return false;
    windowWrites++;
    return true;
  }

  function flushSlot(fp: string): Promise<void> {
    const slot = slots.get(fp);
    if (!slot) return Promise.resolve();
    if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
    const pending = slot.pending;
    if (!pending) return Promise.resolve();
    slot.pending = null;
    slot.lastWriteAt = clock();
    return write(pending.rec, pending.count);
  }

  function sweep(now: number) {
    if (slots.size <= MAX_SLOTS) return;
    for (const [fp, s] of slots) if (!s.pending && now - s.lastWriteAt >= minInterval) slots.delete(fp);
  }

  function record(input: IssueInput): Promise<void> {
    try {
      const rec = prepare(input);
      const now = clock();
      const slot = slots.get(rec.fingerprint);
      if (slot && minInterval > 0 && now - slot.lastWriteAt < minInterval) {
        // A repeat inside the window: count it, keep the latest detail, write once when the window ends.
        slot.pending = { rec, count: (slot.pending?.count ?? 0) + 1 };
        if (!slot.timer) {
          slot.timer = setTimeout(() => { void flushSlot(rec.fingerprint); }, Math.max(1, slot.lastWriteAt + minInterval - now));
          slot.timer.unref?.();
        }
        return Promise.resolve();
      }
      if (!takeGlobal(now)) {
        dropped++;
        if (now - lastDropWarn > 60_000) { lastDropWarn = now; try { warn(`[issues] write cap reached (${cap}/min); dropping repeats`); } catch { /* nothing */ } }
        return Promise.resolve();
      }
      const fresh: Slot = slot ?? { lastWriteAt: now, pending: null, timer: null };
      fresh.lastWriteAt = now;
      slots.set(rec.fingerprint, fresh);
      sweep(now);
      return write(rec, 1);
    } catch {
      return Promise.resolve();
    }
  }

  return {
    record,
    flush: async () => { await Promise.all([...slots.keys()].map((fp) => flushSlot(fp))); },
    get dropped() { return dropped; },
  };
}

const defaultRecorder = createIssueRecorder();

/** Record (or count again) one issue. Never throws; the promise never rejects. */
export function recordIssue(input: IssueInput): Promise<void> {
  return defaultRecorder.record(input);
}

/**
 * The common case: something threw. `what` names the failing piece ("Agency
 * queue tick", "email outbox"); the error's name and normalized message
 * complete the key, plus orgId / locationId when `extra` carries them
 * (fingerprint.ts failureKey). The stack is stored in the detail, never keyed.
 */
export function recordFailure(
  source: IssueSource, what: string, err: unknown,
  extra: Record<string, unknown> = {}, severity: IssueSeverity = "error",
): Promise<void> {
  try {
    return recordIssue({
      source, severity,
      key: failureKey,
      title: `${what} failed: ${shortMessage(err)}`,
      detail: { what, ...extra, error: errorFacts(err) },
    });
  } catch {
    return Promise.resolve();
  }
}

// ── The store (admin page + internal API) ────────────────────────────────────

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function rowToIssue(r: any): OpsIssue {
  return {
    id: Number(r.id), fingerprint: r.fingerprint, source: r.source, severity: r.severity, title: r.title,
    detail: r.detail ?? {}, count: Number(r.count), firstSeen: iso(r.first_seen)!, lastSeen: iso(r.last_seen)!,
    status: r.status, report: r.report ?? null, branch: r.branch ?? null, inspectedAt: iso(r.inspected_at),
    claimedAt: iso(r.claimed_at), history: Array.isArray(r.history) ? (r.history as IssueHistoryEntry[]) : [],
    reporterUserId: r.reporter_user_id == null ? null : Number(r.reporter_user_id), reporterEmail: r.reporter_email ?? null,
    publicReply: r.public_reply ?? null, publicReplyAt: iso(r.public_reply_at),
  };
}
function rowToListRow(r: any): OpsIssueRow {
  const { detail: _d, history: _h, fingerprint: _f, ...rest } = rowToIssue({ ...r, detail: {}, history: [] });
  return rest;
}

const defaultPool = async (q?: Queryable): Promise<Queryable> => q ?? (await import("../db")).pool;

export type IssueListQuery = { status?: IssueStatus; source?: IssueSource; limit?: number; offset?: number };

export async function listIssues(query: IssueListQuery = {}, q?: Queryable): Promise<{ issues: OpsIssueRow[]; total: number; counts: Record<string, number> }> {
  const db = await defaultPool(q);
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.status) { params.push(query.status); where.push(`status = $${params.length}`); }
  if (query.source) { params.push(query.source); where.push(`source = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  // The status tabs' counts follow the source filter (a tab must not claim
  // more issues than the list below it), but never the status filter — each
  // tab counts its own status, so the counts don't move when one tab is chosen.
  const sourceOnly = query.source ? "WHERE source = $1" : "";
  const [{ rows }, { rows: [t] }, { rows: c }] = await Promise.all([
    db.query(`SELECT id, source, severity, title, count, first_seen, last_seen, status, report, branch, inspected_at, claimed_at,
                     reporter_user_id, reporter_email, public_reply, public_reply_at
                FROM ops_issues ${w} ORDER BY last_seen DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, params),
    db.query(`SELECT count(*)::int n FROM ops_issues ${w}`, params),
    db.query(`SELECT status, count(*)::int n FROM ops_issues ${sourceOnly} GROUP BY status`, query.source ? [query.source] : []),
  ]);
  const counts: Record<string, number> = {};
  for (const r of c) counts[r.status] = r.n;
  return { issues: rows.map(rowToListRow), total: t?.n ?? 0, counts };
}

export async function getIssue(id: number, q?: Queryable): Promise<OpsIssue | null> {
  const db = await defaultPool(q);
  const { rows: [r] } = await db.query(`SELECT * FROM ops_issues WHERE id = $1`, [id]);
  return r ? rowToIssue(r) : null;
}

/** How many issues wait on someone: the sidebar badge (new) and the fixes to review. */
export async function issueSummary(q?: Queryable): Promise<{ new: number; fixReady: number; inspecting: number }> {
  const db = await defaultPool(q);
  const { rows } = await db.query(`SELECT status, count(*)::int n FROM ops_issues WHERE status IN ('new','fix_ready','inspecting') GROUP BY status`);
  const n = (s: string) => rows.find((r: any) => r.status === s)?.n ?? 0;
  return { new: n("new"), fixReady: n("fix_ready"), inspecting: n("inspecting") };
}

/** Mark fixed / Ignore / Re-inspect, from /admin/issues. */
export async function setIssueStatusByAdmin(id: number, status: IssueAdminStatus, by: string, q?: Queryable): Promise<OpsIssue | null> {
  const db = await defaultPool(q);
  const event = status === "new" ? "reinspect" : status;
  const { rows: [r] } = await db.query(
    `UPDATE ops_issues SET status = $2, updated_at = now(),
            claimed_at = CASE WHEN $2 = 'new' THEN NULL ELSE claimed_at END,
            history = ${appendHistory("history", historyEntry("$4::text", "$3::text"))}
      WHERE id = $1 RETURNING *`,
    [id, status, scrubText(by, 80), event]);
  return r ? rowToIssue(r) : null;
}

/** A claim older than this is a run that died; the next run may take the issue again. */
export const CLAIM_STALE_MINUTES = 180;
export const MAX_CLAIM = 10;

/**
 * The order a run takes issues in — and the order Claude is given them:
 *   1. a user's blocker report ("I can't use the site": source user + critical),
 *   2. every other user report, worst first, then the one that has waited longest,
 *   3. everything the app captured itself, worst severity then most recent.
 * A user report is therefore inside the first MAX_CLAIM of every run, ahead of
 * any number of recurring job warnings.
 */
export const DESK_ORDER_SQL = `(source = 'user' AND severity = 'critical') DESC, (source = 'user') DESC,
         array_position($2::text[], severity) DESC,
         (CASE WHEN source = 'user' THEN first_seen END) ASC NULLS LAST, last_seen DESC, id`;

/** DESK_ORDER_SQL for rows already in memory (an UPDATE … RETURNING comes back in no order). */
export function compareForDesk(a: OpsIssue, b: OpsIssue): number {
  const user = (i: OpsIssue) => (i.source === "user" ? 1 : 0);
  const blocker = (i: OpsIssue) => (i.source === "user" && i.severity === "critical" ? 1 : 0);
  return blocker(b) - blocker(a)
    || user(b) - user(a)
    || SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity)
    || (user(a) && user(b) ? a.firstSeen.localeCompare(b.firstSeen) : 0)
    || b.lastSeen.localeCompare(a.lastSeen)
    || a.id - b.id;
}

export type ClaimOptions = { /** Only this source (the over-the-daily-cap run takes user reports only). */ source?: IssueSource };

/**
 * Claim up to MAX_CLAIM issues for one tower run, in DESK_ORDER_SQL order: new
 * ones and stale claims. One UPDATE … FOR UPDATE SKIP LOCKED: two concurrent
 * runs never get the same issue.
 */
export async function claimIssues(limit = MAX_CLAIM, q?: Queryable, opts: ClaimOptions = {}): Promise<OpsIssue[]> {
  const db = await defaultPool(q);
  const n = Math.min(Math.max(Math.trunc(limit) || MAX_CLAIM, 1), MAX_CLAIM);
  const { rows } = await db.query(
    `UPDATE ops_issues SET status = 'inspecting', claimed_at = now(), updated_at = now(),
            history = ${appendHistory("history", historyEntry("'claimed'", "'issue desk'"))}
      WHERE id IN (
        SELECT id FROM ops_issues
         WHERE (status = 'new' OR (status = 'inspecting' AND claimed_at < now() - interval '${CLAIM_STALE_MINUTES} minutes'))
           AND ($3::text IS NULL OR source = $3)
         ORDER BY ${DESK_ORDER_SQL}
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [n, SEVERITY_ORDER, opts.source ?? null]);
  return rows.map(rowToIssue).sort(compareForDesk);
}

/** What a claim would return, without claiming (the tower's dry run, and its "are user reports waiting?" check). */
export async function peekNewIssues(limit = MAX_CLAIM, q?: Queryable, opts: ClaimOptions = {}): Promise<OpsIssue[]> {
  const db = await defaultPool(q);
  const n = Math.min(Math.max(Math.trunc(limit) || MAX_CLAIM, 1), MAX_CLAIM);
  const { rows } = await db.query(
    `SELECT * FROM ops_issues WHERE status = 'new' AND ($3::text IS NULL OR source = $3) ORDER BY ${DESK_ORDER_SQL} LIMIT $1`,
    [n, SEVERITY_ORDER, opts.source ?? null]);
  return rows.map(rowToIssue);
}

export type IssueReportInput = {
  status: IssueReportStatus; report: string; branch?: string | null;
  /** A user report's answer for the person who sent it (plain language, no internals). Ignored for other sources. */
  publicReply?: string | null;
};

/** The reply a reporter reads: short, and scrubbed like everything else stored here. */
export const PUBLIC_REPLY_MAX = 1500;
const cleanReply = (text: unknown): string | null => {
  const t = scrubText(String(text ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(), PUBLIC_REPLY_MAX);
  return t || null;
};

/** Claude's verdict on a claimed issue. Only an issue in `inspecting` takes one. */
export async function reportIssue(id: number, input: IssueReportInput, q?: Queryable): Promise<{ issue: OpsIssue } | { error: "not_found" | "not_claimed"; status?: IssueStatus }> {
  const db = await defaultPool(q);
  const { rows: [r] } = await db.query(
    `UPDATE ops_issues SET status = $2, report = $3, branch = $4, inspected_at = now(), updated_at = now(),
            public_reply = CASE WHEN source = 'user' AND $5::text IS NOT NULL THEN $5 ELSE public_reply END,
            public_reply_at = CASE WHEN source = 'user' AND $5::text IS NOT NULL THEN now() ELSE public_reply_at END,
            history = ${appendHistory("history", historyEntry("$2::text", "'claude'"))}
      WHERE id = $1 AND status = 'inspecting' RETURNING *`,
    [id, input.status, scrubText(input.report, 20_000), input.branch ? scrubText(input.branch, 120) : null, cleanReply(input.publicReply)]);
  if (r) return { issue: rowToIssue(r) };
  const { rows: [cur] } = await db.query(`SELECT status FROM ops_issues WHERE id = $1`, [id]);
  return cur ? { error: "not_claimed", status: cur.status } : { error: "not_found" };
}

/** The issues of one run (for its digest): those of `ids` Claude reported on in the last day. */
export async function reportedIssues(ids: number[], q?: Queryable): Promise<OpsIssue[]> {
  const db = await defaultPool(q);
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT * FROM ops_issues WHERE id = ANY($1::bigint[]) AND inspected_at > now() - interval '1 day'
        AND status IN ('inspected','fix_ready','ignored') ORDER BY id`,
    [ids.slice(0, 50)]);
  return rows.map(rowToIssue);
}

/**
 * Of a run's reported issues, the ones with news for the admins: an issue is
 * announced when what a digest says about it — status, fix branch, the last
 * time it came back (reopened after "fixed", or sent back by an admin) —
 * differs from what they were last told (ops_issues.notified_sig). So: the
 * first verdict on an issue, a verdict that changed, a fix that became ready,
 * a recurrence after "fixed". The same verdict on the same issue again is not news.
 *
 * A user report (source "user") follows the same rule and so is news the first
 * time a run reports on it and at each status change after that; its signature
 * also says whether a reply for the reporter exists (schema.ts NOTIFY_SIG_SQL),
 * so the reply being written is news once. Its blocker bell at submission is
 * separate (digest.ts notifyAdminsOfBlockerReport) and rings once per report.
 */
export async function issuesWithNews(ids: number[], q?: Queryable): Promise<OpsIssue[]> {
  const db = await defaultPool(q);
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT * FROM ops_issues WHERE id = ANY($1::bigint[]) AND inspected_at > now() - interval '1 day'
        AND status IN ('inspected','fix_ready','ignored') AND notified_sig IS DISTINCT FROM ${NOTIFY_SIG_SQL} ORDER BY id`,
    [ids.slice(0, 50)]);
  return rows.map(rowToIssue);
}

/** The admins have been told about these issues as they stand now. */
export async function markAnnounced(ids: number[], q?: Queryable): Promise<void> {
  const db = await defaultPool(q);
  if (!ids.length) return;
  await db.query(`UPDATE ops_issues SET notified_sig = ${NOTIFY_SIG_SQL} WHERE id = ANY($1::bigint[])`, [ids.slice(0, 50)]);
}

// ── User reports (/report-issue → server/ops/user-reports.ts) ─────────────────

export type UserReportInput = {
  title: string;
  severity: IssueSeverity;
  detail: Record<string, unknown>;
  reporterUserId: number | null;
  reporterEmail: string | null;
  /** `triage` holds it for an admin (a signed-out visitor's report); default `new`. */
  status?: "new" | "triage";
};

/**
 * One row per report, always: the fingerprint is random, so two people's
 * reports (or one person's two) are never merged the way captured failures
 * are. A signed-in person's report goes straight to `new` — the next run takes
 * it first (DESK_ORDER_SQL). A signed-out visitor's is anonymous internet text:
 * it waits in `triage`, which no run claims, until a platform admin sends it on.
 * Unlike recordIssue this throws on failure: the reporter is told the truth.
 */
export async function createUserReport(input: UserReportInput, q?: Queryable): Promise<OpsIssue> {
  const db = await defaultPool(q);
  const title = scrubText(String(input.title ?? "").replace(/\s+/g, " ").trim(), 200) || "User report";
  const { rows: [r] } = await db.query(
    `INSERT INTO ops_issues (fingerprint, source, severity, title, detail, status, history, reporter_user_id, reporter_email)
     VALUES ($1, 'user', $2, $3, $4::jsonb, $7, jsonb_build_array(${historyEntry("'reported'", "'user'")}), $5, $6)
     RETURNING *`,
    [issueFingerprint("user", randomUUID()), isIssueSeverity(input.severity) ? input.severity : "error", title,
     JSON.stringify(scrubDetail(input.detail ?? {})), input.reporterUserId, input.reporterEmail ? String(input.reporterEmail).slice(0, 254) : null,
     input.status === "triage" ? "triage" : "new"]);
  return rowToIssue(r);
}

/** The signed-in person's own reports, newest first. Tenant-safe by construction: the only filter is their user id. */
export async function listUserReports(userId: number, q?: Queryable, limit = 50): Promise<OpsIssue[]> {
  const db = await defaultPool(q);
  const { rows } = await db.query(
    `SELECT * FROM ops_issues WHERE source = 'user' AND reporter_user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, Math.min(Math.max(Math.trunc(limit) || 50, 1), 100)]);
  return rows.map(rowToIssue);
}

/** How many times a user report may go back to the front of the queue before it is filed for a person instead. */
export const MAX_RELEASES = 3;

/**
 * A run ended before Claude reported on a claimed user report: back to `new`
 * (the reporter keeps reading "Received") and first in the next run. After
 * MAX_RELEASES the report itself may be what ends runs: the tower then files
 * it as inspected with a note, for an admin.
 */
export async function releaseUserReport(id: number, why: string, q?: Queryable): Promise<{ issue: OpsIssue } | { error: "not_found" | "not_claimed" | "not_user_report" | "too_many"; status?: IssueStatus }> {
  const db = await defaultPool(q);
  const { rows: [r] } = await db.query(
    `UPDATE ops_issues SET status = 'new', claimed_at = NULL, updated_at = now(),
            history = ${appendHistory("history", historyEntry("'released'", "$2::text"))}
      WHERE id = $1 AND source = 'user' AND status = 'inspecting'
        AND (SELECT count(*) FROM jsonb_array_elements(history) h WHERE h->>'event' = 'released') < ${MAX_RELEASES}
      RETURNING *`,
    [id, scrubText(why, 80) || "issue desk"]);
  if (r) return { issue: rowToIssue(r) };
  const { rows: [cur] } = await db.query(`SELECT status, source FROM ops_issues WHERE id = $1`, [id]);
  if (!cur) return { error: "not_found" };
  if (cur.source !== "user") return { error: "not_user_report", status: cur.status };
  return cur.status === "inspecting" ? { error: "too_many", status: cur.status } : { error: "not_claimed", status: cur.status };
}

/**
 * The tower skipped a run for its daily cap while user reports wait: each one
 * is marked (once in a row) so the skip is on its timeline, never silent.
 * They stay `new` and are first in the next run.
 */
export async function deferUserReports(why: string, q?: Queryable): Promise<number[]> {
  const db = await defaultPool(q);
  const { rows } = await db.query(
    `UPDATE ops_issues SET updated_at = now(), history = ${appendHistory("history", historyEntry("'deferred'", "$1::text"))}
      WHERE source = 'user' AND status = 'new' AND COALESCE(history->-1->>'event', '') <> 'deferred'
      RETURNING id`,
    [scrubText(why, 80) || "daily cap"]);
  return rows.map((r: any) => Number(r.id)).sort((a: number, b: number) => a - b);
}

/** An admin's (or a corrected) reply to the reporter. User reports only. */
export async function setPublicReply(id: number, reply: string, by: string, q?: Queryable): Promise<{ issue: OpsIssue } | { error: "not_found" | "not_user_report" }> {
  const db = await defaultPool(q);
  const { rows: [r] } = await db.query(
    `UPDATE ops_issues SET public_reply = $2, public_reply_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, updated_at = now(),
            history = ${appendHistory("history", historyEntry("'public_reply'", "$3::text"))}
      WHERE id = $1 AND source = 'user' RETURNING *`,
    [id, cleanReply(reply), scrubText(by, 80)]);
  if (r) return { issue: rowToIssue(r) };
  const { rows: [cur] } = await db.query(`SELECT 1 FROM ops_issues WHERE id = $1`, [id]);
  return { error: cur ? "not_user_report" : "not_found" };
}
