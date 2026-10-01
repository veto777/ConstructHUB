/**
 * Settings → Billing (Subscriptions / Invoices / Payment methods / Purchases),
 * Settings → API (keys, usage) and the /developers reference.
 * Run: npx playwright test -c playwright.billing-api-ui.config.ts (lane on
 * E2E_PORT, growth app, DEV_AUTH_BYPASS_USER1=true).
 *
 * Every account endpoint of the shared contract is mocked with page.route —
 * the panels are verified against the contract shapes, so nothing here
 * depends on Stripe, the database or which server lanes have merged. Prices
 * come from shared/plans.ts, never a number typed into this file.
 */
import { test, expect, type Page } from "@playwright/test";
import { ADDONS, PLANS } from "../shared/plans";
import { gotoCrm, watchPage } from "./helpers";

// Deep links: /settings/billing[?billing=…] and /settings/api[?api=usage] redirect into the settings shell
// (Workspace → Billing with its tabs, API keys, API usage), which is what the assertions below see.
const BILLING_URL = "/settings/billing";
const API_URL = "/settings/api";
const sectionTitle = (page: Page) => page.getByTestId("text-settings-section-title");

const usd = (cents: number) => {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
};
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ── Fixtures in the contract's shapes ───────────────────────────────────────
// Noon UTC keeps the calendar day the same in every US time zone.
const PRO_SUB = {
  plan: "pro", status: "active", stripeSubscriptionId: "sub_P_l9", currentPeriodEnd: "2026-11-01T12:00:00Z", cancelAtPeriodEnd: false,
  billingInterval: "month", addons: { protected_site: 2, competitor_pack: 1 }, agencyLocations: null, startedAt: "2026-04-01T12:00:00Z",
};
const NO_SUB = { plan: "free", status: "inactive" };
const ENTITLEMENTS = {
  plan: "pro", storedPlan: "pro", accessPlan: "pro", planName: "Pro", isPlatformAdmin: false, grantEndsAt: null,
  allowances: PLANS.pro.limits, modules: PLANS.pro.modules, addons: { protected_site: 2, competitor_pack: 1 },
  locations: { used: 1, limit: 1 }, usage: {}, resetsAt: "2026-11-01T00:00:00.000Z",
};
const INVOICES_PAGE_1 = {
  invoices: [
    { id: "in_l9_0002", number: "CH-0002", status: "paid", amountPaid: 10900, amountDue: 0, currency: "usd", created: "2026-09-01T12:00:00Z", periodStart: "2026-09-01T12:00:00Z", periodEnd: "2026-10-01T12:00:00Z", description: "Pro plan + add-ons", hostedInvoiceUrl: "https://invoice.stripe.com/i/l9_0002", invoicePdf: "https://pay.stripe.com/invoice/l9_0002/pdf" },
    { id: "in_l9_0001", number: "CH-0001", status: "open", amountPaid: 0, amountDue: 7900, currency: "usd", created: "2026-08-01T12:00:00Z", periodStart: "2026-08-01T12:00:00Z", periodEnd: "2026-09-01T12:00:00Z", description: null, hostedInvoiceUrl: "https://invoice.stripe.com/i/l9_0001", invoicePdf: null },
  ],
  hasMore: true,
};
const INVOICES_PAGE_2 = {
  invoices: [
    // A non-http(s) document URL must never become an href.
    { id: "in_l9_0000", number: "CH-0000", status: "void", amountPaid: 0, amountDue: 0, currency: "usd", created: "2026-07-01T12:00:00Z", periodStart: null, periodEnd: null, description: "Voided", hostedInvoiceUrl: "javascript:alert(1)", invoicePdf: null },
  ],
  hasMore: false,
};
const METHODS = { methods: [
  { id: "pm_l9_visa", brand: "visa", last4: "4242", expMonth: 4, expYear: 2031, isDefault: true },
  { id: "pm_l9_amex", brand: "amex", last4: "0005", expMonth: 1, expYear: 2020, isDefault: false },
] };
const PURCHASES = { purchases: [
  { id: "pi_l9_course", kind: "course", description: "Master Class", amount: 49900, currency: "usd", created: "2026-06-15T12:00:00Z", receiptUrl: "https://pay.stripe.com/receipts/l9_course" },
  { id: "cs_l9_reinst", kind: "reinstatement", description: "GBP reinstatement", amount: 29900, currency: "usd", created: "2026-05-02T12:00:00Z", receiptUrl: null },
] };

