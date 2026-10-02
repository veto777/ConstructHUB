/**
 * The signed-in home dashboard (docs/dashboard/SPEC.md §4.5). Run against a
 * growth-app lane (VITE_FORCE_PORTAL=false, DEV_AUTH_BYPASS_USER1=true):
 *   E2E_PORT=<port> E2E_DB=constructhub_dev_a6 E2E_WORKERS=1 npx playwright test e2e/dashboard.spec.ts
 *
 * Against the skeleton the route answers SAMPLE payloads (fixture: true);
 * ?fixture=new|noplan is added with page.route. The assertions are about
 * statuses, links and layout — never about the sample numbers — so the same
 * spec keeps working once the real aggregator replaces the fixture.
 * Screenshots (1440 / 390, light / dark) land in DASHBOARD_SHOTS_DIR when set.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { E2E_BASE_URL } from "./helpers";
import { DASHBOARD_GROUPS, DASHBOARD_TILES, type DashboardPayload } from "../shared/dashboard";

const SHOTS = process.env.DASHBOARD_SHOTS_DIR ?? "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

/** The app shell scrolls inside <main>: grow the viewport to the content so the shot is the whole page. */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const vp = page.viewportSize()!;
  const height = await page.evaluate(() => {
    const main = document.querySelector("main");
    const header = document.querySelector("header");
    return Math.ceil((main?.scrollHeight ?? document.body.scrollHeight) + (header?.getBoundingClientRect().height ?? 0));
  });
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(height, vp.height), 12_000) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.setViewportSize(vp);
}

/** Point the client's GET /api/dashboard at a fixture scenario (the skeleton's ?fixture= switch). */
async function useScenario(page: Page, scenario: "full" | "new" | "noplan") {
  await page.route(/\/api\/dashboard(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("fixture", scenario);
    await route.continue({ url: url.toString() });
  });
}

async function openDashboard(page: Page) {
  // Keep the cookie banner and Gabe's first-visit bubble out of the screenshots.
  await page.context().addCookies([{ name: "ch_consent", value: "denied", url: E2E_BASE_URL }]);
  await page.addInitScript(() => { try { localStorage.setItem("hub.welcomeSeen", "1"); } catch { /* storage blocked */ } });
  await page.goto("/");
  await expect(page.getByTestId("page-dashboard")).toBeVisible();
  await expect(page.getByTestId("text-dashboard-greeting")).toBeVisible();
}

const tile = (page: Page, key: string) => page.getByTestId(`tile-${key}`);

