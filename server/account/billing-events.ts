/**
 * Stripe delivers an event at least once. recordBillingEvent claims the event
 * id in billing_events before any handler runs; a second delivery sees false
 * and is skipped, so an invoice email or a purchase row is never doubled.
 * Only call it AFTER the webhook signature has been verified (server/stripe.ts
 * fails closed on that) — an unverified id must never be claimed.
 */
import { pool } from "../db";

export type BillingEventRef = { id: string; type?: string | null; userId?: number | null };

/** True when the event is new (and now recorded); false when it was seen before. */
export async function recordBillingEvent(event: BillingEventRef): Promise<boolean> {
  if (!event?.id || typeof event.id !== "string") throw new Error("recordBillingEvent: event.id is required");
  const { rows } = await pool.query(
    "INSERT INTO billing_events(stripe_event_id, type, user_id, received_at) VALUES ($1, $2, $3, now()) ON CONFLICT (stripe_event_id) DO NOTHING RETURNING stripe_event_id",
    [event.id, event.type ?? null, Number.isInteger(event.userId) ? event.userId : null]);
  return rows.length === 1;
}

/**
 * Attach the account to an event recorded before its owner was known (the
 * claim happens first; the handler resolves the customer afterwards).
 */
export async function attributeBillingEvent(eventId: string, userId: number): Promise<void> {
  await pool.query("UPDATE billing_events SET user_id=$2 WHERE stripe_event_id=$1 AND user_id IS NULL", [eventId, userId]);
}

/** Release a claim when the handler failed and Stripe should retry (500). */
export async function releaseBillingEvent(eventId: string): Promise<void> {
  await pool.query("DELETE FROM billing_events WHERE stripe_event_id=$1", [eventId]);
}
