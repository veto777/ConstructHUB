/**
 * Stripe delivers an event at least once. recordBillingEvent claims the event
 * id in billing_events before any handler runs; a second delivery sees false
 * and is skipped, so an invoice email or a purchase row is never doubled.
 * Only call it AFTER the webhook signature has been verified (server/stripe.ts
 * fails closed on that) — an unverified id must never be claimed.
 *
 * ONE implementation: server/billing/ledger.ts (the webhook's own module).
 * This file is the account-side name for it.
 */
export { recordBillingEvent, attributeBillingEvent, releaseBillingEvent, billingEventSeen, type BillingEventRef } from "../billing/ledger";
