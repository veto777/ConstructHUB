import { expect, test, type Page } from "@playwright/test";
import { DFY_CATALOGUE, DFY_PAGES, dfyPagePath } from "../shared/dfy-pages";
import { MARKETING_ROUTES } from "../shared/seo";
import { SALES_REP_LABEL } from "../shared/plan-copy";

/**
 * The marketing site's foundation: the done-for-you pages (/done-for-you and
 * every /done-for-you/<slug>), the ribbon on every public page with both
 * dropdowns (mouse and keyboard at 1440, the phone fold-outs at 390), the
 * landing's done-for-you cards linking their pages, and the JSON-LD on every
 * marketing page.
 *
 * Signed out, against a dev server (DEV_AUTH_BYPASS_USER1=false) or the built
 * production server (NODE_ENV=production node dist/index.cjs), where the
 * pages arrive prerendered and the HTML itself is checked too:
 *
 *   FP_SIGNED_OUT_URL=http://127.0.0.1:8411 FP_SCREENSHOT_DIR=… \
 *     npx playwright test -c playwright.feature-pages.config.ts marketing-seo
 */

const SIGNED_OUT = process.env.FP_SIGNED_OUT_URL || `http://127.0.0.1:${process.env.E2E_PORT ?? "8291"}`;
const SHOTS = process.env.FP_SCREENSHOT_DIR;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/**
 * Open a page and wait for the app to be on it. The Vite dev server now and
 * then drops a module load in a long loop of page loads (the page stays on
 * index.html's static fallback); reload once when that happens.
 */
async function open(page: Page, url: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const mounted = await page.waitForFunction(
      () => !!document.querySelector("#root [data-testid]") && !document.querySelector('#root > main[style*="max-width:720px"]'),
      null,
      { timeout: 15_000 },
    ).then(() => true, () => false);
    if (mounted) return;
  }
  throw new Error(`the app never mounted on ${url}`);
}

/**
 * Leave the cookie banner and Gabe's launcher out of review shots. Call it
 * before opening a menu: hiding the banner reflows the page under it.
 */
async function hideNoise(page: Page) {
  if (!SHOTS || (await page.locator("style[data-review-shot]").count())) return;
  await page.addStyleTag({ content: "[data-testid=cookie-consent-banner],[data-testid=hub-launcher],[data-testid=hub-welcome-bubble]{display:none!important}" });
  await page.evaluate(() => document.querySelector("style:last-of-type")?.setAttribute("data-review-shot", ""));
}

async function shot(page: Page, name: string, fullPage = true) {
  if (!SHOTS) return;
  await hideNoise(page);
  // A menu panel sizes its frame on the frame after it mounts; let it settle.
  await page.waitForTimeout(250);
  // Finite animations (the panels' 150 ms fade-in) are fast-forwarded to their end state.
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage, animations: "disabled" });
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const slugOf = (path: string) => path.split("/").pop();

/** The open menu panel's frame (the Radix viewport) is as big as the panel: nothing is clipped. */
async function expectPanelFits(page: Page, testId: string) {
  const panel = page.getByTestId(testId);
  await expect.poll(async () => panel.evaluate((el) => {
    const frame = el.parentElement!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return Math.round(frame.width) >= Math.round(box.width) && Math.round(frame.height) >= Math.round(box.height);
  })).toBe(true);
}

