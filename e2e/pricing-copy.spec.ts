import { expect, test, type Page } from "@playwright/test";
import { ADDONS, PLANS, PLAN_KEYS } from "../shared/plans";
import {
  CALL_ASSISTANT_NUMBER_RULES, CALL_ASSISTANT_SPAM, CALL_ASSISTANT_SPAM_BLOCK_TITLE, SALES_REP_LABEL, callAssistantIntroShort, callAssistantPricing, callAssistantTierAdvice,
  callAssistantYearlyNote, callAssistantOverageRule, joinNames, planPriceLine,
} from "../shared/plan-copy";
import { VOICE_PERSONA_LIST } from "../shared/voice-personas";

/**
 * Pricing p5 (copy): pages outside /pricing describe the 2026-09-30 price book.
 * Run against the lane's own dev server (dev bypass signs in as user 1):
 *   E2E_PORT=8255 E2E_DB=constructhub_dev_a6 npx playwright test -c playwright.pricing-copy.config.ts
 */

const LEGACY = /\bPlatinum\b|\bGold (and|&) Platinum\b|\$995|\$499\/mo|Unlimited everything|billed separately|Separate membership|\$29,999|\$5,500|\$15,000|\$7,500|\$2,499/;

const PAGES = [
  "/", "/landing", "/terms", "/crm-app", "/crm-terms", "/master-class-landing", "/master-class", "/master-class?tab=pricing",
  "/competitors-landing", "/permits-landing", "/google-ads-landing", "/reinstatement", "/privacy", "/call-assistant",
];

async function bodyText(page: Page) {
  await page.waitForLoadState("networkidle");
  return page.locator("body").innerText();
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const path of PAGES) {
      test(`${path} shows no legacy plan or price and fits the screen`, async ({ page }) => {
        await page.goto(path);
        const text = await bodyText(page);
        expect(text).not.toMatch(LEGACY);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  });
}

test("Terms list the new plans, add-ons, trial and sales-rep services", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByTestId("text-effective-date")).toHaveText("Last updated: September 30, 2026");
  const plans = page.getByTestId("list-plans");
  for (const key of PLAN_KEYS) await expect(plans).toContainText(`${PLANS[key].name} — ${planPriceLine(key)}`);
  await expect(page.getByTestId("section-subscription-plans")).toContainText("1-day trial");
  await expect(page.getByTestId("section-subscription-plans")).toContainText("There is no free plan");
  await expect(page.getByTestId("section-add-ons")).toContainText("Extra seat — $15/month");
  await expect(page.getByTestId("section-done-for-you")).toContainText("$1,000 or more");
  await expect(page.getByTestId("section-done-for-you")).toContainText(SALES_REP_LABEL);
  // Consulting sessions are no longer sold (owner decision 2026-09-30); custom work is quoted.
  await expect(page.getByTestId("section-consulting")).toHaveCount(0);
  await expect(page.getByTestId("section-custom-work")).toContainText("quoted by a sales rep");
  expect(await page.locator("main, body").first().innerText()).not.toMatch(/consulting session/i);
});

test("landing: plans from the price book, services go to a sales rep", async ({ page }) => {
  await page.goto("/landing");
  for (const key of PLAN_KEYS) await expect(page.getByTestId(`card-plan-${key}`)).toContainText(PLANS[key].name);
  await expect(page.getByTestId("card-plan-starter")).toContainText("$29/month");
  await expect(page.getByTestId("text-agency-modules")).toContainText("Google Ads & LSA manager");
  await expect(page.getByTestId("text-dfy-sales")).toHaveCount(3);
  await expect(page.getByTestId("link-dfy-pricing")).toHaveAttribute("href", "/pricing#services");
  await expect(page.getByText("Create a Free Account")).toHaveCount(0);
});

