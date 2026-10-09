/**
 * The price block of a feature page, computed from the price book
 * (shared/plans.ts) through the plan-copy helpers. A content file only says
 * HOW the feature is sold (FeaturePricing); every name, number and price on
 * the page comes from here, so the page can never promise something checkout
 * and the entitlement gates don't.
 */
import {
  ADDONS, ADDON_MODULES, GBP_REINSTATEMENT_CENTS, PLANS, PLAN_KEYS, TRIAL_DAYS, CALL_ASSISTANT_ANNUAL_MONTHS, CALL_ASSISTANT_PRICING_HREF,
  planForModule, showsPrice, isCallAssistantAddon,
  type AddonModuleKey, type CountLimitKey, type ModuleKey, type Plan, type PlanKey, type PlanLimits,
} from "../plans";
import { CRM_ADDONS, CRM_PLANS, CRM_PLAN_KEYS, CRM_TRIAL_DAYS } from "../crm-plans";
import { SALES_HREF, SALES_REP_LABEL, formatUsd, joinNames, plansWhere, priceOrSalesRep } from "../plan-copy";
import type { FeatureAllowance, FeaturePricing } from "./types";

export type FeaturePriceRow = { label: string; value: string; included: boolean };

export type FeaturePriceSummary = {
  /** "Included in every plan", "Included from the Pro plan", "Agency plan", "Add-on", "Separate service", … */
  headline: string;
  /** The figure under the headline ("$29"), or null when there is none to show. */
  price: string | null;
  /** "/mo", " one-time" or "" — printed right after `price`. */
  per: string;
  /** `price` is the lowest of several prices (the cheapest CRM plan, the cheapest Call Assistant tier): the page says "from $X". */
  from?: boolean;
  /** Words that finish the price in a sentence: " on CRM Basic and CRM Essentials; included in CRM Max ($164/mo)". */
  priceTail?: string;
  /** One sentence about the price: which plan it is, how yearly billing works. */
  priceNote: string;
  /** Plan by plan: what each one gets ("2 Site Scans a month", "Not included"). */
  rows: FeaturePriceRow[];
  /** Plans that include it, cheapest first (empty for add-ons, services and free features). */
  plans: PlanKey[];
  /** Listed but not for sale yet (a `preview` add-on). */
  comingSoon: boolean;
  /** Where "compare" goes on /pricing. */
  link: { label: string; href: string };
  /** The content file's own extra sentence, if any. */
  note?: string;
};

const PER_MONTH = "/mo";
const fromPlan = (key: PlanKey) => `${PLANS[key].name} plan, ${formatUsd(PLANS[key].monthlyCents)}/mo or ${formatUsd(PLANS[key].annualCents)}/yr`;

/** "Site Scans" → "Site Scan", "permit searches" → "permit search" (units are written plural). */
export function singularUnit(unit: string): string {
  if (/(ch|sh|ss|x)es$/.test(unit)) return unit.slice(0, -2);
  return unit.endsWith("s") ? unit.slice(0, -1) : unit;
}

const countOf = (n: number, unit: string) => `${n.toLocaleString("en-US")} ${n === 1 ? singularUnit(unit) : unit}`;

/** "2 Site Scans a month", "1 Site Scan per location a month", "Unlimited (fair use)", or null when the plan has none. */
export function allowanceValue(plan: Plan, a: FeatureAllowance): string | null {
  const flat = plan.limits[a.limit as CountLimitKey] as number;
  const per = a.perLocation ? (plan.limits[a.perLocation] as number) : 0;
  const tail = a.period === "month" ? " a month" : "";
  if (flat < 0) return "Unlimited (fair use)";
  if (flat > 0) return `${countOf(flat, a.unit)}${tail}`;
  if (per > 0) return `${countOf(per, a.unit)} per location${tail}`;
  return null;
}

function allowanceRows(a: FeatureAllowance, keys: readonly PlanKey[] = PLAN_KEYS): FeaturePriceRow[] {
  return keys.map((key) => {
    const value = allowanceValue(PLANS[key], a);
    return { label: PLANS[key].name, value: value ?? "Not included", included: value !== null };
  });
}

const includedRows = (included: readonly PlanKey[]): FeaturePriceRow[] =>
  PLAN_KEYS.map((key) => ({ label: PLANS[key].name, value: included.includes(key) ? "Included" : "Not included", included: included.includes(key) }));

