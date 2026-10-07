/**
 * JobCam storage sizes and the JobCam entitlement — the pure rules
 * (shared/jobcam-storage.ts, shared/crm-plans.ts, server/jobcam/plan.ts,
 * server/crm/entitlements.ts). No server, no database, no Stripe.
 */
import { describe, expect, it, vi } from "vitest";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

import {
  JOBCAM_STORAGE_TIERS_GB, JOBCAM_INCLUDED_GB, JOBCAM_BYTES_PER_GB, isJobcamStorageTier, jobcamTierOrIncluded, jobcamTierBytes,
  nextJobcamTierGb, formatJobcamTier, formatJobcamGb, formatJobcamUsage, jobcamStorageState, jobcamStorageFits, jobcamStorageLimitBody,
} from "@shared/jobcam-storage";
import {
  CRM_PLANS, CRM_PLAN_KEYS, CRM_ADDONS, CRM_JOBCAM_ADDON_MONTHLY_CENTS, CRM_JOBCAM_ADDON_ANNUAL_CENTS,
  cheapestCrmPlanWhere, crmAddonAvailableOn, crmAddonPriceCents, crmPlanHasJobcam, crmPlanPriceCents, jobcamOffer,
} from "@shared/crm-plans";
import { PLANS, PLAN_KEYS, ADDONS } from "@shared/plans";
import { crmAddonPriceSpec, crmSeatPriceSpec, resolvePriceId, resetPriceCache, roleOfPrice } from "../billing/prices";

const { crmEntitlementsFromRow } = await import("../crm/entitlements");
const { jobcamAccessFrom, jobcamPlanRequiredBody } = await import("./plan");
const { parseCrmOrder, describeCrmSubscription, crmChangeItems, crmPriceBook } = await import("../crm/billing");

const GB = JOBCAM_BYTES_PER_GB;