test("AI Call Assistant: the launch price from the price book on every surface, and the ways in", async ({ page }) => {
  const p = callAssistantPricing();
  const short = callAssistantIntroShort();

  // Signed in, /call-assistant is the dashboard (owner, 2026-10-02: it lives on the platform, not the CRM); the sales
  // page is what a signed-out visitor gets, so it is read from the signed-out server.
  const signedOut = process.env.PC_SIGNED_OUT_URL || "http://127.0.0.1:8198";
  await page.context().addCookies([{ name: "ch_consent", value: "denied", url: signedOut }]);
  await page.goto(`${signedOut}/call-assistant`);
  // Owner, 2026-10-02: "$99 a month for the first 3 months" … "annually price can be $1999".
  expect(short).toBe(`${p.intro}/mo for your first ${p.introMonths} months, then ${p.regular}/mo — or ${p.annual}/yr`);
  expect(p.annual).toBe("$1,999");
  // Owner, 2026-10-02: "lets do 1000 min for $149 a month so 4 tiers instead of 3".
  expect(p.tiers.map((t) => t.tier)).toEqual(["lite", "solo", "crew", "fleet"]);
  await expect(page.getByTestId("text-call-assistant-price")).toHaveText(`Four tiers, one per account, regular prices from ${p.from}/mo. Solo starts at ${short}.`);
  await expect(page.getByTestId("text-ca-hero-price")).toContainText(`Regular prices from ${p.from}/mo (${p.fromTier})`);
  await expect(page.getByTestId("text-ca-hero-price")).toContainText(`${p.regular}/mo — or ${p.annual}/yr`);
  await expect(page.getByTestId("text-ca-hero-price")).toContainText(`Solo: ${p.intro}/mo for your first ${p.introMonths} months`);
  // Every figure from the price book; Crew and Fleet: "for the crew and fleet the cost per minute is 5 not 10 cents".
  for (const t of p.tiers) {
    await expect(page.getByTestId(`text-ca-tier-overage-${t.tier}`)).toContainText(`${t.overageShort}/min over`);
    await expect(page.getByTestId(`badge-ca-tier-lower-overage-${t.tier}`)).toHaveCount(t.lowerOverage ? 1 : 0);
    const card = page.getByTestId(`card-ca-tier-${t.tier}`);
    await expect(card).toContainText(`${t.minutes} call minutes a month`);
    await expect(card).toContainText(t.numbersLabel);
    await expect(card).toContainText(t.estimatedCalls);
    await expect(page.getByTestId(`text-ca-tier-price-${t.tier}`)).toHaveText(`${t.intro ?? t.monthly}/mo`);
    await expect(page.getByTestId(`text-ca-tier-terms-${t.tier}`)).toContainText(`${t.annual}/yr`);
  }
  await expect(page.getByTestId("text-ca-tier-terms-solo")).toHaveText(`for your first ${p.introMonths} months, then ${p.regular}/mo — or ${p.annual}/yr`);
  const every = page.getByTestId("card-ca-every-tier");
  await expect(every).toContainText(`The first ${p.freeSpamCalls} spam calls each month free`);
  await expect(every).toContainText(`Above your included minutes: ${p.overageLine}`);
  await expect(every).toContainText(`Extra local numbers ${p.extraNumber}/mo each`);
  // The spam section, near the top: only what the code does.
  const spam = page.getByTestId("section-ca-spam");
  await expect(spam).toContainText(CALL_ASSISTANT_SPAM.headline);
  await expect(spam).toContainText(CALL_ASSISTANT_SPAM.block);
  await expect(spam).toContainText(CALL_ASSISTANT_SPAM.forwarding);
  await expect(spam).toContainText(CALL_ASSISTANT_SPAM_BLOCK_TITLE);
  await expect(spam).toContainText(CALL_ASSISTANT_SPAM.report);
  await expect(page.getByTestId("text-ca-spam-free")).toContainText(`${p.freeSpamCalls} free spam calls every month, on every tier: they never count toward your minutes`);
  const order = await page.evaluate(() => ["section-ca-spam", "section-ca-how", "section-ca-pricing"].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top));
  expect(order[0]).toBeLessThan(order[1]);
  // The FAQ says the owner's number rules plainly.
  const faq = page.getByTestId("section-ca-faq");
  await expect(faq).toContainText(CALL_ASSISTANT_NUMBER_RULES.ownNumbers);
  await expect(faq).toContainText(CALL_ASSISTANT_NUMBER_RULES.cancel);
  await expect(faq).toContainText(CALL_ASSISTANT_NUMBER_RULES.payment);
  // Add-ons follow the plan's billing: $1,999/yr is not a choice for the add-on alone.
  await expect(faq).toContainText(`Yes: ${callAssistantYearlyNote()}.`);
  for (const q of ["What counts as a minute?", "Do spam calls use my minutes?", "Which tier do I need?"]) await expect(faq).toContainText(q);
  await expect(faq).toContainText(callAssistantTierAdvice());
  await expect(faq).toContainText(callAssistantOverageRule());
  expect(callAssistantYearlyNote()).toBe(`${joinNames(p.tiers.map((t) => `${t.name} ${t.annual}/yr`))} when your plan is billed yearly (add-ons follow your plan's billing); the ${p.intro}/mo intro for your first ${p.introMonths} months is Solo on monthly billing`);
  await expect(page.locator('[data-testid^="item-ca-spam-"]')).toHaveCount(3);
  for (const persona of VOICE_PERSONA_LIST) await expect(page.getByTestId(`card-persona-${persona.id}`)).toContainText(persona.name);
  await expect(page.locator('[data-testid^="step-ca-"]')).toHaveCount(4);
  for (const key of p.planKeys) await expect(page.getByTestId("text-ca-plans")).toContainText(PLANS[key].name);
  await expect(page.getByTestId("link-ca-pricing")).toHaveAttribute("href", "/pricing#add-ons");
  // "Coming soon" for as long as the price book keeps the add-on in preview.
  if (p.comingSoon) await expect(page.getByTestId("badge-call-assistant-coming-soon").first()).toBeVisible();
  else await expect(page.getByTestId("badge-call-assistant-coming-soon")).toHaveCount(0);
  await page.getByTestId("button-ca-sales-hero").click();
  await expect(page.getByTestId("dialog-talk-to-sales").getByTestId("text-sales-topic")).toContainText("AI Call Assistant");

  await page.goto("/landing");
  await expect(page.getByTestId("section-call-assistant")).toBeVisible();
  await expect(page.getByTestId("text-call-assistant-landing-price")).toContainText(`${p.intro}/mo`);
  await expect(page.getByTestId("text-call-assistant-landing-price")).toContainText(`then ${p.regular}/mo — or ${p.annual}/yr`);
  for (const t of p.tiers) await expect(page.getByTestId("text-call-assistant-landing-tiers")).toContainText(`${t.name} (${t.minutes} min, ${t.numbersLabel})`);
  await expect(page.getByTestId("text-call-assistant-landing-tiers")).toContainText(`Regular prices from ${p.from}/mo. Four tiers:`);
  await expect(page.getByTestId("text-call-assistant-landing-tiers")).toContainText("Crew and Fleet pay less per extra minute");
  await expect(page.getByTestId("text-call-assistant-landing-tiers")).toContainText(`The first ${p.freeSpamCalls} spam calls each month are free on every tier`);
  await expect(page.getByTestId("link-call-assistant-learn-more")).toHaveAttribute("href", "/call-assistant");
  await expect(page.getByTestId("link-footer-call-assistant")).toHaveAttribute("href", "/call-assistant");

  await page.goto("/pricing");
  await expect(page.getByTestId("text-addon-intro-call_assistant")).toContainText(callAssistantIntroShort());
  await expect(page.getByTestId("text-addon-intro-call_assistant")).toContainText(`Regular prices from ${p.from}/mo (${p.fromTier})`);
  await expect(page.getByTestId("link-addon-call-assistant")).toHaveAttribute("href", "/call-assistant");
  // Four tier cards above the add-on table; the tiers are not rows of it.
  await expect(page.locator('[data-testid^="card-call-assistant-tier-"]')).toHaveCount(4);
  for (const t of p.tiers) {
    await expect(page.getByTestId(`text-call-assistant-tier-overage-${t.tier}`)).toContainText(`${t.overageShort}/min over`);
    await expect(page.getByTestId(`badge-call-assistant-tier-lower-overage-${t.tier}`)).toHaveCount(t.lowerOverage ? 1 : 0);
    await expect(page.getByTestId(`text-call-assistant-tier-price-${t.tier}`)).toHaveText(`${t.monthly}/mo`);
    await expect(page.getByTestId(`card-call-assistant-tier-${t.tier}`)).toContainText(`${t.minutes} call minutes a month`);
    await expect(page.getByTestId(`card-call-assistant-tier-${t.tier}`)).toContainText(`${t.numbersLabel} included`);
    await expect(page.getByTestId(`row-addon-${t.addon}`)).toHaveCount(0);
  }
  await expect(page.getByTestId("text-call-assistant-tier-intro-solo")).toHaveText(`Launch price: ${p.intro}/mo for your first ${p.introMonths} months`);
  await expect(page.getByTestId("text-call-assistant-tiers-every")).toContainText(`the first ${p.freeSpamCalls} spam calls each month are free (they never count toward your minutes)`);
  await expect(page.getByTestId("text-call-assistant-tiers-every")).toContainText(`Above the included minutes, ${p.overageLine}.`);
  await expect(page.getByTestId("row-addon-call_number")).toBeVisible();
  // "Coming soon" on the tier cards and the extra-number row only while the price book keeps them in preview (launched: none).
  await expect(page.getByTestId("section-call-assistant-tiers").getByText("Coming soon", { exact: true })).toHaveCount(p.comingSoon ? p.tiers.length : 0);
  await expect(page.getByTestId("text-call-assistant-tier-preview")).toHaveCount(p.comingSoon ? 1 : 0);
  await expect(page.getByTestId("badge-addon-preview-call_number")).toHaveCount(ADDONS.call_number.preview ? 1 : 0);
  // The tiers' annual prices show on yearly billing even though they are over $1,000 (add-on annuals are exempt).
  await page.getByTestId("button-interval-year").click();
  for (const t of p.tiers) {
    await expect(page.getByTestId(`text-call-assistant-tier-price-${t.tier}`)).toHaveText(`${t.annual}/yr`);
    await expect(page.getByTestId(`text-call-assistant-tier-price-${t.tier}`)).not.toContainText(SALES_REP_LABEL);
  }
  // … and the note no longer offers the monthly intro as if it applied to yearly billing.
  await expect(page.getByTestId("text-addon-intro-call_assistant")).toHaveText(callAssistantYearlyNote());
  await expect(page.getByTestId("text-call-assistant-tier-intro-solo")).toHaveCount(0);

  // Signed in (dev bypass): the main sidebar has the entry, with the NEW badge.
  await page.goto("/");
  const entry = page.getByTestId("link-nav-call-assistant");
  await expect(entry).toHaveAttribute("href", "/call-assistant");
  await expect(page.getByTestId("badge-new-call-assistant")).toHaveText(/^new$/i);
});

