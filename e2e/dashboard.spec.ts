/**
 * The signed-in home dashboard (docs/dashboard/SPEC.md §4.5). Run against a
 * growth-app lane (VITE_FORCE_PORTAL=false, DEV_AUTH_BYPASS_USER1=true):
 *   E2E_PORT=<port> E2E_DB=constructhub_dev_a6 E2E_WORKERS=1 npx playwright test e2e/dashboard.spec.ts
 *
 * The first block runs against the REAL aggregator (no ?fixture=): it reads
 * GET /api/dashboard for the bypass user and checks the page prints exactly
 * that payload. The rest pin layout and edge states with the dev-only sample
 * scenarios (?fixture=full|new|noplan, added with page.route; ignored in
 * production), because a real account can't be every state at once.
 * Screenshots (1440 / 390, light / dark) land in DASHBOARD_SHOTS_DIR when set.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { E2E_BASE_URL } from "./helpers";
import { DASHBOARD_GROUPS, DASHBOARD_TILES, dashboardAttention, type DashboardPayload } from "../shared/dashboard";

/** Shown inside the CRM card (money, then leads / follow-ups / visits), never as grid tiles. */
const CRM_CARD = new Set(["crm", "crmLeads", "crmSchedule"]);

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

/** The real payload for the signed-in (bypass) user — same 60 s server cache the page reads. */
async function realPayload(page: Page): Promise<DashboardPayload> {
  const res = await page.request.get("/api/dashboard");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as DashboardPayload;
  expect(body.fixture).toBe(false);
  return body;
}

const nf = new Intl.NumberFormat("en-US");

