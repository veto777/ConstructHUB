/**
 * /pricing, the cart and Settings → Billing against the shared price book.
 * Run: npx playwright test -c playwright.pricing.config.ts (lane on E2E_PORT,
 * growth app). Every billing call is mocked with page.route — nothing reaches
 * Stripe, the sales inbox or the database — and every expected price comes
 * from shared/plans.ts, never a number typed into this file.
 */
import { test, expect, type Page } from "@playwright/test";
import { PLANS, PLAN_KEYS, ADDONS, CALL_ASSISTANT_TIER_ADDONS, TRIAL_DAYS, agencyMonthlyCents, type PlanKey } from "../shared/plans";
import { gotoCrm, watchPage } from "./helpers";

const usd = (cents: number) => {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
};

// Shapes as GET /api/stripe/subscription reports them (server/billing/sync.ts subscriptionSummary).
type Sub = Record<string, unknown>;
const NO_SUB: Sub = { plan: "free", status: "inactive" };
const PRO_STRIPE: Sub = { plan: "pro", status: "active", stripeSubscriptionId: "sub_P_test", currentPeriodEnd: "2026-11-01T12:00:00Z", billingInterval: "month", addons: { protected_site: 1 }, agencyLocations: null };
const PLATINUM_STRIPE: Sub = { plan: "platinum", status: "active", stripeSubscriptionId: "sub_P_legacy", currentPeriodEnd: "2026-11-01T12:00:00Z", billingInterval: "month", addons: {}, agencyLocations: null };
const AGENCY_STRIPE: Sub = { plan: "agency", status: "active", stripeSubscriptionId: "sub_P_agency", currentPeriodEnd: "2027-10-01T12:00:00Z", billingInterval: "year", addons: { extra_seat: 2 }, agencyLocations: 25 };
const CANCELED_STRIPE: Sub = { plan: "pro", status: "canceled", stripeSubscriptionId: "sub_P_old", currentPeriodEnd: null, billingInterval: null, addons: {}, agencyLocations: null };

/** Mock every billing endpoint the page can call and record what it sends. */
async function mockBilling(page: Page, sub: Sub) {
  const calls = { checkout: [] as any[], changePlan: [] as any[], addons: [] as any[], inquiry: [] as any[], cartCheckout: [] as any[] };
  await page.route("**/api/stripe/subscription", (r) => r.fulfill({ json: sub }));
  await page.route("**/api/stripe/create-checkout", async (r) => { calls.checkout.push(r.request().postDataJSON()); await r.fulfill({ json: {} }); });
  await page.route("**/api/stripe/change-plan", async (r) => { calls.changePlan.push(r.request().postDataJSON()); await r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/stripe/addons", async (r) => { calls.addons.push(r.request().postDataJSON()); await r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/stripe/create-cart-checkout", async (r) => { calls.cartCheckout.push(r.request().postDataJSON()); await r.fulfill({ json: {} }); });
  await page.route("**/api/seo-inquiry", async (r) => { calls.inquiry.push(r.request().postDataJSON()); await r.fulfill({ json: { success: true } }); });
  return calls;
}

/** Nothing wider than the screen outside a deliberate horizontal scroller. */
async function expectNoSideScroll(page: Page, anchorTestId: string) {
  const offenders = await page.evaluate((id) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push("document");
    let el = document.querySelector(`[data-testid="${id}"]`)?.parentElement ?? null;
    while (el) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "hidden") out.push(`${el.tagName}.${el.className}`.slice(0, 80));
      el = el.parentElement;
    }
    return out;
  }, anchorTestId);
  expect(offenders).toEqual([]);
}