const PLANS_LINK = { label: "Compare plans", href: "/pricing#comparison" };

export function featurePriceSummary(spec: FeaturePricing): FeaturePriceSummary {
  const note = spec.note;
  switch (spec.kind) {
    case "plan": {
      const cheapest = PLAN_KEYS.reduce((a, b) => (PLANS[b].monthlyCents < PLANS[a].monthlyCents ? b : a));
      return {
        headline: "Included in every plan",
        price: formatUsd(PLANS[cheapest].monthlyCents), per: PER_MONTH,
        priceNote: `From the ${fromPlan(cheapest)}. A new account's first plan starts with a ${TRIAL_DAYS}-day trial.`,
        rows: spec.allowance ? allowanceRows(spec.allowance) : includedRows(PLAN_KEYS),
        plans: [...PLAN_KEYS], comingSoon: false, link: PLANS_LINK, note,
      };
    }
    case "allowance": {
      const a = spec.allowance;
      const plans = plansWhere((plan) => allowanceValue(plan, a) !== null);
      const cheapest = plans[0] ?? "agency";
      return {
        headline: plans.length === PLAN_KEYS.length ? "Included in every plan" : `Included from the ${PLANS[cheapest].name} plan`,
        price: formatUsd(PLANS[cheapest].monthlyCents), per: PER_MONTH,
        priceNote: `From the ${fromPlan(cheapest)}. A new account's first plan starts with a ${TRIAL_DAYS}-day trial.`,
        rows: allowanceRows(a), plans, comingSoon: false, link: PLANS_LINK, note,
      };
    }
    case "module": {
      const plans = plansWhere((plan) => plan.modules[spec.module]);
      const cheapest = plans[0] ?? planForModule(spec.module);
      const only = plans.length === 1;
      return {
        headline: only ? `${PLANS[cheapest].name} plan` : `Included from the ${PLANS[cheapest].name} plan`,
        price: formatUsd(PLANS[cheapest].monthlyCents), per: PER_MONTH,
        priceNote: only
          ? `Part of the ${fromPlan(cheapest)}; no other plan includes it.`
          : `From the ${fromPlan(cheapest)}.`,
        rows: spec.allowance ? allowanceRows(spec.allowance, plans) : includedRows(plans),
        plans, comingSoon: false, link: PLANS_LINK, note,
      };
    }
    case "addon": {
      const addon = ADDONS[spec.addon];
      const setup = addon.setupCents ? ` plus a ${formatUsd(addon.setupCents)} one-time setup fee` : "";
      const soldOn = `the ${joinNames(addon.availableOn.map((k) => PLANS[k].name))} plan${addon.availableOn.length > 1 ? "s" : ""}`;
      // The AI Call Assistant is a SEPARATE SERVICE sold in tiers on its own subscription (owner, 2026-10-08):
      // priced from its cheapest tier, the note lists every tier — never one middle tier's price as if it were
      // the price — and no platform plan "includes" or "sells" it: the rows say so for every plan.
      const tiers = isCallAssistantAddon(spec.addon) && addon.exclusiveGroup
        ? Object.values(ADDONS).filter((a) => a.exclusiveGroup === addon.exclusiveGroup).sort((a, b) => a.monthlyCents - b.monthlyCents)
        : [];
      if (tiers.length > 1) {
        return {
          headline: "Separate service",
          price: formatUsd(tiers[0].monthlyCents), per: PER_MONTH, from: true,
          priceNote: `${joinNames(tiers.map((t) => `${t.name}: ${formatUsd(t.monthlyCents)}/mo or ${formatUsd(t.annualCents)}/yr`))} (yearly is ${CALL_ASSISTANT_ANNUAL_MONTHS} times the monthly price). One tier per account, on its own subscription: no ConstructHUB plan includes it, and none is needed to buy it.`,
          rows: PLAN_KEYS.map((key) => ({ label: PLANS[key].name, value: "Not included — a separate service", included: false })),
          plans: [], comingSoon: tiers.every((t) => t.preview === true), link: { label: "See Call Assistant pricing", href: CALL_ASSISTANT_PRICING_HREF }, note,
        };
      }
      return {
        headline: "Add-on",
        price: formatUsd(addon.monthlyCents), per: PER_MONTH,
        priceNote: `${addon.name}: ${formatUsd(addon.monthlyCents)}/mo or ${formatUsd(addon.annualCents)}/yr${setup}, added to ${soldOn}.`,
        rows: PLAN_KEYS.map((key) => ({
          label: PLANS[key].name,
          value: addon.availableOn.includes(key) ? "Available as an add-on" : "Not available",
          included: addon.availableOn.includes(key),
        })),
        plans: [], comingSoon: addon.preview === true, link: { label: "See add-ons", href: "/pricing#add-ons" }, note,
      };
    }
    case "crmPlan": {
      // The CRM is a separate product (shared/crm-plans.ts): priced from the cheapest CRM plan, never a platform plan.
      const cheapest = CRM_PLAN_KEYS.reduce((a, b) => (CRM_PLANS[b].monthlyCents < CRM_PLANS[a].monthlyCents ? b : a));
      const plan = CRM_PLANS[cheapest];
      return {
        headline: "Separate CRM plan",
        price: formatUsd(plan.monthlyCents), per: PER_MONTH, from: CRM_PLAN_KEYS.length > 1,
        priceNote: `From ${plan.name}, ${formatUsd(plan.monthlyCents)}/mo or ${formatUsd(plan.annualCents)}/yr. The CRM is a separate product with its own plans; the ConstructHUB platform plans do not include it. A first CRM subscription starts with a ${CRM_TRIAL_DAYS}-day trial.`,
        rows: CRM_PLAN_KEYS.map((key) => {
          const seats = CRM_PLANS[key].limits.seats;
          return { label: CRM_PLANS[key].name, value: seats < 0 ? "Unlimited seats (fair use)" : `${seats} seat${seats === 1 ? "" : "s"}`, included: true };
        }),
        plans: [], comingSoon: false, link: { label: "See CRM plans", href: "/pricing#crm" }, note,
      };
    }
    case "crmAddon": {
      // Sold on the CRM subscription, not a platform plan: the rows are the CRM's plans.
      const addon = CRM_ADDONS[spec.addon];
      const includedIn = CRM_PLAN_KEYS.filter((k) => !addon.availableOn.includes(k));
      const names = (keys: readonly (typeof CRM_PLAN_KEYS)[number][]) => joinNames(keys.map((k) => CRM_PLANS[k].name));
      // The figure is the ADD-ON's price, so the headline and the words after it say where that price
      // applies; the plan that includes the feature has its own price, stated beside its name.
      const withPrice = (keys: readonly (typeof CRM_PLAN_KEYS)[number][]) => joinNames(keys.map((k) => `${CRM_PLANS[k].name} (${formatUsd(CRM_PLANS[k].monthlyCents)}/mo)`));
      return {
        headline: "CRM add-on",
        price: formatUsd(addon.monthlyCents), per: PER_MONTH,
        priceTail: ` on ${names(addon.availableOn)}${includedIn.length ? `; included in ${withPrice(includedIn)}` : ""}`,
        priceNote: `${addon.name} add-on: ${formatUsd(addon.monthlyCents)}/mo or ${formatUsd(addon.annualCents)}/yr, added to ${names(addon.availableOn)}.${includedIn.length ? ` ${withPrice(includedIn)} includes it at no extra charge.` : ""}`,
        rows: CRM_PLAN_KEYS.map((key) => ({
          label: CRM_PLANS[key].name,
          value: addon.availableOn.includes(key) ? "Available as an add-on" : "Included",
          included: true,
        })),
        plans: [], comingSoon: false, link: { label: "See CRM plans", href: "/pricing#crm" }, note,
      };
    }
    case "account":
      return {
        headline: "Free with an account",
        price: null, per: "",
        priceNote: "Any ConstructHUB account can use it; it is not counted against a plan.",
        rows: [], plans: [], comingSoon: false, link: { label: "See plans", href: "/pricing" }, note,
      };
    case "service": {
      const cents = GBP_REINSTATEMENT_CENTS;
      return {
        headline: "One-time service",
        price: priceOrSalesRep(cents), per: showsPrice(cents) ? " one-time" : "",
        priceNote: "Paid once per project, not a subscription.",
        rows: [], plans: [], comingSoon: false, link: { label: "See services", href: SALES_HREF }, note,
      };
    }
    case "sales":
      return {
        headline: SALES_REP_LABEL,
        price: null, per: "",
        priceNote: `${spec.topic} is quoted by a sales rep for your business.`,
        rows: [], plans: [], comingSoon: false, link: { label: "See services", href: SALES_HREF }, note,
      };
  }
}

