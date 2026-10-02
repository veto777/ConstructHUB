/**
 * Spam ledger (docs/call-assistant/SPEC.md § 12) — OWNER: calls+crm lane.
 *
 * One row per (org, caller number). A `flag_spam` verdict at or above the
 * profile's `flagAt` makes the call spam (no notifications, no lead, no
 * escalation); at or above `strikeAt` it is a STRIKE. Two strikes block the
 * number: the engine asks before answering (GET /profile → caller.blocked, or
 * GET /api/voice-internal/blocklist) and `<Reject>`s the call, which is logged
 * as `blocked` with 0 minutes. Unblocking resets the strikes so the next
 * verdicts start over; a manual block carries the member id. Per org only.
 */
import { db } from "../db";
import { voiceSpam, type VoiceSpamRow } from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { normalizePhone } from "../crm/sms";

/** Strikes that block a number (owner rule: "2 near-certain spam calls"). */
export const SPAM_STRIKES_TO_BLOCK = 2;
/** Defaults when the compiled profile carries no thresholds (= sensitivity "normal"). */
export const DEFAULT_SPAM_THRESHOLDS = { flagAt: 0.8, strikeAt: 0.95 } as const;
export const SPAM_THRESHOLDS_BY_SENSITIVITY: Record<"low" | "normal" | "high", { flagAt: number; strikeAt: number }> = {
  low: { flagAt: 0.9, strikeAt: 0.98 },
  normal: { flagAt: 0.8, strikeAt: 0.95 },
  high: { flagAt: 0.7, strikeAt: 0.9 },
};

/** Pitches that are spam every time; the model tends to rate them 0.9 when strikeAt is 0.95 (QA spam_google_listing). */
export const UNMISTAKABLE_SPAM = /google (?:business )?(?:listing|profile|verification)|\bpress (?:1|one|2|two)\b|\bseo\b|rank(?:ing)? (?:on|in) google|merchant services|this is a recorded message/i;

/**
 * The confidence the ledger records for a call that is already flagged spam: at least `strikeAt` when the
 * model's reason or what the caller said is one of the unmistakable pitches, so the two-strike block is
 * deterministic. Never raises a call that wasn't flagged (that decision stays with flagAt).
 */
export function spamConfidenceWithFloor(confidence: number, strikeAt: number, ...texts: Array<string | null | undefined>): number {
  return texts.some((t) => !!t && UNMISTAKABLE_SPAM.test(t)) ? Math.max(confidence, strikeAt) : confidence;
}

export type SpamVerdictResult = { strikes: number; calls: number; blocked: boolean; strike: boolean };

/** E.164 or null; the ledger never stores a number it could not normalize. */
export const spamNumber = (raw: string | null | undefined): string | null => normalizePhone(raw);

/** Is this caller blocked for the org right now? (`unblocked_at` after `blocked_at` means not blocked.) */
export async function callerSpamStatus(orgId: string, from: string | null | undefined): Promise<{ blocked: boolean; strikes: number; calls: number }> {
  const phone = spamNumber(from);
  if (!phone) return { blocked: false, strikes: 0, calls: 0 };
  const [row] = await db.select().from(voiceSpam)
    .where(and(eq(voiceSpam.orgId, orgId), eq(voiceSpam.phoneNumber, phone))).limit(1);
  if (!row) return { blocked: false, strikes: 0, calls: 0 };
  return { blocked: isBlocked(row), strikes: row.strikes, calls: row.calls };
}

export function isBlocked(row: Pick<VoiceSpamRow, "blockedAt" | "unblockedAt">): boolean {
  if (!row.blockedAt) return false;
  return !row.unblockedAt || row.unblockedAt < row.blockedAt;
}

/**
 * Record one spam verdict for a caller. Every verdict bumps `calls` and the
 * `last_*` columns; a verdict ≥ strikeAt adds a strike; the second strike
 * blocks (blocked_by 'auto'). Returns the ledger state after the write.
 */