describe("jobcam storage sizes", () => {
  it("are 5 (included), 10, 100, 500, 1,000 and 2,000 GB, at 1024³ bytes per GB", () => {
    expect([...JOBCAM_STORAGE_TIERS_GB]).toEqual([5, 10, 100, 500, 1000, 2000]);
    expect(JOBCAM_INCLUDED_GB).toBe(5);
    expect(GB).toBe(1073741824);
    expect(jobcamTierBytes(5)).toBe(5 * 1024 ** 3);
    expect(jobcamTierBytes(2000)).toBe(2000 * 1024 ** 3);
  });

  it("accepts only a size on the list", () => {
    for (const t of JOBCAM_STORAGE_TIERS_GB) expect(isJobcamStorageTier(t)).toBe(true);
    for (const bad of [0, 1, 6, 50, 5.5, -5, 4000, "5", null, undefined, NaN]) expect(isJobcamStorageTier(bad), String(bad)).toBe(false);
    expect(jobcamTierOrIncluded(100)).toBe(100);
    expect(jobcamTierOrIncluded("10")).toBe(10);
    expect(jobcamTierOrIncluded(7)).toBe(5);
    expect(jobcamTierOrIncluded(null)).toBe(5);
  });

  it("knows the next size up, and that the largest has none", () => {
    expect(JOBCAM_STORAGE_TIERS_GB.map((t) => nextJobcamTierGb(t))).toEqual([10, 100, 500, 1000, 2000, null]);
  });

  it('formats "4.2 of 5 GB" and never rounds usage up to the limit', () => {
    expect(formatJobcamUsage(4.2 * GB, 5)).toBe("4.2 of 5 GB");
    expect(formatJobcamUsage(0, 5)).toBe("0 of 5 GB");
    expect(formatJobcamUsage(4.96 * GB, 5)).toBe("4.9 of 5 GB");
    expect(formatJobcamUsage(5 * GB, 5)).toBe("5 of 5 GB");
    expect(formatJobcamUsage(1024, 5)).toBe("<0.1 of 5 GB");
    expect(formatJobcamUsage(812.7 * GB, 1000)).toBe("812 of 1,000 GB");
    expect(formatJobcamTier(2000)).toBe("2,000 GB");
    expect(formatJobcamGb(12.34 * GB)).toBe("12.3");
  });

  it("warns from 80% and is full when nothing more fits — in-flight uploads included", () => {
    expect(jobcamStorageState(3.9 * GB, 5)).toMatchObject({ warn: false, full: false, nextTierGb: 10, label: "3.9 of 5 GB" });
    expect(jobcamStorageState(4 * GB, 5)).toMatchObject({ warn: true, full: false });
    expect(jobcamStorageState(5 * GB, 5)).toMatchObject({ warn: true, full: true, ratio: 1 });
    expect(jobcamStorageState(4 * GB, 5, 1 * GB).full).toBe(true);
    // A size lowered below what is stored: over the limit, still "full", nothing negative.
    expect(jobcamStorageState(8 * GB, 5)).toMatchObject({ full: true, ratio: 1, limitBytes: 5 * GB });
    expect(jobcamStorageState(1999 * GB, 2000).nextTierGb).toBeNull();
  });

  it("fits exactly up to the limit and counts what is already on its way", () => {
    const at = (usedBytes: number, pendingBytes: number, addBytes: number) => jobcamStorageFits({ usedBytes, pendingBytes, addBytes, tierGb: 5 });
    expect(at(5 * GB - 100, 0, 100)).toBe(true);
    expect(at(5 * GB - 100, 0, 101)).toBe(false);
    expect(at(4 * GB, GB - 50, 50)).toBe(true);
    expect(at(4 * GB, GB - 50, 51)).toBe(false);
    expect(at(6 * GB, 0, 1)).toBe(false);
  });

  it("refuses in the platform's limit_reached shape, with the numbers and no price or plan to buy", () => {
    const body = jobcamStorageLimitBody({ usedBytes: 4.9 * GB, pendingBytes: 1000, addBytes: 0.2 * GB, tierGb: 5 });
    expect(body).toMatchObject({
      code: "limit_reached", feature: "jobcamStorage", limit: 5 * GB, used: 4.9 * GB, pendingBytes: 1000,
      tierGb: 5, nextTierGb: 10, upgradePlan: null, addon: null,
    });
    expect(body.message).toContain("4.9 of 5 GB");
    expect(body.message).toContain("next size: 10 GB");
    expect(JSON.stringify(body)).not.toMatch(/\$|cents|price/i);
    expect(jobcamStorageLimitBody({ usedBytes: 2000 * GB, pendingBytes: 0, addBytes: 1, tierGb: 2000 }).nextTierGb).toBeNull();
  });
});

