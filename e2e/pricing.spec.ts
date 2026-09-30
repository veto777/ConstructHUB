/**
 * /pricing, the cart and Settings → Billing against the shared price book.
 * Run: npx playwright test -c playwright.pricing.config.ts (lane on E2E_PORT,
 * growth app). Every billing call is mocked with page.route — nothing reaches
 * Stripe, the sales inbox or the database — and every expected price comes
 * from shared/plans.ts, never a number typed into this file.
 */
import { test, expect, type Page } from "@playwright/test";
import { PLANS, PLAN_KEYS, ADDONS, MODULE_NAMES, TRIAL_DAYS, agencyMonthlyCents, type PlanKey } from "../shared/plans";
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
  test("four plans from the price book, no free plan, annual toggle shows two months free", async ({ page }) => {
    const guards = watchPage(page);
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing");
    await expect(page.getByTestId("text-pricing-title")).toBeVisible();
    await expect(page.getByTestId("text-trial")).toContainText(`${TRIAL_DAYS}-day free trial`);
    for (const k of PLAN_KEYS) {
      await expect(page.getByTestId(`card-plan-${k}`)).toBeVisible();
      await expect(page.getByTestId(`text-price-${k}`)).toHaveText(`${usd(PLANS[k].monthlyCents)}/mo`);
      await expect(page.getByTestId(`button-subscribe-${k}`)).toHaveText(`Start ${TRIAL_DAYS}-day free trial`);
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

  test("comparison table: the four agency modules are Agency-only", async ({ page }) => {
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing#comparison");
    for (const m of Object.keys(MODULE_NAMES)) {
      await expect(page.getByTestId(`row-compare-module-${m}`)).toContainText(MODULE_NAMES[m as keyof typeof MODULE_NAMES]);
      for (const k of PLAN_KEYS) {
        await expect(page.getByTestId(`cell-compare-module-${m}-${k}`).locator("svg")).toHaveAttribute("aria-label", k === "agency" ? "Included" : "Not included");
      }
    }
    await expect(page.getByTestId("cell-compare-crmSeats-pro")).toHaveText(String(PLANS.pro.limits.crmSeats));
  });

  test("agency calculator prices locations by band and hands 500+ to sales", async ({ page }) => {
    const calls = await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing#agency");
    const input = page.getByTestId("input-agency-locations");
    for (const n of [10, 25, 120, 500]) {
      await input.fill(String(n));
      await expect(page.getByTestId("text-agency-total")).toHaveText(`${n} locations = ${usd(agencyMonthlyCents(n)!)}/mo`);
    }
    await page.getByTestId("button-interval-year").click();
    await input.fill("25");
    await expect(page.getByTestId("text-agency-total")).toHaveText(`25 locations = ${usd(agencyMonthlyCents(25)! * 10)}/yr`);
    await page.getByTestId("button-agency-start").click();
    await expect.poll(() => calls.checkout).toEqual([{ plan: "agency", interval: "year", locations: 25 }]);

    await input.fill("600");
    await expect(page.getByTestId("text-agency-total")).toHaveText("600 locations = Talk to a sales rep");
    await expect(page.getByTestId("button-agency-start")).toHaveCount(0);
    await page.getByTestId("button-agency-sales").click();
    await expect(page.getByTestId("dialog-talk-to-sales")).toContainText("Agency plan — 600 locations");
  });

  test("add-ons table lists every add-on; the old individual-tools URL lands on it", async ({ page }) => {
    await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/individual-pricing");
    await expect(page).toHaveURL(/\/pricing#add-ons$/);
    await expect(page.getByTestId("text-addons-heading")).toBeInViewport();
    for (const addon of Object.values(ADDONS)) {
      await expect(page.getByTestId(`row-addon-${addon.key}`)).toContainText(addon.name);
      await expect(page.getByTestId(`text-addon-price-${addon.key}`)).toContainText(`${usd(addon.monthlyCents)}/mo`);
    }
    await expect(page.getByRole("link", { name: "Individual Tools" })).toHaveCount(0);
  });

  test("services show no price and open the sales form, which posts to /api/seo-inquiry", async ({ page }) => {
    const calls = await mockBilling(page, NO_SUB);
    await gotoCrm(page, "/pricing#done-for-you");
    const section = page.locator("#done-for-you");
    await expect(section.getByRole("button", { name: /Talk to a sales rep/ })).toHaveCount(6);
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
    await expect(dialog).toContainText(`Growth at ${usd(PLANS.growth.monthlyCents)}/mo`);
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

  test("an Agency subscriber switching billing keeps the locations they pay for", async ({ page }) => {
    const calls = await mockBilling(page, AGENCY_STRIPE);
    await gotoCrm(page, "/pricing?interval=year");
    await expect(page.getByTestId("button-subscribe-agency")).toHaveText("Current plan");
    await page.getByTestId("button-interval-month").click();
    await page.getByTestId("button-subscribe-agency").click();
    await expect(page.getByTestId("dialog-change-plan")).toContainText(`with 25 locations at ${usd(agencyMonthlyCents(25)!)}/mo`);
    await page.getByTestId("button-confirm-change-plan").click();
    await expect.poll(() => calls.changePlan).toEqual([{ plan: "agency", interval: "month", locations: 25 }]);
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
    const expected = Object.values(ADDONS).filter((a) => a.availableOn.includes("pro" as PlanKey)).map((a) => a.key);
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
    for (const hash of ["", "#comparison", "#agency", "#add-ons", "#done-for-you"]) {
      await gotoCrm(page, `/pricing${hash}`);
      await expect(page.getByTestId("text-pricing-title")).toBeAttached();
      await expectNoSideScroll(page, "text-pricing-title");
    }
    await gotoCrm(page, "/settings?tab=billing");
    await expect(page.getByTestId("card-addons")).toBeVisible();
    await expectNoSideScroll(page, "card-current-plan");
  });
});
