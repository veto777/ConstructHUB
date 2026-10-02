/**
 * Minutes metering hook (docs/call-assistant/SPEC.md § 2 voice_usage) —
 * the write at the end of a call (calls+crm lane).
 *
 * Integration: the calls+crm and numbers+billing lanes each wrote a
 * voice_usage upsert. There is now ONE meter — `recordVoiceCallUsage` in
 * ./billing-usage.ts (the billing lane's, with the int casts, the
 * blocked → 0 minutes rule and the "included minutes only grow within a
 * month" snapshot). This file keeps the calls lane's call shape and forwards.
 * Idempotent per call: internal-calls.ts calls it exactly once, under the
 * end-report claim.
 */
import { billedMinutesFor, recordVoiceCallUsage } from "./billing-usage";

export { billedMinutesFor };

export type CallUsage = {
  orgId: string;
  /** crm_orgs.owner_user_id — the subscription that holds the add-on. */
  accountUserId: number;
  billedMinutes: number;
  outcome: string | null;
  at?: Date;
};

/** Add one finished call to the org's month. Returns the month row after the write. */
export function meterCallUsage(u: CallUsage) {
  return recordVoiceCallUsage({ orgId: u.orgId, accountUserId: u.accountUserId, outcome: u.outcome, billedMinutes: u.billedMinutes, at: u.at });
}
