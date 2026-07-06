/**
 * LSA dispute engine — MULTI-TENANT.
 *
 * Disputes stay FULLY MANUAL: the owner picks the bad leads and the reason; we
 * never fabricate a dispute. Mechanics ported verbatim from the authoritative
 * single-tenant bundle, with two changes:
 *   1. Every DB read/write is scoped by user_id (tenant isolation).
 *   2. The spaced send queue is PER-ACCOUNT (keyed by customerId) so different
 *      tenants/accounts dispute in parallel while each account still spaces its
 *      own sends 30–60s apart (anti-bot-pattern).
 */
import { adsPost, getAccessToken, clearAccessToken } from "./client";
import { getConnectionByUserId, loginCidFor } from "./store";
import { db } from "../db";
import { lsaLeads } from "@shared/schema";
import { and, or, eq, isNull, inArray, lte } from "drizzle-orm";

// Google's SurveyAnswer enum only has two usable values (UNSPECIFIED/UNKNOWN are
// return-only). 👍 Good = SATISFIED, 👎 Bad = DISSATISFIED.
const SURVEY_ANSWERS = new Set(["SATISFIED", "DISSATISFIED"]);

// Valid SurveyDissatisfiedReason enum values per the official v22 reference
// (LocalServicesLeadSurveyDissatisfiedReasonEnum). OTHER_DISSATISFIED_REASON is
// omitted because Google requires a free-form otherReasonComment when selected.
// Sending a value outside this set gets an atomic INVALID_ARGUMENT reject.
export const DISSATISFIED_REASONS = new Set([
  "DUPLICATE",
  "GEO_MISMATCH",
  "JOB_TYPE_MISMATCH",
  "NOT_READY_TO_BOOK",
  "SOLICITATION",
  "SPAM",
]);

/**
 * Send the owner's rating for a single LSA lead to Google
 * (LocalServicesLeadService.ProvideLeadFeedback). A DISSATISFIED answer with a
 * nested reason is how a bad lead is flagged for a billing credit/dispute.
 * Scoped to the owning user — a lead can only ever be rated by its owner.
 */
export async function provideLeadFeedback(
  userId: number,
  leadId: string,
  surveyAnswer: string,
  dissatisfiedReason?: string | null,
  opts?: { fromQueue?: boolean },
): Promise<any> {
  const answer = String(surveyAnswer || "").toUpperCase();
  if (!SURVEY_ANSWERS.has(answer)) {
    throw new Error(`Invalid rating "${surveyAnswer}".`);
  }
  const id = String(leadId).replace(/\D/g, "");
  const rows = await db
    .select()
    .from(lsaLeads)
    .where(and(eq(lsaLeads.leadId, id), eq(lsaLeads.userId, userId)));
  const row = rows[0];
  if (!row) throw new Error("That lead isn't in the system yet — try Sync now first.");

  // Authoritative anti-double-dispute guard. Google itself is the source of truth
  // (feedbackSubmitted), so never re-rate a lead it already has feedback for.
  if (row.feedbackSubmitted === true) {
    throw new Error("This lead has already been rated.");
  }
  if (!opts?.fromQueue) {
    const s = row.disputeStatus || "";
    if (s === "queued" || s === "sending") throw new Error("This lead is already queued for a dispute.");
    if (s === "disputed") throw new Error("This lead has already been disputed.");
  }
  const cid = (row.customerId || "").replace(/\D/g, "");
  if (!cid) throw new Error("This lead has no Google account id on file.");

  const conn = await getConnectionByUserId(userId);
  if (!conn?.refreshToken) throw new Error("Google Ads isn't connected for this account.");
  const loginCid = (await loginCidFor(userId, cid)) || cid;

  const body: Record<string, unknown> = { surveyAnswer: answer };
  const reason = dissatisfiedReason ? String(dissatisfiedReason).toUpperCase() : null;
  if (answer === "DISSATISFIED") {
    if (!reason) throw new Error("Pick a reason when rating a lead as bad.");
    if (!DISSATISFIED_REASONS.has(reason)) throw new Error(`Invalid reason "${dissatisfiedReason}".`);
    // survey_details is REQUIRED for DISSATISFIED and the reason must be nested
    // under surveyDissatisfied (oneof member of survey_details).
    body.surveyDissatisfied = { surveyDissatisfiedReason: reason };
  }

  let res: any;
  try {
    res = await adsPost(
      conn.refreshToken,
      cid,
      `customers/${cid}/localServicesLeads/${id}:provideLeadFeedback`,
      body,
      loginCid,
    );
  } catch (e) {
    clearAccessToken(conn.refreshToken);
    throw e;
  }

  await db
    .update(lsaLeads)
    .set({
      feedbackSubmitted: true,
      surveyAnswer: answer,
      disputeReason: reason,
      disputeStatus: answer === "DISSATISFIED" ? "disputed" : null,
    })
    .where(and(eq(lsaLeads.leadId, id), eq(lsaLeads.userId, userId)));

  return res;
}

