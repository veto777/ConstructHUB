/**
 * Add-on introductory prices — today only the AI Call Assistant's Solo tier
 * (owner, 2026-10-02: "$99 a month for the first 3 months", then the regular
 * price). Crew and Fleet have no intro; moving between tiers never grants it.
 *
 * The price book carries the figures (shared/plans.ts `introMonthlyCents`,
 * `introMonths`); this module turns them into a Stripe coupon and decides who
 * gets it:
 *
 *   - monthly billing: `amount_off = monthly − intro`, `duration: repeating`,
 *     `duration_in_months = introMonths` → the add-on line costs the intro
 *     price for that many invoices;
 *   - annual billing: NO intro. The intro is a monthly offer; the annual price
 *     (owner, 2026-10-02: "$1999" a year) is already the yearly deal, so an
 *     annual order gets no coupon and records no grant (the intro stays
 *     unused for a later monthly purchase);
 *   - the coupon `applies_to` the add-on's own Stripe product, so it can never
 *     discount the plan or another add-on, and it is attached to the add-on's
 *     subscription item (an existing subscriber) or to the Checkout Session (a
 *     new subscriber);
 *   - ONCE PER CUSTOMER, and only when the add-on is first added: an account
 *     that already holds the add-on gets nothing, and `billing_addon_intros`
 *     records every grant. A grant on a Checkout Session only counts once that
 *     session completed — an abandoned checkout does not use the intro up.
 *
 * Coupons are found by a deterministic id that spells every figure
 * (`chub_v1_intro_<addon>_<interval>_<regular>_<intro>x<months>`), so a price
 * change makes a new coupon and an old one is never reused for a new price.
 * One amount_off per line: with two units of the add-on, the intro covers one.
 */
import type Stripe from "stripe";
import { pool } from "../db";
import { ADDONS, ADDON_KEYS, type AddonKey, type BillingInterval } from "@shared/plans";
import { addonPriceSpec, resolvePriceId } from "./prices";
import type { AddonQuantities } from "./order";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** The slice of Stripe this module calls (a fake stands in for it in tests). */
export type StripeForIntro = {
  coupons: {
    retrieve(id: string): Promise<{ id: string; valid?: boolean }>;
    create(params: Stripe.CouponCreateParams, opts?: { idempotencyKey?: string }): Promise<{ id: string }>;
  };
  prices: { retrieve(id: string): Promise<{ id: string; product: string | { id: string } }> };
  checkout: { sessions: { retrieve(id: string): Promise<{ id: string; status: string | null }> } };
};

export type IntroOffer = { addon: AddonKey; monthlyCents: number; months: number };

/** The add-on's intro, or null when it has none (or the "intro" would not be cheaper). */
export function addonIntro(addon: AddonKey): IntroOffer | null {
  const a = ADDONS[addon];
  if (!a.introMonthlyCents || !a.introMonths || a.introMonthlyCents >= a.monthlyCents) return null;
  return { addon, monthlyCents: a.introMonthlyCents, months: a.introMonths };
}

/** The intro an order on this billing interval gets: monthly only (annual billing has its own price, no intro). */
export function introFor(addon: AddonKey, interval: BillingInterval): IntroOffer | null {
  return interval === "month" ? addonIntro(addon) : null;
}

/** The coupon a MONTHLY order needs (the discount, repeated for the intro months); null for annual billing. */
export function introCouponSpec(addon: AddonKey, interval: BillingInterval): { id: string; amountOff: number; params: Omit<Stripe.CouponCreateParams, "applies_to"> } | null {
  const intro = introFor(addon, interval);
  if (!intro) return null;
  const a = ADDONS[addon];
  const amountOff = a.monthlyCents - intro.monthlyCents;
  const id = `chub_v1_intro_${addon}_${interval}_${a.monthlyCents}_${intro.monthlyCents}x${intro.months}`;
  const usd = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  return {
    id,
    amountOff,
    params: {
      id,
      amount_off: amountOff,
      currency: "usd",
      duration: "repeating",
      duration_in_months: intro.months,
      name: `${a.name}: ${usd(intro.monthlyCents)}/mo for ${intro.months} months`.slice(0, 40),
      metadata: { chub_kind: "intro", addon, interval },
    },
  };
}

const couponIds = new Map<string, string>();
/** Test hook. */
export function resetIntroCouponCache() { couponIds.clear(); }

