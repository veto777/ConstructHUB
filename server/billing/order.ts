/**
 * What a customer asked to buy (plan, interval, add-ons, Agency locations),
 * validated against shared/plans.ts, and the Stripe line items / subscription
 * item changes that bill it. Prices come only from shared/plans.ts through
 * ./prices — nothing the client sends is a price.
 */
import type Stripe from "stripe";
import {
  PLANS, ADDONS, ADDON_KEYS, ADDON_MAX_QUANTITY, AGENCY_SELF_SERVE_MAX_LOCATIONS, LEGACY_PLAN_MAP, TALK_TO_SALES_CODE,
  isPlanKey, isAddonKey, isBillingInterval, addonAvailableOn, agencyExtraLocations, maxExtraLocations,
  type PlanKey, type AddonKey, type BillingInterval,
} from "@shared/plans";
import {
  planPriceSpec, addonPriceSpec, addonSetupPriceSpec, agencyLocationsPriceSpec, resolvePriceId, roleOfPrice,
  type SubscriptionShape,
} from "./prices";

/** A request the price book can't sell as asked. `code` is machine-readable for the client. */
export class BillingRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = "BillingRequestError";
  }
}

export type AddonQuantities = Partial<Record<AddonKey, number>>;

export type PlanOrder = {
  plan: PlanKey;
  interval: BillingInterval;
  /** Only positive quantities. */
  addons: AddonQuantities;
  /** Agency: locations billed (at least the included 10). Null for other plans. */
  agencyLocations: number | null;
};

const planList = () => Object.values(PLANS).map((p) => p.name).join(", ");

export function parsePlanKey(raw: unknown): PlanKey {
  if (isPlanKey(raw)) return raw;
  if (typeof raw === "string" && raw in LEGACY_PLAN_MAP) {
    throw new BillingRequestError(400, `That plan is no longer sold. Choose one of: ${planList()}.`, "plan_retired");
  }
  throw new BillingRequestError(400, "Invalid plan");
}

export function parseInterval(raw: unknown, fallback: BillingInterval = "month"): BillingInterval {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (isBillingInterval(raw)) return raw;
  throw new BillingRequestError(400, "Billing interval must be \"month\" or \"year\".");
}

/** `{ addon: quantity }` from the request. Zero is allowed (it removes an add-on on a change). */
export function parseAddonQuantities(raw: unknown): AddonQuantities {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new BillingRequestError(400, "Add-ons must be given as { addon: quantity }.");
  }
  const out: AddonQuantities = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAddonKey(key)) throw new BillingRequestError(400, `Unknown add-on: ${String(key).slice(0, 60)}`);
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new BillingRequestError(400, `${ADDONS[key].name}: quantity must be a whole number, 0 or more.`);
    }
    if (value > ADDON_MAX_QUANTITY) {
      throw new BillingRequestError(409,
        `More than ${ADDON_MAX_QUANTITY} × ${ADDONS[key].name} is quoted by a sales rep. Talk to a sales rep — nothing was charged.`,
        TALK_TO_SALES_CODE);
    }
    out[key] = value;
  }
  return out;
}

/** Refuse add-ons the plan doesn't offer, and extra locations that would make it an Agency-sized account. */
export function checkAddonsForPlan(plan: PlanKey, addons: AddonQuantities): void {
  const name = PLANS[plan].name;
  for (const key of ADDON_KEYS) {
    const quantity = addons[key] ?? 0;
    if (quantity <= 0) continue;
    if (!addonAvailableOn(key, plan)) {
      let why = "";
      if (key === "texting_number" && PLANS[plan].limits.clientTexting === "included") why = ` ${name} already includes a client-texting number.`;
      else if (key === "extra_location" && plan === "agency") why = " Agency is billed by location count instead.";
      throw new BillingRequestError(400, `${ADDONS[key].name} isn't available on the ${name} plan.${why}`, "addon_unavailable");
    }
    // A preview add-on is listed on the pricing page but not for sale yet
    // (shared/plans.ts `preview`): nothing is charged for it.
    if (ADDONS[key].preview) {
      throw new BillingRequestError(409, `${ADDONS[key].name} isn't available yet. Nothing was charged.`, "addon_unavailable");
    }
    const needs = ADDONS[key].requires;
    if (needs && (addons[needs] ?? 0) <= 0) {
      throw new BillingRequestError(400, `${ADDONS[key].name} needs the ${ADDONS[needs].name} add-on on the same subscription.`, "addon_unavailable");
    }
    if (key === "extra_location" && quantity > maxExtraLocations(plan)) {
      const max = maxExtraLocations(plan);
      throw new BillingRequestError(400,
        `${name} can add up to ${max} extra location${max === 1 ? "" : "s"} (${PLANS[plan].limits.locations + max} in all). ` +
        `${PLANS.agency.limits.locations} or more locations is the Agency plan.`, "addon_limit");
    }
  }
}

