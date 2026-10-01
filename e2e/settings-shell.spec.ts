/**
 * Account settings shell: the grouped nav (Me / Workspace), old ?tab= names,
 * Limits & usage, Audit log and Integrations, at desktop and phone widths.
 * Run against a growth-app lane (VITE_FORCE_PORTAL=false, DEV_AUTH_BYPASS_USER1=true):
 *   E2E_PORT=<port> E2E_DB=constructhub_dev_a6 npx playwright test e2e/settings-shell.spec.ts
 * Billing, entitlements and the account endpoints are mocked with page.route —
 * nothing reaches Stripe or the database — and every expected number comes
 * from shared/plans.ts. Screenshots land in SETTINGS_SHOTS_DIR when set.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { ADDONS, PLANS } from "../shared/plans";
import { gotoCrm } from "./helpers";

const SHOTS = process.env.SETTINGS_SHOTS_DIR ?? "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
/** A screenshot after the colour transitions (150ms) have settled; the nav otherwise paints a frame behind the DOM. */
const shot = async (page: Page, name: string, fullPage = true) => {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};

/** Something each section shows once its data is in, so a screenshot isn't of a spinner. */
const SECTION_ANCHOR: Record<string, string> = {
  account: "card-profile", security: "card-two-factor", notifications: "section-notifications", billing: "card-current-plan",
  limits: "text-limits-plan", "api-keys": "card-api-plan", "api-usage": "card-api-usage-totals", "audit-log": "text-audit-count",
  integrations: "text-integration-service-gbp",
};

const PRO_STRIPE = {
  plan: "pro", status: "active", stripeSubscriptionId: "sub_P_test", currentPeriodEnd: "2026-11-01T12:00:00Z",
  billingInterval: "month", addons: { protected_site: 1 }, agencyLocations: null,
};
const PRO_ENTITLEMENTS = {
  plan: "pro", storedPlan: "pro", accessPlan: "pro", planName: "Pro", isPlatformAdmin: false, grantEndsAt: null,
  limits: PLANS.pro.limits, allowances: PLANS.pro.limits, modules: PLANS.pro.modules, addons: { protected_site: 1 },
  locations: { used: 1, limit: PLANS.pro.limits.locations },
  usage: {
    searches: { used: 120, limit: PLANS.pro.limits.permitSearches },
    rankings: { used: PLANS.pro.limits.gridCredits, limit: PLANS.pro.limits.gridCredits },
    siteScans: { used: 2, limit: PLANS.pro.limits.siteScans },
    competitorScans: { used: 0, limit: PLANS.pro.limits.competitorScans },
  },
  resetsAt: "2026-11-01T00:00:00Z",
};
const PRO_WITH_API = { ...PRO_ENTITLEMENTS, allowances: { ...PLANS.pro.limits, apiUnitsPerMonth: 10000, apiRatePerMinute: 60 } };

