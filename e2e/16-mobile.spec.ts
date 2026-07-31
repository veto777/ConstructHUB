import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

/**
 * Mobile pass: an iPhone-ish viewport, the bottom ribbon, and the two pages it
 * introduced (Schedule, Inbox). Desktop has its own coverage in specs 01–15.
 */
test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("mobile ribbon", () => {
  test("curated: five tabs navigate, More sheet opens and closes", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm");

    // The ribbon renders below md with all five tabs.
    const ribbon = page.getByTestId("crm-ribbon");
    await expect(ribbon).toBeVisible();
    for (const tab of ["dashboard", "schedule", "inbox", "customers", "more"]) {
      await expect(page.getByTestId(`ribbon-tab-${tab}`)).toBeVisible();
    }

    await page.getByTestId("ribbon-tab-schedule").click();
    await expect(page).toHaveURL(/\/crm\/schedule/);
    await expect(page.locator("h1")).toContainText("Schedule");

    await page.getByTestId("ribbon-tab-inbox").click();
    await expect(page).toHaveURL(/\/crm\/inbox/);
    await expect(page.locator("h1")).toContainText("Inbox");

    await page.getByTestId("ribbon-tab-customers").click();
    await expect(page).toHaveURL(/\/crm\/clients/);
    await expect(page.locator("h1")).toContainText("Clients");

    await page.getByTestId("ribbon-tab-dashboard").click();
    await expect(page).toHaveURL(/\/$/);

    // More opens the bottom sheet; a destination both navigates and closes it.
    await page.getByTestId("ribbon-tab-more").click();
    const sheet = page.getByTestId("ribbon-more-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("ribbon-more-pipeline")).toBeVisible();
    await expect(page.getByTestId("ribbon-more-pricebook")).toBeVisible();
    await expect(page.getByTestId("ribbon-more-payments")).toBeVisible();
    await expect(page.getByTestId("ribbon-more-team")).toBeVisible();
    await expect(page.getByTestId("ribbon-more-settings")).toBeVisible();
    await expect(page.getByTestId("button-ribbon-theme-toggle")).toBeVisible();

    await page.getByTestId("ribbon-more-pipeline").click();
    await expect(page).toHaveURL(/\/crm\/pipeline/);
    await expect(page.locator("h1")).toContainText("Pipeline");
    await expect(sheet).toBeHidden();

    // Escape closes the sheet without navigating. Let the open animation (and
    // Radix's dismiss listeners) settle first — an Escape in the mount tick is
    // genuinely missed by the browser too.
    await page.getByTestId("ribbon-tab-more").click();
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/crm\/pipeline/);

    guards.assertClean("ribbon curated");
  });

  test("theme toggle in the More sheet flips the theme", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm");
    const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.getByTestId("ribbon-tab-more").click();
    await page.getByTestId("button-ribbon-theme-toggle").click();
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    ).toBe(!wasDark);
    // Restore so later tests see the default theme.
    await page.getByTestId("button-ribbon-theme-toggle").click();
    await page.keyboard.press("Escape");
    guards.assertClean("ribbon theme toggle");
  });
});

test.describe("mobile schedule", () => {
  test("curated: day-grouped rows from a real appointment", async ({ page }) => {
    const guards = watchPage(page);

    // Book a visit tomorrow through the real API so the page has a real row.
    const startsAt = new Date(Date.now() + 26 * 3600_000).toISOString();
    const endsAt = new Date(Date.now() + 28 * 3600_000).toISOString();
    const r = await page.request.post("/api/crm/appointments", {
      data: { title: "E2E mobile visit", startsAt, endsAt, allDay: false, dispatchedMemberIds: [] },
    });
    if (!r.ok()) throw new Error(`create appointment: ${r.status()} ${await r.text()}`);

    await gotoCrm(page, "/crm/schedule");
    await expect(page.locator("h1")).toContainText("Schedule");
    await expect(page.getByTestId("schedule-list")).toBeVisible();
    await expect(page.locator('[data-testid^="schedule-day-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="appt-"]').first()).toBeVisible();
    // Repeated runs of this test leave their visits in the demo org — first() wins.
    await expect(page.getByText("E2E mobile visit").first()).toBeVisible();

    // The range switcher re-queries.
    await page.getByTestId("button-days-7").click();
    await expect(page.getByTestId("schedule-list")).toBeVisible();

    guards.assertClean("schedule curated");
  });

  test("sweep: every control", async ({ page }) => {
    const { clicked, labels } = await sweepPage(page, "/crm/schedule", {
      ready: "h1",
    });
    console.log(`schedule sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(3); // 7d / 14d / 30d
  });
});

test.describe("mobile inbox", () => {
  test("curated: the feed renders real estimate activity", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/inbox");
    await expect(page.locator("h1")).toContainText("Inbox");

    const feed = page.getByTestId("activity-feed");
    await expect(feed).toBeVisible();
    const rows = page.locator('[data-testid^="activity-est-"]');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    // Rows read like "X viewed estimate E-2001" with a relative timestamp.
    await expect(rows.first()).toContainText(/estimate/);
    await expect(rows.first()).toContainText(/ago|just now|\d{1,2}\/\d{1,2}\/\d{4}/);

    guards.assertClean("inbox curated");
  });

  test("sweep: ribbon from the inbox page", async ({ page }) => {
    // The page itself has no controls; this sweep exercises the five ribbon
    // tabs (skip everything else — the rest of home is covered by spec 01).
    const { clicked, labels } = await sweepPage(page, "/crm/inbox", {
      ready: "h1",
      skip: ({ testid }) => !testid.startsWith("ribbon-tab-"),
    });
    console.log(`inbox/ribbon sweep clicked ${clicked}: ${labels.join(" | ")}`);
    expect(clicked).toBeGreaterThanOrEqual(5);
  });
});
