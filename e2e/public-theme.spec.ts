import { expect, test, type Page } from "@playwright/test";

/**
 * The public pages restyled to the marketing site's editorial look (design B):
 * sign-in / sign-up with the gator, the legal pages' contents list, the 404.
 * Signed out, against an already-started dev server (DEV_AUTH_BYPASS_USER1=false):
 *
 *   THEME_SIGNED_OUT_URL=http://127.0.0.1:8470 npx playwright test -c playwright.public-theme.config.ts
 */
const BASE = process.env.THEME_SIGNED_OUT_URL || `http://127.0.0.1:${process.env.E2E_PORT ?? "8470"}`;

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test("sign-up: the gator welcomes you in, the Terms agreement still gates the button", async ({ page }) => {
      await page.goto(`${BASE}/auth?mode=signup`);
      const bubble = page.getByTestId(viewport.width >= 1024 ? "text-auth-bubble" : "text-auth-bubble-small");
      await expect(bubble).toHaveText("Welcome in — let's build your business.");
      await expect(bubble).toBeVisible();
      await expect(page.getByTestId("button-signup")).toBeDisabled();
      await page.getByTestId("checkbox-agree-terms").check();
      await expect(page.getByTestId("button-signup")).toBeEnabled();
      await expect(page.getByTestId("link-signup-terms")).toHaveAttribute("href", "/terms");
      await expect(page.getByTestId("link-signup-privacy")).toHaveAttribute("href", "/privacy");
      await expect(page.getByTestId("text-signup-agreement")).toContainText("including with Google");
      await expect(page.getByTestId("link-google-signup")).toHaveAttribute("href", "/api/auth/google");
      await noSideScroll(page);
    });

    test("sign-in: \"Welcome back.\" and the mode follows the screen", async ({ page }) => {
      await page.goto(`${BASE}/auth?next=%2Fpricing`);
      const bubble = page.getByTestId(viewport.width >= 1024 ? "text-auth-bubble" : "text-auth-bubble-small");
      await expect(bubble).toHaveText("Welcome back.");
      await expect(page.getByTestId("link-google-login")).toHaveAttribute("href", "/api/auth/google?next=%2Fpricing");
      await page.getByTestId("link-forgot-password").click();
      await expect(page).toHaveURL(/mode=forgot-password/);
      await expect(page.getByTestId("input-forgot-email")).toBeVisible();
      await noSideScroll(page);
    });

    test("the Terms and Privacy pages list every section in their contents", async ({ page }) => {
      for (const [path, testId] of [["/terms", "page-terms-of-use"], ["/privacy", "page-privacy-policy"]] as const) {
        await page.goto(`${BASE}${path}`);
        await expect(page.getByTestId(testId)).toBeVisible();
        const sections = await page.locator(`[data-testid="${testId}"] article section h2`).count();
        expect(sections, path).toBeGreaterThan(10);
        const toc = page.getByTestId(viewport.width >= 1024 ? "toc-legal" : "toc-legal-mobile");
        await expect(toc.locator('a[href^="#"]')).toHaveCount(sections);
        await noSideScroll(page);
      }
    });

    test("picking a Contents entry lands its heading at the top of the screen, and the site footer follows", async ({ page }) => {
      const phone = viewport.width < 1024;
      for (const [path, id] of [["/privacy", "ccpa"], ["/terms", "refund-policy"], ["/terms", "introduction"]] as const) {
        await page.goto(`${BASE}${path}`);
        const heading = page.locator(`section#${id} h2`);
        await expect(heading).toHaveCount(1);
        if (phone) await page.getByTestId("toc-legal-mobile").locator("summary").click();
        await page.getByTestId(phone ? "toc-legal-mobile" : "toc-legal").getByTestId(`link-toc-${id}`).click();
        if (phone) await expect(page.getByTestId("toc-legal-mobile")).not.toHaveAttribute("open", "");
        // The smooth scroll settles: the heading sits in the top band of the viewport.
        await expect.poll(async () => {
          const top = await heading.evaluate((el) => Math.round(el.getBoundingClientRect().top));
          return top >= 0 && top < 200 ? "in view" : `top=${top}`;
        }, { message: `${path} #${id}`, timeout: 5_000 }).toBe("in view");
        await expect(page).toHaveURL(new RegExp(`#${id}$`));
        await expect(page.getByTestId("footer-public-page")).toHaveCount(1);
      }
    });

    test("an unknown URL is the 404 with the gator", async ({ page }) => {
      await page.goto(`${BASE}/this-page-does-not-exist`);
      await expect(page.getByText("Page Not Found")).toBeVisible();
      await expect(page.getByTestId("text-not-found-bubble")).toHaveText("This page wandered off the job site.");
      await expect(page.getByTestId("link-back-home")).toHaveAttribute("href", "/");
      await noSideScroll(page);
    });
  });
}
