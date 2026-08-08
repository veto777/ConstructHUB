import { expect, test } from "@playwright/test";
import { gotoCrm, watchPage } from "./helpers";

/**
 * Cookie consent banner — accept/decline persistence, no re-show, pageview
 * beacons only after accept. The banner shipped untested and its full-width
 * wrapper blanketed clicks across the app; these tests pin both the consent
 * contract and the banner's non-blocking behaviour.
 */

test.describe("cookie consent", () => {
  test("decline: persists, never re-shows, no beacons, server records nothing", async ({ page }) => {
    const guards = watchPage(page);
    let beacons = 0;
    page.on("request", (r) => { if (r.url().includes("/api/analytics/events")) beacons++; });

    await gotoCrm(page, "/crm-privacy");
    await expect(page.getByTestId("cookie-consent-banner")).toBeVisible();

    await page.getByTestId("button-cookies-decline").click();
    await expect(page.getByTestId("cookie-consent-banner")).toBeHidden();

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ch_consent")?.value).toBe("denied");
    expect(cookies.find((c) => c.name === "ch_vid")).toBeUndefined();

    // No re-show after a hard reload, and no beacons on navigation.
    await gotoCrm(page, "/crm-terms");
    await expect(page.getByTestId("cookie-consent-banner")).toBeHidden();
    await page.waitForTimeout(500);
    expect(beacons).toBe(0);

    // Server side: a hand-crafted POST from the declined browser records 0.
    const r = await page.request.post("/api/analytics/events", {
      data: { events: [{ type: "pageview", path: "/probe" }] },
    });
    expect((await r.json()).recorded).toBe(0);

    guards.assertClean("consent decline");
  });

  test("accept: persists, never re-shows, beacons flow and the server records them", async ({ page }) => {
    const guards = watchPage(page);
    let beacons = 0;
    page.on("request", (r) => { if (r.url().includes("/api/analytics/events")) beacons++; });

    await gotoCrm(page, "/crm-privacy");
    await expect(page.getByTestId("cookie-consent-banner")).toBeVisible();
    // No beacon before the answer.
    expect(beacons).toBe(0);

    await page.getByTestId("button-cookies-accept").click();
    await expect(page.getByTestId("cookie-consent-banner")).toBeHidden();

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ch_consent")?.value).toBe("granted");
    expect(cookies.find((c) => c.name === "ch_vid")?.value).toBeTruthy();

    // The accept itself triggers the first pageview; navigation triggers more.
    await gotoCrm(page, "/crm-terms");
    await expect(page.getByTestId("cookie-consent-banner")).toBeHidden();
    await page.waitForTimeout(500);
    expect(beacons).toBeGreaterThan(0);

    const r = await page.request.post("/api/analytics/events", {
      data: { events: [{ type: "pageview", path: "/probe" }] },
    });
    expect((await r.json()).recorded).toBe(1);

    // Bearer-token paths are normalized before they reach the analytics table.
    await gotoCrm(page, "/e/some-token-value-123");
    await page.waitForTimeout(500);
    const { q } = await import("./db");
    const rows = await q<{ path: string }>(
      `select path from ch_analytics_events where path like '/e/%' order by created_at desc limit 5`,
    );
    expect(rows.map((r2) => r2.path)).toContain("/e/:token");
    expect(rows.some((r2) => r2.path.includes("some-token-value-123"))).toBe(false);

    guards.assertClean("consent accept");
  });

  test("the banner never blocks page controls behind its wrapper", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm");
    await expect(page.getByTestId("cookie-consent-banner")).toBeVisible();
    // This click shipped broken — the banner's full-width wrapper intercepted
    // it even where the card wasn't painted.
    await page.getByTestId("card-clients").click();
    await expect(page).toHaveURL(/\/crm\/clients/);
    await expect(page.locator("h1")).toContainText("Clients");
    guards.assertClean("banner does not block");
  });
});