test("Master Class: modules and bundle at $1,000+ are sold through a sales rep", async ({ page }) => {
  await page.goto("/master-class?tab=pricing");
  await expect(page.getByTestId("text-bundle-price")).toHaveCount(0);
  await expect(page.locator('[data-testid^="button-module-sales-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="button-add-cart-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="button-enroll-"]')).toHaveCount(0);
  // No saving to show, so no "best value" claim.
  await expect(page.getByTestId("badge-bundle-best-value")).toHaveCount(0);
  // The inquiry form names what they asked about.
  await page.getByTestId("button-bundle-sales").click();
  await expect(page.getByTestId("dialog-talk-to-sales").getByTestId("text-sales-topic")).toContainText("Master Class — Complete Bundle");
  // The old Master Class landing page is now its feature page, sold through a sales rep.
  await page.goto("/master-class-landing");
  await expect(page).toHaveURL(/\/features\/master-class$/);
  await expect(page.getByTestId("button-feature-sales-hero")).toContainText(SALES_REP_LABEL);
  await expect(page.getByTestId("text-feature-price")).toHaveCount(0);
});

test("CRM gateway says the CRM is included in every plan", async ({ page }) => {
  await page.goto("/crm-app");
  await expect(page.getByTestId("text-crm-included")).toContainText("included with every ConstructHUB plan");
  await expect(page.getByTestId("text-crm-included")).toContainText("Starter 1, Pro 3, Growth 10 and Agency 10");
});