test.describe("signed-in dashboard: real aggregate", () => {
  test("prints the account's own payload: statuses, metrics, usage, checklist, recent", async ({ page }) => {
    const body = await realPayload(page);
    await openDashboard(page);
    await expect(page.getByTestId("badge-dashboard-fixture")).toHaveCount(0);
    await expect(page.getByText("Stop Guessing")).toHaveCount(0);
    await expect(page.getByTestId("badge-dashboard-plan")).toHaveAttribute("data-plan-status", body.account.status);
    if (body.account.planName && body.account.status !== "none") {
      await expect(page.getByTestId("badge-dashboard-plan")).toContainText(body.account.planName);
    }

    // Needs you today: exactly the warn/bad items the payload carries, at the top of the page.
    const attention = dashboardAttention(body.tiles, body.account);
    const needs = page.getByTestId("card-dashboard-needs");
    await expect(needs).toHaveAttribute("data-count", String(attention.length));
    for (const item of attention) await expect(needs.getByTestId(`needs-${item.key}`)).toBeVisible();
    const needsBox = (await needs.boundingBox())!;
    const gridBox = (await page.getByTestId("section-dashboard-grow").boundingBox())!;
    expect(needsBox.y).toBeLessThan(gridBox.y);

    // Every tile the server sent (bar the CRM card's) is on the page with the server's status.
    for (const t of body.tiles.filter((x) => !CRM_CARD.has(x.key))) {
      await expect(tile(page, t.key)).toHaveAttribute("data-status", t.status);
      if (t.status === "locked") await expect(tile(page, t.key).locator('[data-testid^="metric-"]')).toHaveCount(0);
      // Grid tiles show the hero number + two rows.
      if (t.status === "ok") {
        for (const m of t.metrics.slice(0, 3)) await expect(page.getByTestId(`metric-${t.key}-${m.key}`)).toBeVisible();
        const hero = t.metrics[0];
        if (hero && hero.format === "count" && typeof hero.value === "number") {
          await expect(page.getByTestId(`metric-${t.key}-${hero.key}`)).toContainText(nf.format(hero.value));
        }
      }
    }

    // CRM snapshot card: the org's own numbers (cents rounded to whole dollars).
    const crm = body.tiles.find((t) => t.key === "crm");
    if (crm) {
      const card = page.getByTestId("card-dashboard-crm");
      await expect(card).toHaveAttribute("data-status", crm.status);
      for (const m of crm.metrics.slice(0, 6)) {
        const el = card.getByTestId(`metric-crm-${m.key}`);
        await expect(el).toBeVisible();
        if (typeof m.value === "number" && m.format === "cents") await expect(el).toContainText(`$${nf.format(Math.round(m.value / 100))}`);
        if (typeof m.value === "number" && m.format === "count") await expect(el).toContainText(nf.format(m.value));
      }
      // Leads, follow-ups and visits sit in the same card, not four groups down.
      const leads = body.tiles.find((t) => t.key === "crmLeads");
      if (crm.status === "ok" && leads?.status === "ok") {
        for (const key of ["followUpsDue", "newLeads7d", "needEstimate"]) {
          const m = leads.metrics.find((x) => x.key === key)!;
          await expect(card.getByTestId(`metric-crmLeads-${key}`)).toContainText(nf.format(m.value as number));
        }
      }
    }

    // Usage meters: used / limit as the server counted them; portal meters go to the CRM host.
    for (const u of body.account.usage) {
      const meter = page.getByTestId(`usage-${u.key}`);
      await expect(meter).toContainText(u.limit < 0 ? `${nf.format(u.used)} · Unlimited` : `${nf.format(u.used)} / ${nf.format(u.limit)}`);
      if (u.period === "count" && u.limit > 0 && u.used > u.limit) await expect(meter).toContainText("Over your plan's limit");
      if (u.surface === "portal") await expect(page.getByTestId(`link-usage-${u.key}`)).toHaveAttribute("href", /^https?:\/\/portal\./);
    }

    // Checklist: hidden only when every step is done; otherwise the done count matches.
    const steps = body.checklist;
    const card = page.getByTestId("card-dashboard-checklist");
    if (steps.every((c) => c.done)) {
      await expect(card).toHaveCount(0);
    } else {
      await expect(card).toBeVisible();
      for (const c of steps) {
        const row = card.getByTestId(`checklist-${c.key}`);
        if (await row.count()) await expect(row).toHaveAttribute("data-done", String(c.done));
      }
    }

    // Recent activity: the newest real items, in the server's order.
    if (body.recent.length) {
      await expect(page.getByTestId(`recent-${body.recent[0].id}`)).toBeVisible();
    } else {
      await expect(page.getByTestId("text-dashboard-recent-empty")).toBeVisible();
    }
  });

  test("Refresh asks the server for ?fresh=1 and the page keeps real data", async ({ page }) => {
    await openDashboard(page);
    const fresh = page.waitForResponse((r) => r.url().includes("/api/dashboard") && r.url().includes("fresh=1"));
    await page.getByTestId("button-dashboard-refresh").click();
    const res = await fresh;
    expect(res.status()).toBe(200);
    expect(((await res.json()) as DashboardPayload).fixture).toBe(false);
    await expect(page.getByTestId("button-dashboard-refresh")).toBeEnabled();
    await expect(page.getByTestId("badge-dashboard-fixture")).toHaveCount(0);
    // New data is "just now", never a time in the future.
    await expect(page.getByTestId("text-dashboard-meta")).toContainText("Updated just now");
    await expect(page.getByTestId("text-dashboard-meta")).not.toContainText("in a moment");
  });

  test("no horizontal scroll at 390px with real data", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main.scrollWidth - main.clientWidth);
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, "real-390-light");
  });

  test("real data at 1440 light and dark (screenshots)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);
    await expect(page.getByTestId("card-dashboard-crm")).toBeVisible();
    await shot(page, "real-1440-light");
    await page.evaluate(() => { try { localStorage.setItem("theme", "dark"); } catch { /* blocked */ } });
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("text-dashboard-greeting")).toBeVisible();
    await shot(page, "real-1440-dark");
  });
});