/** The page's JSON-LD script, parsed (throws on invalid JSON). */
async function jsonLd(page: Page): Promise<any[]> {
  const text = await page.locator('script[type="application/ld+json"][data-seo="jsonld"]').textContent();
  return JSON.parse(text ?? "")["@graph"];
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`done-for-you pages, signed out, ${viewport.width}px`, () => {
    test.use({ viewport });

    test("/done-for-you lists every service, each linked to its page", async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, `${SIGNED_OUT}/done-for-you`);
      await expect(page.getByTestId("header-public-page")).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByTestId("text-dfy-catalogue-title")).toBeVisible();
      await expect(page.locator('[data-testid^="card-dfy-catalogue-"]')).toHaveCount(DFY_CATALOGUE.length);
      for (const e of DFY_CATALOGUE) await expect(page.getByTestId(`card-dfy-catalogue-${e.key}`)).toHaveAttribute("href", e.path);
      await expect(page.getByTestId("section-dfy-compare")).toBeVisible();
      await expect(page.getByTestId("link-dfy-compare-features")).toHaveAttribute("href", "/features");
      await expect(page).toHaveTitle(/Done-For-You Services/);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
      await shot(page, `done-for-you-${viewport.width}`);
    });

    for (const dfy of DFY_PAGES) {
      test(`/done-for-you/${dfy.slug}`, async ({ page }) => {
        const errors = watchErrors(page);
        await open(page, `${SIGNED_OUT}${dfyPagePath(dfy)}`);
        await expect(page.getByTestId(`page-dfy-${dfy.slug}`)).toBeVisible();
        await expect(page.getByTestId("header-public-page")).toBeVisible();
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.getByTestId("text-feature-title")).toBeVisible();
        await expect(page).toHaveTitle(dfy.seo.title);
        // A service is sold through a sales rep: never a price at or above the threshold, never a checkout.
        await expect(page.getByTestId("text-feature-price-headline")).toHaveText(SALES_REP_LABEL);
        await expect(page.getByTestId("text-feature-price")).toHaveCount(0);
        await expect(page.getByTestId("link-dfy-all")).toHaveAttribute("href", "/done-for-you");
        await expect(page.locator('[data-testid^="faq-feature-"]')).toHaveCount(dfy.faqs.length);
        // The call to action opens the sales request, about this service.
        await page.getByTestId("cta-dfy-sales-hero").click();
        await expect(page.getByTestId("dialog-talk-to-sales")).toBeVisible();
        await expect(page.getByTestId("text-sales-topic")).toContainText(dfy.title);
        await page.keyboard.press("Escape");
        // Structured data: the service, its FAQ, a breadcrumb — and no Offer for a sales-rep service.
        const graph = await jsonLd(page);
        const service = graph.find((n) => n["@type"] === "Service");
        expect(service.name).toBe(dfy.title);
        expect(service.offers).toBeUndefined();
        expect(graph.find((n) => n["@type"] === "FAQPage").mainEntity).toHaveLength(dfy.faqs.length);
        expect(await overflow(page)).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
        if (dfy.key === "formation") await shot(page, `dfy-business-formation-${viewport.width}`);
      });
    }
  });
}

