/**
 * Card retry cap (owner, 2026-10-21: "lets not allow a card to be ran more than twice not over and over for week").
 * Stripe's automatic collection retries a failed subscription invoice for days (one customer's card was declined
 * daily from 10-08 to 10-17). After the SECOND failed attempt we switch the invoice's automatic collection off
 * (auto_advance=false): Stripe makes no further attempts. The invoice stays open, so the customer can still pay it
 * from Billing or the hosted invoice link, and a new card on file can be charged by hand.
 */
import type Stripe from "stripe";
import { stripe } from "./client";
import { logError } from "../ops/log";

export const MAX_AUTOMATIC_CARD_ATTEMPTS = 2;

type InvoiceLike = Pick<Stripe.Invoice, "status" | "auto_advance" | "attempt_count" | "collection_method">;

/** True when Stripe would retry this invoice again although it has already failed MAX_AUTOMATIC_CARD_ATTEMPTS times. */
export function shouldStopRetries(inv: InvoiceLike): boolean {
  return inv.status === "open"
    && inv.collection_method === "charge_automatically"
    && inv.auto_advance !== false
    && (inv.attempt_count ?? 0) >= MAX_AUTOMATIC_CARD_ATTEMPTS;
}

/** invoice.payment_failed: stop automatic retries once the cap is reached. Never throws (the webhook must ack). */
export async function capInvoiceRetries(inv: Stripe.Invoice): Promise<boolean> {
  if (!inv.id || !shouldStopRetries(inv)) return false;
  try {
    await stripe.invoices.update(inv.id, { auto_advance: false });
    return true;
  } catch (err) {
    logError(`retry cap: could not stop retries on ${inv.id}`, err);
    return false;
  }
}