const KEY_A = { id: "key_a1", name: "Zapier", prefix: "a1b2c3", suffix: "x9", scopes: ["read"], monthlyUnitLimit: null, unitsThisMonth: 1250, createdAt: "2026-08-10T12:00:00Z", lastUsedAt: "2026-09-29T15:04:00Z", expiresAt: null };
const KEY_B = { id: "key_b2", name: "Reporting script", prefix: "d4e5f6", suffix: "q7", scopes: ["read", "write"], monthlyUnitLimit: 2000, unitsThisMonth: 300, createdAt: "2026-09-01T12:00:00Z", lastUsedAt: null, expiresAt: "2026-01-01T12:00:00Z" };
const PRO_API = { apiEnabled: true, unitsPerMonth: 10000, usedThisMonth: 1550, ratePerMinute: 60 };
const STARTER_API = { apiEnabled: false, unitsPerMonth: 0, usedThisMonth: 0, ratePerMinute: 60 };
const USAGE = {
  days: [
    { date: "2026-09-27", units: 40, requests: 30, byKey: { key_a1: 30, key_b2: 10 } },
    { date: "2026-09-28", units: 0, requests: 0, byKey: {} },
    { date: "2026-09-29", units: 125, requests: 90, byKey: { key_a1: 100, key_b2: 25 } },
  ],
  totals: { units: 165, requests: 120 },
};
const OPENAPI = {
  openapi: "3.0.3",
  info: { title: "ConstructHUB API", version: "1.0.0", description: "Your data, from your own tools." },
  tags: [{ name: "Growth", description: "Google Business Profile data." }],
  paths: {
    "/api/v1/growth/posts": {
      get: { tags: ["Growth"], summary: "List posts", "x-scope": "read", parameters: [{ name: "limit", in: "query", schema: { type: "integer" }, description: "Rows per page (max 200)." }], responses: { "200": { description: "A page of posts." } } },
      post: { tags: ["Growth"], summary: "Create a post", "x-scope": "write", "x-units": 5, requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["body"], properties: { body: { type: "string", description: "Stored exactly as sent." } } } } } }, responses: { "201": { description: "Created." } } },
    },
  },
};

type Calls = { portal: number; create: any[]; patch: { id: string; body: any }[]; del: string[]; invoiceUrls: string[] };

/** Mock every account endpoint the panels can call and record what they send. */
async function mockAccount(page: Page, opts: { sub?: unknown; api?: unknown; keys?: unknown[]; createStatus?: number[] } = {}): Promise<Calls> {
  const calls: Calls = { portal: 0, create: [], patch: [], del: [], invoiceUrls: [] };
  // A deep copy: rename/limit/revoke mutate this list, and the fixtures must stay pristine for the next test.
  const keys: any[] = structuredClone(opts.keys ?? [KEY_A, KEY_B]);
  const createStatuses = [...(opts.createStatus ?? [])];
  await page.route("**/api/stripe/subscription", (r) => r.fulfill({ json: opts.sub ?? PRO_SUB }));
  await page.route("**/api/entitlements", (r) => r.fulfill({ json: ENTITLEMENTS }));
  await page.route("**/api/stripe/create-portal", async (r) => { calls.portal++; await r.fulfill({ json: {} }); });
  await page.route("**/api/billing/invoices**", (r) => {
    const url = new URL(r.request().url());
    calls.invoiceUrls.push(url.search);
    return r.fulfill({ json: url.searchParams.get("starting_after") ? INVOICES_PAGE_2 : INVOICES_PAGE_1 });
  });
  await page.route("**/api/billing/payment-methods", (r) => r.fulfill({ json: METHODS }));
  await page.route("**/api/billing/purchases", (r) => r.fulfill({ json: PURCHASES }));
  await page.route("**/api/account/api-usage**", (r) => r.fulfill({ json: USAGE }));
  await page.route("**/api/account/api-keys", async (r) => {
    const req = r.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      calls.create.push(body);
      const status = createStatuses.shift();
      if (status === 403) return r.fulfill({ status: 403, json: { reauth: true, message: "Verify it's you first." } });
      const item = { id: "key_new", name: body.name, prefix: "n3wk3y", suffix: "zz", scopes: body.scopes, monthlyUnitLimit: body.monthlyUnitLimit ?? null, unitsThisMonth: 0, createdAt: "2026-09-30T12:00:00Z", lastUsedAt: null, expiresAt: body.expiresInDays ? "2026-12-29T12:00:00Z" : null };
      keys.unshift(item);
      return r.fulfill({ status: 201, json: { key: "chub_n3wk3y_SECRETSECRETSECRETzz", item } });
    }
    return r.fulfill({ json: { keys, plan: opts.api ?? PRO_API } });
  });
  await page.route("**/api/account/api-keys/*", async (r) => {
    const req = r.request();
    const id = decodeURIComponent(req.url().split("/").pop()!);
    if (req.method() === "PATCH") {
      const body = req.postDataJSON();
      calls.patch.push({ id, body });
      const k = keys.find((x) => x.id === id) as any;
      if (k) Object.assign(k, body);
      return r.fulfill({ json: { item: k } });
    }
    if (req.method() === "DELETE") {
      calls.del.push(id);
      const i = keys.findIndex((x) => x.id === id);
      if (i >= 0) keys.splice(i, 1);
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ status: 405, json: { message: "nope" } });
  });
  // Step-up verification, when the create route asks for it.
  await page.route("**/api/auth/reauth", (r) => r.request().method() === "POST"
    ? r.fulfill({ json: { ok: true } })
    : r.fulfill({ json: { method: "password", google: false, email: "l9@example.invalid" } }));
  return calls;
}