test.describe("the ribbon, 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every public page carries the ribbon with both dropdowns", async ({ page }) => {
    for (const route of [...MARKETING_ROUTES, "/free-site-scan"]) {
      await open(page, `${SIGNED_OUT}${route}`);
      const bar = page.getByTestId("site-nav-links");
      await expect(bar, route).toBeVisible();
      await expect(bar.getByTestId("nav-dropdown-features"), route).toBeVisible();
      await expect(bar.getByTestId("nav-dropdown-dfy"), route).toBeVisible();
      for (const id of ["plans", "stats", "coverage"]) await expect(bar.getByTestId(`link-nav-${id}`), route).toBeVisible();
    }
  });

  test("Done-For-You ▾ by mouse: every service, then 'See all services'", async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, `${SIGNED_OUT}/pricing`);
    await hideNoise(page);
    await page.getByTestId("nav-dropdown-dfy").hover();
    await expect(page.getByTestId("nav-panel-dfy")).toBeVisible();
    await expectPanelFits(page, "nav-panel-dfy");
    for (const e of DFY_CATALOGUE) await expect(page.getByTestId(`nav-item-dfy-${slugOf(e.path)}`)).toHaveAttribute("href", e.path);
    await expect(page.getByTestId("nav-dfy-all")).toHaveAttribute("href", "/done-for-you");
    await shot(page, "nav-dfy-open-1440", false);
    // Moving across to Features swaps the panel.
    await page.getByTestId("nav-dropdown-features").hover();
    await expect(page.getByTestId("nav-panel-features")).toBeVisible();
    await expectPanelFits(page, "nav-panel-features");
    await expect(page.getByTestId("nav-item-site-scan")).toHaveAttribute("href", "/features/site-scan");
    await shot(page, "nav-features-open-1440", false);
    await page.getByTestId("nav-dropdown-dfy").hover();
    await page.getByTestId("nav-item-dfy-seo-contracts").click();
    await expect(page).toHaveURL(/\/done-for-you\/seo-contracts$/);
    await expect(page.getByTestId("page-dfy-seo-contracts")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("both dropdowns by keyboard: Enter opens, arrows move between them, Tab goes in, Escape closes", async ({ page }) => {
    await open(page, `${SIGNED_OUT}/features`);
    await hideNoise(page);
    const features = page.getByTestId("nav-dropdown-features");
    await features.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("nav-panel-features")).toBeVisible();
    await expect(features).toHaveAttribute("aria-expanded", "true");
    // A person's pause: Radix registers the panel's Escape listener just after it opens.
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("nav-panel-features")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("nav-dropdown-dfy")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("nav-panel-dfy")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId(`nav-item-dfy-${slugOf(DFY_CATALOGUE[0].path)}`)).toBeFocused();
    await expectPanelFits(page, "nav-panel-dfy");
    await shot(page, "nav-dfy-keyboard-1440", false);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${DFY_CATALOGUE[0].path}$`));
    await expect(page.getByTestId(`page-dfy-${slugOf(DFY_CATALOGUE[0].path)}`)).toBeVisible();
  });

  test("the landing's done-for-you cards link their pages", async ({ page }) => {
    await open(page, `${SIGNED_OUT}/`);
    await expect(page.getByTestId("link-hero-dfy")).toHaveAttribute("href", "/done-for-you");
    await expect(page.getByTestId("link-dfy-formation")).toHaveAttribute("href", "/done-for-you/business-formation");
    await expect(page.getByTestId("link-dfy-gmb")).toHaveAttribute("href", "/done-for-you/gmb-website-setup");
    await expect(page.getByTestId("link-dfy-seo")).toHaveAttribute("href", "/done-for-you/seo-ads-management");
    await expect(page.getByTestId("link-dfy-bundle")).toHaveAttribute("href", "/done-for-you/complete-business-build");
    // Still "Talk to a sales rep" on each card, and the bundle's sales link (pricing-copy.spec.ts).
    await expect(page.getByTestId("text-dfy-sales")).toHaveCount(3);
    await expect(page.getByTestId("link-dfy-pricing")).toHaveAttribute("href", "/pricing#services");
    await page.getByTestId("link-dfy-formation").click();
    await expect(page.getByTestId("page-dfy-business-formation")).toBeVisible();
  });
});

test.describe("the ribbon, 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the phone menu folds out the features and the services", async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, `${SIGNED_OUT}/features/site-scan`);
    await hideNoise(page);
    await page.getByTestId("button-landing-menu").click();
    // Features opens first; Done-For-You is its own fold-out group.
    await expect(page.getByTestId("mobile-nav-features-all")).toBeVisible();
    await page.getByTestId("mobile-nav-dfy").click();
    for (const e of DFY_CATALOGUE) await expect(page.getByTestId(`mobile-nav-item-dfy-${slugOf(e.path)}`)).toHaveAttribute("href", e.path);
    await expect(page.getByTestId("mobile-nav-dfy-all")).toHaveAttribute("href", "/done-for-you");
    // One group open at a time: Features folds away as Done-For-You opens.
    await expect(page.getByTestId("mobile-nav-features-all")).toBeHidden();
    await expect(page.getByTestId("mobile-nav-dfy-all")).toBeInViewport();
    for (const id of ["plans", "stats", "coverage"]) await expect(page.getByTestId(`link-mobile-nav-${id}`)).toBeVisible();
    await shot(page, "nav-mobile-dfy-390", false);
    await page.getByTestId("mobile-nav-item-dfy-complete-business-build").click();
    await expect(page).toHaveURL(/\/done-for-you\/complete-business-build$/);
    await expect(page.getByTestId("page-dfy-complete-business-build")).toBeVisible();
    await expect(page.getByTestId("mobile-nav-dfy")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("every public page keeps the menu button", async ({ page }) => {
    for (const route of ["/", "/features", "/done-for-you", "/pricing", "/privacy", "/terms", "/google-business", "/lsa-guide"]) {
      await open(page, `${SIGNED_OUT}${route}`);
      await expect(page.getByTestId("button-landing-menu"), route).toBeVisible();
      expect(await overflow(page), route).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("structured data", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every marketing page has valid JSON-LD with the Organization; the HTML has it when the server writes it", async ({ page }) => {
    for (const route of MARKETING_ROUTES) {
      await open(page, `${SIGNED_OUT}${route}`);
      const graph = await jsonLd(page);
      expect(graph.find((n) => n["@type"] === "Organization"), route).toBeTruthy();
      if (route !== "/") expect(graph.find((n) => n["@type"] === "BreadcrumbList"), route).toBeTruthy();
      await expect(page.locator('link[rel="canonical"]'), route).toHaveAttribute("href", `https://constructhub.us${route}`);
      // The production server writes it (and the prerendered page) into the HTML itself.
      const html = await (await page.request.get(`${SIGNED_OUT}${route}`)).text();
      const raw = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
      if (raw) expect(JSON.parse(raw[1])["@graph"].length, route).toBeGreaterThan(0);
    }
  });
});