/** Agency location count: whole number ≥ 1; above the self-serve maximum is a sales quote. */
export function parseAgencyLocations(raw: unknown, fallback: number): number {
  const value = raw === undefined || raw === null || raw === "" ? fallback : raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new BillingRequestError(400, "Locations must be a whole number, 1 or more.");
  }
  if (value > AGENCY_SELF_SERVE_MAX_LOCATIONS) {
    throw new BillingRequestError(409,
      `More than ${AGENCY_SELF_SERVE_MAX_LOCATIONS} locations is quoted by a sales rep. Talk to a sales rep — nothing was charged.`,
      TALK_TO_SALES_CODE);
  }
  return Math.max(value, PLANS.agency.limits.locations);
}

const positive = (addons: AddonQuantities): AddonQuantities =>
  Object.fromEntries(Object.entries(addons).filter(([, qty]) => (qty ?? 0) > 0)) as AddonQuantities;

/**
 * The whole order from a request body. `current` supplies what an existing
 * subscription already has (interval, add-ons, Agency locations) so a change
 * only needs to name what changes; request add-on quantities override it.
 */
export function parsePlanOrder(
  body: any,
  current: { interval?: BillingInterval | null; addons?: AddonQuantities; agencyLocations?: number | null } = {},
): PlanOrder {
  const plan = parsePlanKey(body?.plan);
  const interval = parseInterval(body?.interval, current.interval ?? "month");
  const addons = positive({ ...(current.addons ?? {}), ...parseAddonQuantities(body?.addons) });
  checkAddonsForPlan(plan, addons);
  const agencyLocations = plan === "agency"
    ? parseAgencyLocations(body?.locations, current.agencyLocations ?? PLANS.agency.limits.locations)
    : null;
  return { plan, interval, addons, agencyLocations };
}

type LineItem = Stripe.Checkout.SessionCreateParams.LineItem;

/** Checkout line items: plan, Agency band item (if any), recurring add-ons, one-time setup fees. */
export async function checkoutLineItems(stripe: Stripe, order: PlanOrder): Promise<LineItem[]> {
  const items: LineItem[] = [{ price: await resolvePriceId(stripe, planPriceSpec(order.plan, order.interval)), quantity: 1 }];
  const extra = order.plan === "agency" ? agencyExtraLocations(order.agencyLocations ?? 0) : 0;
  if (extra > 0) items.push({ price: await resolvePriceId(stripe, agencyLocationsPriceSpec(order.interval)), quantity: extra });
  for (const key of ADDON_KEYS) {
    const quantity = order.addons[key] ?? 0;
    if (quantity <= 0) continue;
    items.push({ price: await resolvePriceId(stripe, addonPriceSpec(key, order.interval)), quantity });
    const setup = addonSetupPriceSpec(key);
    if (setup) items.push({ price: await resolvePriceId(stripe, setup), quantity });
  }
  return items;
}

type ItemChange = Stripe.SubscriptionUpdateParams.Item;
type InvoiceItem = Stripe.SubscriptionUpdateParams.AddInvoiceItem;

