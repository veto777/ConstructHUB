import { expect, test, type Page } from "@playwright/test";
import { FEATURE_CATALOGUE, FEATURE_PAGES, featurePagePath } from "../shared/feature-pages";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "../client/src/lib/features";

/**
 * The feature intro pages: /features (the catalogue) and every /features/<slug>,
 * signed out at 1440 and 390 — no console errors, no sideways scroll, one h1, a
 * call to action — plus the platform admins' index /admin/feature-pages.
 *
 * Two already-started dev servers from the same checkout, on a scratch DB:
 *   FP_SIGNED_OUT_URL  DEV_AUTH_BYPASS_USER1=false  (default http://127.0.0.1:$E2E_PORT)
 *   FP_SIGNED_IN_URL   DEV_AUTH_BYPASS_USER1=true   (user 1 is a platform admin in dev; the admin tests skip without it)
 *   FP_SCREENSHOT_DIR  optional: where the review screenshots go
 *
 *   FP_SIGNED_OUT_URL=http://127.0.0.1:8291 FP_SIGNED_IN_URL=http://127.0.0.1:8292 \
 *     npx playwright test -c playwright.feature-pages.config.ts
 */

const SIGNED_OUT = process.env.FP_SIGNED_OUT_URL || `http://127.0.0.1:${process.env.E2E_PORT ?? "8291"}`;
const SIGNED_IN = process.env.FP_SIGNED_IN_URL || "";
const SHOTS = process.env.FP_SCREENSHOT_DIR;

const FLAGS = { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } as const;
const visible = (flag?: keyof typeof FLAGS) => !flag || FLAGS[flag];
const PAGES = FEATURE_PAGES.filter((p) => visible(p.flag));
const CATALOGUE = FEATURE_CATALOGUE.filter((e) => visible(e.flag));

/** Console errors and uncaught exceptions while the page is open. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  // The cookie banner and Gabe's launcher float over the page; leave them out of review shots.
  await page.addStyleTag({ content: "[data-testid=cookie-consent-banner],[data-testid=hub-launcher]{display:none!important}" });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`signed out, ${viewport.width}px`, () => {
    test.use({ viewport });

    test("/features lists every feature by group, with a way in", async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, `${SIGNED_OUT}/features`);
      await expect(page.getByTestId("header-public-page")).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByTestId("text-features-title")).toBeVisible();
      await expect(page.getByTestId("cta-features-primary")).toHaveAttribute("href", /^\/auth\?mode=signup/);
      await expect(page.locator('[data-testid^="card-catalogue-"]')).toHaveCount(CATALOGUE.length);
      for (const e of CATALOGUE) await expect(page.getByTestId(`card-catalogue-${e.key}`)).toHaveAttribute("href", e.path);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
      await shot(page, `features-${viewport.width}`);
    });

    for (const fp of PAGES) {
      test(`/features/${fp.slug}`, async ({ page }) => {
        const errors = watchErrors(page);
        await open(page, `${SIGNED_OUT}${featurePagePath(fp)}`);
        await expect(page.getByTestId(`page-feature-${fp.slug}`)).toBeVisible();
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.getByTestId("text-feature-title")).toBeVisible();
        const cta = page.getByTestId("cta-feature-primary-hero");
        await expect(cta).toBeVisible();
        await expect(cta).toHaveAttribute("href", /^\/auth\?mode=signup&next=/);
        await expect(page.getByTestId("button-feature-sales-hero")).toBeVisible();
        await expect(page.getByTestId("section-feature-pricing")).toBeVisible();
        await expect(page.getByTestId("text-feature-price-headline")).not.toBeEmpty();
        await expect(page).toHaveTitle(fp.seo.title);
        expect(await overflow(page)).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
        if (fp.key === "siteScan") await shot(page, `site-scan-${viewport.width}`);
      });
    }
  });
}

test.describe("signed out: routing", () => {
  test("an unknown slug is the 404 page; /features/call-assistant goes to its own page", async ({ page }) => {
    await open(page, `${SIGNED_OUT}/features/no-such-feature`);
    await expect(page.getByText("Page Not Found")).toBeVisible();
    await open(page, `${SIGNED_OUT}/features/call-assistant`);
    await expect(page).toHaveURL(/\/call-assistant$/);
    await expect(page.getByTestId("page-call-assistant")).toBeVisible();
  });

  test("a retired landing page keeps rendering until its feature page is ready", async ({ page }) => {
    const permits = FEATURE_PAGES.find((p) => p.key === "permits")!;
    await open(page, `${SIGNED_OUT}/permits-landing`);
    if (permits.status === "ready") await expect(page).toHaveURL(new RegExp(`${featurePagePath(permits)}$`));
    else await expect(page).toHaveURL(/\/permits-landing$/);
  });

  test("the admin index asks a signed-out visitor to sign in", async ({ page }) => {
    await open(page, `${SIGNED_OUT}/admin/feature-pages`);
    await expect(page).toHaveURL(/\/auth\?next=%2Fadmin%2Ffeature-pages/);
    const res = await page.request.get(`${SIGNED_OUT}/api/admin/feature-pages`);
    expect(res.status()).toBe(401);
  });

  test("the public header and footer link the catalogue", async ({ page }) => {
    await open(page, `${SIGNED_OUT}/pricing`);
    await expect(page.getByTestId("link-public-features")).toHaveAttribute("href", "/features");
    await expect(page.getByTestId("link-public-footer-features")).toHaveAttribute("href", "/features");
  });
});

test.describe("platform admin (signed in)", () => {
  test.skip(!SIGNED_IN, "set FP_SIGNED_IN_URL to a DEV_AUTH_BYPASS_USER1=true server");
  test.use({ viewport: { width: 1440, height: 900 } });

  test("/admin/feature-pages lists every page, linked from the sidebar", async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, `${SIGNED_IN}/admin/feature-pages`);
    await expect(page.getByTestId("page-admin-feature-pages")).toBeVisible();
    await expect(page.locator('[data-testid^="row-admin-feature-"]')).toHaveCount(FEATURE_CATALOGUE.length + 1);
    for (const e of FEATURE_CATALOGUE) {
      await expect(page.getByTestId(`link-admin-feature-public-${e.key}`)).toHaveAttribute("href", e.path);
    }
    await expect(page.getByTestId("row-admin-feature-callAssistant")).toHaveAttribute("data-status", "external");
    await expect(page.getByTestId("link-admin-feature-public-landing")).toHaveAttribute("href", "/landing");
    await expect(page.getByTestId("row-admin-feature-siteScan")).toHaveAttribute("data-status", "ready");
    const nav = page.getByTestId("link-nav-admin-feature-pages");
    await expect(nav).toBeVisible();
    await expect(nav).toHaveAttribute("href", "/admin/feature-pages");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 2400 });
    await shot(page, "admin-feature-pages-1440");
  });

  test("the dashboard header links the index; a feature page opens the tool inside the app frame", async ({ page }) => {
    await open(page, `${SIGNED_IN}/`);
    await expect(page.getByTestId("link-dashboard-feature-pages")).toHaveAttribute("href", "/admin/feature-pages", { timeout: 30_000 });
    await open(page, `${SIGNED_IN}/features/site-scan`);
    await expect(page.getByTestId("header-public-page")).toHaveCount(0);
    await expect(page.getByTestId("link-nav-admin-feature-pages")).toBeVisible();
    const cta = page.getByTestId("cta-feature-primary-hero");
    await expect(cta).toHaveText(/Open Site Scan/);
    await expect(cta).toHaveAttribute("href", "/site-scan");
  });
});
