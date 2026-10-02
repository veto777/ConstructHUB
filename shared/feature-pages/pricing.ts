/**
 * The price block of a feature page, computed from the price book
 * (shared/plans.ts) through the plan-copy helpers. A content file only says
 * HOW the feature is sold (FeaturePricing); every name, number and price on
 * the page comes from here, so the page can never promise something checkout
 * and the entitlement gates don't.
 */
import {
  ADDONS, GBP_REINSTATEMENT_CENTS, PLANS, PLAN_KEYS, TRIAL_DAYS, planForModule, showsPrice,
  type CountLimitKey, type Plan, type PlanKey,
} from "../plans";
import { SALES_HREF, SALES_REP_LABEL, formatUsd, joinNames, plansWhere, priceOrSalesRep } from "../plan-copy";
import type { FeatureAllowance, FeaturePricing } from "./types";

export type FeaturePriceRow = { label: string; value: string; included: boolean };

export type FeaturePriceSummary = {
  /** "Included in every plan", "Included from the Pro plan", "Agency plan", "Add-on", … */
  headline: string;
  /** The figure under the headline ("$29"), or null when there is none to show. */
  price: string | null;
  /** "/mo", " one-time" or "" — printed right after `price`. */
  per: string;
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
        priceNote: `From the ${fromPlan(cheapest)}. Every plan starts with a ${TRIAL_DAYS}-day trial.`,
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
        priceNote: `From the ${fromPlan(cheapest)}. Every plan starts with a ${TRIAL_DAYS}-day trial.`,
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
      return {
        headline: "Add-on",
        price: formatUsd(addon.monthlyCents), per: PER_MONTH,
        priceNote: `${addon.name}: ${formatUsd(addon.monthlyCents)}/mo or ${formatUsd(addon.annualCents)}/yr${setup}, added to the ${joinNames(addon.availableOn.map((k) => PLANS[k].name))} plan${addon.availableOn.length > 1 ? "s" : ""}.`,
        rows: PLAN_KEYS.map((key) => ({
          label: PLANS[key].name,
          value: addon.availableOn.includes(key) ? "Available as an add-on" : "Not available",
          included: addon.availableOn.includes(key),
        })),
        plans: [], comingSoon: addon.preview === true, link: { label: "See add-ons", href: "/pricing#add-ons" }, note,
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
  const parts = PLAN_KEYS.flatMap((key) => {
    const plan = PLANS[key];
    const flat = plan.limits[a.limit] as number;
    const per = a.perLocation ? (plan.limits[a.perLocation] as number) : 0;
    const value = flat < 0 ? "unlimited (fair use)" : flat > 0 ? flat.toLocaleString("en-US") : per > 0 ? `${per.toLocaleString("en-US")} per location` : null;
    return value ? [`${plan.name} ${value}`] : [];
  });
  return `${a.unit}${a.period === "month" ? " a month" : ""}: ${joinNames(parts)}`;
}