test.describe("pricing page", () => {
  test("five plans from the price book, no free plan, annual toggle shows two months free", async ({ page }) => {
    const guards = watchPage(page);
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing");
    await expect(page.getByTestId("text-pricing-title")).toBeVisible();
    await expect(page.getByTestId("text-trial")).toContainText(`${TRIAL_DAYS}-day free trial`);
    for (const k of PLAN_KEYS) {
      await expect(page.getByTestId(`card-plan-${k}`)).toBeVisible();
      await expect(page.getByTestId(`text-price-${k}`)).toHaveText(`${usd(PLANS[k].monthlyCents)}/mo`);
      await expect(page.getByTestId(`button-subscribe-${k}`)).toHaveText(`Choose ${PLANS[k].name}`);
    }
    await expect(page.locator('[data-testid="card-plan-free"]')).toHaveCount(0);
    await expect(page.getByText(/Gold|Platinum/)).toHaveCount(0);

    await page.getByTestId("button-interval-year").click();
    await expect(page.getByTestId("button-interval-year")).toHaveAttribute("aria-checked", "true");
    for (const k of PLAN_KEYS) {
      await expect(page.getByTestId(`text-price-${k}`)).toHaveText(`${usd(PLANS[k].annualCents)}/yr`);
      await expect(page.getByTestId(`text-price-note-${k}`)).toContainText(`save ${usd(PLANS[k].monthlyCents * 12 - PLANS[k].annualCents)}`);
    }
    await expect(page.getByTestId("button-interval-year")).toContainText("2 months free");
    guards.assertClean("pricing plans");
  });

  test("comparison table: checks, crosses, the Unlimited pill and Coming badges from the matrix", async ({ page }) => {
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing#comparison");
    // Locations step up the ladder; Unlimited reads as the purple pill.
    await expect(page.getByTestId("cell-compare-locations-starter")).toHaveText("1");
    await expect(page.getByTestId("cell-compare-locations-agency")).toContainText("Unlimited");
    await expect(page.getByTestId("cell-compare-autoPublish-starter").locator("svg")).toHaveAttribute("aria-label", "Not included");
    await expect(page.getByTestId("cell-compare-autoPublish-pro").locator("svg")).toHaveAttribute("aria-label", "Included");
    // Coming modules show the badge on the plans that promise them, nothing on the others.
    await expect(page.getByTestId("cell-compare-permitAlerts-growth")).toContainText("Coming");
    await expect(page.getByTestId("cell-compare-permitAlerts-starter").locator("svg")).toHaveAttribute("aria-label", "Not included");
    await expect(page.getByTestId("cell-compare-csvExport-pro")).toContainText("Coming");
    // Texting numbers and the SEO suite are worded from the price book.
    await expect(page.getByTestId("cell-compare-clientTextingNumber-starter")).toHaveText("Add-on $29");
    await expect(page.getByTestId("cell-compare-clientTextingNumber-growth")).toHaveText("1 included");
    await expect(page.getByTestId("cell-compare-seoSuite-agency")).toHaveText("5,000 keywords + $60 data/mo");
    await expect(page.getByTestId("cell-compare-newProductSeats-agency")).toHaveText("2 seats");
  });

  test("Unlimited is the hero of the ladder", async ({ page }) => {
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing");
    const hero = page.getByTestId("card-plan-agency");
    await expect(hero).toContainText("No caps");
    await expect(hero).toContainText(`${usd(PLANS.agency.monthlyCents)}/mo`);
    // No plan is a free plan, and no plan card prices per location.
    await expect(page.locator('[data-testid="card-plan-free"]')).toHaveCount(0);
    expect(await page.locator("#plans").innerText()).not.toMatch(/per location/i);
  });

  test("the CRM tab shows the CRM plans and their own comparison table", async ({ page }) => {
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing#crm");
    await expect(page.getByTestId("section-crm-plans")).toBeVisible();
    await expect(page.getByTestId("table-crm-comparison")).toBeVisible();
    await expect(page.getByTestId("cell-compare-seats-crm_basic")).toHaveText("1");
    await expect(page.getByTestId("cell-compare-jobcam-crm_max").locator("svg")).toHaveAttribute("aria-label", "Included");
    await expect(page.getByTestId("cell-compare-jobcam-crm_basic")).toHaveText("Add-on $39");
    await expect(page.getByTestId("cell-compare-teamTexts-crm_essentials")).toHaveText("500");
    // Back to the Business Tools tab.
    await page.getByTestId("tab-business").click();
    await expect(page.getByTestId("table-plan-comparison")).toBeVisible();
  });

  test("add-ons table lists every add-on; the old individual-tools URL lands on it", async ({ page }) => {
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/individual-pricing");
    await expect(page).toHaveURL(/\/pricing#add-ons$/);
    await expect(page.getByTestId("text-addons-heading")).toBeInViewport();
    // The Call Assistant tiers have their own section (pricing.tsx); every other add-on is a row here.
    // Retired add-ons (nothing for sale, like the old extra-location line) are not listed; the Call Assistant's are its own section.
    for (const addon of Object.values(ADDONS).filter((a) => !CALL_ASSISTANT_TIER_ADDONS.includes(a.key) && (a.availableOn.length > 0 || a.preview))) {
      await expect(page.getByTestId(`row-addon-${addon.key}`)).toContainText(addon.name);
      await expect(page.getByTestId(`text-addon-price-${addon.key}`)).toContainText(`${usd(addon.monthlyCents)}/mo`);
    }
    await expect(page.getByRole("link", { name: "Individual Tools" })).toHaveCount(0);
  });

  test("services show no price and open the sales form, which posts to /api/seo-inquiry", async ({ page }) => {
    const calls = await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing#done-for-you");
    const section = page.locator("#services");
    // One per service card, plus the section's own inquiry button.
    await expect(section.getByRole("button", { name: /Talk to a sales rep/ })).toHaveCount(7);
    expect(await section.innerText()).not.toMatch(/\$\s?\d/);
    await expect(section.getByRole("button", { name: /Add to cart/i })).toHaveCount(0);
    expect(await section.innerText()).not.toMatch(/guarantee(d)? (first|top)/i);

    await page.getByTestId("button-sales-formation").click();
    const dialog = page.getByTestId("dialog-talk-to-sales");
    await expect(dialog).toContainText("Business formation & contractor license");
    await dialog.getByTestId("input-sales-name").fill("P- Pricing Tester");
    await dialog.getByTestId("input-sales-email").fill("p-pricing@example.invalid");
    await dialog.getByTestId("input-sales-phone").fill("555-0100");
    await dialog.getByTestId("input-sales-company").fill("P- Acme Roofing");
    await dialog.getByTestId("input-sales-need").fill("LLC and a roofing license in Florida.");
    await dialog.getByTestId("button-sales-submit").click();
    await expect(dialog.getByTestId("text-sales-success")).toContainText("p-pricing@example.invalid");
    expect(calls.inquiry).toEqual([{
      name: "P- Pricing Tester", email: "p-pricing@example.invalid", phone: "555-0100",
      services: ["Business formation & contractor license"],
      message: "Company: P- Acme Roofing\n\nLLC and a roofing license in Florida.",
    }]);
    expect(calls.checkout).toEqual([]);
  });

  test("no subscription: plan buttons start a checkout with plan + interval", async ({ page }) => {
    const calls = await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing");
    await page.getByTestId("button-subscribe-pro").click();
    await expect.poll(() => calls.checkout.length).toBe(1);
    await page.getByTestId("button-interval-year").click();
    await page.getByTestId("button-subscribe-growth").click();
    await expect.poll(() => calls.checkout.length).toBe(2);
    expect(calls.checkout).toEqual([{ plan: "pro", interval: "month" }, { plan: "growth", interval: "year" }]);
    expect(calls.changePlan).toEqual([]);
  });

  test("live subscription: plan buttons change the plan, never a second checkout", async ({ page }) => {
    const calls = await mockBilling(page, PRO_STRIPE);
    await gotoCrm(page, "/pricing");
    await expect(page.getByTestId("badge-current-plan")).toContainText("Pro");
    await expect(page.getByTestId("button-subscribe-pro")).toHaveText("Current plan");
    await expect(page.getByTestId("button-subscribe-pro")).toBeDisabled();
    await page.getByTestId("button-subscribe-growth").click();
    const dialog = page.getByTestId("dialog-change-plan");
    await expect(dialog).toContainText(`${PLANS.growth.name} at ${usd(PLANS.growth.monthlyCents)}/mo`);
    await page.getByTestId("button-confirm-change-plan").click();
    await expect.poll(() => calls.changePlan).toEqual([{ plan: "growth", interval: "month" }]);
    // Same plan, other interval: a switch, still no checkout.
    await page.getByTestId("button-interval-year").click();
    await expect(page.getByTestId("button-subscribe-pro")).toHaveText("Switch to yearly billing");
    await page.getByTestId("button-subscribe-pro").click();
    await page.getByTestId("button-confirm-change-plan").click();
    await expect.poll(() => calls.changePlan.length).toBe(2);
    expect(calls.changePlan[1]).toEqual({ plan: "pro", interval: "year" });
    expect(calls.checkout).toEqual([]);
  });
});

test.describe("pricing page: returning and Agency subscribers", () => {
  test("a returning customer checks out again without a trial promise", async ({ page }) => {
    const calls = await mockBilling(page, CANCELED_STRIPE);
    await gotoCrm(page, "/pricing");
    for (const k of PLAN_KEYS) await expect(page.getByTestId(`button-subscribe-${k}`)).toHaveText(`Choose ${PLANS[k].name}`);
    await page.getByTestId("button-subscribe-pro").click();
    await expect.poll(() => calls.checkout).toEqual([{ plan: "pro", interval: "month" }]);
    expect(calls.changePlan).toEqual([]);
  });

  test("an Unlimited subscriber switching billing changes the same subscription, never a second checkout", async ({ page }) => {
    const calls = await mockBilling(page, AGENCY_STRIPE);
    await gotoCrm(page, "/pricing?interval=year");
    await expect(page.getByTestId("button-subscribe-agency")).toHaveText("Current plan");
    await page.getByTestId("button-interval-month").click();
    await page.getByTestId("button-subscribe-agency").click();
    await expect(page.getByTestId("dialog-change-plan")).toContainText("Switch to monthly billing?");
    await page.getByTestId("button-confirm-change-plan").click();
    await expect.poll(() => calls.changePlan).toEqual([{ plan: "agency", interval: "month" }]);
    expect(calls.checkout).toEqual([]);
  });
});

test.describe("cart", () => {
  test("a stored service of $1,000+ leaves checkout and waits as a sales request", async ({ page }) => {
    const calls = await mockBilling(page, NO_SUB);
    await page.addInitScript((items) => {
      if (sessionStorage.getItem("p4-seeded")) return;
      localStorage.setItem("constructhub_cart", JSON.stringify(items));
      sessionStorage.setItem("p4-seeded", "1");
    }, [
      { id: "dfy_formation", type: "dfy_service", name: "P- Business Formation & Filing", price: 550000 },
      { id: "course_module_990001", type: "course_module", name: "P- Course module", price: 49900, moduleId: 990001 },
    ]);
    await gotoCrm(page, "/pricing");
    await page.getByTestId("button-cart-trigger").click();
    const sheet = page.getByTestId("sheet-cart");
    await expect(sheet.getByTestId("card-cart-sales-dfy_formation")).toContainText("P- Business Formation & Filing");
    await expect(sheet.getByTestId("card-cart-item-course_module_990001")).toBeVisible();
    await expect(sheet.getByTestId("card-cart-item-dfy_formation")).toHaveCount(0);
    await expect(sheet.getByTestId("text-cart-total")).toHaveText(usd(49900));
    expect(await sheet.innerText()).not.toContain(usd(550000));

    await sheet.getByTestId("button-cart-checkout").click();
    await expect.poll(() => calls.cartCheckout.length).toBe(1);
    expect(calls.cartCheckout[0].items.map((i: any) => i.id)).toEqual(["course_module_990001"]);

    // The sales request survives a reload until it is sent or dismissed.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("button-cart-trigger").click();
    await expect(sheet.getByTestId("card-cart-sales-dfy_formation")).toBeVisible();

    await sheet.getByTestId("button-cart-sales-dfy_formation").click();
    const dialog = page.getByTestId("dialog-talk-to-sales");
    await expect(dialog).toContainText("P- Business Formation & Filing");
    await dialog.getByTestId("input-sales-name").fill("P- Cart Tester");
    await dialog.getByTestId("input-sales-email").fill("p-cart@example.invalid");
    await dialog.getByTestId("button-sales-submit").click();
    await expect(dialog.getByTestId("text-sales-success")).toBeVisible();
    await dialog.getByTestId("button-sales-done").click();
    await expect(sheet.getByTestId("card-cart-sales-dfy_formation")).toHaveCount(0);
    expect(calls.inquiry.at(-1)).toMatchObject({ name: "P- Cart Tester", email: "p-cart@example.invalid", services: ["P- Business Formation & Filing"] });
  });
});

test.describe("settings billing", () => {
  test("a legacy plan shows its old name and the plan it matches; add-ons wait for a switch", async ({ page }) => {
    const calls = await mockBilling(page, PLATINUM_STRIPE);
    await gotoCrm(page, "/settings?tab=billing");
    await expect(page.getByTestId("text-current-plan")).toContainText("Platinum plan");
    await expect(page.getByTestId("text-legacy-match")).toContainText(`Your features now match ${PLANS.agency.name}`);
    await expect(page.getByTestId("text-plan-interval")).toContainText("Billed monthly");
    // The server doesn't say whether it renews, so no "Renews" claim.
    await expect(page.getByTestId("text-plan-period")).toContainText("Current period ends");
    await expect(page.getByTestId("button-manage-billing")).toBeVisible();
    // Add-ons and location counts are sold on the current plans only (the server refuses them on a legacy price).
    await expect(page.getByTestId("text-addons-legacy")).toContainText(`switch to ${PLANS.agency.name}`);
    await expect(page.getByTestId("row-billing-locations")).toHaveCount(0);
    await expect(page.getByTestId("row-billing-addon-extra_location")).toHaveCount(0); // not sold on Agency
    await expect(page.getByTestId("button-addon-inc-extra_seat")).toBeDisabled();
    expect(calls.addons).toEqual([]);
  });

  test("Agency: add-on + / − send the new total and the location count changes the plan", async ({ page }) => {
    const calls = await mockBilling(page, AGENCY_STRIPE);
    await gotoCrm(page, "/settings?tab=billing");
    await expect(page.getByTestId("text-current-plan")).toContainText(`${PLANS.agency.name} plan`);
    await expect(page.getByTestId("text-plan-interval")).toHaveText(`Billed yearly · ${usd(agencyMonthlyCents(25)! * 10)}/yr for 25 locations`);
    await expect(page.getByTestId("row-billing-locations")).toContainText("billed for 25 now");
    await expect(page.getByTestId("text-addon-qty-extra_seat")).toHaveText("2");
    await page.getByTestId("button-addon-inc-extra_seat").click();
    await expect.poll(() => calls.addons).toEqual([{ addons: { extra_seat: 3 } }]);
    await page.getByTestId("button-addon-dec-extra_seat").click();
    await expect.poll(() => calls.addons.length).toBe(2);
    expect(calls.addons[1]).toEqual({ addons: { extra_seat: 1 } });
    await expect(page.getByTestId("button-addon-dec-competitor_pack")).toBeDisabled();

    await page.getByTestId("input-billing-locations").fill("30");
    await expect(page.getByTestId("text-billing-locations-quote")).toHaveText(`30 locations = ${usd(agencyMonthlyCents(30)! * 10)}/yr`);
    await page.getByTestId("button-billing-locations").click();
    await expect.poll(() => calls.changePlan).toEqual([{ plan: "agency", interval: "year", locations: 30 }]);
    expect(calls.checkout).toEqual([]);
  });

  test("a current plan shows interval, price and its add-ons", async ({ page }) => {
    await mockBilling(page, PRO_STRIPE);
    await gotoCrm(page, "/settings?tab=billing");
    await expect(page.getByTestId("text-current-plan")).toContainText("Pro plan");
    await expect(page.getByTestId("text-legacy-match")).toHaveCount(0);
    await expect(page.getByTestId("text-plan-interval")).toHaveText(`Billed monthly · ${usd(PLANS.pro.monthlyCents)}/mo`);
    // The Call Assistant tiers are a tier picker of their own (plan-billing.tsx), not add-on rows.
    const expected = Object.values(ADDONS).filter((a) => a.availableOn.includes("pro" as PlanKey) && !CALL_ASSISTANT_TIER_ADDONS.includes(a.key)).map((a) => a.key);
    for (const k of expected) await expect(page.getByTestId(`row-billing-addon-${k}`)).toBeVisible();
    await expect(page.getByTestId("text-addon-qty-protected_site")).toHaveText("1");
  });

  test("no subscription: no free plan, a trial and a way to choose a plan", async ({ page }) => {
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/settings?tab=billing");
    await expect(page.getByTestId("text-current-plan")).toHaveText("No active plan");
    await expect(page.getByTestId("text-plan-inactive")).toContainText(`${TRIAL_DAYS}-day free trial`);
    await expect(page.getByTestId("card-addons")).toHaveCount(0);
    await page.getByTestId("button-upgrade").click();
    await expect(page).toHaveURL(/\/pricing$/);
  });
});

test.describe("mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("pricing and billing never scroll sideways", async ({ page }) => {
    await mockBilling(page, PLATINUM_STRIPE);
    for (const hash of ["", "#plans", "#comparison", "#add-ons", "#services", "#crm", "#call-assistant"]) {
      await gotoCrm(page, `/pricing${hash}`);
      await expect(page.getByTestId("text-pricing-title")).toBeAttached();
      await expectNoSideScroll(page, "text-pricing-title");
    }
    await gotoCrm(page, "/settings?tab=billing");
    await expect(page.getByTestId("card-addons")).toBeVisible();
    await expectNoSideScroll(page, "card-current-plan");
  });

  test("usage never scrolls sideways", async ({ page }) => {
    await mockBilling(page, AGENCY_STRIPE);
    await mockEntitlements(page, AGENCY_ENTITLEMENTS);
    await mockSavedCredentials(page, SAVED_ALL);
    await gotoCrm(page, "/settings?tab=billing");
    await expect(page.getByTestId("card-usage")).toBeVisible();
    await expectNoSideScroll(page, "card-usage");
  });
});