test("Competitor Intel: a 402 plan_required shows an honest upgrade prompt", async ({ page }) => {
  await page.route("**/api/competitors/scans", (route) => route.request().method() === "GET"
    ? route.fulfill({
      status: 402, contentType: "application/json",
      body: JSON.stringify({ code: "plan_required", requiredPlan: "pro", message: "Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it." }),
    })
    : route.continue());
  await page.goto("/competitors");
  await expect(page.getByTestId("text-plan-required")).toHaveText("Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it.");
  await expect(page.getByTestId("button-upgrade-plan")).toHaveText(/See the Pro plan/);
  await expect(page.getByText("Pro, Growth and Agency")).toBeVisible();
  await expect(page.getByTestId("button-start-scan")).toHaveCount(0);
});

test("Competitor Intel: an entitled account gets the scan form", async ({ page }) => {
  await page.route("**/api/competitors/scans", (route) => route.request().method() === "GET"
    ? route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    : route.continue());
  await page.goto("/competitors");
  await expect(page.getByTestId("button-start-scan")).toBeVisible();
  await expect(page.getByTestId("text-plan-required")).toHaveCount(0);
});

test("Competitor Intel: the pre-entitlements 403 shows the same prompt, not the retired plan names", async ({ page }) => {
  await page.route("**/api/competitors/scans", (route) => route.request().method() === "GET"
    ? route.fulfill({
      status: 403, contentType: "application/json",
      body: JSON.stringify({ message: "Competitor Intelligence requires a Gold or Platinum membership. Upgrade your plan to access this feature." }),
    })
    : route.continue());
  await page.goto("/competitors");
  await expect(page.getByTestId("text-plan-required")).toHaveText("Your plan does not include Competitor Intel.");
  await expect(page.getByTestId("button-upgrade-plan")).toHaveText(/See plans/);
  await expect(page.getByTestId("button-start-scan")).toHaveCount(0);
  expect(await bodyText(page)).not.toMatch(LEGACY);
});