describe("JobCam in the CRM plan model", () => {
  it("is included in CRM Max only, and listed as not included on Basic and Essentials", () => {
    expect(CRM_PLAN_KEYS.map((k) => CRM_PLANS[k].limits.jobcam)).toEqual([false, false, true]);
    expect(cheapestCrmPlanWhere((l) => l.jobcam)).toBe("crm_max");
    expect(CRM_PLANS.crm_max.features).toContain("JobCam — job photos & video, 5 GB included");
    for (const k of ["crm_basic", "crm_essentials"] as const) {
      expect(CRM_PLANS[k].features.join(" "), k).not.toMatch(/JobCam/);
      expect(CRM_PLANS[k].notIncluded.filter((l) => /JobCam/.test(l)), k).toEqual([
        "JobCam — job photos & video (add it for $39/mo, or move up to Max, where it is included)",
      ]);
    }
    expect(CRM_PLANS.crm_max.notIncluded.join(" ")).not.toMatch(/JobCam/);
    for (const k of CRM_PLAN_KEYS) expect(CRM_PLANS[k].limits.jobcamStorageGb).toBe(JOBCAM_INCLUDED_GB);
  });

  it("no platform plan or platform add-on sells JobCam", () => {
    for (const k of PLAN_KEYS) expect(JSON.stringify(PLANS[k]), k).not.toMatch(/jobcam/i);
    expect(Object.keys(ADDONS).join(" ")).not.toMatch(/jobcam/i);
  });

  it("the add-on is $39/mo on Basic and Essentials, never on Max, and 12 x $39 a year (no discount assumed)", () => {
    expect(CRM_JOBCAM_ADDON_MONTHLY_CENTS).toBe(3900);
    expect(CRM_JOBCAM_ADDON_ANNUAL_CENTS).toBe(46800);
    expect(CRM_ADDONS.jobcam).toMatchObject({ monthlyCents: 3900, annualCents: 46800, availableOn: ["crm_basic", "crm_essentials"] });
    expect(crmAddonPriceCents("jobcam", "month")).toBe(3900);
    expect(crmAddonPriceCents("jobcam", "year")).toBe(46800);
    expect(crmAddonAvailableOn("jobcam", "crm_basic")).toBe(true);
    expect(crmAddonAvailableOn("jobcam", "crm_essentials")).toBe(true);
    expect(crmAddonAvailableOn("jobcam", "crm_max")).toBe(false);
    expect(crmAddonAvailableOn("jobcam", null)).toBe(false);
    expect(crmPlanHasJobcam("crm_basic", false)).toBe(false);
    expect(crmPlanHasJobcam("crm_basic", true)).toBe(true);
    expect(crmPlanHasJobcam("crm_max", false)).toBe(true);
    expect(crmPlanHasJobcam(null, true)).toBe(false);
  });

  it("the price book lists it; storage sizes carry no price anywhere", async () => {
    expect(crmPriceBook().addons).toEqual([CRM_ADDONS.jobcam]);
    const fs = await import("fs");
    const src = fs.readFileSync(new URL("../../shared/jobcam-storage.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/cents|\$\d/i);
  });
});

describe("upgrade-card data (jobcamOffer)", () => {
  it("Basic and Essentials: add JobCam for $39/mo, or move to CRM Max at its real price", () => {
    for (const plan of ["crm_basic", "crm_essentials"] as const) {
      expect(jobcamOffer(plan, "month")).toEqual({
        kind: "upgrade", plan, interval: "month",
        addon: { key: "jobcam", name: "JobCam", cents: 3900 },
        includedIn: { plan: "crm_max", name: "CRM Max", cents: crmPlanPriceCents("crm_max", "month") },
      });
    }
    const yearly = jobcamOffer("crm_basic", "year");
    expect(yearly).toMatchObject({ addon: { cents: 46800 }, includedIn: { cents: CRM_PLANS.crm_max.annualCents } });
  });

  it("no CRM plan: the standard CRM plan prompt; CRM Max: nothing to sell", () => {
    expect(jobcamOffer(null)).toEqual({ kind: "crm_plan_required" });
    expect(jobcamOffer("crm_max")).toMatchObject({ kind: "upgrade", addon: null, includedIn: null });
  });
});

describe("the JobCam add-on's Stripe price", () => {
  it("has its own lookup key that encodes the amount, monthly and yearly", () => {
    expect(crmAddonPriceSpec("jobcam", "month")).toMatchObject({
      lookupKey: "chub_v1_crmaddon_jobcam_month_3900",
      role: { kind: "crm_addon", key: "jobcam", interval: "month" },
      params: { currency: "usd", unit_amount: 3900, recurring: { interval: "month" } },
    });
    expect(crmAddonPriceSpec("jobcam", "year")).toMatchObject({ lookupKey: "chub_v1_crmaddon_jobcam_year_46800", params: { unit_amount: 46800, recurring: { interval: "year" } } });
    expect(crmAddonPriceSpec("jobcam", "month").lookupKey).not.toBe(crmSeatPriceSpec("month").lookupKey);
  });

  it("is created lazily by lookup key, once, and read back by role", async () => {
    resetPriceCache();
    const store: any[] = [];
    const stripe = {
      prices: {
        list: vi.fn(async ({ lookup_keys }: any) => ({ data: store.filter((p) => lookup_keys.includes(p.lookup_key)) })),
        create: vi.fn(async (params: any) => { const p = { id: `price_${store.length + 1}`, ...params }; store.push(p); return p; }),
      },
    } as any;
    const spec = crmAddonPriceSpec("jobcam", "month");
    const id = await resolvePriceId(stripe, spec);
    expect(await resolvePriceId(stripe, spec)).toBe(id);
    expect(stripe.prices.create).toHaveBeenCalledTimes(1);
    expect(store[0]).toMatchObject({ lookup_key: "chub_v1_crmaddon_jobcam_month_3900", unit_amount: 3900, metadata: { chub_kind: "crm_addon", chub_key: "jobcam", chub_interval: "month" } });
    expect(roleOfPrice({ metadata: store[0].metadata, recurring: { interval: "month" } } as any)).toEqual({ kind: "crm_addon", key: "jobcam", interval: "month" });
    expect(roleOfPrice({ metadata: { chub_kind: "crm_addon", chub_key: "nope" }, recurring: { interval: "month" } } as any)).toBeNull();
    resetPriceCache();
  });
});

describe("the JobCam add-on on a CRM order", () => {
  const item = (id: string, kind: string, key: string, interval = "month", quantity = 1) =>
    ({ id, quantity, price: { id: `price_${id}`, metadata: { chub_kind: kind, chub_key: key }, recurring: { interval } } }) as any;
  const priceId = async (spec: { lookupKey: string }) => `new_${spec.lookupKey}`;

  it("can be ordered on Basic and Essentials, is refused on Max, and needs a CRM plan", () => {
    expect(parseCrmOrder({ plan: "crm_basic", jobcam: true })).toEqual({ plan: "crm_basic", interval: "month", extraSeats: 0, jobcam: true });
    expect(parseCrmOrder({ plan: "crm_essentials", interval: "year", jobcam: true }).jobcam).toBe(true);
    expect(() => parseCrmOrder({ plan: "crm_max", jobcam: true })).toThrowError(/already included in CRM Max/);
    expect(() => parseCrmOrder({ jobcam: true })).toThrowError(/Choose a CRM plan/);
    expect(() => parseCrmOrder({ plan: "crm_basic", jobcam: "yes" })).toThrowError(/on or off/);
    expect(parseCrmOrder({ plan: "crm_basic" }).jobcam).toBe(false);
  });

  it("a change keeps the add-on unless asked, and drops it on a move to the plan that includes JobCam", () => {
    const current = { plan: "crm_basic" as const, interval: "month" as const, extraSeats: 0, jobcam: true };
    expect(parseCrmOrder({}, current).jobcam).toBe(true);
    expect(parseCrmOrder({ plan: "crm_essentials" }, current).jobcam).toBe(true);
    expect(parseCrmOrder({ jobcam: false }, current).jobcam).toBe(false);
    expect(parseCrmOrder({ plan: "crm_max" }, current).jobcam).toBe(false);
  });

  it("reads the add-on back from the subscription's items", () => {
    const sub = { items: { data: [item("si_plan", "crm_plan", "crm_basic"), item("si_jc", "crm_addon", "jobcam")] } } as any;
    expect(describeCrmSubscription(sub)).toMatchObject({ plan: "crm_basic", interval: "month", extraSeats: 0, jobcam: true, jobcamItem: { id: "si_jc" } });
    expect(describeCrmSubscription({ items: { data: [item("si_plan", "crm_plan", "crm_basic")] } } as any).jobcam).toBe(false);
  });

  it("adds one line at the add-on's price, removes it, re-prices it on an interval change", async () => {
    const plan = { ...item("si_plan", "crm_plan", "crm_basic"), price: { id: "new_chub_v1_crmplan_crm_basic_month_3900" } };
    const base = { planItem: plan, seatItem: null, jobcamItem: null, extraSeats: 0 } as any;
    expect(await crmChangeItems(base, { plan: "crm_basic", interval: "month", extraSeats: 0, jobcam: true }, priceId))
      .toEqual([{ price: "new_chub_v1_crmaddon_jobcam_month_3900", quantity: 1 }]);
    const withAddon = { ...base, jobcamItem: { id: "si_jc", price: { id: "new_chub_v1_crmaddon_jobcam_month_3900" } } };
    expect(await crmChangeItems(withAddon, { plan: "crm_basic", interval: "month", extraSeats: 0, jobcam: true }, priceId)).toEqual([]);
    expect(await crmChangeItems(withAddon, { plan: "crm_basic", interval: "month", extraSeats: 0, jobcam: false }, priceId))
      .toEqual([{ id: "si_jc", deleted: true }]);
    expect(await crmChangeItems(withAddon, { plan: "crm_basic", interval: "year", extraSeats: 0, jobcam: true }, priceId)).toEqual([
      { id: "si_plan", price: "new_chub_v1_crmplan_crm_basic_year_34800", quantity: 1 },
      { id: "si_jc", price: "new_chub_v1_crmaddon_jobcam_year_46800", quantity: 1 },
    ]);
    // Moving to CRM Max: the plan changes and the add-on line goes (the plan covers JobCam).
    const toMax = parseCrmOrder({ plan: "crm_max" }, { plan: "crm_basic", interval: "month", extraSeats: 0, jobcam: true });
    expect(await crmChangeItems(withAddon, toMax, priceId)).toEqual([
      { id: "si_plan", price: `new_chub_v1_crmplan_crm_max_month_${CRM_PLANS.crm_max.monthlyCents}`, quantity: 1 },
      { id: "si_jc", deleted: true },
    ]);
  });

});

describe("who has JobCam (crmEntitlementsFromRow → jobcamAccessFrom)", () => {
  const row = (plan: string | null, over: Record<string, unknown> = {}) => ({ plan, status: plan ? "active" : null, extra_seats: 0, jobcam_addon: false, beta_at: null, ...over });
  const access = (r: any, admin = false) => jobcamAccessFrom(crmEntitlementsFromRow(r, admin));

  it("CRM Basic and Essentials: refused without the add-on, allowed with it", () => {
    for (const plan of ["crm_basic", "crm_essentials"]) {
      expect(access(row(plan)), plan).toEqual({ entitled: false, via: null, plan });
      expect(access(row(plan, { jobcam_addon: true })), plan).toEqual({ entitled: true, via: "addon", plan });
      expect(access(row(plan, { jobcam_addon: true, status: "trialing" })).entitled, plan).toBe(true);
    }
  });

  it("CRM Max: included by the plan, add-on or not", () => {
    expect(access(row("crm_max"))).toEqual({ entitled: true, via: "plan", plan: "crm_max" });
    const ent = crmEntitlementsFromRow(row("crm_max", { jobcam_addon: true }), false);
    expect(ent).toMatchObject({ jobcam: true, jobcamAddon: false });
  });

  it("no CRM plan, or one that ended: no JobCam — even with a stale add-on flag", () => {
    expect(access(row(null))).toEqual({ entitled: false, via: null, plan: null });
    expect(access(row(null, { jobcam_addon: true })).entitled).toBe(false);
    expect(access(row("crm_basic", { status: "canceled", jobcam_addon: true })).entitled).toBe(false);
    expect(access(row("crm_basic", { status: "unpaid", jobcam_addon: true })).entitled).toBe(false);
  });

  it("platform admins and beta accounts are never gated", () => {
    expect(access(row(null), true)).toEqual({ entitled: true, via: "admin", plan: "crm_max" });
    expect(access(row(null, { beta_at: new Date() }))).toEqual({ entitled: true, via: "beta", plan: "crm_max" });
    expect(access(row("crm_basic", { beta_at: new Date() })).via).toBe("beta");
  });

  it("the refusal is the CRM's plan-required answer, naming CRM Max and the add-on, with no price", () => {
    expect(jobcamPlanRequiredBody("crm_basic")).toMatchObject({ code: "crm_plan_required", feature: "jobcam", requiredCrmPlan: "crm_max", crmAddon: "jobcam", currentCrmPlan: "crm_basic" });
    expect(jobcamPlanRequiredBody("crm_basic").message).toMatch(/CRM Basic.*add JobCam.*CRM Max/);
    expect(jobcamPlanRequiredBody(null)).toMatchObject({ code: "crm_plan_required", requiredCrmPlan: "crm_max", crmAddon: null });
    for (const p of ["crm_basic", "crm_essentials", null] as const) expect(jobcamPlanRequiredBody(p).message).not.toMatch(/\$|\d+\/mo/);
  });
});