test.describe("signed-in dashboard: sample scenarios", () => {
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
    // Every catalogue tile but the CRM card's three is in the grid, each with a status.
    for (const def of DASHBOARD_TILES.filter((d) => !CRM_CARD.has(d.key))) {
      await expect(tile(page, def.key)).toHaveAttribute("data-status", /^(ok|empty|error|locked|coming_soon)$/);
    }
    await expect(page.locator('[data-testid^="tile-"][data-status]')).toHaveCount(DASHBOARD_TILES.length - CRM_CARD.size);

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
    await expect(crm.getByTestId("link-tile-crmSchedule")).toHaveAttribute("href", /^https?:\/\/portal\.[^/]+\/crm\/schedule$/);
    await expect(crm.getByTestId("metric-crmLeads-followUpsDue")).toContainText("3");
    await expect(crm.getByTestId("link-crm-work-crmLeads-needEstimate")).toHaveAttribute("href", /^https?:\/\/portal\.[^/]+\/crm\/pipeline$/);

    // Needs you today, above everything else: the sample's warn numbers, each a link.
    const needs = page.getByTestId("card-dashboard-needs");
    await expect(needs.getByTestId("needs-crm.unscheduled")).toContainText("Sold, not scheduled");
    await expect(needs.getByTestId("needs-clickGuard.suspicious30d")).toContainText("17");
    await expect(needs.getByTestId("link-needs-reviews.unanswered")).toHaveAttribute("href", "/google-reviews");
    expect((await needs.boundingBox())!.y).toBeLessThan((await crm.boundingBox())!.y);

    await expect(page.getByTestId("usage-searches")).toBeVisible();
    await expect(page.getByTestId("link-usage-searches")).toHaveAttribute("href", "/search");
    await expect(page.getByTestId("link-usage-crmSeats")).toHaveAttribute("href", /^https?:\/\/portal\./);
    await expect(page.getByTestId("list-dashboard-recent").locator("li")).not.toHaveCount(0);

    // Headings run h1 → h2 → h3.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(tile(page, "reviews").getByRole("heading", { level: 3 })).toHaveText("Google Reviews");
    await shot(page, "dashboard-1440-light");
  });

  test("locked tiles fold into one row per group with a single link to the plans", async ({ page }) => {
    await useScenario(page, "full");
    await openDashboard(page);
    const row = page.getByTestId("locked-row-protect");
    const cf = row.getByTestId("tile-cloudflare");
    await expect(cf).toHaveAttribute("data-status", "locked");
    await expect(cf.getByTestId("status-cloudflare")).toContainText("Agency");
    await expect(cf).toHaveAttribute("title", /Cloudflare \+ Search Console is included with the Agency plan/);
    // No numbers, and no per-tile prompt box: one "See plans" per group; each chip opens its feature page.
    await expect(row.locator('[data-testid^="metric-"]')).toHaveCount(0);
    await expect(row.locator('[data-testid^="locked-cloudflare"]')).toHaveCount(0);
    await expect(row.getByTestId("link-locked-protect-plans")).toHaveCount(1);
    await expect(cf.getByTestId("link-tile-cloudflare-intro")).toHaveAttribute("href", "/features/cloudflare");
    await expect(row.getByRole("link")).toHaveCount((await row.locator('[data-status="locked"]').count()) + 1);
    await row.getByTestId("link-locked-protect-plans").click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("Refresh fetches a fresh answer and shows it", async ({ page }) => {
    await useScenario(page, "full");
    await page.route(/\/api\/dashboard\?.*fresh=1/, async (route) => {
      // route.fetch() skips the scenario handler: ask for the same sample, never the real account's shape.
      const url = new URL(route.request().url());
      url.searchParams.set("fixture", "full");
      const res = await route.fetch({ url: url.toString() });
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
    await expect(card.getByTestId("link-checklist-turnOnGuard")).toHaveAttribute("href", "/locations");
    // One "start here": the first open step, and only it.
    await expect(card.locator('[data-next="true"]')).toHaveCount(1);
    await expect(card.getByTestId("checklist-connectGoogle")).toHaveAttribute("data-next", "true");
    await expect(card.getByTestId("checklist-connectGoogle").getByTestId("badge-checklist-next")).toHaveText("Next step");
    // A brand-new account: nothing on its tiles needs it yet, only the unread welcome alert.
    await expect(page.getByTestId("card-dashboard-needs")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("needs-notifications")).toBeVisible();
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
