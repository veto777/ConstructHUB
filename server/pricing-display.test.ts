import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  PLANS, PLAN_KEYS, ANNUAL_MONTHS, LEGACY_BAND_ANNUAL_MONTHS, ADDONS, SALES_THRESHOLD_CENTS, agencyMonthlyCents, showsPrice,
} from "../shared/plans";
import {
  businessToolsMatrix, businessToolsColumns, crmMatrixRows, crmMatrixColumns, UNLIMITED_CELL,
} from "../shared/plan-matrix";
import {
  formatUsd, annualMonthsFree, annualSavingsCents, planPriceCents, addonsForPlan, addonPlanNames,
  agencyQuote, agencyBandRows, normalizeLocations,
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

  it("annual savings follow ANNUAL_MONTHS on every plan, from the price book", () => {
    expect(annualMonthsFree()).toBe(12 - ANNUAL_MONTHS);
    for (const k of PLAN_KEYS) {
      expect(planPriceCents(PLANS[k], "month")).toBe(PLANS[k].monthlyCents);
      expect(planPriceCents(PLANS[k], "year")).toBe(PLANS[k].annualCents);
      expect(annualSavingsCents(PLANS[k])).toBe(PLANS[k].monthlyCents * (12 - ANNUAL_MONTHS));
    }
  });

  it("add-ons are listed per plan and by plan name", () => {
    // The retired extra-location add-on (empty availableOn) is never listed; the Call Assistant's are a separate subscription.
    expect(addonsForPlan("starter").map((a) => a.key)).toEqual(["protected_site", "texting_number", "competitor_pack", "grid_pack", "seo_basic", "seo_pro"]);
    expect(addonsForPlan("growth").map((a) => a.key)).toEqual(["extra_seat", "protected_site", "texting_number", "competitor_pack", "grid_pack", "seo_basic", "seo_pro"]);
    expect(addonsForPlan("agency").map((a) => a.key)).toEqual(["texting_number", "competitor_pack", "grid_pack"]);
    expect(addonPlanNames(ADDONS.texting_number)).toBe("Solo, Team, Pro, Agency, Unlimited");
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
      expect(q.annualCents).toBe(q.monthlyCents * LEGACY_BAND_ANNUAL_MONTHS);
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

describe("pricing display: comparison tables (shared/plan-matrix.ts)", () => {
  const sections = businessToolsMatrix();
  const rows = sections.flatMap((s) => s.rows);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const crmByKey = Object.fromEntries(crmMatrixRows().map((r) => [r.key, r]));

  it("has a cell for every plan in every row", () => {
    for (const r of rows) expect(Object.keys(r.cells).sort()).toEqual([...PLAN_KEYS].sort());
    for (const r of crmMatrixRows()) expect(Object.keys(r.cells).sort()).toEqual(["crm_basic", "crm_elite", "crm_essentials", "crm_max"]);
    // The columns are the price book's display order, Unlimited the hero.
    expect(businessToolsColumns().map((c) => c.key)).toEqual([...PLAN_KEYS]);
    expect(businessToolsColumns().find((c) => c.hero)?.key).toBe("agency");
    expect(crmMatrixColumns().find((c) => c.hero)?.key).toBe("crm_elite");
  });

  it("is derived from the limits: counts step up the ladder, -1 reads as the unlimited cell", () => {
    expect(byKey.locations.cells).toEqual({ starter: 1, team: 10, pro: 25, growth: 100, agency: UNLIMITED_CELL });
    expect(byKey.teamSeats.cells).toEqual({ starter: 1, team: 3, pro: 5, growth: 10, agency: UNLIMITED_CELL });
    expect(byKey.clientWorkspaces.cells).toEqual({ starter: false, team: false, pro: false, growth: 10, agency: UNLIMITED_CELL });
    expect(byKey.autoPublish.cells).toEqual({ starter: false, team: false, pro: true, growth: true, agency: true });
    expect(byKey.gabeQuestions.cells.agency).toBe(UNLIMITED_CELL);
    expect(byKey.publicApi.cells).toEqual({ starter: false, team: false, pro: 50_000, growth: 250_000, agency: UNLIMITED_CELL });
  });

  it("marks coming modules and the not-yet-enforced history row", () => {
    // Permit alerts are LIVE (server/permits) — a plain ✅ on the plans that carry the module, never Coming.
    expect(byKey.permitAlerts.cells).toEqual({ starter: false, team: false, pro: false, growth: true, agency: true });
    expect(byKey.csvExport.cells.pro).toEqual({ coming: true });
    // Scheduled client email reports are LIVE (server/seo/site-report-send.ts, sent by server/seo/jobs.ts) — a plain ✅, never Coming.
    expect(byKey.scheduledReports.cells).toEqual({ starter: false, team: false, pro: false, growth: true, agency: true });
    expect(byKey.history.coming).toBe(true);
    expect(byKey.history.cells).toEqual({ starter: "90 days", team: "90 days", pro: "12 months", growth: UNLIMITED_CELL, agency: UNLIMITED_CELL });
  });

  it("words texting, SEO and the Unlimited-only extras from the price book", () => {
    expect(byKey.clientTextingNumber.cells).toEqual({ starter: "Add-on $29", team: "Add-on $29", pro: "Add-on $29", growth: "1 included", agency: "2 included" });
    expect(byKey.seoSuite.cells).toEqual({
      starter: "Add-on from $29", team: "Add-on from $29", pro: "Add-on from $29",
      growth: "250 keywords + $10 data/mo", agency: "5,000 keywords + $60 data/mo",
    });
    expect(byKey.whiteLabel.cells).toEqual({ starter: false, team: false, pro: false, growth: false, agency: true });
    expect(byKey.masterClass.cells.agency).toBe(true);
    // These two cells are derived from the Unlimited card's own bullets (plan-matrix.ts), so the
    // expectation derives from PLANS too: the 2026-10-09 rebuild dropped the bullets' "($2,499)" and
    // "(Call Assistant minutes excluded)" notes, and a hard-coded expectation would freeze stale copy.
    const newProductBullet = PLANS.agency.features.find((f) => /new product/i.test(f)) ?? "";
    const newProductNote = newProductBullet.match(/\(([^)]*)\)/)?.[1] ?? "";
    expect(byKey.newProductSeats.cells).toEqual({
      starter: false, team: false, pro: false, growth: false,
      agency: newProductNote ? `2 seats (${newProductNote})` : "2 seats",
    });
    expect(byKey.gbpReinstatement.cells.starter).toBe("$599");
    expect(byKey.gbpReinstatement.cells.agency).toBe("$299.50 — half price");
    // Support is inherited down the ladder through each plan's "Everything in …" bullet.
    expect(byKey.support.cells).toEqual({
      starter: "Email support", team: "Email support", pro: "Priority email support",
      growth: "Priority support with a phone callback", agency: "Named support contact, onboarding call, first access to new features",
    });
    // Every plan alerts on reviews and drafts replies.
    expect(Object.values(byKey.reviewAlerts.cells)).toEqual([true, true, true, true, true]);
  });

  it("labels the rows in the owner's wording (the approved comparison table)", () => {
    expect(byKey.clientWorkspaces.label).toBe("Client workspaces, roles, bulk actions, email onboarding");
    expect(byKey.autoPosts.label).toBe("AI posts and photo captions on a schedule");
    expect(byKey.reviewReminders.label).toBe("Review reminders to customers (email; text coming soon)");
    expect(byKey.permitAlerts.label).toBe("Permit alerts for new filings in a territory");
    expect(byKey.adsLsaManager.label).toBe("Google Ads and LSA manager, IP exclusions");
    expect(byKey.cloudflareDomains.label).toBe("Cloudflare, Search Console, Domains, Gmail forwarding");
    expect(byKey.scheduledReports.label).toBe("Scheduled client email reports");
    expect(byKey.seoSuite.label).toBe("SEO suite: rank tracker, explorer, keywords, backlinks");
    expect(byKey.gridWatches.label).toBe("Weekly scheduled grid watches");
    // The label carries the Unlimited bullet's price note only when the bullet states one (plan-matrix.ts derives it).
    const masterClassBullet = PLANS.agency.features.find((f) => /master class/i.test(f)) ?? "";
    expect(byKey.masterClass.label).toBe(`Master Class course ${masterClassBullet.match(/\(\$[\d,]+\)/)?.[0] ?? ""}`);
    expect(byKey.gridScans.label).toBe("Grid scans / month");
    expect(byKey.publicApi.label).toBe("Public API (units / month)");
    // The grid-scans row counts credits, not scans — the footnote under the table says so.
    expect(byKey.gridScans.note).toMatch(/metered in credits/);
  });

  it("derives the CRM rows from CRM_PLANS (a separate product)", () => {
    expect(crmByKey.seats.cells).toEqual({ crm_basic: 1, crm_essentials: 5, crm_max: 8, crm_elite: 35 });
    expect(crmByKey.clients.cells.crm_basic).toBe(UNLIMITED_CELL);
    expect(crmByKey.documents.cells.crm_max).toBe(UNLIMITED_CELL);
    expect(crmByKey.teamTexts.cells).toEqual({ crm_basic: false, crm_essentials: 500, crm_max: 1500, crm_elite: 5000 });
    expect(crmByKey.jobCosting.cells).toEqual({ crm_basic: false, crm_essentials: true, crm_max: true, crm_elite: true });
    expect(crmByKey.jobcam.cells).toEqual({ crm_basic: "Add-on $39", crm_essentials: "Add-on $39", crm_max: true, crm_elite: true });
    expect(crmByKey.apiUnits.cells).toEqual({ crm_basic: false, crm_essentials: 10_000, crm_max: 50_000, crm_elite: 250_000 });
    expect(crmByKey.clientTexting.cells).toEqual({
      crm_basic: false, crm_essentials: "The texting add-on", crm_max: "1 number included", crm_elite: "3 numbers included",
    });
    expect(crmByKey.trial.cells.crm_basic).toBe("7 days");
    // The platform matrix has no CRM rows — the CRM is its own product.
    expect(byKey.seats).toBeUndefined();
  });

  it("docs/pricing/PLAN-MATRIX.md is generated from the same matrix and current", () => {
    const doc = read("docs/pricing/PLAN-MATRIX.md");
    expect(doc).toMatch(/generated from `shared\/plan-matrix\.ts` on \d{4}-\d{2}-\d{2} — do not edit by hand/);
    for (const key of PLAN_KEYS) expect(doc).toContain(PLANS[key].name);
    expect(doc).toContain("CRM Basic");
    expect(doc).toContain("🟣 Unlimited");
    expect(doc).toContain("🕒 Coming");
    expect(doc).toContain("There is no per-location pricing and no extra-location add-on");
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

  it("reads the billing route's field names (billingInterval, agencyLocations)", () => {
    expect(describeSubscription({ plan: "agency", status: "active", stripeSubscriptionId: "sub_1", billingInterval: "year", agencyLocations: 25 }))
      .toMatchObject({ planKey: "agency", interval: "year", locations: 25, changesInPlace: true });
    expect(describeSubscription({ plan: "agency", status: "active", interval: "month", locations: 12 }))
      .toMatchObject({ interval: "month", locations: 12 });
    expect(describeSubscription({ plan: "agency", status: "active", agencyLocations: null })).toMatchObject({ interval: null, locations: null });
  });

  it("changes in place only with a Stripe subscription, in any status the server still bills", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]) {
      expect(describeSubscription({ plan: "pro", status, stripeSubscriptionId: "sub_1" }).changesInPlace, status).toBe(true);
    }
    // An access grant without Stripe (beta, manual) has no subscription to change: it checks out.
    expect(describeSubscription({ plan: "platinum", status: "active" })).toMatchObject({ live: true, changesInPlace: false });
    expect(describeSubscription({ plan: "pro", status: "canceled", stripeSubscriptionId: "sub_1" }).changesInPlace).toBe(false);
  });

  it("offers the trial only to an account that never had a Stripe subscription", () => {
    expect(describeSubscription({ plan: "free", status: "inactive" }).firstSubscription).toBe(true);
    expect(describeSubscription(undefined).firstSubscription).toBe(true);
    expect(describeSubscription({ plan: "pro", status: "canceled", stripeSubscriptionId: "sub_old" }).firstSubscription).toBe(false);
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
    // The Billing cards moved out of settings.tsx into the settings shell's plan-billing panel.
    const billing = read("client/src/pages/settings/plan-billing.tsx").split("function PlanBillingSection")[1];
    for (const [name, src] of [
      ["pricing.tsx", read("client/src/pages/pricing.tsx")],
      ["cart-sheet.tsx", read("client/src/components/cart-sheet.tsx")],
      ["talk-to-sales.tsx", read("client/src/components/talk-to-sales.tsx")],
      ["settings/plan-billing.tsx PlanBillingSection", billing],
      ["settings/billing/subscriptions-panel.tsx", read("client/src/pages/settings/billing/subscriptions-panel.tsx")],
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

  it("plan cards and the purchase review badge coming-soon bullets from COMING_MODULES (one mechanism)", () => {
    // The card badge and the review flag both derive from shared/plans.ts isComingFeature /
    // FEATURE_BULLET_MODULE — never a hard-coded "(coming soon)" line — so a module shipping
    // (leaving COMING_MODULES) drops every badge at once.
    const pricing = read("client/src/pages/pricing.tsx");
    expect(pricing).toContain("isComingFeature(feature)");
    expect(pricing).toContain("badge-coming-");
    expect(pricing).toContain("comingSoon: isComingFeature(text)");
    const review = read("client/src/components/purchase-review.tsx");
    expect(review).toContain("comingSoon");
    expect(review).toContain("Coming soon");
  });
});
