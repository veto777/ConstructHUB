/**
 * Stripe Prices for the price book in shared/plans.ts.
 *
 * Every recurring thing we sell is a Stripe Price found by a lookup_key that
 * spells out what it is AND what it costs (e.g. `chub_v1_plan_pro_month_7900`).
 * The first checkout that needs a price creates it (idempotently: an
 * idempotency key per lookup key, and `transfer_lookup_key` so a retry never
 * leaves two prices fighting over one key). Changing a price in shared/plans.ts
 * therefore yields a new lookup key and a new Stripe Price on the next
 * checkout; existing subscriptions keep the price they were sold at until they
 * change plans.
 *
 * Each Price also carries metadata naming its role (plan / add-on / Agency
 * location band / setup fee). The webhook reads a subscription's plan, interval
 * and add-on quantities back from its items through that metadata — never from
 * anything the client sent.
 */
import type Stripe from "stripe";
import {
  PLANS, ADDONS, AGENCY_LOCATION_BANDS, ANNUAL_MONTHS,
  planPriceCents, addonPriceCents, isPlanKey, isAddonKey, isBillingInterval,
  type PlanKey, type AddonKey, type BillingInterval,
} from "@shared/plans";
import {
  CRM_PLANS, CRM_ADDONS, CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_EXTRA_SEAT_ANNUAL_CENTS, crmPlanPriceCents, crmAddonPriceCents, isCrmPlanKey,
  type CrmPlanKey, type CrmAddonKey,
} from "@shared/crm-plans";

const PREFIX = "chub_v1";

export type PriceRole =
  | { kind: "plan"; key: PlanKey; interval: BillingInterval }
  | { kind: "addon"; key: AddonKey; interval: BillingInterval }
  | { kind: "agency_locations"; interval: BillingInterval }
  | { kind: "setup"; key: AddonKey }
  // The CRM is a separate product with its own subscription (server/crm/billing.ts).
  | { kind: "crm_plan"; key: CrmPlanKey; interval: BillingInterval }
  | { kind: "crm_seat"; interval: BillingInterval }
  // A yes/no add-on on the CRM subscription (shared/crm-plans.ts CRM_ADDONS).
  | { kind: "crm_addon"; key: CrmAddonKey; interval: BillingInterval };

export type PriceSpec = {
  lookupKey: string;
  role: PriceRole;
  params: Stripe.PriceCreateParams;
};

type Tier = { up_to: number | "inf"; unit_amount: number };

/**
 * Graduated tiers for the Agency per-location item. Its quantity is the
 * locations ABOVE the included ones, so each band's bound is shifted down by
 * the included count. The last band is open-ended in Stripe; checkout and the
 * daily sync never bill past AGENCY_SELF_SERVE_MAX_LOCATIONS.
 */
export function agencyLocationTiers(interval: BillingInterval): Tier[] {
  const included = PLANS.agency.limits.locations;
  const multiplier = interval === "year" ? ANNUAL_MONTHS : 1;
  const paid = AGENCY_LOCATION_BANDS.filter((band) => band.centsPerLocation > 0);
  return paid.map((band, i) => ({
    up_to: i === paid.length - 1 ? "inf" : band.upTo - included,
    unit_amount: band.centsPerLocation * multiplier,
  }));
}

/** What `quantity` extra Agency locations cost on the tiered price (mirrors Stripe's graduated maths). */
export function tieredAmountCents(tiers: Tier[], quantity: number): number {
  let cents = 0, prev = 0;
  for (const tier of tiers) {
    const top = tier.up_to === "inf" ? quantity : Math.min(quantity, tier.up_to);
    cents += Math.max(0, top - prev) * tier.unit_amount;
    if (tier.up_to === "inf" || quantity <= tier.up_to) break;
    prev = tier.up_to;
  }
  return cents;
}

function roleMetadata(role: PriceRole): Record<string, string> {
  return {
    chub_kind: role.kind,
    chub_key: "key" in role ? role.key : "",
    chub_interval: "interval" in role ? role.interval : "once",
  };
}

export function planPriceSpec(plan: PlanKey, interval: BillingInterval): PriceSpec {
  const cents = planPriceCents(plan, interval);
  return {
    lookupKey: `${PREFIX}_plan_${plan}_${interval}_${cents}`,
    role: { kind: "plan", key: plan, interval },
    params: {
      currency: "usd",
      unit_amount: cents,
      recurring: { interval },
      product_data: { name: `ConstructHUB ${PLANS[plan].name}` },
    },
  };
}