/** One slot (Agency band or an add-on): add, requantify/reprice, remove, or leave alone. */
async function slotChange(item: Stripe.SubscriptionItem | null, quantity: number, priceId: () => Promise<string>): Promise<ItemChange[]> {
  if (quantity <= 0) return item ? [{ id: item.id, deleted: true }] : [];
  const price = await priceId();
  if (!item) return [{ price, quantity }];
  if (item.price.id === price && (item.quantity ?? 1) === quantity) return [];
  return [{ id: item.id, price, quantity }];
}

const SALES_SET_UP = () => new BillingRequestError(409,
  "Your subscription includes items a sales rep set up, so this change can't be made here. Talk to a sales rep — nothing was changed or charged.",
  TALK_TO_SALES_CODE);

/**
 * Item changes that turn `current` into `order` on the SAME subscription (no
 * second subscription). Setup fees are charged once per newly added unit.
 *
 * Items on prices we did not create are never removed by a self-serve change:
 *   - a subscription with no plan item of ours and exactly one other item, on
 *     an account whose stored plan is a legacy key (LEGACY_PLAN_MAP), is a
 *     legacy checkout (one ad-hoc plan price); that item is repriced to the new plan;
 *   - any other such item (e.g. something a sales rep added and priced, or a
 *     sales-quoted subscription made of one custom price) is kept as it is; if
 *     the change would leave it on a different billing interval (Stripe bills
 *     every item on one interval), or it's unclear which item is the plan, the
 *     change is refused as a sales conversation.
 * A second item on one of OUR prices (a duplicate plan or add-on) is removed.
 *
 * `storedPlan` is the account's subscriptions.plan as stored (a legacy row keeps
 * its legacy key: the webhook never rewrites the plan of a legacy price).
 */
export async function subscriptionChange(stripe: Stripe, current: SubscriptionShape, order: PlanOrder, storedPlan?: string | null):
  Promise<{ items: ItemChange[]; addInvoiceItems: InvoiceItem[] }> {
  const items: ItemChange[] = [];
  const foreign = current.otherItems.filter((item) => !roleOfPrice(item.price));
  const duplicates = current.otherItems.filter((item) => !!roleOfPrice(item.price));
  if (!current.planItem && foreign.length > 1) throw SALES_SET_UP();
  // A lone custom price is only a legacy plan when the account was sold a legacy plan.
  const legacyRow = typeof storedPlan === "string" && Object.hasOwn(LEGACY_PLAN_MAP, storedPlan);
  if (!current.planItem && foreign.length === 1 && !legacyRow) throw SALES_SET_UP();
  const planSlot = current.planItem ?? foreign[0] ?? null;
  const kept = foreign.filter((item) => item !== planSlot);
  if (kept.some((item) => item.price?.recurring?.interval && item.price.recurring.interval !== order.interval)) throw SALES_SET_UP();

  const planPrice = await resolvePriceId(stripe, planPriceSpec(order.plan, order.interval));
  if (!planSlot) items.push({ price: planPrice, quantity: 1 });
  else if (planSlot.price.id !== planPrice || (planSlot.quantity ?? 1) !== 1) items.push({ id: planSlot.id, price: planPrice, quantity: 1 });
  for (const duplicate of duplicates) items.push({ id: duplicate.id, deleted: true });

  const extra = order.plan === "agency" ? agencyExtraLocations(order.agencyLocations ?? 0) : 0;
  items.push(...await slotChange(current.agencyItem, extra, () => resolvePriceId(stripe, agencyLocationsPriceSpec(order.interval))));
  for (const key of ADDON_KEYS) {
    items.push(...await slotChange(current.addonItems[key] ?? null, order.addons[key] ?? 0,
      () => resolvePriceId(stripe, addonPriceSpec(key, order.interval))));
  }

  const addInvoiceItems: InvoiceItem[] = [];
  for (const key of ADDON_KEYS) {
    const setup = addonSetupPriceSpec(key);
    const added = (order.addons[key] ?? 0) - (current.addons[key] ?? 0);
    if (setup && added > 0) addInvoiceItems.push({ price: await resolvePriceId(stripe, setup), quantity: added });
  }
  return { items, addInvoiceItems };
}
