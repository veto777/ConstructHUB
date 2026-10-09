import { describe, it, expect } from "vitest";
import {
  CRM_PLANS, CRM_PLAN_KEYS, CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_TRIAL_DAYS, crmPlanPriceCents, cheapestCrmPlanWhere, isCrmPlanKey,
} from "@shared/crm-plans";
import { PLANS, PLAN_KEYS, ADDONS, CALL_ASSISTANT_FROM_CENTS, CALL_ASSISTANT_TIERS } from "@shared/plans";
import { crmPlanPriceSpec, crmSeatPriceSpec, planPriceSpec, roleOfPrice } from "../billing/prices";

/** Housecall Pro's published prices on 2026-10-07 (housecallpro.com/pricing), in cents. */
const HOUSECALL = {
  crm_basic: { month: 7900, yearPerMonth: 5900, users: 1 },
  crm_essentials: { month: 18900, yearPerMonth: 14900, users: 5 },
  crm_max: { month: 32900, yearPerMonth: 29900, users: 8 },
} as const;

describe("the CRM is a separate product", () => {
  it("costs half of Housecall Pro or less, monthly and yearly, with the same seats (owner, 2026-10-07)", () => {
    for (const key of CRM_PLAN_KEYS) {
      const ours = CRM_PLANS[key], theirs = HOUSECALL[key];
      expect(ours.monthlyCents, key).toBeLessThanOrEqual(theirs.month / 2);
      expect(ours.annualCents, key).toBeLessThanOrEqual((theirs.yearPerMonth * 12) / 2);
      expect(ours.limits.seats, key).toBe(theirs.users);
      expect(crmPlanPriceCents(key, "month")).toBe(ours.monthlyCents);
      expect(crmPlanPriceCents(key, "year")).toBe(ours.annualCents);
    }
    expect(CRM_EXTRA_SEAT_MONTHLY_CENTS).toBeLessThanOrEqual(3500 / 2);
    // The trial length is the constant's (owner, 2026-10-07: 7 days, down from 14) — never a literal here, and every
    // piece of copy that names it reads the constant (the help entries once said "14-day" after the change).
    expect(Number.isInteger(CRM_TRIAL_DAYS) && CRM_TRIAL_DAYS >= 7 && CRM_TRIAL_DAYS <= 30).toBe(true);
  });

  it("no platform plan grants CRM seats, and the platform's seat add-on is Agency-only", () => {
    for (const key of PLAN_KEYS) {
      expect("crmSeats" in PLANS[key].limits, key).toBe(false);
      expect(PLANS[key].features.join(" "), key).not.toMatch(/\bCRM\b/);
    }
    expect(ADDONS.extra_seat.availableOn).toEqual(["agency"]);
  });

  it("every plan of either product says what it does NOT include, and names the other product", () => {
    for (const key of PLAN_KEYS) {
      expect(PLANS[key].notIncluded.length, key).toBeGreaterThan(0);
      expect(PLANS[key].notIncluded[0], key).toMatch(/ConstructHUB CRM/);
    }
    for (const key of CRM_PLAN_KEYS) {
      const text = CRM_PLANS[key].notIncluded.join(" ");
      expect(text, key).toMatch(/Google Business Profile/);
      expect(text, key).toMatch(/Click Guard/);
      expect(text, key).toMatch(/[Pp]ermit/);
    }
  });

  it("every plan of either product says the AI Call Assistant is a separate service, with its real starting price (owner, 2026-10-08)", () => {
    const line = `The AI Call Assistant — answers your phone 24/7, screens spam and files the lead (a separate service, from $${CALL_ASSISTANT_FROM_CENTS / 100}/mo)`;
    for (const key of PLAN_KEYS) expect(PLANS[key].notIncluded, key).toContain(line);
    for (const key of CRM_PLAN_KEYS) expect(CRM_PLANS[key].notIncluded, key).toContain(line);
    expect(CALL_ASSISTANT_FROM_CENTS).toBe(Math.min(...CALL_ASSISTANT_TIERS.map((t) => t.monthlyCents)));
  });

  it("the CRM line in a platform plan quotes the CRM's real starting price", () => {
    const from = `$${CRM_PLANS.crm_basic.monthlyCents / 100}/mo`;
    for (const key of PLAN_KEYS) expect(PLANS[key].notIncluded[0], key).toContain(from);
  });

  it("has its own Stripe prices, told apart from platform prices by role", () => {
    const spec = crmPlanPriceSpec("crm_essentials", "year");
    expect(spec.params.unit_amount).toBe(CRM_PLANS.crm_essentials.annualCents);
    expect(spec.lookupKey).toBe(`chub_v1_crmplan_crm_essentials_year_${CRM_PLANS.crm_essentials.annualCents}`);
    expect(spec.lookupKey).not.toBe(planPriceSpec("pro", "year").lookupKey);
    const price = (role: any, interval: string) => ({ metadata: { chub_kind: role.kind, chub_key: role.key ?? "" }, recurring: { interval } }) as any;
    expect(roleOfPrice(price(spec.role, "year"))).toEqual({ kind: "crm_plan", key: "crm_essentials", interval: "year" });
    expect(roleOfPrice(price(crmSeatPriceSpec("month").role, "month"))).toEqual({ kind: "crm_seat", interval: "month" });
    expect(roleOfPrice(price({ kind: "crm_plan", key: "pro" }, "month"))).toBeNull();
    expect(crmSeatPriceSpec("month").params.unit_amount).toBe(CRM_EXTRA_SEAT_MONTHLY_CENTS);
  });

  it("plan keys never collide with the platform's", () => {
    for (const key of CRM_PLAN_KEYS) expect((PLAN_KEYS as readonly string[]).includes(key)).toBe(false);
    expect(isCrmPlanKey("pro")).toBe(false);
    expect(cheapestCrmPlanWhere((l) => l.seats >= 5)).toBe("crm_essentials");
    expect(cheapestCrmPlanWhere((l) => l.seats >= 99)).toBeNull();
  });
});