export function addonPriceSpec(addon: AddonKey, interval: BillingInterval): PriceSpec {
  const cents = addonPriceCents(addon, interval);
  return {
    lookupKey: `${PREFIX}_addon_${addon}_${interval}_${cents}`,
    role: { kind: "addon", key: addon, interval },
    params: {
      currency: "usd",
      unit_amount: cents,
      recurring: { interval },
      product_data: { name: `ConstructHUB add-on — ${ADDONS[addon].name}` },
    },
  };
}

/** One-time setup fee for an add-on that has one (texting number); null otherwise. */
export function addonSetupPriceSpec(addon: AddonKey): PriceSpec | null {
  const cents = ADDONS[addon].setupCents;
  if (!cents) return null;
  return {
    lookupKey: `${PREFIX}_setup_${addon}_${cents}`,
    role: { kind: "setup", key: addon },
    params: {
      currency: "usd",
      unit_amount: cents,
      product_data: { name: `ConstructHUB — ${ADDONS[addon].name} setup (one time)` },
    },
  };
}

/** A CRM plan (shared/crm-plans.ts). Annual is its own price, not ANNUAL_MONTHS x monthly. */
export function crmPlanPriceSpec(plan: CrmPlanKey, interval: BillingInterval): PriceSpec {
  const cents = crmPlanPriceCents(plan, interval);
  return {
    lookupKey: `${PREFIX}_crmplan_${plan}_${interval}_${cents}`,
    role: { kind: "crm_plan", key: plan, interval },
    params: {
      currency: "usd",
      unit_amount: cents,
      recurring: { interval },
      product_data: { name: `ConstructHUB ${CRM_PLANS[plan].name}` },
    },
  };
}

/** One extra CRM seat, on a CRM subscription. */
export function crmSeatPriceSpec(interval: BillingInterval): PriceSpec {
  const cents = interval === "year" ? CRM_EXTRA_SEAT_ANNUAL_CENTS : CRM_EXTRA_SEAT_MONTHLY_CENTS;
  return {
    lookupKey: `${PREFIX}_crmseat_${interval}_${cents}`,
    role: { kind: "crm_seat", interval },
    params: {
      currency: "usd",
      unit_amount: cents,
      recurring: { interval },
      product_data: { name: "ConstructHUB CRM — extra seat" },
    },
  };
}

/** A CRM add-on (JobCam), one line on a CRM subscription. Annual is its own explicit price. */
export function crmAddonPriceSpec(addon: CrmAddonKey, interval: BillingInterval): PriceSpec {
  const cents = crmAddonPriceCents(addon, interval);
  return {
    lookupKey: `${PREFIX}_crmaddon_${addon}_${interval}_${cents}`,
    role: { kind: "crm_addon", key: addon, interval },
    params: {
      currency: "usd",
      unit_amount: cents,
      recurring: { interval },
      product_data: { name: `ConstructHUB CRM — ${CRM_ADDONS[addon].name} add-on` },
    },
  };
}

export function agencyLocationsPriceSpec(interval: BillingInterval): PriceSpec {
  const tiers = agencyLocationTiers(interval);
  const signature = tiers.map((t) => `${t.up_to}x${t.unit_amount}`).join("-");
  return {
    lookupKey: `${PREFIX}_agencyloc_${interval}_${signature}`,
    role: { kind: "agency_locations", interval },
    params: {
      currency: "usd",
      recurring: { interval },
      billing_scheme: "tiered",
      tiers_mode: "graduated",
      tiers,
      product_data: { name: `ConstructHUB Agency — locations above ${PLANS.agency.limits.locations}` },
    },
  };
}

/** A found price is only reused when it is exactly the one the spec describes. */
function priceMatches(price: Stripe.Price, spec: PriceSpec): boolean {
  const p = spec.params;
  if (price.currency !== p.currency) return false;
  if ((price.recurring?.interval ?? null) !== (p.recurring?.interval ?? null)) return false;
  if (p.billing_scheme === "tiered") {
    if (price.billing_scheme !== "tiered" || price.tiers_mode !== "graduated") return false;
    const want = p.tiers ?? [];
    const got = price.tiers ?? [];
    return got.length === want.length && got.every((t, i) =>
      (t.up_to ?? "inf") === want[i].up_to && t.unit_amount === want[i].unit_amount);
  }
  return price.unit_amount === p.unit_amount;
}