test.describe("signed-in dashboard", () => {
  test("renders every group and tile status, never the old marketing home", async ({ page }) => {
    await useScenario(page, "full");
    await openDashboard(page);
    await expect(page.getByText("Stop Guessing")).toHaveCount(0);
    await expect(page.getByText("Your Complete Toolkit")).toHaveCount(0);
    await expect(page.getByTestId("badge-dashboard-fixture")).toHaveText("Sample data");
    await expect(page.getByTestId("badge-dashboard-plan")).toContainText("Active");

    for (const group of DASHBOARD_GROUPS) {
      const section = page.getByTestId(`section-dashboard-${group.key}`);
      await expect(section).toBeVisible();
      await expect(section.getByRole("heading", { level: 2, name: group.label })).toBeVisible();
    }
    // Every catalogue tile but the CRM (the snapshot card) is in the grid, each with a status.
    for (const def of DASHBOARD_TILES.filter((d) => d.key !== "crm")) {
      await expect(tile(page, def.key)).toHaveAttribute("data-status", /^(ok|empty|error|locked|coming_soon)$/);
    }
    await expect(page.locator('[data-testid^="tile-"][data-status]')).toHaveCount(DASHBOARD_TILES.length - 1);

    await expect(tile(page, "cloudflare")).toHaveAttribute("data-status", "locked");
    await expect(tile(page, "callAssistant")).toHaveAttribute("data-status", "coming_soon");
    await expect(tile(page, "callAssistant")).toContainText("Coming soon");
    await expect(tile(page, "social")).toHaveAttribute("data-status", "error");
    await expect(tile(page, "social").getByTestId("link-tile-social")).toHaveAttribute("href", "/social-media");
    await expect(tile(page, "media")).toHaveAttribute("data-status", "empty");
    await expect(tile(page, "media").getByTestId("link-tile-media")).toBeVisible();
    // The failing tile doesn't take its neighbours down.
    await expect(tile(page, "rankingGrid")).toHaveAttribute("data-status", "ok");
    await expect(page.getByTestId("metric-rankingGrid-credits")).toBeVisible();
    await expect(tile(page, "permits").getByTestId("link-tile-permits-0")).toHaveAttribute("href", "/history");

    // CRM snapshot: the money numbers, linked to the portal host.
    const crm = page.getByTestId("card-dashboard-crm");
    await expect(crm).toHaveAttribute("data-status", "ok");
    await expect(crm.getByTestId("metric-crm-pipeline")).toBeVisible();
    await expect(crm.getByTestId("metric-crm-openEstimates")).toBeVisible();
    await expect(page.getByTestId("link-dashboard-crm")).toHaveAttribute("href", /^https?:\/\/portal\.[^/]+\/crm$/);
    await expect(tile(page, "crmSchedule").getByTestId("link-tile-crmSchedule")).toHaveAttribute("href", /^https?:\/\/portal\.[^/]+\/crm\/schedule$/);

    await expect(page.getByTestId("usage-searches")).toBeVisible();
    await expect(page.getByTestId("link-usage-searches")).toHaveAttribute("href", "/search");
    await expect(page.getByTestId("link-usage-crmSeats")).toHaveAttribute("href", /^https?:\/\/portal\./);
    await expect(page.getByTestId("list-dashboard-recent").locator("li")).not.toHaveCount(0);

    // Headings run h1 → h2 → h3.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(tile(page, "reviews").getByRole("heading", { level: 3 })).toHaveText("Google Reviews");
    await shot(page, "dashboard-1440-light");
  });

  test("a locked tile shows the plan_required prompt and links to the plans", async ({ page }) => {
    await useScenario(page, "full");
    await openDashboard(page);
    const cf = tile(page, "cloudflare");
    await expect(cf.getByTestId("status-cloudflare")).toContainText("Agency");
    await expect(cf.getByTestId("locked-cloudflare")).toContainText("Included with the Agency plan.");
    await expect(cf.getByTestId("locked-cloudflare")).toHaveAttribute("title", /Cloudflare \+ Search Console/);
    await expect(cf.getByTestId("link-tile-cloudflare-plans")).toHaveAttribute("href", "/pricing");
    // A locked tile shows no numbers.
    await expect(cf.locator('[data-testid^="metric-"]')).toHaveCount(0);
    await cf.getByTestId("link-tile-cloudflare-plans").click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("Refresh fetches a fresh answer and shows it", async ({ page }) => {
    await useScenario(page, "full");
    await page.route(/\/api\/dashboard\?.*fresh=1/, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as DashboardPayload;
      const reviews = body.tiles.find((t) => t.key === "reviews")!;
      reviews.metrics = reviews.metrics.map((m) => (m.key === "rating" ? { ...m, value: 3.2 } : m));
      await route.fulfill({ response: res, json: body });
    });
    await openDashboard(page);
    await expect(page.getByTestId("metric-reviews-rating")).not.toContainText("3.2");
    const fresh = page.waitForRequest((r) => r.url().includes("/api/dashboard") && r.url().includes("fresh=1"));
    await page.getByTestId("button-dashboard-refresh").click();
    await fresh;
    await expect(page.getByTestId("metric-reviews-rating")).toContainText("3.2");
    await expect(page.getByTestId("button-dashboard-refresh")).toBeEnabled();
  });

  test("a new account gets the checklist with working links", async ({ page }) => {
    await useScenario(page, "new");
    await openDashboard(page);
    const card = page.getByTestId("card-dashboard-checklist");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("checklist-connectGoogle")).toHaveAttribute("data-done", "false");
    await expect(card.locator('[data-done="true"]')).toHaveCount(0);
    await expect(card.getByTestId("link-checklist-runSiteScan")).toHaveAttribute("href", "/site-scan");
    await expect(card.getByTestId("link-checklist-setUpCrm")).toHaveAttribute("href", /^https?:\/\/portal\.[^/]+\/crm$/);
    await expect(page.getByTestId("badge-dashboard-plan")).toContainText("trial");
    await expect(page.getByTestId("text-dashboard-gabe")).toContainText("Ask Gabe how to connect Google");
    await expect(tile(page, "gbp")).toHaveAttribute("data-status", "empty");
    await expect(page.getByTestId("card-dashboard-crm")).toHaveAttribute("data-status", "empty");
    await expect(page.getByTestId("link-dashboard-crm")).toHaveAttribute("href", "/crm-app");

    // Collapsing is remembered by this browser.
    await card.getByTestId("button-checklist-toggle").click();
    await expect(card.getByTestId("checklist-connectGoogle")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("card-dashboard-checklist").getByTestId("checklist-connectGoogle")).toHaveCount(0);
    await page.getByTestId("button-checklist-toggle").click();
    await expect(page.getByTestId("checklist-connectGoogle")).toBeVisible();
    await shot(page, "dashboard-new-1440-light");

    await page.getByTestId("link-checklist-connectGoogle").click();
    await expect(page).toHaveURL(/\/locations$/);
  });

  test("no plan: plan-gated tiles are locked and the chip asks for a plan", async ({ page }) => {
    await useScenario(page, "noplan");
    await openDashboard(page);
    await expect(page.getByTestId("badge-dashboard-plan")).toContainText("Choose a plan");
    await expect(page.getByTestId("badge-dashboard-plan")).toHaveAttribute("href", "/pricing");
    await expect(tile(page, "gbp")).toHaveAttribute("data-status", "locked");
    await expect(tile(page, "property")).toHaveAttribute("data-status", "ok");
    await expect(page.getByTestId("link-dashboard-manage-plan")).toHaveCount(0);
  });

  test("a failed load shows one error card and Try again recovers", async ({ page }) => {
    let fail = true;
    await page.route(/\/api\/dashboard(\?.*)?$/, async (route) => {
      if (fail) return route.fulfill({ status: 500, json: { message: "boom" } });
      return route.continue();
    });
    await page.goto("/");
    await expect(page.getByTestId("card-dashboard-error")).toBeVisible();
    // The app shell (sidebar) still works.
    await expect(page.getByTestId("link-nav-crm")).toBeAttached();
    fail = false;
    await page.getByTestId("button-dashboard-retry").click();
    await expect(page.getByTestId("text-dashboard-greeting")).toBeVisible();
    await expect(page.getByTestId("card-dashboard-error")).toHaveCount(0);
  });

  test("shows skeletons while loading, not a spinner", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await page.route(/\/api\/dashboard(\?.*)?$/, async (route) => { await gate; await route.continue(); });
    await page.goto("/");
    await expect(page.getByTestId("skeleton-dashboard")).toBeVisible();
    release();
    await expect(page.getByTestId("skeleton-dashboard")).toHaveCount(0);
    await expect(page.getByTestId("text-dashboard-greeting")).toBeVisible();
  });

  test("Ask Gabe opens the assistant with the question typed in, not sent", async ({ page }) => {
    await useScenario(page, "new");
    await openDashboard(page);
    await page.getByTestId("button-dashboard-ask-gabe").click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    // The dev lane runs Gabe with chat on (builder tier), so the text box is there to prefill.
    await expect(panel.getByTestId("hub-input")).toHaveValue("How do I connect Google?");
    await expect(panel.getByTestId("hub-msg-user")).toHaveCount(0);
  });

  for (const width of [360, 390]) {
    test(`${width}px: one column and no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await useScenario(page, "full");
      await openDashboard(page);
      await expect(tile(page, "reviews")).toBeVisible();
      const overflow = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        return {
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          main: main.scrollWidth - main.clientWidth,
        };
      });
      expect(overflow.doc).toBeLessThanOrEqual(0);
      expect(overflow.main).toBeLessThanOrEqual(0);
      const a = await tile(page, "gbp").boundingBox();
      const b = await tile(page, "reviews").boundingBox();
      expect(a && b && Math.abs(a.x - b.x)).toBeLessThan(1);
      expect(b!.y).toBeGreaterThan(a!.y);
      if (width === 390) await shot(page, "dashboard-390-light");
    });
  }

  test("dark mode renders readable text", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch { /* blocked */ } });
    await useScenario(page, "full");
    await openDashboard(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
    // Light text on a dark card: the greeting and a tile title are far from the background.
    const lum = await page.evaluate(() => {
      const L = (el: Element, prop: "color" | "backgroundColor") => {
        const m = getComputedStyle(el)[prop].match(/\d+(\.\d+)?/g)!.map(Number);
        const [r, g, b] = m.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const card = document.querySelector('[data-testid="tile-reviews"]')!;
      const title = card.querySelector("h3")!;
      const greeting = document.querySelector('[data-testid="text-dashboard-greeting"]')!;
      return { card: L(card, "backgroundColor"), title: L(title, "color"), greeting: L(greeting, "color") };
    });
    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(contrast(lum.title, lum.card)).toBeGreaterThan(7);
    expect(lum.greeting).toBeGreaterThan(0.5);
    await shot(page, "dashboard-1440-dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "dashboard-390-dark");
  });
});
