import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  PLANS, PLAN_KEYS, ADDONS, MODULE_NAMES, SALES_THRESHOLD_CENTS, agencyMonthlyCents, showsPrice,
} from "../shared/plans";
import {
  formatUsd, annualMonthsFree, annualSavingsCents, planPriceCents, addonsForPlan, addonPlanNames,
  agencyQuote, agencyBandRows, normalizeLocations, comparisonSections, agencyOnlyModuleNames,
  describeSubscription, DFY_SERVICES, SALES_ONLY_CART_IDS, isSalesOnlyCartItem, isSalesOnlyService,
} from "../client/src/lib/pricing-display";
import { DFY_CATALOG, COURSE_BUNDLE } from "./catalog";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

describe("pricing display: money", () => {
  it("formats whole dollars without cents and keeps real cents", () => {
    expect(formatUsd(2900)).toBe("$29");
    expect(formatUsd(2417)).toBe("$24.17");
    expect(formatUsd(164900)).toBe("$1,649");
    expect(formatUsd(SALES_THRESHOLD_CENTS)).toBe("$1,000");
  });

  it("annual is two months free on every plan, from the price book", () => {
    expect(annualMonthsFree()).toBe(2);
    for (const k of PLAN_KEYS) {
      expect(planPriceCents(PLANS[k], "month")).toBe(PLANS[k].monthlyCents);
      expect(planPriceCents(PLANS[k], "year")).toBe(PLANS[k].annualCents);
      expect(annualSavingsCents(PLANS[k])).toBe(PLANS[k].monthlyCents * 2);
    }
  });

  it("add-ons are listed per plan and by plan name", () => {
    expect(addonsForPlan("starter").map((a) => a.key)).toEqual(["extra_location", "extra_seat"]);
    expect(addonsForPlan("growth").map((a) => a.key)).not.toContain("texting_number");
    expect(addonsForPlan("agency").map((a) => a.key)).not.toContain("extra_location");
    expect(addonPlanNames(ADDONS.texting_number)).toBe("Pro, Agency");
  });
});

describe("pricing display: Agency locations", () => {
  it("matches the published examples and the shared bill for every self-serve count", () => {
    const monthly = (n: number) => { const q = agencyQuote(n); return q.sales ? null : q.monthlyCents; };
    expect(monthly(1)).toBe(34900);
    expect(monthly(10)).toBe(34900);
    expect(monthly(25)).toBe(57400);
    expect(monthly(50)).toBe(94900);
    expect(monthly(100)).toBe(144900);
    expect(monthly(250)).toBe(294900);
    expect(monthly(500)).toBe(469900);
    for (let n = 1; n <= 500; n++) {
      const q = agencyQuote(n);
      if (q.sales) throw new Error(`unexpected sales quote at ${n}`);
      expect(q.monthlyCents).toBe(agencyMonthlyCents(n));
      expect(q.lines.reduce((s, l) => s + l.subtotalCents, 0)).toBe(q.monthlyCents);
      expect(q.annualCents).toBe(q.monthlyCents * 10);
    }
  });

  it("is a sales quote above 500 and normalizes typed counts", () => {
    expect(agencyQuote(501)).toEqual({ sales: true, locations: 501 });
    expect(agencyQuote(10_000).sales).toBe(true);
    expect(normalizeLocations("")).toBe(1);
    expect(normalizeLocations("-4")).toBe(1);
    expect(normalizeLocations("37.9")).toBe(37);
    expect(normalizeLocations("abc")).toBe(1);
  });

  it("labels the graduated bands from the price book", () => {
    expect(agencyBandRows()).toEqual([
      { label: "1–10", centsPerLocation: 0 },
      { label: "11–50", centsPerLocation: 1500 },
      { label: "51–250", centsPerLocation: 1000 },
      { label: "251–500", centsPerLocation: 700 },
      { label: "501+", centsPerLocation: null },
    ]);
  });
});

describe("pricing display: comparison table", () => {
  const rows = comparisonSections().flatMap((s) => s.rows);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  it("has a cell for every plan in every row", () => {
    for (const r of rows) expect(Object.keys(r.cells).sort()).toEqual([...PLAN_KEYS].sort());
  });

  it("marks the four agency modules as Agency-only", () => {
    expect(agencyOnlyModuleNames()).toEqual(Object.values(MODULE_NAMES));
    for (const m of Object.keys(MODULE_NAMES)) {
      expect(byKey[`module-${m}`].cells).toEqual({ starter: false, pro: false, growth: false, agency: true });
    }
  });

  it("is generated from limits", () => {
    expect(byKey.protectedSites.cells).toEqual({ starter: false, pro: "1 website", growth: "3 websites", agency: "10 websites" });
    expect(byKey.crmSeats.cells).toEqual({ starter: "1", pro: "3", growth: "10", agency: "10" });
    expect(byKey.competitorScans.cells.starter).toBe(false);
    expect(byKey.grid.cells.agency).toBe("2 per location / mo");
    expect(byKey.clientTexting.cells).toEqual({
      starter: false, pro: "Your SignalWire number or the add-on", growth: "1 number included", agency: "Your SignalWire number or the add-on",
    });
  });
});