export async function recordSpamVerdict(args: {
  orgId: string; from: string | null | undefined; confidence: number; reason: string; callId?: string | null; strikeAt?: number;
}): Promise<SpamVerdictResult | null> {
  const phone = spamNumber(args.from);
  if (!phone) return null;
  const strikeAt = args.strikeAt ?? DEFAULT_SPAM_THRESHOLDS.strikeAt;
  const strike = args.confidence >= strikeAt;
  const confidence = Math.max(0, Math.min(1, args.confidence)).toFixed(2);
  const reason = String(args.reason ?? "").slice(0, 300);
  const [row] = await db.insert(voiceSpam).values({
    orgId: args.orgId, phoneNumber: phone, strikes: strike ? 1 : 0, calls: 1,
    lastConfidence: confidence, lastReason: reason, lastCallId: args.callId ?? null,
  }).onConflictDoUpdate({
    target: [voiceSpam.orgId, voiceSpam.phoneNumber],
    set: {
      strikes: sql`${voiceSpam.strikes} + ${strike ? 1 : 0}`,
      calls: sql`${voiceSpam.calls} + 1`,
      lastConfidence: confidence, lastReason: reason, lastCallId: args.callId ?? null,
      lastSeenAt: new Date(),
    },
  }).returning();
  let blocked = isBlocked(row);
  if (!blocked && row.strikes >= SPAM_STRIKES_TO_BLOCK) {
    await db.update(voiceSpam).set({ blockedAt: new Date(), unblockedAt: null, blockedBy: "auto" }).where(eq(voiceSpam.id, row.id));
    blocked = true;
  }
  return { strikes: row.strikes, calls: row.calls, blocked, strike };
}

/** A rejected (pre-answer) call from a blocked number: count it, touch last_seen. */
export async function recordBlockedCall(orgId: string, from: string | null | undefined, callId?: string | null): Promise<void> {
  const phone = spamNumber(from);
  if (!phone) return;
  await db.update(voiceSpam)
    .set({ calls: sql`${voiceSpam.calls} + 1`, lastSeenAt: new Date(), lastCallId: callId ?? null })
    .where(and(eq(voiceSpam.orgId, orgId), eq(voiceSpam.phoneNumber, phone)));
}

/** Block by hand (Calls → Spam). `by` is the member id. */
export async function blockNumber(orgId: string, raw: string, by: string, reason = "Blocked by hand"): Promise<VoiceSpamRow | null> {
  const phone = spamNumber(raw);
  if (!phone) return null;
  const [row] = await db.insert(voiceSpam).values({
    orgId, phoneNumber: phone, strikes: SPAM_STRIKES_TO_BLOCK, calls: 0, lastReason: reason,
    blockedAt: new Date(), unblockedAt: null, blockedBy: by,
  }).onConflictDoUpdate({
    target: [voiceSpam.orgId, voiceSpam.phoneNumber],
    set: { blockedAt: new Date(), unblockedAt: null, blockedBy: by, lastReason: reason, lastSeenAt: new Date() },
  }).returning();
  return row;
}

/** Unblock: strikes reset so the number gets a fresh two chances. Org-scoped by id. */
export async function unblockNumber(orgId: string, id: number): Promise<VoiceSpamRow | null> {
  const [row] = await db.update(voiceSpam)
    .set({ unblockedAt: new Date(), strikes: 0 })
    .where(and(eq(voiceSpam.orgId, orgId), eq(voiceSpam.id, id)))
    .returning();
  return row ?? null;
}

export async function listSpamLedger(orgId: string, limit = 200): Promise<VoiceSpamRow[]> {
  return db.select().from(voiceSpam).where(eq(voiceSpam.orgId, orgId))
    .orderBy(desc(voiceSpam.lastSeenAt)).limit(Math.min(500, Math.max(1, limit)));
}

/** Presented row: `blocked` computed once, here, so no screen re-derives it. */
export function presentSpamRow(row: VoiceSpamRow) {
  return { ...row, blocked: isBlocked(row), lastConfidence: row.lastConfidence == null ? null : Number(row.lastConfidence) };
}