// ── Integration (i3-client): the server's refusal codes, usage meters, API keys ──

const PRO_ENTITLEMENTS = {
  plan: "pro", storedPlan: "pro", accessPlan: "pro", planName: "Pro", isPlatformAdmin: false, grantEndsAt: null,
  limits: PLANS.pro.limits, allowances: PLANS.pro.limits,
  modules: PLANS.pro.modules, addons: { protected_site: 1 },
  locations: { used: 1, limit: PLANS.pro.limits.locations },
  usage: {
    searches: { used: 120, limit: PLANS.pro.limits.permitSearches },
    rankings: { used: PLANS.pro.limits.gridCredits, limit: PLANS.pro.limits.gridCredits },
    siteScans: { used: 1, limit: PLANS.pro.limits.siteScans },
    competitorScans: { used: 0, limit: PLANS.pro.limits.competitorScans },
  },
  resetsAt: "2026-11-01T00:00:00.000Z",
};
const AGENCY_ENTITLEMENTS = {
  ...PRO_ENTITLEMENTS, plan: "agency", storedPlan: "agency", accessPlan: "agency", planName: PLANS.agency.name,
  limits: PLANS.agency.limits, allowances: PLANS.agency.limits, modules: PLANS.agency.modules,
  locations: { used: 25, limit: 500 },
};