describe("pricing display: subscriptions", () => {
  it("shows a legacy plan by its old name and maps its features", () => {
    const v = describeSubscription({ plan: "platinum", status: "active" });
    expect(v).toMatchObject({ storedPlan: "platinum", planKey: "agency", isLegacy: true, displayName: "Platinum", live: true, viaStripe: false });
    expect(describeSubscription({ plan: "standard", status: "active" })).toMatchObject({ planKey: "starter", displayName: "Standard" });
  });

  it("treats trialing and past-due as live (change plan, never a second checkout)", () => {
    expect(describeSubscription({ plan: "pro", status: "trialing", stripeSubscriptionId: "sub_1", interval: "year" }))
      .toMatchObject({ planKey: "pro", isLegacy: false, displayName: "Pro", live: true, viaStripe: true, interval: "year" });
    expect(describeSubscription({ plan: "growth", status: "past_due" }).live).toBe(true);
    expect(describeSubscription({ plan: "gold", status: "canceled" })).toMatchObject({ live: false, displayName: "Gold" });
    expect(describeSubscription({ plan: "free", status: "inactive" })).toMatchObject({ planKey: null, live: false, displayName: null });
    expect(describeSubscription(undefined).live).toBe(false);
    expect(describeSubscription({ plan: "mystery", status: "active" })).toMatchObject({ planKey: null, live: false });
  });
});

describe("pricing display: services at or above the sales threshold", () => {
  it("every quote-only service stands for catalog items priced at $1,000 or more", () => {
    for (const s of DFY_SERVICES) {
      if (s.priceCents != null) {
        expect(showsPrice(s.priceCents)).toBe(true);
        continue;
      }
      expect(isSalesOnlyService(s)).toBe(true);
      for (const id of s.catalogIds) {
        expect(DFY_CATALOG[id], id).toBeDefined();
        expect(DFY_CATALOG[id].priceCents, id).toBeGreaterThanOrEqual(SALES_THRESHOLD_CENTS);
      }
    }
  });

  it("covers every done-for-you catalog item, so nothing sellable is missing from /pricing", () => {
    const covered = new Set(DFY_SERVICES.flatMap((s) => s.catalogIds));
    for (const id of Object.keys(DFY_CATALOG)) expect(covered.has(id), id).toBe(true);
    for (const id of Object.keys(DFY_CATALOG)) expect(SALES_ONLY_CART_IDS.has(id), id).toBe(true);
  });

  it("the cart refuses sales-only items even with a tampered stored price", () => {
    expect(isSalesOnlyCartItem({ id: "dfy_formation", price: 100 })).toBe(true);
    expect(isSalesOnlyCartItem({ id: "course_bundle", price: COURSE_BUNDLE.priceCents })).toBe(!showsPrice(COURSE_BUNDLE.priceCents));
    expect(isSalesOnlyCartItem({ id: "course_module_1", price: 150000 })).toBe(true);
    expect(isSalesOnlyCartItem({ id: "course_module_1", price: 49900 })).toBe(false);
    expect(isSalesOnlyCartItem({ id: "course_module_1", price: SALES_THRESHOLD_CENTS - 1 })).toBe(false);
    expect(isSalesOnlyCartItem({ id: "course_module_1", price: SALES_THRESHOLD_CENTS })).toBe(true);
  });
});

describe("pricing UI source", () => {
  it("hard-codes no prices and no retired plans", () => {
    const billing = read("client/src/pages/settings.tsx").split("function BillingSection")[1];
    for (const [name, src] of [
      ["pricing.tsx", read("client/src/pages/pricing.tsx")],
      ["cart-sheet.tsx", read("client/src/components/cart-sheet.tsx")],
      ["talk-to-sales.tsx", read("client/src/components/talk-to-sales.tsx")],
      ["settings.tsx BillingSection", billing],
    ] as const) {
      expect(src, name).not.toMatch(/\$\s?\d/);
      expect(src, name).not.toMatch(/\b(Gold|Platinum|Premium|Professional)\b/);
      expect(src, name).not.toMatch(/individual-pricing|api\/stripe\/plans/);
      expect(src, name).not.toMatch(/[Gg]uarantee(d|s)? (first|top)/);
    }
  });

  it("the individual-tools page is gone and its URL redirects to the add-ons", () => {
    expect(fs.existsSync(path.resolve(import.meta.dirname, "../client/src/pages/individual-pricing.tsx"))).toBe(false);
    const app = read("client/src/App.tsx");
    expect(app).toMatch(/setLocation\("\/pricing#add-ons", \{ replace: true \}\)/);
    expect(read("client/src/components/app-sidebar.tsx")).not.toMatch(/Individual Tools/);
  });
});