const ACTIVITY = [
  { id: 1, kind: "auth.login_success", detail: { method: "password" }, ip: "203.0.113.5", user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/128.0", created_at: "2026-09-29T14:14:00Z" },
  { id: 2, kind: "security.device_revoked", detail: null, ip: "203.0.113.5", user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1", created_at: "2026-09-28T09:00:00Z" },
  // A failed attempt carries whatever the other side sent: a user agent that is a spreadsheet formula must export as text.
  { id: 5, kind: "auth.login_failure", detail: { email: "=HYPERLINK(\"https://example.invalid\",\"open\")" }, ip: "198.51.100.77", user_agent: "=cmd|' /C calc'!A0", created_at: "2026-09-27T09:00:00Z" },
  { id: 3, kind: "google.connected", detail: { email: "fixture@example.invalid" }, ip: null, user_agent: null, created_at: "2026-09-20T09:00:00Z" },
  { id: 4, kind: "sitescan.started", detail: null, ip: "198.51.100.9", user_agent: "curl/8.0", created_at: "2026-09-10T09:00:00Z" },
];

const INTEGRATIONS = [
  { id: "gbp", service: "Google Business Profile", status: "connected", detail: "owner@example.invalid · 2 locations", manageHref: "/locations" },
  { id: "cloudflare", service: "Cloudflare", status: "reconnect", detail: "Token rejected on the last check", manageHref: "/cloudflare" },
  { id: "stripe", service: "Stripe payments", status: "not_connected", detail: null, manageHref: "/crm/payments" },
];

/** Mock every endpoint the settings pages read and record what they send. */
async function mockAccount(page: Page, entitlements: Record<string, unknown> = PRO_ENTITLEMENTS) {
  const calls = { addons: [] as any[] };
  await page.route("**/api/stripe/subscription", (r) => r.fulfill({ json: PRO_STRIPE }));
  await page.route("**/api/stripe/addons", async (r) => { calls.addons.push(r.request().postDataJSON()); await r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/entitlements", (r) => r.fulfill({ json: entitlements }));
  await page.route("**/api/crm/me", (r) => r.fulfill({ json: { seats: { used: 2, limit: PLANS.pro.limits.crmSeats } } }));
  await page.route("**/api/click-guard/domains", (r) => r.fulfill({ json: [{ id: 1, domain: "example.invalid" }] }));
  await page.route("**/api/review-templates", (r) => r.fulfill({ json: [{ id: 1, name: "Main office", googleProfileUrl: "https://g.page/r/abc/review", isDefault: true }] }));
  await page.route("**/api/account-activity", (r) => r.fulfill({ json: { activity: ACTIVITY } }));
  await page.route("**/api/account/integrations", (r) => r.fulfill({ json: { items: INTEGRATIONS } }));
  await page.route("**/api/account/api-keys", (r) => r.fulfill({ json: { keys: [], plan: { apiEnabled: true, unitsPerMonth: 10000, usedThisMonth: 120, ratePerMinute: 60 } } }));
  await page.route("**/api/account/api-usage**", (r) => r.fulfill({ json: { days: [], totals: { units: 0, requests: 0 } } }));
  return calls;
}

/** Nothing wider than the screen outside a deliberate horizontal scroller. */
async function expectNoSideScroll(page: Page, anchorTestId: string) {
  const offenders = await page.evaluate((id) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push("document");
    let el = document.querySelector(`[data-testid="${id}"]`)?.parentElement ?? null;
    while (el) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "hidden") out.push(`${el.tagName}.${el.className}`.slice(0, 80));
      el = el.parentElement;
    }
    return out;
  }, anchorTestId);
  expect(offenders).toEqual([]);
}

const ME = [["account", "My account"], ["security", "Password & security"], ["notifications", "Notifications"]] as const;
const WORKSPACE = [
  ["billing", "Billing"], ["limits", "Limits & usage"], ["api-keys", "API keys"], ["api-usage", "API usage"],
  ["audit-log", "Audit log"], ["integrations", "Integrations"],
] as const;

const sectionTitle = (page: Page) => page.getByTestId("text-settings-section-title");

test.describe("settings shell — desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("two nav groups in order, My account by default, and every section opens from ?tab=", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await mockAccount(page);
    await gotoCrm(page, "/settings");
    await expect(page.getByTestId("text-settings-title")).toHaveText("Account settings");
    await expect(sectionTitle(page)).toContainText("My account");
    await expect(page.getByTestId("card-profile")).toBeVisible();

    const me = page.getByTestId("nav-settings-group-me");
    await expect(me).toContainText("Me");
    await expect(me.getByRole("button")).toHaveText(ME.map(([, label]) => label));
    const workspace = page.getByTestId("nav-settings-group-workspace");
    await expect(workspace).toContainText("Workspace");
    await expect(workspace.getByRole("button")).toHaveText(WORKSPACE.map(([, label]) => label));
    await expect(page.getByTestId("button-settings-tab-account")).toHaveAttribute("aria-current", "page");
    await shot(page, "1280-account");

    for (const [id, label] of [...ME, ...WORKSPACE]) {
      await page.getByTestId(`button-settings-tab-${id}`).click();
      await expect(sectionTitle(page)).toContainText(label);
      await expect(page.getByTestId(`button-settings-tab-${id}`)).toHaveAttribute("aria-current", "page");
      if (id === "account") await expect(page).toHaveURL(/\/settings$/);
      else await expect(page).toHaveURL(new RegExp(`[?&]tab=${id}(&|$)`));
      await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
      await expect(page.getByTestId(SECTION_ANCHOR[id])).toBeVisible();
      await shot(page, `1280-${id}`);
    }

    // The ⓘ next to the title opens the plain-English entry for the open section.
    await page.getByTestId("info-tip-account-integrations").click();
    await expect(page.getByTestId("info-dialog-account-integrations")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("info-dialog-account-integrations")).toBeHidden();
    expect(pageErrors).toEqual([]);
  });

  test("old ?tab= names and inner-view aliases land on the new sections", async ({ page }) => {
    await mockAccount(page);
    const cases: [string, string][] = [
      ["profile", "My account"], ["account", "My account"], ["security", "Password & security"],
      ["notifications", "Notifications"], ["billing", "Billing"], ["invoices", "Billing"], ["payment-methods", "Billing"],
      ["usage", "Limits & usage"], ["api", "API keys"], ["activity", "Audit log"], ["nonsense", "My account"],
    ];
    for (const [tab, label] of cases) {
      await gotoCrm(page, `/settings?tab=${tab}`);
      await expect(sectionTitle(page), `?tab=${tab}`).toContainText(label);
    }
    // Security keeps 2FA, remembered devices and recent activity on one page (links in alerts point here).
    await gotoCrm(page, "/settings?tab=security");
    await expect(page.getByTestId("card-two-factor")).toBeVisible();
    await expect(page.getByLabel("Activity type")).toBeVisible();
    // Billing keeps the plan card, this month's usage and the add-on controls the pricing suite drives.
    await gotoCrm(page, "/settings?tab=billing&view=invoices");
    await expect(sectionTitle(page)).toContainText("Billing");
    await expect(page.getByTestId("card-current-plan")).toContainText("Pro plan");
    await expect(page.getByTestId("card-usage")).toBeVisible();
    await expect(page.getByTestId("button-addon-inc-protected_site")).toBeVisible();
    await expect(page).toHaveURL(/tab=billing&view=invoices/);
  });

  test("Limits & usage: every plan limit with included and used from the server's counts; add-on +/- send the new total", async ({ page }) => {
    const calls = await mockAccount(page);
    await gotoCrm(page, "/settings?tab=limits");
    await expect(page.getByTestId("text-limits-plan")).toContainText("Pro plan limits");
    await expect(page.getByTestId("text-limits-resets")).toContainText("November 1");

    const L = PLANS.pro.limits;
    const n = (v: number) => v.toLocaleString("en-US");
    for (const key of ["locations", "guardCadenceMinutes", "gridCredits", "reviewTemplates", "autoPublishAiReplies", "protectedSites", "siteScans", "competitorScans", "permitSearches", "crmSeats", "teamTextSegments", "clientTexting"]) {
      await expect(page.getByTestId(`limit-${key}`), key).toBeVisible();
    }
    await expect(page.getByTestId("limit-locations-included")).toContainText(n(L.locations));
    await expect(page.getByTestId("limit-locations-used")).toContainText(`1 of ${n(L.locations)}`);
    await expect(page.getByTestId("limit-guardCadenceMinutes-included")).toContainText(`Every ${L.guardCadenceMinutes} min`);
    await expect(page.getByTestId("limit-gridCredits-included")).toContainText(`${n(L.gridCredits)} / mo`);
    await expect(page.getByTestId("limit-gridCredits-used")).toContainText(`${n(L.gridCredits)} of ${n(L.gridCredits)} this month`);
    await expect(page.getByTestId("limit-gridCredits").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByTestId("limit-permitSearches-used")).toContainText(`120 of ${n(L.permitSearches)} this month`);
    await expect(page.getByTestId("limit-siteScans-used")).toContainText(`2 of ${n(L.siteScans)} this month`);
    await expect(page.getByTestId("limit-crmSeats-used")).toContainText(`2 of ${n(L.crmSeats)}`);
    await expect(page.getByTestId("limit-protectedSites-used")).toContainText(`1 of ${n(L.protectedSites)}`);
    await expect(page.getByTestId("limit-reviewTemplates-used")).toContainText(`1 of ${n(L.reviewTemplates)}`);
    await expect(page.getByTestId("limit-autoPublishAiReplies-included")).toContainText(L.autoPublishAiReplies ? "Included" : "Not included");
    await expect(page.getByTestId("limit-teamTextSegments-included")).toContainText(L.teamTextSegments === 0 ? "Not included" : `${n(L.teamTextSegments)} / mo`);
    if (L.teamTextSegments !== 0) await expect(page.getByTestId("limit-teamTextSegments-used")).toContainText("Not reported");
    await expect(page.getByTestId("limit-clientTexting-included")).toContainText(
      L.clientTexting === "none" ? "Not included" : L.clientTexting === "included" ? "1 number included" : "SignalWire",
    );
    // No API allowances on this server → no API rows.
    await expect(page.getByTestId("limit-apiUnitsPerMonth")).toHaveCount(0);

    // Add-ons the Pro plan sells sit under the limit they raise, with the quantity Stripe reports.
    for (const addon of Object.values(ADDONS).filter((a) => a.availableOn.includes("pro"))) {
      await expect(page.getByTestId(`row-limit-addon-${addon.key}`), addon.key).toBeVisible();
    }
    await expect(page.getByTestId("text-limit-addon-qty-protected_site")).toHaveText("1");
    await expect(page.getByTestId("text-limit-addon-qty-extra_seat")).toHaveText("0");
    await expect(page.getByTestId("button-limit-addon-dec-extra_seat")).toBeDisabled();
    await expect(page.getByTestId("button-limit-addon-dec-competitor_pack")).toBeDisabled();
    await page.getByTestId("button-limit-addon-inc-extra_seat").click();
    await expect.poll(() => calls.addons).toEqual([{ addons: { extra_seat: 1 } }]);
    await page.getByTestId("button-limit-addon-dec-protected_site").click();
    await expect.poll(() => calls.addons.length).toBe(2);
    expect(calls.addons[1]).toEqual({ addons: { protected_site: 0 } });

    await page.getByTestId("button-limits-billing").click();
    await expect(sectionTitle(page)).toContainText("Billing");
  });

  test("Limits & usage shows the API allowance when the plan carries one", async ({ page }) => {
    await mockAccount(page, PRO_WITH_API);
    await gotoCrm(page, "/settings?tab=limits");
    await expect(page.getByTestId("limit-apiUnitsPerMonth-included")).toContainText("10,000 / mo");
    await expect(page.getByTestId("limit-apiUnitsPerMonth-used")).toContainText("120 of 10,000 this month");
    await expect(page.getByTestId("limit-apiRatePerMinute-included")).toContainText("60 / min per key");
    await page.getByTestId("button-limits-api-keys").click();
    await expect(sectionTitle(page)).toContainText("API keys");
    await expect(page.getByTestId("badge-api-enabled")).toHaveText("Enabled");
    await expect(page.getByTestId("text-api-plan-units")).toContainText("120 of 10,000 units");
  });

  test("Limits & usage without a plan offers the way to one", async ({ page }) => {
    await mockAccount(page, { plan: null, storedPlan: null, accessPlan: null, planName: null, isPlatformAdmin: false, grantEndsAt: null, limits: null, allowances: null, modules: {}, addons: {}, locations: { used: 0, limit: 0 }, usage: {}, resetsAt: "2026-11-01T00:00:00Z" });
    await gotoCrm(page, "/settings?tab=limits");
    await expect(page.getByTestId("card-limits-no-plan")).toBeVisible();
    await page.getByTestId("button-limits-choose-plan").click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("Audit log: plain-language events, filters, and a CSV export", async ({ page }) => {
    await mockAccount(page);
    await gotoCrm(page, "/settings?tab=audit-log");
    const rows = page.getByTestId("row-audit-event");
    await expect(rows).toHaveCount(ACTIVITY.length);
    await expect(rows.first().getByTestId("text-audit-event")).toHaveText("Signed in with password");
    await expect(rows.first()).toContainText("203.0.113.5");
    await expect(rows.first()).toContainText("Chrome · Windows");
    await expect(rows.nth(3)).toContainText("fixture@example.invalid");
    await expect(rows.nth(3)).toContainText("Unavailable");
    await expect(page.getByTestId("text-audit-count")).toContainText(`${ACTIVITY.length} of ${ACTIVITY.length} events`);

    await page.getByTestId("select-audit-area").selectOption("security");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("text-audit-event")).toHaveText("Remembered device removed");
    await expect(page.getByTestId("select-audit-kind").getByRole("option", { name: "Remembered device removed" })).toHaveCount(1);
    await page.getByTestId("select-audit-area").selectOption("");
    await page.getByTestId("input-audit-search").fill("curl");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Site Scan started");
    await page.getByTestId("input-audit-search").fill("nothing-matches-this");
    await expect(page.getByTestId("text-audit-no-match")).toBeVisible();
    await expect(page.getByTestId("button-audit-export")).toBeDisabled();
    await page.getByTestId("input-audit-search").fill("");
    await page.getByTestId("input-audit-since").fill("2026-09-25");
    await expect(rows).toHaveCount(3);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("button-audit-export").click()]);
    expect(download.suggestedFilename()).toMatch(/^constructhub-audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = fs.readFileSync(await download.path(), "utf8");
    expect(csv.split("\n")).toHaveLength(4);
    expect(csv).toContain("Signed in with password,auth.login_success,Sign-in,203.0.113.5");
    // Formula-shaped values are exported as text, never as something a spreadsheet would run.
    expect(csv).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid"",""open"")"`);
    for (const line of csv.split("\n").slice(1)) for (const cell of line.split(",")) expect(cell, line).not.toMatch(/^[=+\-@]/);
  });

  test("Integrations: the status list with manage links, and an honest fallback when the service isn't there", async ({ page }) => {
    await mockAccount(page);
    await gotoCrm(page, "/settings?tab=integrations");
    for (const item of INTEGRATIONS) {
      await expect(page.getByTestId(`text-integration-service-${item.id}`)).toHaveText(item.service);
      await expect(page.getByTestId(`link-integration-manage-${item.id}`)).toHaveAttribute("href", item.manageHref);
    }
    await expect(page.getByTestId("badge-integration-status-gbp")).toHaveText("Connected");
    await expect(page.getByTestId("badge-integration-status-cloudflare")).toHaveText("Reconnect needed");
    await expect(page.getByTestId("link-integration-manage-cloudflare")).toHaveText("Reconnect");
    await expect(page.getByTestId("badge-integration-status-stripe")).toHaveText("Not connected");
    await expect(page.getByTestId("link-integration-manage-stripe")).toHaveText("Connect");
    await expect(page.getByTestId("text-integration-detail-cloudflare")).toContainText("Token rejected");

    // A server without the endpoint answers with the SPA's HTML: the page says so and links the pages that manage each connection.
    await page.unroute("**/api/account/integrations");
    await page.route("**/api/account/integrations", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>app</title>" }));
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("card-integrations-unavailable")).toBeVisible();
    await expect(page.getByTestId("row-integration-page")).toHaveCount(8);
    await expect(page.getByTestId("link-integration-page-locations")).toHaveAttribute("href", "/locations");
  });

  test("API keys and API usage say so when the account API isn't installed", async ({ page }) => {
    await mockAccount(page);
    await page.unroute("**/api/account/api-keys");
    await page.unroute("**/api/account/api-usage**");
    const html = (r: any) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>app</title>" });
    await page.route("**/api/account/api-keys", html);
    await page.route("**/api/account/api-usage**", html);
    await gotoCrm(page, "/settings?tab=api-keys");
    await expect(page.getByTestId("card-api-keys-unavailable")).toContainText("AI features");
    await page.getByTestId("button-settings-tab-api-usage").click();
    await expect(page.getByTestId("card-api-usage-unavailable")).toBeVisible();
  });
});

