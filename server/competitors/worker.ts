import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { recordFailure } from "../ops/issues";
import * as store from "./store";
import {
  executeCompetitorScan,
  ScanFailedError,
  ScanLostError,
  defaultExecuteDeps,
  type ExecuteDeps,
} from "./scan";

/** The scan card's copy when the results could not be written (the raw driver error is recorded for ops). */
export const SAVE_FAILED = "Couldn't save the scan results. Run the scan again — it has not counted against your monthly limit.";

/**
 * Durable Competitor Intel execution (COMP-1, round 2). A scan is a database
 * row with a lease: this process or the next one always finishes it, and the
 * monthly quota settles exactly once either way:
 *   - enqueue persists the route's reservation on the row (no second reserve, ever);
 *   - completion leaves the charge in place;
 *   - failure, cancel, or an exhausted interruption refunds through a
 *     compare-and-swap on the row, so a restart between "failed" and "refunded"
 *     is settled by the next sweep — never double, never lost.
 */
export const LEASE_MS = 2 * 60_000;
export const HEARTBEAT_MS = 30_000;
export const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 15 * 60_000;
/** Delay before the next try after `attempts` tries: 30 s, 60 s, capped at 15 min. */
export const retryDelayMs = (attempts: number) =>
  Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

export type Clock = { now: () => Date };
export const systemClock: Clock = { now: () => new Date() };

/**
 * Take over the queue: fail scans out of tries whose worker died, requeue the
 * rest with a backoff, and settle any terminal scan whose refund a crash
 * interrupted. Runs at worker start and before every claim.
 */
export async function recoverCompetitorScans(now: Date): Promise<{ failed: number; requeued: number; refunded: number }> {
  const { failed, requeued } = await store.sweepStuckScans(now, MAX_ATTEMPTS, retryDelayMs);
  const refunded = await store.refundUnsettledTerminalScans();
  return { failed: failed.length, requeued: requeued.length, refunded };
}

export type WorkerDeps = {
  clock?: Clock;
  /** Tests: no heartbeat timer. */
  heartbeat?: boolean;
  exec?: Partial<ExecuteDeps>;
};

export async function runCompetitorWorker(deps: WorkerDeps = {}): Promise<void> {
  const clock = deps.clock ?? systemClock;
  const now = () => clock.now();
  await recoverCompetitorScans(now());
  const token = randomUUID();
  const job = await store.claimNextScan(token, new Date(now().getTime() + LEASE_MS), now(), MAX_ATTEMPTS);
  if (!job) return;
  await runClaimedScan(job, token, deps);
}

/**
 * One claimed scan, run to a settled end under its lease `token`: listings
 * indexed and the scan completed, or released for a retry, or failed and
 * refunded. Exported so the Postgres integration test can drive the worker's
 * real execution on a row it leased itself (other processes' workers share
 * the lane DB's queue).
 */
export async function runClaimedScan(job: store.ScanRow, token: string, deps: WorkerDeps = {}): Promise<void> {
  const clock = deps.clock ?? systemClock;
  const now = () => clock.now();
  let heartbeat: NodeJS.Timeout | null = null;
  if (deps.heartbeat !== false) {
    heartbeat = setInterval(() => {
      void store.heartbeatScan(job.id, token, new Date(clock.now().getTime() + LEASE_MS)).catch(() => {});
    }, HEARTBEAT_MS);
    heartbeat.unref();
  }
  try {
    // A resumed run re-indexes from a clean slate; each listing keeps the
    // first-seen date an earlier attempt established, so NEW badges are not
    // revived by the re-write.
    let firstSeen = new Map<string, Date>();
    if (job.attempts > 1) {
      firstSeen = await store.firstSeenByPlace(job.id);
      if (!(await store.clearListings(job.id, token))) return; // lease already gone: someone else owns this row now
    }
    const exec: ExecuteDeps = { ...defaultExecuteDeps(), ...deps.exec };
    const { totalFound } = await executeCompetitorScan(job, exec, {
      isLive: () => store.isLive(job.id, token),
      note: (f) => store.noteProgress(job.id, token, f),
      // Lease-conditional: a write after a cancel/delete/takeover lands nothing and stops the run.
      insert: async (l) => { if (!(await store.insertListing(job.id, job.user_id, token, l, now()))) throw new ScanLostError(); },
      // A place this scan has not seen before is first seen now (the column is NOT NULL; an explicit NULL skips its default).
      firstSeenFor: (placeId) => firstSeen.get(placeId) ?? now(),
    });
    // False when the scan was cancelled/deleted mid-run: nothing to settle here
    // (cancel refunded it; a deleted row is gone).
    await store.completeScan(job.id, token, totalFound, now());
  } catch (e) {
    if (e instanceof ScanLostError) return;
    let err: ScanFailedError;
    if (e instanceof ScanFailedError) err = e;
    else {
      // Not a provider failure (classify maps those): a database/driver error
      // while saving. The raw message goes to ops, never onto the scan card.
      void recordFailure("job", "Competitor Intel scan save", e);
      err = new ScanFailedError(SAVE_FAILED, true);
    }
    if (err.retryable && job.attempts < MAX_ATTEMPTS) {
      await store.releaseScan(job.id, token, new Date(now().getTime() + retryDelayMs(job.attempts)));
    } else {
      // Terminal failure is never charged: fail, drop partial listings and
      // refund in one transaction under our lease (exactly once, by the row's CAS).
      await store.failScanAndSettle(job.id, token, err.message || "Provider request failed.", now());
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

export type EnqueueParams = { industry: string; location: string; lat: string | null; lon: string | null; radius: number };

/**
 * Queue a scan durably (POST /api/competitors/scans body once Lane 1 routes it
 * here). The caller's reservation is persisted on the row — retries settle
 * against it instead of reserving again.
 */
export async function enqueueCompetitorScan(
  userId: number,
  params: EnqueueParams,
  reservation: { key: string; remaining: number } | undefined,
  now: Date,
) {
  const row = await store.enqueueScan(userId, params, { key: reservation?.key || null, amount: reservation?.remaining ?? 0 }, now);
  return store.toApiScan(row);
}

/** Stop an active scan, keep its card and partial findings, refund its month. */
export async function cancelCompetitorScan(userId: number, scanId: number, now: Date): Promise<{ ok: true } | { status: number; message: string }> {
  const outcome = await store.cancelActiveScan(userId, scanId, now);
  if (outcome === "cancelled") return { ok: true };
  return outcome === "missing"
    ? { status: 404, message: "Scan not found" }
    : { status: 409, message: "This scan has already finished." };
}

/**
 * DELETE's durable body: one transaction that verifies ownership under a row
 * lock before touching anything, cancels an active scan, settles its
 * reservation, and removes listings and scan. A foreign id changes nothing.
 */
export async function removeCompetitorScan(userId: number, scanId: number, _now: Date): Promise<boolean> {
  return store.deleteOwnedScan(userId, scanId);
}

/**
 * The Competitor Intel worker tick. Lane 1 registers this next to the other
 * workers (see HANDOFF): `startCompetitorWorker()` after
 * `await ensureCompetitorWorkerSchema()`.
 */
export function startCompetitorWorker(tickMs = 2_000): NodeJS.Timeout | null {
  if (process.env.COMPETITOR_WORKER_DISABLED === "true") return null;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runCompetitorWorker();
    } catch (e) {
      console.error("Competitor worker tick failed");
      void recordFailure("job", "Competitor Intel worker tick", e);
    } finally {
      busy = false;
    }
  }, tickMs);
  timer.unref();
  return timer;
}
