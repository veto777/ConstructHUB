import { expect, test, type Page } from "@playwright/test";
import { watchPage } from "./helpers";

/**
 * Site analytics without a cookie banner (owner, 2026-10-12: the pop-up kept coming back — removed; the privacy
 * policy §1.3 covers it). A first visit sets ch_consent=granted + ch_vid once, silently; pageviews flow; nothing
 * pops up; a visitor who declined under the old banner stays declined.
 */
async function gotoRaw(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test.describe("site analytics cookie", () => {
  test("first visit: no banner, granted once, beacons flow, tokens normalized", async ({ page }) => {
    const guards = watchPage(page);
    let beacons = 0;
    page.on("request", (r) => { if (r.url().includes("/api/analytics/events")) beacons++; });

    await gotoRaw(page, "/crm-privacy");
    await expect(page.getByTestId("cookie-consent-banner")).toHaveCount(0);
    await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === "ch_consent")?.value).toBe("granted");
    expect((await page.context().cookies()).find((c) => c.name === "ch_vid")?.value).toBeTruthy();

    await gotoRaw(page, "/crm-terms");
    await expect(page.getByTestId("cookie-consent-banner")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(beacons).toBeGreaterThan(0);

    const r = await page.request.post("/api/analytics/events", { data: { events: [{ type: "pageview", path: "/probe" }] } });
    expect((await r.json()).recorded).toBe(1);

    await gotoRaw(page, "/e/some-token-value-123");
    await page.waitForTimeout(500);
    const { q } = await import("./db");
    const rows = await q<{ path: string }>(`select path from ch_analytics_events where path like '/e/%' order by created_at desc limit 5`);
    expect(rows.map((r2) => r2.path)).toContain("/e/:token");
    expect(rows.some((r2) => r2.path.includes("some-token-value-123"))).toBe(false);
    guards.assertClean("analytics first visit");
  });

  test("an earlier decline is kept: no beacons, server records nothing", async ({ page }) => {
    const guards = watchPage(page);
    let beacons = 0;
    page.on("request", (r) => { if (r.url().includes("/api/analytics/events")) beacons++; });
    await page.addInitScript(() => { if (!/ch_consent=/.test(document.cookie)) document.cookie = "ch_consent=denied; path=/"; });
    await gotoRaw(page, "/crm-privacy");
    await gotoRaw(page, "/crm-terms");
    await page.waitForTimeout(500);
    expect(beacons).toBe(0);
    expect((await page.context().cookies()).find((c) => c.name === "ch_consent")?.value).toBe("denied");
    const r = await page.request.post("/api/analytics/events", { data: { events: [{ type: "pageview", path: "/probe" }] } });
    expect((await r.json()).recorded).toBe(0);
    guards.assertClean("analytics declined");
  });
});
