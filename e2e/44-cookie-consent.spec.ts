import { expect, test, type Page } from "@playwright/test";
import { watchPage } from "./helpers";

/**
 * Site analytics without a cookie banner (owner, 2026-10-12: the pop-up kept coming back — removed; the privacy
 * policy §1.3 covers it). On the main site a first visit sets ch_consent=granted + ch_vid once, silently, and
 * pageviews flow; a visitor who declined under the old banner stays declined. The CRM, the client portal and customer
 * links (estimates, invoices, reviews, forms, contracts) record nothing (components/cookie-consent.tsx; the CRM
 * privacy notice §7 says so). ?portal=0 / ?portal=1 pick the face on any e2e lane (lib/site.ts forcedPortal).
 */
async function gotoRaw(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}
const beaconsOn = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/analytics/events")) seen.push(r.postData() ?? ""); });
  return seen;
};

test.describe("site analytics cookie", () => {
  test("main site, first visit: no banner, granted once, beacons flow and the server records them", async ({ page }) => {
    const guards = watchPage(page);
    const beacons = beaconsOn(page);
    await gotoRaw(page, "/crm-privacy?portal=0");
    await expect(page.getByTestId("cookie-consent-banner")).toHaveCount(0);
    await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === "ch_consent")?.value).toBe("granted");
    expect((await page.context().cookies()).find((c) => c.name === "ch_vid")?.value).toBeTruthy();

    await gotoRaw(page, "/crm-terms?portal=0");
    await expect(page.getByTestId("cookie-consent-banner")).toHaveCount(0);
    await expect.poll(() => beacons.length).toBeGreaterThan(0);

    const r = await page.request.post("/api/analytics/events", { data: { events: [{ type: "pageview", path: "/probe" }] } });
    expect((await r.json()).recorded).toBe(1);
    guards.assertClean("analytics first visit");
  });

  test("customer links record nothing, even for a visitor who already has the cookie", async ({ page }) => {
    await gotoRaw(page, "/crm-privacy?portal=0");
    await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === "ch_consent")?.value).toBe("granted");
    const beacons = beaconsOn(page);
    await gotoRaw(page, "/e/some-token-value-123?portal=0");
    await page.waitForTimeout(500);
    expect(beacons.filter((b) => b.includes("/e/"))).toEqual([]);
    const { q } = await import("./db");
    const rows = await q<{ path: string }>(`select path from ch_analytics_events where path like '%some-token-value-123%'`);
    expect(rows).toEqual([]);
  });

  test("the CRM sets no analytics cookie and sends no beacon", async ({ page }) => {
    const beacons = beaconsOn(page);
    await gotoRaw(page, "/crm-privacy?portal=1");
    await page.waitForTimeout(500);
    expect((await page.context().cookies()).find((c) => c.name === "ch_consent")).toBeUndefined();
    expect(beacons).toEqual([]);
    await expect(page.getByTestId("cookie-consent-banner")).toHaveCount(0);
  });

  test("an earlier decline is kept: no beacons, server records nothing", async ({ page }) => {
    const guards = watchPage(page);
    const beacons = beaconsOn(page);
    await page.addInitScript(() => { if (!/ch_consent=/.test(document.cookie)) document.cookie = "ch_consent=denied; path=/"; });
    await gotoRaw(page, "/crm-privacy?portal=0");
    await gotoRaw(page, "/crm-terms?portal=0");
    await page.waitForTimeout(500);
    expect(beacons).toEqual([]);
    expect((await page.context().cookies()).find((c) => c.name === "ch_consent")?.value).toBe("denied");
    const r = await page.request.post("/api/analytics/events", { data: { events: [{ type: "pageview", path: "/probe" }] } });
    expect((await r.json()).recorded).toBe(0);
    guards.assertClean("analytics declined");
  });
});