async function mockEntitlements(page: Page, body: Record<string, unknown>) {
  await page.route("**/api/entitlements", (r) => r.fulfill({ json: body }));
}

type Saved = { cloudflare: any[]; gsc: any[]; ads: any; gmail: any[]; registrar: any[] | null };
const SAVED_ALL: Saved = {
  cloudflare: [{ id: 7, label: "i3-cf@example.invalid" }],
  gsc: [{ id: 8, label: "i3-gsc@example.invalid" }],
  ads: { saved: true, managerId: "1112223334" },
  gmail: [{ subject: "i3-subject", email: "i3-alerts@example.invalid" }],
  registrar: [{ id: 3, provider: "porkbun", label: "I3- main registrar" }],
};

/** The saved-credential lists and their disconnect routes; records every disconnect body. */
async function mockSavedCredentials(page: Page, saved: Saved) {
  const disconnects: { url: string; body: any }[] = [];
  const list = (url: string, body: () => unknown) => page.route(url, (r) => r.fulfill({ json: body() }));
  await list("**/api/cloudflare/saved-connections", () => ({ items: saved.cloudflare }));
  await list("**/api/gsc/saved-connections", () => ({ items: saved.gsc }));
  await list("**/api/ads/saved-connection", () => saved.ads);
  await list("**/api/mail-alerts/oauth/saved-connections", () => ({ items: saved.gmail }));
  await page.route("**/api/domains/saved-connections", (r) => saved.registrar
    ? r.fulfill({ json: { items: saved.registrar } })
    : r.fulfill({ status: 404, json: { message: "Not found" } }));
  for (const url of ["**/api/cloudflare/disconnect", "**/api/gsc/disconnect", "**/api/ads/disconnect", "**/api/mail-alerts/oauth/disconnect", "**/api/domains/disconnect"]) {
    await page.route(url, async (r) => {
      disconnects.push({ url: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
      if (url.includes("cloudflare")) {
        saved.cloudflare = [];
        await r.fulfill({ json: { results: [{ id: 7, revoked: true, message: "Disconnected locally. Previously applied edge rules remain; manage them in Cloudflare." }] } });
      } else await r.fulfill({ json: { ok: true, message: "Disconnected." } });
    });
  }
  return disconnects;
}

test.describe("pricing page: refusals with a next step", () => {
  test("#services is where every sales link lands, with its own inquiry form", async ({ page }) => {
    const calls = await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing#services");
    const section = page.locator("#services");
    await expect(section.getByTestId("text-dfy-heading")).toBeInViewport();
    await section.getByTestId("button-services-sales").click();
    const dialog = page.getByTestId("dialog-talk-to-sales");
    await expect(dialog.getByTestId("text-sales-topic")).toContainText("Done-for-you services");
    await dialog.getByTestId("input-sales-name").fill("I3- Services Tester");
    await dialog.getByTestId("input-sales-email").fill("i3-services@example.invalid");
    await dialog.getByTestId("button-sales-submit").click();
    await expect(dialog.getByTestId("text-sales-success")).toBeVisible();
    expect(calls.inquiry.at(-1)).toMatchObject({ services: ["Done-for-you services"] });
  });

  test("a 409 talk_to_sales opens the inquiry form for that plan instead of an error", async ({ page }) => {
    await mockBilling(page, NO_SUB);
    await page.route("**/api/stripe/create-checkout", (r) => r.fulfill({ status: 409, json: { code: "talk_to_sales", message: "Talk to a sales rep" } }));
    await gotoCrm(page, "/pricing");
    await page.getByTestId("button-subscribe-growth").click();
    await expect(page.getByTestId("dialog-talk-to-sales").getByTestId("text-sales-topic")).toContainText(`${PLANS.growth.name} plan`);
  });

  test("a 409 has_subscription (subscribed in another tab) switches to changing that plan", async ({ page }) => {
    const calls = await mockBilling(page, NO_SUB);
    let subscribed = false;
    await page.route("**/api/stripe/subscription", (r) => r.fulfill({ json: subscribed ? PRO_STRIPE : NO_SUB }));
    await page.route("**/api/stripe/create-checkout", async (r) => {
      subscribed = true;
      await r.fulfill({ status: 409, json: { code: "has_subscription", message: "You already have a subscription." } });
    });
    await gotoCrm(page, "/pricing");
    await page.getByTestId("button-subscribe-growth").click();
    const dialog = page.getByTestId("dialog-change-plan");
    await expect(dialog).toContainText(`${PLANS.growth.name} at ${usd(PLANS.growth.monthlyCents)}/mo`);
    await page.getByTestId("button-confirm-change-plan").click();
    await expect.poll(() => calls.changePlan).toEqual([{ plan: "growth", interval: "month" }]);
  });

  test("a declined card (402 payment_failed) changes nothing and offers Manage billing", async ({ page }) => {
    await mockBilling(page, PRO_STRIPE);
    const message = "Your card couldn't be charged, so nothing changed (Your card was declined.). Update your card in Manage billing and try again.";
    await page.route("**/api/stripe/change-plan", (r) => r.fulfill({ status: 402, json: { code: "payment_failed", message } }));
    let portal = 0;
    await page.route("**/api/stripe/create-portal", async (r) => { portal++; await r.fulfill({ json: {} }); });
    await gotoCrm(page, "/pricing");
    await page.getByTestId("button-subscribe-growth").click();
    await page.getByTestId("button-confirm-change-plan").click();
    // .first(): Radix also announces the toast in a hidden live region for a moment (same text twice).
    await expect(page.getByText(message).first()).toBeVisible();
    await page.getByTestId("button-toast-manage-billing").click();
    await expect.poll(() => portal).toBe(1);
  });
});

test.describe("settings: usage", () => {
  test("Billing shows this month's usage from the entitlements the server enforces", async ({ page }) => {
    await mockBilling(page, PRO_STRIPE);
    await mockEntitlements(page, PRO_ENTITLEMENTS);
    await gotoCrm(page, "/settings?tab=billing");
    const card = page.getByTestId("card-usage");
    await expect(card.getByTestId("usage-searches")).toContainText(`120 of ${PLANS.pro.limits.permitSearches} used`);
    await expect(card.getByTestId("usage-rankings")).toContainText(`${PLANS.pro.limits.gridCredits} of ${PLANS.pro.limits.gridCredits} used`);
    await expect(card.getByTestId("usage-rankings").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(card.getByTestId("usage-locations")).toContainText(`1 of ${PLANS.pro.limits.locations}`);
    await expect(card.getByTestId("text-usage-resets")).toContainText("November 1");
    await expect(page.getByTestId("card-addons")).toContainText("prorated and invoiced right away");
  });

  test("an add-on order above self-serve opens the inquiry form", async ({ page }) => {
    await mockBilling(page, PRO_STRIPE);
    await page.route("**/api/stripe/addons", (r) => r.fulfill({ status: 409, json: { code: "talk_to_sales", message: "Talk to a sales rep" } }));
    await gotoCrm(page, "/settings?tab=billing");
    await page.getByTestId("button-addon-inc-competitor_pack").click();
    await expect(page.getByTestId("dialog-talk-to-sales").getByTestId("text-sales-topic")).toContainText(`${ADDONS.competitor_pack.name} × 1`);
  });

});

test.describe("plan answers anywhere get a way forward", () => {
  test("a 402 plan_required toast links to Pricing", async ({ page }) => {
    const message = "Click-fraud protection (Click Guard, IP Tracker and VPN Shield) is included with the Pro plan. Upgrade in Pricing to use it.";
    await page.route("**/api/click-guard/domains", (r) => r.request().method() === "POST"
      ? r.fulfill({ status: 402, json: { code: "plan_required", requiredPlan: "pro", message } })
      : r.fulfill({ json: [] }));
    await gotoCrm(page, "/ip-tracker");
    await page.getByTestId("button-add-first-domain").click();
    await page.getByTestId("input-domain").fill("i3-example.invalid");
    await page.getByTestId("button-save-domain").click();
    await expect(page.getByText(message)).toBeVisible();
    const link = page.getByTestId("link-toast-plan-prompt");
    await expect(link).toHaveText(`See ${PLANS.pro.name}`);
    await link.click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("the sidebar marks Agency-only pages before the click, and only for accounts without them", async ({ page }) => {
    const openGroups = async () => {
      for (const g of ["google-business", "google-ads"]) {
        const b = page.getByTestId(`link-nav-group-${g}`);
        if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
      }
    };
    await mockEntitlements(page, PRO_ENTITLEMENTS);
    await page.route("**/api/agency/me", (r) => r.fulfill({ json: { entitled: false, requiredPlan: "agency" } }));
    await gotoCrm(page, "/pricing");
    await openGroups();
    for (const id of ["agency", "domains", "mail-alerts", "agency-ads-&-lsa", "cloudflare", "search-console"]) {
      await expect(page.getByTestId(`badge-plan-${id}`)).toHaveAttribute("title", `Included with the ${PLANS.agency.name} plan`);
    }
    await expect(page.getByTestId("badge-plan-locations")).toHaveCount(0);

    await page.unroute("**/api/entitlements");
    await page.unroute("**/api/agency/me");
    await mockEntitlements(page, AGENCY_ENTITLEMENTS);
    await page.route("**/api/agency/me", (r) => r.fulfill({ json: { entitled: true } }));
    await gotoCrm(page, "/pricing");
    await openGroups();
    await expect(page.getByTestId("link-nav-domains")).toBeVisible();
    await expect(page.locator('[data-testid^="badge-plan-"]')).toHaveCount(0);
  });
});