async function mockOpenApi(page: Page, doc: unknown | null) {
  await page.route("**/api/v1/openapi.json", (r) => doc ? r.fulfill({ json: doc }) : r.fulfill({ status: 404, json: { message: "Not found" } }));
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

// ── Billing ─────────────────────────────────────────────────────────────────

test.describe("settings billing", () => {
  test("Subscriptions: plan, interval, start, next billing, price, add-ons with quantities, total", async ({ page }) => {
    const guards = watchPage(page);
    const calls = await mockAccount(page);
    await gotoCrm(page, BILLING_URL);
    await expect(sectionTitle(page)).toContainText("Billing");
    await expect(page).toHaveURL(/[?&]tab=billing(&|$)/);
    await expect(page.getByTestId("tab-billing-subscriptions")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("text-subscription-plan")).toHaveText("Pro");
    await expect(page.getByTestId("badge-subscription-status")).toHaveText("Active");
    await expect(page.getByTestId("text-subscription-interval")).toHaveText("Monthly");
    await expect(page.getByTestId("text-subscription-start")).toHaveText(date(PRO_SUB.startedAt));
    await expect(page.getByTestId("text-subscription-next")).toHaveText(date(PRO_SUB.currentPeriodEnd));
    await expect(page.getByTestId("text-subscription-price")).toHaveText(`${usd(PLANS.pro.monthlyCents)}/mo`);
    await expect(page.getByTestId("row-subscription-addon-protected_site")).toContainText(`${ADDONS.protected_site.name} × 2`);
    await expect(page.getByTestId("row-subscription-addon-protected_site")).toContainText(`${usd(2 * ADDONS.protected_site.monthlyCents)}/mo`);
    await expect(page.getByTestId("row-subscription-addon-competitor_pack")).toContainText(`${ADDONS.competitor_pack.name} × 1`);
    await expect(page.locator('[data-testid="row-subscription-addon-extra_seat"]')).toHaveCount(0);
    const total = PLANS.pro.monthlyCents + 2 * ADDONS.protected_site.monthlyCents + ADDONS.competitor_pack.monthlyCents;
    await expect(page.getByTestId("text-subscription-total")).toHaveText(`${usd(total)}/mo`);
    // The plan cards under the statement carry the actions (one "Manage billing" on the page).
    await expect(page.getByTestId("button-upgrade")).toHaveText("Change plan");
    await expect(page.getByTestId("card-current-plan")).toContainText("Pro plan");
    await page.getByTestId("button-manage-billing").click();
    await expect.poll(() => calls.portal).toBe(1);
    guards.assertClean("subscriptions");
  });

  test("Subscriptions: a trial set to cancel never promises a first charge", async ({ page }) => {
    await mockAccount(page, { sub: { ...PRO_SUB, status: "trialing", cancelAtPeriodEnd: true } });
    await gotoCrm(page, BILLING_URL);
    await expect(page.getByTestId("badge-subscription-status")).toHaveText("Trial");
    await expect(page.getByTestId("text-subscription-next")).toHaveText(`Ends ${date(PRO_SUB.currentPeriodEnd)} (won't renew)`);
    await expect(page.getByTestId("text-subscription-next")).not.toContainText("first charge");
  });

  test("Subscriptions without a reported interval: add-on quantities, but no guessed prices or total", async ({ page }) => {
    await mockAccount(page, { sub: { ...PRO_SUB, billingInterval: null } });
    await gotoCrm(page, BILLING_URL);
    await expect(page.getByTestId("text-subscription-interval")).toHaveText("—");
    await expect(page.getByTestId("text-subscription-price")).toHaveText("—");
    await expect(page.getByTestId("row-subscription-addon-protected_site")).toContainText(`${ADDONS.protected_site.name} × 2`);
    await expect(page.getByTestId("row-subscription-addon-protected_site")).not.toContainText("/mo");
    await expect(page.locator('[data-testid="text-subscription-total"]')).toHaveCount(0);
  });

  test("Subscriptions without a plan: no price, a way to choose one, no portal button", async ({ page }) => {
    await mockAccount(page, { sub: NO_SUB });
    await gotoCrm(page, BILLING_URL);
    await expect(page.getByTestId("text-no-subscription")).toContainText("No active plan");
    await expect(page.getByTestId("button-upgrade")).toHaveText("Choose a plan");
    await expect(page.locator('[data-testid="button-manage-billing"]')).toHaveCount(0);
    await page.getByTestId("button-upgrade").click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("Invoices: number, date, period, amount, status, View + PDF; Load more pages by cursor", async ({ page }) => {
    const guards = watchPage(page);
    const calls = await mockAccount(page);
    await gotoCrm(page, `${BILLING_URL}?billing=invoices`);
    await expect(page.getByTestId("tab-billing-invoices")).toHaveAttribute("aria-selected", "true");
    const paid = INVOICES_PAGE_1.invoices[0], open = INVOICES_PAGE_1.invoices[1];
    await expect(page.getByTestId(`text-invoice-number-${paid.id}`)).toHaveText("CH-0002");
    await expect(page.getByTestId(`text-invoice-date-${paid.id}`)).toHaveText(date(paid.created));
    await expect(page.getByTestId(`text-invoice-period-${paid.id}`)).toHaveText(`Sep 1 – ${date(paid.periodEnd!)}`);
    await expect(page.getByTestId(`text-invoice-amount-${paid.id}`)).toHaveText(usd(paid.amountPaid));
    await expect(page.getByTestId(`badge-invoice-status-${paid.id}`)).toHaveText("Paid");
    await expect(page.getByTestId(`link-invoice-view-${paid.id}`)).toHaveAttribute("href", paid.hostedInvoiceUrl!);
    await expect(page.getByTestId(`link-invoice-pdf-${paid.id}`)).toHaveAttribute("href", paid.invoicePdf!);
    await expect(page.getByTestId(`text-invoice-amount-${open.id}`)).toHaveText(usd(open.amountDue));
    await expect(page.getByTestId(`badge-invoice-status-${open.id}`)).toHaveText("Open");
    await expect(page.locator(`[data-testid="link-invoice-pdf-${open.id}"]`)).toHaveCount(0);

    await page.getByTestId("button-invoices-more").click();
    await expect(page.getByTestId("badge-invoice-status-in_l9_0000")).toHaveText("Void");
    await expect(page.getByTestId("text-invoice-period-in_l9_0000")).toHaveText("—");
    await expect(page.locator('[data-testid="link-invoice-view-in_l9_0000"]')).toHaveCount(0);
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
    await expect(page.locator('[data-testid="button-invoices-more"]')).toHaveCount(0);
    expect(calls.invoiceUrls).toEqual(["?limit=20", "?limit=20&starting_after=in_l9_0001"]);
    guards.assertClean("invoices");
  });

  test("Payment methods: brand, last 4, expiry, default, an expired card, and Manage opens the portal", async ({ page }) => {
    const calls = await mockAccount(page);
    await gotoCrm(page, `${BILLING_URL}?billing=payment-methods`);
    await expect(page.getByTestId("text-payment-method-brand-pm_l9_visa")).toHaveText("Visa");
    await expect(page.getByTestId("text-payment-method-last4-pm_l9_visa")).toHaveText("•••• 4242");
    await expect(page.getByTestId("text-payment-method-exp-pm_l9_visa")).toHaveText("Expires 04/31");
    await expect(page.getByTestId("badge-payment-method-default-pm_l9_visa")).toHaveText("Default");
    await expect(page.getByTestId("text-payment-method-brand-pm_l9_amex")).toHaveText("American Express");
    await expect(page.getByTestId("text-payment-method-exp-pm_l9_amex")).toHaveText("Expired 01/20");
    await expect(page.locator('[data-testid="badge-payment-method-default-pm_l9_amex"]')).toHaveCount(0);
    await page.getByTestId("button-payment-methods-manage").click();
    await expect.poll(() => calls.portal).toBe(1);
  });

  test("Purchases: kind, description, amount, date and the receipt link", async ({ page }) => {
    await mockAccount(page);
    await gotoCrm(page, `${BILLING_URL}?billing=purchases`);
    await expect(page.getByTestId("text-purchase-description-pi_l9_course")).toHaveText("Master Class");
    await expect(page.getByTestId("badge-purchase-kind-pi_l9_course")).toHaveText("Course");
    await expect(page.getByTestId("text-purchase-amount-pi_l9_course")).toHaveText(usd(49900));
    await expect(page.getByTestId("text-purchase-date-pi_l9_course")).toHaveText(date("2026-06-15T12:00:00Z"));
    await expect(page.getByTestId("link-purchase-receipt-pi_l9_course")).toHaveAttribute("href", "https://pay.stripe.com/receipts/l9_course");
    await expect(page.getByTestId("badge-purchase-kind-cs_l9_reinst")).toHaveText("Reinstatement");
    await expect(page.locator('[data-testid="link-purchase-receipt-cs_l9_reinst"]')).toHaveCount(0);
  });

  test("tabs keep their place in the URL", async ({ page }) => {
    await mockAccount(page);
    await gotoCrm(page, BILLING_URL);
    await page.getByTestId("tab-billing-invoices").click();
    await expect(page).toHaveURL(/[?&]view=invoices(&|$)/);
    await page.reload();
    await expect(page.getByTestId("card-invoices")).toBeVisible();
  });
});

// ── API keys ────────────────────────────────────────────────────────────────

test.describe("settings api keys", () => {
  test("banner, quota bar and the Ahrefs-style table", async ({ page }) => {
    const guards = watchPage(page);
    await mockAccount(page);
    await gotoCrm(page, API_URL);
    await expect(page.getByTestId("text-api-no-ai")).toHaveText("API keys give access to your ConstructHUB data. AI features are not available through the API.");
    await expect(page.getByTestId("text-api-quota")).toHaveText("1,550 of 10,000 used");
    await expect(page.getByTestId("card-api-quota").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "16");
    await expect(page.getByTestId("text-api-rate")).toContainText("60 requests per minute");
    await expect(page.locator('[data-testid="card-api-upgrade"]')).toHaveCount(0);

    const head = page.getByTestId("table-api-keys").locator("thead");
    for (const col of ["Title", "Key", "Scope", "Units consumed", "Limit", "Added", "Last used", "Expires"]) await expect(head).toContainText(col);
    await expect(page.getByTestId("text-key-name-key_a1")).toHaveText("Zapier");
    await expect(page.getByTestId("text-key-masked-key_a1")).toHaveText("chub_a1b2c3…x9");
    await expect(page.getByTestId("text-key-scopes-key_a1")).toHaveText("Read");
    await expect(page.getByTestId("text-key-scopes-key_b2")).toHaveText("ReadWrite");
    await expect(page.getByTestId("text-key-units-key_a1")).toHaveText("1,250");
    await expect(page.getByTestId("text-key-limit-key_a1")).toHaveText("Plan");
    await expect(page.getByTestId("text-key-limit-key_b2")).toHaveText("2,000");
    await expect(page.getByTestId("text-key-added-key_a1")).toHaveText(date(KEY_A.createdAt));
    await expect(page.getByTestId("text-key-last-used-key_b2")).toHaveText("Never");
    await expect(page.getByTestId("text-key-expires-key_a1")).toHaveText("Never");
    await expect(page.getByTestId("text-key-expires-key_b2")).toContainText("Expired");
    // The secret is never on the page: only the prefix and the suffix.
    expect(await page.locator("body").innerText()).not.toMatch(/chub_[a-z0-9]+_[A-Za-z0-9]{8,}/);
    guards.assertClean("api keys");
  });

  test("Generate: name, scopes, limit, expiry -> POST body; the key is shown once and copied", async ({ page }) => {
    const guards = watchPage(page);
    const calls = await mockAccount(page);
    await gotoCrm(page, API_URL);
    await page.getByTestId("button-generate-key").click();
    const dialog = page.getByTestId("dialog-generate-key");
    await expect(dialog).toContainText("AI features are not available through the API.");
    await expect(dialog.getByTestId("button-generate-submit")).toBeDisabled();
    await dialog.getByTestId("input-key-name").fill("My Claude");
    await dialog.getByTestId("checkbox-scope-write").click();
    await dialog.getByTestId("input-key-limit").fill("50000");
    await expect(dialog.getByTestId("text-key-limit-error")).toContainText("10,000");
    await expect(dialog.getByTestId("button-generate-submit")).toBeDisabled();
    await dialog.getByTestId("input-key-limit").fill("500");
    await dialog.getByTestId("select-key-expiry").click();
    await page.getByTestId("option-key-expiry-90").click();
    await dialog.getByTestId("button-generate-submit").click();
    await expect.poll(() => calls.create).toEqual([{ name: "My Claude", scopes: ["read", "write"], monthlyUnitLimit: 500, expiresInDays: 90 }]);

    const reveal = page.getByTestId("dialog-new-key");
    await expect(reveal).toContainText("won't be shown again");
    await expect(reveal.getByTestId("text-new-key")).toHaveValue("chub_n3wk3y_SECRETSECRETSECRETzz");
    await reveal.getByTestId("button-copy-key").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("chub_n3wk3y_SECRETSECRETSECRETzz");
    await reveal.getByTestId("button-new-key-done").click();
    await expect(reveal).toBeHidden();
    // The list refreshed with the new key, masked.
    await expect(page.getByTestId("text-key-masked-key_new")).toHaveText("chub_n3wk3y…zz");
    expect(await page.locator("body").innerText()).not.toContain("SECRETSECRET");
    // The next Generate starts from a blank form, not the previous key's.
    await page.getByTestId("button-generate-key").click();
    await expect(dialog.getByTestId("input-key-name")).toHaveValue("");
    await expect(dialog.getByTestId("input-key-limit")).toHaveValue("");
    await expect(dialog.getByTestId("checkbox-scope-write")).toHaveAttribute("data-state", "unchecked");
    guards.assertClean("generate key");
  });

  test("Generate asks for step-up verification (403 reauth) and retries", async ({ page }) => {
    const calls = await mockAccount(page, { createStatus: [403] });
    await gotoCrm(page, API_URL);
    await page.getByTestId("button-generate-key").click();
    await page.getByTestId("input-key-name").fill("Verified key");
    await page.getByTestId("button-generate-submit").click();
    const reauth = page.getByRole("dialog", { name: "Verify your identity" });
    await expect(reauth).toBeVisible();
    await reauth.getByLabel("Verification").fill("correct horse battery");
    await reauth.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByTestId("dialog-new-key")).toBeVisible();
    expect(calls.create).toHaveLength(2);
  });

  test("menu: rename, set monthly limit, revoke with confirmation", async ({ page }) => {
    const calls = await mockAccount(page);
    await gotoCrm(page, API_URL);
    await page.getByTestId("button-key-menu-key_a1").click();
    await page.getByTestId("menu-key-rename").click();
    await page.getByTestId("input-rename-key").fill("Zapier (prod)");
    await page.getByTestId("button-rename-submit").click();
    await expect.poll(() => calls.patch).toEqual([{ id: "key_a1", body: { name: "Zapier (prod)" } }]);
    await expect(page.getByTestId("text-key-name-key_a1")).toHaveText("Zapier (prod)");
    // Another key's dialog opens with its own name, never the draft typed for the first.
    await page.getByTestId("button-key-menu-key_b2").click();
    await page.getByTestId("menu-key-rename").click();
    await expect(page.getByTestId("input-rename-key")).toHaveValue("Reporting script");
    await page.getByTestId("dialog-rename-key").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("dialog-rename-key")).toBeHidden();

    await page.getByTestId("button-key-menu-key_a1").click();
    await page.getByTestId("menu-key-limit").click();
    await expect(page.getByTestId("input-limit-key")).toHaveValue("");
    await page.getByTestId("input-limit-key").fill("750");
    await page.getByTestId("button-limit-submit").click();
    await expect.poll(() => calls.patch.at(-1)).toEqual({ id: "key_a1", body: { monthlyUnitLimit: 750 } });
    await expect(page.getByTestId("text-key-limit-key_a1")).toHaveText("750");
    await page.getByTestId("button-key-menu-key_b2").click();
    await page.getByTestId("menu-key-limit").click();
    await expect(page.getByTestId("input-limit-key")).toHaveValue("2000");
    await page.getByTestId("dialog-limit-key").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("dialog-limit-key")).toBeHidden();

    await page.getByTestId("button-key-menu-key_b2").click();
    await page.getByTestId("menu-key-revoke").click();
    const confirm = page.getByTestId("dialog-revoke-key");
    await expect(confirm).toContainText("Revoke Reporting script?");
    await confirm.getByTestId("button-revoke-cancel").click();
    expect(calls.del).toEqual([]);
    await page.getByTestId("button-key-menu-key_b2").click();
    await page.getByTestId("menu-key-revoke").click();
    await page.getByTestId("button-revoke-confirm").click();
    await expect.poll(() => calls.del).toEqual(["key_b2"]);
    await expect(page.locator('[data-testid="row-api-key-key_b2"]')).toHaveCount(0);
  });

  test("Starter: upgrade card, no quota bar, Generate disabled", async ({ page }) => {
    await mockAccount(page, { api: STARTER_API, keys: [] });
    await gotoCrm(page, API_URL);
    await expect(page.getByTestId("card-api-upgrade")).toContainText("API access starts with Pro");
    await expect(page.locator('[data-testid="card-api-quota"]')).toHaveCount(0);
    await expect(page.getByTestId("button-generate-key")).toBeDisabled();
    await expect(page.getByTestId("text-api-keys-empty")).toBeVisible();
    await page.getByTestId("button-api-upgrade").click();
    await expect(page).toHaveURL(/\/pricing$/);
  });
});