/** Find or create the intro coupon for an add-on + interval; null when the add-on has no intro. */
export async function resolveIntroCoupon(stripe: StripeForIntro, addon: AddonKey, interval: BillingInterval): Promise<string | null> {
  const spec = introCouponSpec(addon, interval);
  if (!spec) return null;
  const cached = couponIds.get(spec.id);
  if (cached) return cached;
  try {
    const found = await stripe.coupons.retrieve(spec.id);
    if (found.valid === false) throw new Error(`intro coupon ${spec.id} exists but is no longer valid`);
    couponIds.set(spec.id, found.id);
    return found.id;
  } catch (e: any) {
    if (e?.code !== "resource_missing" && e?.statusCode !== 404) throw e;
  }
  // Scoped to the add-on's own product (the product of its price for this interval).
  const priceId = await resolvePriceId(stripe as unknown as Stripe, addonPriceSpec(addon, interval));
  const price = await stripe.prices.retrieve(priceId);
  const product = typeof price.product === "string" ? price.product : price.product.id;
  const created = await stripe.coupons.create({ ...spec.params, applies_to: { products: [product] } }, { idempotencyKey: `create-${spec.id}-${product}` });
  couponIds.set(spec.id, created.id);
  return created.id;
}

/** Has this account never had the add-on's intro (an abandoned checkout does not count)? */
export async function introEligible(stripe: StripeForIntro, userId: number, addon: AddonKey, q: Queryable = pool): Promise<boolean> {
  if (!addonIntro(addon)) return false;
  const { rows: [row] } = await q.query("SELECT ref FROM billing_addon_intros WHERE user_id = $1 AND addon = $2", [userId, addon]);
  if (!row) return true;
  if (!String(row.ref).startsWith("cs_")) return false;
  try {
    const session = await stripe.checkout.sessions.retrieve(row.ref);
    return session.status !== "complete";
  } catch (e: any) {
    // A session Stripe no longer has was never paid; anything else: no intro rather than a guess.
    return e?.code === "resource_missing" || e?.statusCode === 404;
  }
}

/** Record a grant: `ref` is the Checkout Session (cs_…) or the subscription (sub_…) it went on. */
export async function recordIntro(userId: number, addon: AddonKey, couponId: string, ref: string, q: Queryable = pool): Promise<void> {
  await q.query(
    `INSERT INTO billing_addon_intros (user_id, addon, coupon_id, ref) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, addon) DO UPDATE SET coupon_id = EXCLUDED.coupon_id, ref = EXCLUDED.ref, created_at = now()`,
    [userId, addon, couponId, ref]);
}

/** Add-ons this order adds for the first time that carry an intro, with their coupon (eligible accounts only). */
export async function introsForOrder(
  stripe: StripeForIntro, userId: number, before: AddonQuantities, after: AddonQuantities, interval: BillingInterval, q: Queryable = pool,
): Promise<{ addon: AddonKey; couponId: string }[]> {
  const out: { addon: AddonKey; couponId: string }[] = [];
  for (const addon of ADDON_KEYS) {
    if (!introFor(addon, interval) || (before[addon] ?? 0) > 0 || (after[addon] ?? 0) <= 0) continue;
    // A switch between Call Assistant tiers (Crew → Solo) is not "first added": the intro is for a new customer of the service.
    const group = ADDONS[addon].exclusiveGroup;
    if (group && ADDON_KEYS.some((k) => ADDONS[k].exclusiveGroup === group && (before[k] ?? 0) > 0)) continue;
    if (!(await introEligible(stripe, userId, addon, q))) continue;
    const couponId = await resolveIntroCoupon(stripe, addon, interval);
    if (couponId) out.push({ addon, couponId });
  }
  return out;
}

/**
 * Put each intro coupon on the subscription-item change that ADDS its add-on
 * (`{ price, quantity }`, no `id`). Returns the intros actually attached.
 */
export async function attachIntrosToItems(
  stripe: StripeForIntro, items: Stripe.SubscriptionUpdateParams.Item[], intros: { addon: AddonKey; couponId: string }[], interval: BillingInterval,
): Promise<{ addon: AddonKey; couponId: string }[]> {
  const attached: { addon: AddonKey; couponId: string }[] = [];
  for (const intro of intros) {
    const priceId = await resolvePriceId(stripe as unknown as Stripe, addonPriceSpec(intro.addon, interval));
    const item = items.find((i) => !i.id && i.price === priceId && !i.deleted);
    if (!item) continue;
    item.discounts = [{ coupon: intro.couponId }];
    attached.push(intro);
  }
  return attached;
}
