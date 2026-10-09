/**
 * Daily: bill each Agency subscription for the Google Business Profile
 * locations its owner has linked. The Agency plan includes 10; the graduated
 * band item's quantity is (linked − 10), capped at the self-serve maximum
 * (above that is a sales quote — logged, never billed automatically).
 *
 * Idempotent: a subscription whose band quantity already matches is left
 * alone, so running twice (or after a restart) changes nothing. Quantity
 * changes are prorated: on the next invoice for monthly subscriptions,
 * invoiced immediately for yearly ones (agencyProrationBehavior). Never runs
 * without a Stripe key.
 */
import type Stripe from "stripe";
import { pool } from "../db";
import { AGENCY_SELF_SERVE_MAX_LOCATIONS, agencyExtraLocations, LEGACY_AGENCY_INCLUDED_LOCATIONS } from "@shared/plans";
import { stripe as appStripe, stripeConfigured } from "./client";
import { describeSubscription, agencyLocationsPriceSpec, resolvePriceId } from "./prices";
import { LIVE_STATUSES, billingSchemaReady, withBillingLock } from "./sync";
import { recordFailure } from "../ops/issues";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

/** Linked GBP locations the user bills for (a location linked twice counts once). */
export async function linkedGbpLocationCount(userId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT count(DISTINCT gbp_location_name)::int AS n FROM business_locations
      WHERE user_id = $1 AND gbp_location_name IS NOT NULL`, [userId]);
  return Number(row?.n ?? 0);
}

/**
 * How a location-count change is billed. Monthly: the prorated difference
 * lands on the next monthly invoice. Yearly: invoiced right away
 * (always_invoice) — otherwise locations linked mid-year would wait for the
 * renewal up to 12 months later, and never be collected if the customer
 * cancels at period end.
 */
export function agencyProrationBehavior(interval: "month" | "year"): Stripe.SubscriptionUpdateParams.ProrationBehavior {
  return interval === "year" ? "always_invoice" : "create_prorations";
}

export type AgencySyncResult = { checked: number; changed: number; failed: number };
type Log = (line: string) => void;

export async function syncAgencyLocations(opts: { stripe?: Stripe; log?: Log } = {}): Promise<AgencySyncResult | null> {
  const log = opts.log ?? ((line: string) => console.log(`[billing] ${line}`));
  if (!opts.stripe && !stripeConfigured()) {
    log("Agency location sync skipped: STRIPE_SECRET_KEY is not set.");
    return null;
  }
  const stripe = opts.stripe ?? appStripe;
  await billingSchemaReady();
  const { rows } = await pool.query(
    `SELECT id, user_id, stripe_subscription_id FROM subscriptions
      WHERE plan = 'agency' AND stripe_subscription_id IS NOT NULL AND status = ANY($1)
        AND agency_locations IS NOT NULL`,
    [[...LIVE_STATUSES]]);
  // The bands are legacy: only a stored billed count (a 2026-09-30 Agency row) is synced.
  // Unlimited — the `agency` key since 2026-10-09 — has no location cap and never lands here.
  const included = LEGACY_AGENCY_INCLUDED_LOCATIONS;
  const result: AgencySyncResult = { checked: 0, changed: 0, failed: 0 };
  /** One subscription; true when its Stripe items changed. */
  const syncOne = async (row: { id: number; user_id: number; stripe_subscription_id: string }): Promise<boolean> => {
    const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    if (!LIVE_STATUSES.has(sub.status)) return false;
    const shape = describeSubscription(sub.items.data);
    if (shape.plan !== "agency" || !shape.interval) {
      log(`Agency location sync: user ${row.user_id} subscription ${sub.id} has no Agency plan item — skipped.`);
      return false;
    }
    const linked = await linkedGbpLocationCount(row.user_id);
    if (linked > AGENCY_SELF_SERVE_MAX_LOCATIONS) {
      log(`Agency location sync: user ${row.user_id} has ${linked} linked locations — above ${AGENCY_SELF_SERVE_MAX_LOCATIONS}, needs a sales quote; billing ${AGENCY_SELF_SERVE_MAX_LOCATIONS}.`);
    }
    const billed = Math.max(included, Math.min(linked, AGENCY_SELF_SERVE_MAX_LOCATIONS));
    const extra = agencyExtraLocations(billed);
    if (extra === shape.agencyExtraLocations) {
      await pool.query(
        `UPDATE subscriptions SET agency_locations = $2 WHERE id = $1 AND agency_locations IS DISTINCT FROM $2`,
        [row.id, billed]);
      return false;
    }
    let change: Stripe.SubscriptionUpdateParams.Item;
    if (shape.agencyItem && extra === 0) change = { id: shape.agencyItem.id, deleted: true };
    else if (shape.agencyItem) change = { id: shape.agencyItem.id, quantity: extra };
    else change = { price: await resolvePriceId(stripe, agencyLocationsPriceSpec(shape.interval)), quantity: extra };
    await stripe.subscriptions.update(sub.id, { items: [change], proration_behavior: agencyProrationBehavior(shape.interval) });
    await pool.query(`UPDATE subscriptions SET agency_locations = $2 WHERE id = $1`, [row.id, billed]);
    log(`Agency location sync: user ${row.user_id} now billed for ${billed} locations (was ${included + shape.agencyExtraLocations}; ${linked} linked).`);
    return true;
  };
  for (const row of rows) {
    result.checked++;
    try {
      // Serialized with the account's own plan / add-on changes, so both never
      // edit the subscription's items from the same stale read.
      if (await withBillingLock(row.user_id, () => syncOne(row))) result.changed++;
    } catch (e: any) {
      result.failed++;
      log(`Agency location sync: user ${row.user_id} failed — ${e?.message || e}`);
    }
  }
  log(`Agency location sync: ${result.checked} checked, ${result.changed} changed, ${result.failed} failed.`);
  return result;
}

let started = false;
let running = false;

/**
 * Why the scheduled sync must stay off here, or null when it may run. It
 * changes what real customers are billed from this server's database, so it
 * runs only in production (`npm start`), or on another server that sets
 * AGENCY_SYNC_ALLOW_NONPROD=1 on purpose. Otherwise a dev server started with
 * the checkout's .env (which can hold the live Stripe key) and a copied
 * database would re-bill live Agency subscriptions from stale location counts.
 */
export function agencySyncOffReason(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.STRIPE_SECRET_KEY) return "STRIPE_SECRET_KEY is not set";
  if (env.NODE_ENV !== "production" && env.AGENCY_SYNC_ALLOW_NONPROD !== "1") {
    return "this is not a production server (set AGENCY_SYNC_ALLOW_NONPROD=1 to run it anyway)";
  }
  return null;
}

/** Schedules the sync (5 minutes after boot, then daily). Not in tests; logs and stays off without a Stripe key or outside production. */
export function startAgencyLocationSync(): void {
  if (started || process.env.NODE_ENV === "test" || process.env.VITEST) return;
  started = true;
  const off = agencySyncOffReason();
  if (off) {
    console.log(`[billing] Agency location sync is off: ${off}.`);
    return;
  }
  const run = async () => {
    if (running) return;
    running = true;
    try { await syncAgencyLocations(); }
    catch (e: any) { console.error("[billing] Agency location sync failed:", e?.message || e); void recordFailure("job", "Agency location billing sync", e); }
    finally { running = false; }
  };
  setTimeout(run, FIRST_RUN_DELAY_MS).unref();
  setInterval(run, DAY_MS).unref();
}