// ── API usage ───────────────────────────────────────────────────────────────

test.describe("settings api usage", () => {
  test("totals, a per-key chart and the per-day table", async ({ page }) => {
    const guards = watchPage(page);
    await mockAccount(page);
    await gotoCrm(page, `${API_URL}?api=usage`);
    await expect(page.getByTestId("button-settings-tab-api-usage")).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(/[?&]tab=api-usage(&|$)/);
    await expect(page.getByTestId("text-usage-total-units")).toHaveText("165");
    await expect(page.getByTestId("text-usage-total-requests")).toHaveText("120");
    await expect(page.getByTestId("text-usage-active-keys")).toHaveText("2");
    await expect(page.getByTestId("chart-api-usage").locator("svg.recharts-surface")).toBeVisible();
    // One stacked series per key; legend labels carry the key names.
    await expect(page.getByTestId("chart-api-usage")).toContainText("Zapier (chub_a1b2c3…x9)");
    await expect(page.getByTestId("chart-api-usage")).toContainText("Reporting script");
    // Newest day first in the table.
    const rows = page.getByTestId("table-api-usage").locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute("data-testid", "row-usage-2026-09-29");
    await expect(page.getByTestId("text-usage-units-2026-09-29")).toHaveText("125");
    await expect(page.getByTestId("text-usage-requests-2026-09-29")).toHaveText("90");
    await expect(page.getByTestId("text-usage-bykey-2026-09-29")).toContainText("Zapier (chub_a1b2c3…x9): 100");
    await expect(page.getByTestId("text-usage-bykey-2026-09-28")).toHaveText("—");
    guards.assertClean("api usage");
  });

  test("no calls: an empty state, not an empty chart", async ({ page }) => {
    await mockAccount(page);
    await page.route("**/api/account/api-usage**", (r) => r.fulfill({ json: { days: [], totals: { units: 0, requests: 0 } } }));
    await gotoCrm(page, `${API_URL}?api=usage`);
    await expect(page.getByTestId("text-api-usage-empty")).toContainText("No API calls");
    await expect(page.locator('[data-testid="chart-api-usage"]')).toHaveCount(0);
  });
});