// ---------------------------------------------------------------------------
// Per-account spaced dispute queue
// ---------------------------------------------------------------------------
// Disputing many leads in a tight burst looks like bot abuse to Google. Each
// account sends its disputes ONE AT A TIME with a randomized 30–60s gap. Queues
// are keyed by customerId so different accounts run concurrently.
type QueueItem = { userId: number; customerId: string; leadId: string; reason: string; runAt: number };
const queues = new Map<string, QueueItem[]>();
const runningAccounts = new Set<string>();

// 30s–60s. `used` enforces that no two gaps in the same batch are identical.
function randomGapMs(used?: Set<number>): number {
  let gap = Math.round(30000 + Math.random() * 30000);
  if (used) {
    let guard = 0;
    while (used.has(gap) && guard++ < 50) gap = Math.round(30000 + Math.random() * 30000);
    used.add(gap);
  }
  return gap;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startRunner(customerId: string): void {
  if (runningAccounts.has(customerId)) return;
  runningAccounts.add(customerId);
  void (async () => {
    try {
      const q = queues.get(customerId);
      while (q && q.length > 0) {
        const item = q[0];
        const wait = item.runAt - Date.now();
        if (wait > 0) await sleep(wait);
        q.shift();
        try {
          await db
            .update(lsaLeads)
            .set({ disputeStatus: "sending" })
            .where(and(eq(lsaLeads.leadId, item.leadId), eq(lsaLeads.userId, item.userId)));
          await provideLeadFeedback(item.userId, item.leadId, "DISSATISFIED", item.reason, { fromQueue: true });
        } catch (e) {
          await db
            .update(lsaLeads)
            .set({ disputeStatus: "failed" })
            .where(and(eq(lsaLeads.leadId, item.leadId), eq(lsaLeads.userId, item.userId)))
            .catch(() => {});
          console.error(`Dispute failed for lead ${item.leadId}:`, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      runningAccounts.delete(customerId);
      // Drain anything queued while we were finishing up.
      const q = queues.get(customerId);
      if (q && q.length > 0) startRunner(customerId);
    }
  })();
}

/** Push claimed items onto their account queues with per-account spacing. */
function enqueueClaimed(items: QueueItem[]): void {
  const byCustomer = new Map<string, QueueItem[]>();
  for (const it of items) {
    (byCustomer.get(it.customerId) ?? byCustomer.set(it.customerId, []).get(it.customerId)!).push(it);
  }
  for (const [customerId, group] of Array.from(byCustomer)) {
    const q = queues.get(customerId) ?? [];
    let cursor = Math.max(Date.now(), q.length ? q[q.length - 1].runAt : 0);
    const usedGaps = new Set<number>();
    for (const it of group) {
      cursor += randomGapMs(usedGaps);
      q.push({ ...it, runAt: cursor });
    }
    queues.set(customerId, q);
    startRunner(customerId);
  }
}

/** Queue a batch of "bad lead" disputes (manual). Scoped to the owner. */
export async function enqueueDisputes(
  userId: number,
  items: { leadId: string; reason: string }[],
): Promise<{ queued: number }> {
  if (!Array.isArray(items) || items.length === 0) throw new Error("No leads to dispute.");
  const seen = new Set<string>();
  const cleaned: { leadId: string; reason: string }[] = [];
  for (const it of items) {
    const leadId = String(it.leadId || "").replace(/\D/g, "");
    const reason = String(it.reason || "").toUpperCase();
    if (!leadId) throw new Error("A selected lead has no id.");
    if (!DISSATISFIED_REASONS.has(reason)) throw new Error(`Invalid reason "${it.reason}".`);
    if (seen.has(leadId)) continue;
    seen.add(leadId);
    cleaned.push({ leadId, reason });
  }

  // Atomically CLAIM each lead with a conditional update (charged-only,
  // not-already-rated, free pipeline state), scoped to this user. `.returning()`
  // closes the read-then-write race so a lead can never be double-queued.
  const claimedItems: QueueItem[] = [];
  for (const c of cleaned) {
    const claimed = await db
      .update(lsaLeads)
      .set({ disputeStatus: "queued", disputeReason: c.reason })
      .where(
        and(
          eq(lsaLeads.leadId, c.leadId),
          eq(lsaLeads.userId, userId),
          eq(lsaLeads.leadCharged, true),
          or(isNull(lsaLeads.feedbackSubmitted), eq(lsaLeads.feedbackSubmitted, false)),
          or(
            isNull(lsaLeads.disputeStatus),
            eq(lsaLeads.disputeStatus, "failed"),
            eq(lsaLeads.disputeStatus, "scheduled"),
          ),
        ),
      )
      .returning({ leadId: lsaLeads.leadId, customerId: lsaLeads.customerId });
    if (claimed.length === 0) continue;
    claimedItems.push({
      userId,
      customerId: (claimed[0].customerId || "").replace(/\D/g, ""),
      leadId: c.leadId,
      reason: c.reason,
      runAt: 0,
    });
  }

  if (claimedItems.length === 0) throw new Error("Those leads are already disputed or in progress.");
  enqueueClaimed(claimedItems);
  return { queued: claimedItems.length };
}

/** Schedule a batch of disputes for future moments (scoped to the owner). */
export async function scheduleDisputes(
  userId: number,
  items: { leadId: string; reason: string; runAt: number }[],
): Promise<{ scheduled: number; skipped: number }> {
  if (!Array.isArray(items) || items.length === 0) throw new Error("No leads to schedule.");
  const seen = new Set<string>();
  const cleaned: { leadId: string; reason: string; runAt: number }[] = [];
  for (const it of items) {
    const leadId = String(it.leadId || "").replace(/\D/g, "");
    const reason = String(it.reason || "").toUpperCase();
    const runAt = Number(it.runAt);
    if (!leadId) throw new Error("A selected lead has no id.");
    if (!DISSATISFIED_REASONS.has(reason)) throw new Error(`Invalid reason "${it.reason}".`);
    if (!Number.isFinite(runAt) || runAt <= 0) throw new Error("A selected lead has no valid date.");
    if (seen.has(leadId)) continue;
    seen.add(leadId);
    cleaned.push({ leadId, reason, runAt });
  }

  let scheduled = 0;
  for (const c of cleaned) {
    const claimed = await db
      .update(lsaLeads)
      .set({ disputeStatus: "scheduled", disputeReason: c.reason, disputeScheduledAt: new Date(c.runAt) })
      .where(
        and(
          eq(lsaLeads.leadId, c.leadId),
          eq(lsaLeads.userId, userId),
          eq(lsaLeads.leadCharged, true),
          or(isNull(lsaLeads.feedbackSubmitted), eq(lsaLeads.feedbackSubmitted, false)),
          or(
            isNull(lsaLeads.disputeStatus),
            eq(lsaLeads.disputeStatus, "failed"),
            eq(lsaLeads.disputeStatus, "scheduled"),
          ),
        ),
      )
      .returning({ leadId: lsaLeads.leadId });
    if (claimed.length === 0) continue;
    scheduled++;
  }

  if (scheduled === 0) {
    throw new Error("Those leads can't be scheduled (already disputed, in progress, or uncharged).");
  }
  return { scheduled, skipped: cleaned.length - scheduled };
}

/** Cancel scheduled disputes that haven't been sent yet (scoped to the owner). */
export async function unscheduleDisputes(userId: number, leadIds: string[]): Promise<{ cancelled: number }> {
  const ids = (Array.isArray(leadIds) ? leadIds : [])
    .map((x) => String(x || "").replace(/\D/g, ""))
    .filter(Boolean);
  if (ids.length === 0) throw new Error("No scheduled leads to cancel.");
  const cleared = await db
    .update(lsaLeads)
    .set({ disputeStatus: null, disputeScheduledAt: null })
    .where(and(inArray(lsaLeads.leadId, ids), eq(lsaLeads.userId, userId), eq(lsaLeads.disputeStatus, "scheduled")))
    .returning({ leadId: lsaLeads.leadId });
  return { cancelled: cleared.length };
}

/**
 * Move scheduled disputes whose moment has arrived into the spaced send queue.
 * Runs on boot and on a periodic timer, across ALL tenants. The per-account
 * queue still spaces each send 30–60s apart.
 */
export async function promoteDueScheduledDisputes(): Promise<void> {
  try {
    const due = await db
      .select()
      .from(lsaLeads)
      .where(and(eq(lsaLeads.disputeStatus, "scheduled"), lte(lsaLeads.disputeScheduledAt, new Date())));
    if (due.length === 0) return;

    const toEnqueue: QueueItem[] = [];
    let promoted = 0;
    let retired = 0;

    for (const r of due) {
      const userId = r.userId;
      if (userId == null) continue;
      // Missing/invalid reason — can never succeed, retire it (only while still scheduled).
      if (!r.disputeReason || !DISSATISFIED_REASONS.has(r.disputeReason)) {
        const f = await db
          .update(lsaLeads)
          .set({ disputeStatus: "failed", disputeScheduledAt: null })
          .where(and(eq(lsaLeads.leadId, r.leadId), eq(lsaLeads.disputeStatus, "scheduled")))
          .returning({ leadId: lsaLeads.leadId });
        if (f.length) retired++;
        continue;
      }
      // Atomically claim scheduled -> queued while still scheduled & disputable.
      const claimed = await db
        .update(lsaLeads)
        .set({ disputeStatus: "queued", disputeScheduledAt: null })
        .where(
          and(
            eq(lsaLeads.leadId, r.leadId),
            eq(lsaLeads.disputeStatus, "scheduled"),
            eq(lsaLeads.leadCharged, true),
            or(isNull(lsaLeads.feedbackSubmitted), eq(lsaLeads.feedbackSubmitted, false)),
          ),
        )
        .returning({ leadId: lsaLeads.leadId, customerId: lsaLeads.customerId });
      if (claimed.length > 0) {
        toEnqueue.push({
          userId,
          customerId: (r.customerId || "").replace(/\D/g, ""),
          leadId: r.leadId,
          reason: r.disputeReason,
          runAt: 0,
        });
        promoted++;
        continue;
      }
      // Not claimed: cancelled (now null — leave) or no longer disputable — retire.
      const retiredRow = await db
        .update(lsaLeads)
        .set({ disputeStatus: "failed", disputeScheduledAt: null })
        .where(
          and(
            eq(lsaLeads.leadId, r.leadId),
            eq(lsaLeads.disputeStatus, "scheduled"),
            or(
              isNull(lsaLeads.leadCharged),
              eq(lsaLeads.leadCharged, false),
              eq(lsaLeads.feedbackSubmitted, true),
            ),
          ),
        )
        .returning({ leadId: lsaLeads.leadId });
      if (retiredRow.length) retired++;
    }

    if (toEnqueue.length > 0) {
      enqueueClaimed(toEnqueue);
      console.log(`⏰ Promoted ${promoted} scheduled LSA dispute(s) into the send queue.`);
    }
    if (retired > 0) console.log(`⚠️ Retired ${retired} un-disputable scheduled lead(s).`);
  } catch (e) {
    console.error("Failed to promote scheduled disputes:", e);
  }
}

/** On boot, re-queue anything left mid-flight by a restart (across all tenants). */
export async function resumeDisputeQueue(): Promise<void> {
  try {
    const pending = await db
      .select()
      .from(lsaLeads)
      .where(inArray(lsaLeads.disputeStatus, ["queued", "sending"]));
    if (pending.length === 0) return;
    const toEnqueue: QueueItem[] = [];
    for (const r of pending) {
      if (r.userId == null) continue;
      if (!r.disputeReason || !DISSATISFIED_REASONS.has(r.disputeReason)) {
        await db
          .update(lsaLeads)
          .set({ disputeStatus: "failed" })
          .where(eq(lsaLeads.leadId, r.leadId))
          .catch(() => {});
        continue;
      }
      toEnqueue.push({
        userId: r.userId,
        customerId: (r.customerId || "").replace(/\D/g, ""),
        leadId: r.leadId,
        reason: r.disputeReason,
        runAt: 0,
      });
    }
    if (toEnqueue.length > 0) {
      enqueueClaimed(toEnqueue);
      console.log(`↻ Resumed ${toEnqueue.length} pending LSA dispute(s).`);
    }
  } catch (e) {
    console.error("Failed to resume dispute queue:", e);
  }
}
