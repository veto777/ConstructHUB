/**
 * Minutes metering hook (docs/call-assistant/SPEC.md § 2 voice_usage) —
 * OWNER: calls+crm lane (the write at the end of a call).
 *
 * `voice_usage` is the meter the numbers+billing lane reads (Overview, overage
 * reporting to Stripe in server/voice/billing-usage.ts). This file only adds
 * what a finished call contributes: one call, its billed minutes
 * (ceil(duration/60)), the spam/blocked counters, the included-minutes
 * snapshot and the overage so far. Idempotent per call: internal-calls.ts
 * calls it exactly once, when the call row's billed_minutes is first set.
 */
import { db } from "../db";
import { voiceUsage } from "@shared/schema";
import { sql } from "drizzle-orm";
import { monthKey } from "../growth-quotas";

export type CallUsage = {
  orgId: string;
  /** crm_orgs.owner_user_id — the subscription that holds the add-on. */
  accountUserId: number;
  billedMinutes: number;
  outcome: string | null;
  /** callAssistantAllowance(ent).minutes at the time of the call. */
  includedMinutes: number;
  at?: Date;
};

export const billedMinutesFor = (durationSeconds: number | null | undefined): number =>
  Math.max(0, Math.ceil((Number(durationSeconds) || 0) / 60));

/** Add one finished call to the org's month. Returns the month row after the write. */
export async function meterCallUsage(u: CallUsage) {
  const month = monthKey(u.at ?? new Date());
  const spam = u.outcome === "spam" ? 1 : 0;
  const blocked = u.outcome === "blocked" ? 1 : 0;
  const [row] = await db.insert(voiceUsage).values({
    orgId: u.orgId, accountUserId: u.accountUserId, month,
    calls: 1, minutes: u.billedMinutes, spamCalls: spam, blockedCalls: blocked,
    includedMinutes: u.includedMinutes,
    overageMinutes: Math.max(0, u.billedMinutes - u.includedMinutes),
  }).onConflictDoUpdate({
    target: [voiceUsage.orgId, voiceUsage.month],
    set: {
      accountUserId: u.accountUserId,
      calls: sql`${voiceUsage.calls} + 1`,
      minutes: sql`${voiceUsage.minutes} + ${u.billedMinutes}`,
      spamCalls: sql`${voiceUsage.spamCalls} + ${spam}`,
      blockedCalls: sql`${voiceUsage.blockedCalls} + ${blocked}`,
      includedMinutes: u.includedMinutes,
      overageMinutes: sql`greatest(0, ${voiceUsage.minutes} + ${u.billedMinutes} - ${u.includedMinutes})`,
      updatedAt: new Date(),
    },
  }).returning();
  return row;
}