/**
 * One sentence of plan allowances for copy (FAQ answers):
 * "Site Scans a month: Starter 2, Pro 5, Growth 15 and Agency 1 per location".
 * Plans without the allowance are left out.
 */
export function allowanceLine(a: FeatureAllowance): string {
  // The CRM is its own product: its seats come from the CRM price book.
  if (a.limit === "crmPlanSeats") {
    const seats = CRM_PLAN_KEYS.map((k) => `${CRM_PLANS[k].name} ${CRM_PLANS[k].limits.seats}`);
    return `${a.unit}: ${joinNames(seats)}`;
  }
  // Hoisted: the narrowing above does not survive into the callback below.
  const limitKey = a.limit;
  const parts = PLAN_KEYS.flatMap((key) => {
    const plan = PLANS[key];
    const flat = plan.limits[limitKey] as number;
    const per = a.perLocation ? (plan.limits[a.perLocation] as number) : 0;
    const value = flat < 0 ? "unlimited (fair use)" : flat > 0 ? flat.toLocaleString("en-US") : per > 0 ? `${per.toLocaleString("en-US")} per location` : null;
    return value ? [`${plan.name} ${value}`] : [];
  });
  return `${a.unit}${a.period === "month" ? " a month" : ""}: ${joinNames(parts)}`;
}