const priceIds = new Map<string, string>();
/** Test hook: forget resolved price ids. */
export function resetPriceCache() { priceIds.clear(); }

/** The Stripe Price id for a spec, creating the Price once if Stripe has none under its lookup key. */
export async function resolvePriceId(stripe: Stripe, spec: PriceSpec): Promise<string> {
  const cached = priceIds.get(spec.lookupKey);
  if (cached) return cached;
  const found = await stripe.prices.list({ lookup_keys: [spec.lookupKey], active: true, limit: 1, expand: ["data.tiers"] });
  let id = found.data.find((price) => priceMatches(price, spec))?.id;
  if (!id) {
    const created = await stripe.prices.create(
      { ...spec.params, lookup_key: spec.lookupKey, transfer_lookup_key: true, metadata: roleMetadata(spec.role) },
      { idempotencyKey: `chub-price-${spec.lookupKey}` },
    );
    id = created.id;
  }
  priceIds.set(spec.lookupKey, id);
  return id;
}

/** The role we gave a Price when we created it, or null for a price we did not create (legacy checkouts). */
export function roleOfPrice(price: Stripe.Price | null | undefined): PriceRole | null {
  const meta = price?.metadata ?? {};
  const interval = price?.recurring?.interval;
  switch (meta.chub_kind) {
    case "plan":
      return isPlanKey(meta.chub_key) && isBillingInterval(interval) ? { kind: "plan", key: meta.chub_key, interval } : null;
    case "addon":
      return isAddonKey(meta.chub_key) && isBillingInterval(interval) ? { kind: "addon", key: meta.chub_key, interval } : null;
    case "agency_locations":
      return isBillingInterval(interval) ? { kind: "agency_locations", interval } : null;
    case "setup":
      return isAddonKey(meta.chub_key) ? { kind: "setup", key: meta.chub_key } : null;
    case "crm_plan":
      return isCrmPlanKey(meta.chub_key) && isBillingInterval(interval) ? { kind: "crm_plan", key: meta.chub_key, interval } : null;
    case "crm_seat":
      return isBillingInterval(interval) ? { kind: "crm_seat", interval } : null;
    case "crm_addon":
      return typeof meta.chub_key === "string" && meta.chub_key in CRM_ADDONS && isBillingInterval(interval)
        ? { kind: "crm_addon", key: meta.chub_key as CrmAddonKey, interval } : null;
    default:
      return null;
  }
}

export type SubscriptionShape = {
  /** Current-price-book plan, or null when the subscription is on a legacy price. */
  plan: PlanKey | null;
  interval: BillingInterval | null;
  addons: Partial<Record<AddonKey, number>>;
  agencyExtraLocations: number;
  planItem: Stripe.SubscriptionItem | null;
  agencyItem: Stripe.SubscriptionItem | null;
  addonItems: Partial<Record<AddonKey, Stripe.SubscriptionItem>>;
  /** Items on prices we did not create (a legacy plan price). */
  otherItems: Stripe.SubscriptionItem[];
};

/** Read plan, interval, add-on quantities and Agency extra locations from a subscription's items. */
export function describeSubscription(items: Stripe.SubscriptionItem[]): SubscriptionShape {
  const shape: SubscriptionShape = {
    plan: null, interval: null, addons: {}, agencyExtraLocations: 0,
    planItem: null, agencyItem: null, addonItems: {}, otherItems: [],
  };
  for (const item of items) {
    const role = roleOfPrice(item.price);
    const quantity = item.quantity ?? 1;
    if (role?.kind === "plan" && !shape.planItem) {
      shape.plan = role.key;
      shape.interval = role.interval;
      shape.planItem = item;
    } else if (role?.kind === "addon" && !shape.addonItems[role.key]) {
      shape.addonItems[role.key] = item;
      if (quantity > 0) shape.addons[role.key] = quantity;
    } else if (role?.kind === "agency_locations" && !shape.agencyItem) {
      shape.agencyItem = item;
      shape.agencyExtraLocations = quantity;
    } else {
      shape.otherItems.push(item);
    }
  }
  if (!shape.interval) {
    const interval = items.map((i) => i.price?.recurring?.interval).find(isBillingInterval);
    shape.interval = interval ?? null;
  }
  return shape;
}
