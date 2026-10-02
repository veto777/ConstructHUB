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
import { createHash } from "node:crypto";
import {
  ISSUE_SEVERITIES, isIssueSeverity, isIssueSource,
  type IssueAdminStatus, type IssueHistoryEntry, type IssueReportStatus, type IssueSeverity, type IssueSource,
  type IssueStatus, type OpsIssue, type OpsIssueRow,
} from "@shared/ops-issues";
import { ensureOpsIssuesSchema, type Queryable } from "./schema";
import { errorFacts, scrubDetail, scrubText } from "./scrub";

export type IssueInput = {
  source: IssueSource;
  /** What makes two occurrences "the same issue" (hashed with the source into the fingerprint). */
  key: string;
  title: string;
  detail?: unknown;
  severity?: IssueSeverity;
};

export function issueFingerprint(source: string, key: string): string {
  return createHash("sha256").update(`${source}\u0000${key}`).digest("hex").slice(0, 32);
}

/** A message or path made stable across occurrences: ids, numbers and addresses become placeholders. */
export function normalizeForKey(text: unknown, max = 200): string {
  return String(text ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A URL path with its variable segments replaced (/api/crm/estimates/:id), no query string. */
export function normalizePath(path: unknown): string {
  const p = String(path ?? "").split(/[?#]/)[0];
  return p.split("/").map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg)) return ":n";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
    if (/@/.test(seg)) return ":email";
    if (/^[0-9a-f]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg)) return ":token";
    return seg.length > 60 ? ":long" : seg;
  }).join("/").slice(0, 200) || "/";
}

/** The identity of an error for a fingerprint: name, normalized message, top frames without line numbers. */
export function errorKey(err: unknown): string {
  if (err instanceof Error) {
    const frames = (err.stack ?? "").split("\n").slice(1, 4)
      .map((l) => l.trim().replace(/:\d+:\d+\)?$/, "").replace(/^at /, "").replace(/\(.*\/(?=[^/]+$)/, "("))
      .join(" < ");
    return `${err.name}|${normalizeForKey(err.message)}|${frames}`;
  }
  return `thrown|${normalizeForKey(typeof err === "object" ? safeJson(err) : String(err))}`;
}

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
  const key = String(input?.key ?? "").slice(0, 1000) || "unkeyed";
  const title = scrubText(String(input?.title ?? "").replace(/\s+/g, " ").trim(), 200) || "Untitled issue";
  return { fingerprint: issueFingerprint(source, key), source, severity, title, detail: scrubDetail(input?.detail ?? {}) };
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
 * queue tick", "email outbox"); the error's identity (name, normalized
 * message, top frames) completes the key.
 */
export function recordFailure(
  source: IssueSource, what: string, err: unknown,
  extra: Record<string, unknown> = {}, severity: IssueSeverity = "error",
): Promise<void> {
  try {
    return recordIssue({
      source, severity,
      key: `${what}|${errorKey(err)}`,
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
  const [{ rows }, { rows: [t] }, { rows: c }] = await Promise.all([
    db.query(`SELECT id, source, severity, title, count, first_seen, last_seen, status, report, branch, inspected_at, claimed_at
                FROM ops_issues ${w} ORDER BY last_seen DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, params),
    db.query(`SELECT count(*)::int n FROM ops_issues ${w}`, params),
    db.query(`SELECT status, count(*)::int n FROM ops_issues GROUP BY status`),
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
 * Claim up to MAX_CLAIM issues for one tower run: new ones (worst severity,
 * then most recent first) and stale claims. One UPDATE … FOR UPDATE SKIP
 * LOCKED: two concurrent runs never get the same issue.
 */
export async function claimIssues(limit = MAX_CLAIM, q?: Queryable): Promise<OpsIssue[]> {
  const db = await defaultPool(q);
  const n = Math.min(Math.max(Math.trunc(limit) || MAX_CLAIM, 1), MAX_CLAIM);
  const { rows } = await db.query(
    `UPDATE ops_issues SET status = 'inspecting', claimed_at = now(), updated_at = now(),
            history = ${appendHistory("history", historyEntry("'claimed'", "'issue desk'"))}
      WHERE id IN (
        SELECT id FROM ops_issues
         WHERE status = 'new' OR (status = 'inspecting' AND claimed_at < now() - interval '${CLAIM_STALE_MINUTES} minutes')
         ORDER BY array_position($2::text[], severity) DESC, last_seen DESC, id
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [n, SEVERITY_ORDER]);
  return rows.map(rowToIssue).sort((a: OpsIssue, b: OpsIssue) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) || b.lastSeen.localeCompare(a.lastSeen));
}

/** What a claim would return, without claiming (the tower's dry run). */
export async function peekNewIssues(limit = MAX_CLAIM, q?: Queryable): Promise<OpsIssue[]> {
  const db = await defaultPool(q);
  const n = Math.min(Math.max(Math.trunc(limit) || MAX_CLAIM, 1), MAX_CLAIM);
  const { rows } = await db.query(
    `SELECT * FROM ops_issues WHERE status = 'new' ORDER BY array_position($2::text[], severity) DESC, last_seen DESC, id LIMIT $1`,
    [n, SEVERITY_ORDER]);
  return rows.map(rowToIssue);
}

export type IssueReportInput = { status: IssueReportStatus; report: string; branch?: string | null };

/** Claude's verdict on a claimed issue. Only an issue in `inspecting` takes one. */
export async function reportIssue(id: number, input: IssueReportInput, q?: Queryable): Promise<{ issue: OpsIssue } | { error: "not_found" | "not_claimed"; status?: IssueStatus }> {
  const db = await defaultPool(q);
  const { rows: [r] } = await db.query(
    `UPDATE ops_issues SET status = $2, report = $3, branch = $4, inspected_at = now(), updated_at = now(),
            history = ${appendHistory("history", historyEntry("$2::text", "'claude'"))}
      WHERE id = $1 AND status = 'inspecting' RETURNING *`,
    [id, input.status, scrubText(input.report, 20_000), input.branch ? scrubText(input.branch, 120) : null]);
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