test.describe("settings shell — tablet 820", () => {
  // The app sidebar is open at this width, so the section has to fit beside it without the settings rail.
  test.use({ viewport: { width: 820, height: 1180 } });

  test("the rail gives way to the menu and no section scrolls sideways beside the app sidebar", async ({ page }) => {
    await mockAccount(page);
    await gotoCrm(page, "/settings?tab=audit-log");
    await expect(page.getByTestId("nav-settings")).toBeHidden();
    await expect(page.getByTestId("button-settings-menu")).toContainText("Audit log");
    await expect(page.getByTestId("row-audit-event").first()).toBeVisible();
    await expectNoSideScroll(page, "text-audit-count");
    await shot(page, "820-audit-log");
    for (const [id, anchor] of [["limits", "text-limits-plan"], ["billing", "card-current-plan"], ["account", "card-profile"]] as const) {
      await page.getByTestId("button-settings-menu").click();
      await page.getByTestId(`button-settings-menu-${id}`).click();
      await expect(page.getByTestId(anchor)).toBeVisible();
      await expectNoSideScroll(page, anchor);
      await shot(page, `820-${id}`);
    }
  });
});

test.describe("settings shell — phone 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the nav collapses to a menu; picking a section closes it; nothing scrolls sideways", async ({ page }) => {
    await mockAccount(page);
    await gotoCrm(page, "/settings");
    await expect(page.getByTestId("nav-settings")).toBeHidden();
    const menu = page.getByTestId("button-settings-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("My account");
    await expectNoSideScroll(page, "text-settings-title");
    await shot(page, "390-account");

    await menu.click();
    const sheet = page.getByTestId("sheet-settings-menu");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Limits & usage" })).toBeVisible();
    await shot(page, "390-menu", false);
    await sheet.getByTestId("button-settings-menu-limits").click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/tab=limits/);
    await expect(sectionTitle(page)).toContainText("Limits & usage");
    await expect(menu).toContainText("Limits & usage");
    await expect(page.getByTestId("limit-permitSearches")).toBeVisible();
    await expectNoSideScroll(page, "text-limits-plan");
    await shot(page, "390-limits");

    for (const [id, anchor] of [["billing", "card-current-plan"], ["audit-log", "text-audit-count"], ["integrations", "text-integration-service-gbp"], ["security", "card-two-factor"], ["notifications", "section-notifications"]] as const) {
      await menu.click();
      await page.getByTestId(`button-settings-menu-${id}`).click();
      await expect(page.getByTestId(anchor)).toBeVisible();
      await expectNoSideScroll(page, anchor);
      await shot(page, `390-${id}`);
    }
  });
});