/** The slice of GET /api/entitlements the "is it in my plan?" check reads. */
export type FeatureEntitlementsInput = {
  accessPlan: PlanKey | null;
  allowances: PlanLimits | null;
  modules: Partial<Record<ModuleKey, boolean>>;
  addonModules?: Partial<Record<AddonModuleKey, boolean>>;
};

/** What a signed-in account on a plan that lacks the feature is offered instead of "Open <feature>". */
export type FeaturePlanGap = { label: string; href: string; note: string };

/**
 * Null when the account can use the feature (or the page can't tell); otherwise
 * the upgrade step. It mirrors the server's gates (requireModule, the allowance
 * tests, add-on modules). An account with no plan of its own gets null: a crew
 * seat or workspace teammate works under someone else's plan, which this check
 * can't see, so the page keeps "Open <feature>" and the app decides.
 */
export function featurePlanGap(spec: FeaturePricing, ent: FeatureEntitlementsInput): FeaturePlanGap | null {
  if (!ent.accessPlan) return null;
  const current = PLANS[ent.accessPlan].name;
  const upgrade = (plans: PlanKey[]): FeaturePlanGap | null => {
    const target = plans.find((k) => k !== ent.accessPlan);
    return target ? { label: `Upgrade to ${PLANS[target].name}`, href: "/pricing", note: `Not in your ${current} plan.` } : null;
  };
  switch (spec.kind) {
    case "module":
      return ent.modules[spec.module] ? null : upgrade(plansWhere((plan) => plan.modules[spec.module]));
    case "allowance": {
      const a = spec.allowance, l = ent.allowances;
      // The CRM is a separate subscription: a platform plan never satisfies it,
      // and no platform upgrade would, so point at the CRM price book instead.
      if (a.limit === "crmPlanSeats") {
        return { label: "See CRM plans", href: "/pricing#crm", note: "The CRM is a separate subscription from your platform plan." };
      }
      const has = !!l && ((l[a.limit] as number) !== 0 || (!!a.perLocation && (l[a.perLocation] as number) > 0));
      return has ? null : upgrade(plansWhere((plan) => allowanceValue(plan, a) !== null));
    }
    // "crmAddon" (JobCam) falls through to null: it hangs off the CRM subscription, which this check can't
    // see, so the page keeps "Open <feature>" and the CRM shows its own upgrade card to a workspace without it.
    case "addon": {
      const module = (Object.keys(ADDON_MODULES) as AddonModuleKey[]).find((k) => ADDON_MODULES[k] === spec.addon);
      if (!module || ent.addonModules?.[module]) return null;
      // The AI Call Assistant is a separate service: no plan upgrade would add it, so point at its own pricing.
      return { label: "See Call Assistant pricing", href: CALL_ASSISTANT_PRICING_HREF, note: `A separate service, not part of your ${current} plan.` };
    }
    default:
      return null;
  }
}