// ── /developers ─────────────────────────────────────────────────────────────

test.describe("developers page", () => {
  test("renders the OpenAPI document: auth, limits, the AI rule and every endpoint", async ({ page }) => {
    const guards = watchPage(page);
    await mockAccount(page);
    await mockOpenApi(page, OPENAPI);
    await gotoCrm(page, "/developers");
    await expect(page).toHaveTitle("Developers | ConstructHUB");
    await expect(page.getByTestId("text-developers-title")).toHaveText("ConstructHUB API");
    await expect(page.getByTestId("text-developers-no-ai")).toHaveText("API keys give access to your ConstructHUB data. AI features are not available through the API.");
    await expect(page.getByTestId("text-developers-base-url")).toHaveText(/\/api\/v1$/);
    await expect(page.getByTestId("card-developers-limits")).toContainText("60 requests per minute per key");
    await expect(page.getByTestId("card-developers-limits")).toContainText("X-Units-Remaining");
    const tag = page.getByTestId("card-developers-tag-growth");
    await expect(tag).toContainText("Google Business Profile data.");
    await expect(tag.getByTestId("endpoint-get-api-v1-growth-posts")).toContainText("List posts");
    const create = tag.getByTestId("endpoint-post-api-v1-growth-posts");
    await expect(create).toContainText("Create a post");
    await create.locator("summary").click();
    await expect(create).toContainText("Stored exactly as sent.");
    await expect(create).toContainText("Cost: 5 unit(s).");
    await expect(create).toContainText("201 — Created.");
    await page.getByTestId("link-developers-keys").click();
    await expect(page).toHaveURL(/[?&]tab=api-keys(&|$)/);
    guards.assertClean("developers");
  });

  test("without a published reference the page says so and keeps the rules", async ({ page }) => {
    await mockOpenApi(page, null);
    await gotoCrm(page, "/developers");
    await expect(page.getByTestId("text-developers-unpublished")).toContainText("isn't published on this server yet");
    await expect(page.getByTestId("card-developers-auth")).toBeVisible();
    await expect(page.getByTestId("banner-developers-no-ai")).toBeVisible();
  });

  test("a server that answers the SPA's HTML for openapi.json reads as unpublished, not as a parse error", async ({ page }) => {
    const guards = watchPage(page);
    await page.route("**/api/v1/openapi.json", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!DOCTYPE html><html><body>app</body></html>" }));
    await gotoCrm(page, "/developers");
    await expect(page.getByTestId("text-developers-unpublished")).toContainText("isn't published on this server yet");
    await expect(page.getByTestId("text-developers-unpublished")).not.toContainText("Unexpected token");
    guards.assertClean("developers html fallback");
  });
});

// ── 390px ───────────────────────────────────────────────────────────────────

test.describe("mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("billing, api keys, api usage and developers never scroll sideways", async ({ page }) => {
    await mockAccount(page);
    await mockOpenApi(page, OPENAPI);
    for (const [url, anchor] of [
      [BILLING_URL, "card-subscription"],
      [`${BILLING_URL}?billing=invoices`, "card-invoices"],
      [`${BILLING_URL}?billing=payment-methods`, "card-payment-methods"],
      [`${BILLING_URL}?billing=purchases`, "card-purchases"],
      [API_URL, "card-api-keys"],
      [`${API_URL}?api=usage`, "card-api-usage"],
      ["/developers", "card-developers-auth"],
    ] as const) {
      await gotoCrm(page, url);
      await expect(page.getByTestId(anchor)).toBeVisible();
      await expectNoSideScroll(page, anchor);
    }
    // Phone layouts: cards, not tables.
    await gotoCrm(page, `${BILLING_URL}?billing=invoices`);
    await expect(page.getByTestId("card-invoice-in_l9_0002")).toBeVisible();
    await expect(page.getByTestId("table-invoices")).toBeHidden();
    await gotoCrm(page, API_URL);
    await expect(page.getByTestId("card-api-key-key_a1")).toBeVisible();
    await expect(page.getByTestId("table-api-keys")).toBeHidden();
    await page.getByTestId("button-key-menu-m-key_a1").click();
    await expect(page.getByTestId("menu-key-revoke")).toBeVisible();
  });
});
