import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "crypto";
import { q } from "./db";
import { gotoCrm, sweepPage, watchPage } from "./helpers";

/**
 * The homeowner client portal (client.* / ?client=1 in dev): magic-link
 * sign-in, then every estimate, invoice and signed contract of the session's
 * customer — and nobody else's.
 *
 * Raw link tokens are SHA-256 hashed at rest, so the suite INSERTS token rows
 * with a known hash (the exact shape request-link writes) instead of trying
 * to read a minted token back — which also gives exact control over expiry.
 *
 * Fixtures come from the seeded Aspire demo: kane@example.com owns approved
 * estimate E-2001 (a signed contract) and unpaid invoice INV-2002; the
 * neighbours are luis.orozco@example.com (estimate E-2002, "Downstairs LVP")
 * and vince.c@example.com (invoice INV-2001, "Guest bath tile — final").
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function kaneId(): Promise<string> {
  const rows = await q<{ id: string }>(
    `select id from crm_customers where lower(email) = 'kane@example.com' limit 1`,
  );
  if (!rows.length) throw new Error("seeded kane@example.com missing — run scripts/seed-crm-demo.ts");
  return rows[0].id;
}

/** Insert a magic-link token row as request-link would; returns the RAW token. */
async function makeClientToken(customerIds: string[], opts: { expired?: boolean } = {}): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_tokens (token_hash, customer_ids, email, expires_at)
     values ($1, $2::jsonb, 'kane@example.com', now() + $3::interval)`,
    [sha256(raw), JSON.stringify(customerIds), opts.expired ? "-5 minutes" : "30 minutes"],
  );
  return raw;
}

/** Redeem a fresh magic link in the browser and land on the dashboard. */
async function signInAsKane(page: import("@playwright/test").Page) {
  const raw = await makeClientToken([await kaneId()]);
  await page.goto(`/api/client/auth/verify?token=${raw}&client=1`);
  await expect(page).toHaveURL(/\/\?client=1/);
  await expect(page.getByTestId("text-org-name")).toHaveText("Aspire Interiors", { timeout: 15_000 });
  return raw;
}

test.describe("client portal — magic link", () => {
  test("curated: request form confirms without revealing whether the email exists", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/?client=1");
    await expect(page.getByTestId("input-client-email")).toBeVisible();

    // An email no customer has gets the exact same confirmation as a real one.
    await page.getByTestId("input-client-email").fill(`ghost.${Date.now()}@example.com`);
    await page.getByTestId("button-request-link").click();
    await expect(page.getByTestId("text-link-sent")).toBeVisible();
    await expect(page.getByText(/If that email is on file/)).toBeVisible();

    const rows = await q(`select id from crm_client_tokens where email like 'ghost.%'`);
    expect(rows.length).toBe(0); // nothing minted for a stranger
    guards.assertClean("request-link anti-enumeration");
  });

  test("curated: invalid and expired links land on the invalid state", async ({ page }) => {
    const guards = watchPage(page);

    await page.goto(`/api/client/auth/verify?token=${randomBytes(32).toString("hex")}&client=1`);
    await expect(page).toHaveURL(/auth=invalid/);
    await expect(page.getByTestId("text-auth-invalid")).toBeVisible();
    // The request form is right there to recover with.
    await expect(page.getByTestId("input-client-email")).toBeVisible();

    const expired = await makeClientToken([await kaneId()], { expired: true });
    await page.goto(`/api/client/auth/verify?token=${expired}&client=1`);
    await expect(page).toHaveURL(/auth=invalid/);
    await expect(page.getByTestId("text-auth-invalid")).toBeVisible();

    guards.assertClean("invalid/expired token states");
  });

  test("curated: a magic link is single-use", async ({ page }) => {
    const raw = await signInAsKane(page);
    // Second redemption of the SAME link mints no new session — the URL shows
    // the invalid state and the FIRST session keeps working untouched.
    await page.goto(`/api/client/auth/verify?token=${raw}&client=1`);
    await expect(page).toHaveURL(/auth=invalid/);
    await expect(page.getByTestId("text-org-name")).toHaveText("Aspire Interiors", { timeout: 15_000 });

    // Without the session, the used link lands on the invalid sign-in state.
    await page.context().clearCookies();
    await page.goto(`/api/client/auth/verify?token=${raw}&client=1`);
    await expect(page).toHaveURL(/auth=invalid/);
    await expect(page.getByTestId("text-auth-invalid")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("client portal — dashboard", () => {
  test("curated: sections group Kane's documents, neighbours stay invisible", async ({ page }) => {
    const guards = watchPage(page);
    await signInAsKane(page);

    await expect(page.getByText(/Welcome, Joe & Mary Kane/)).toBeVisible();

    // Needs your action: the unpaid invoice, NOT the approved estimate.
    const action = page.getByTestId("section-needs-action");
    await expect(action).toContainText("INV-2002");
    await expect(action).not.toContainText("E-2001");

    // The portal is a per-view shell now — each document group lives behind
    // its own sidebar nav entry.
    await page.getByTestId("portal-nav-estimates").click();
    await expect(page.getByTestId("section-estimates")).toContainText("E-2001");
    await expect(page.getByTestId("section-estimates")).toContainText("approved");
    // Isolation: Orozco's estimate never appears.
    await expect(page.locator("main")).not.toContainText("E-2002");
    await expect(page.locator("main")).not.toContainText("Downstairs LVP");

    await page.getByTestId("portal-nav-invoices").click();
    await expect(page.getByTestId("section-invoices")).toContainText("INV-2002");
    await expect(page.getByTestId("section-invoices")).toContainText("$13,969.92");
    // Isolation: Castellano's invoice never appears.
    await expect(page.locator("main")).not.toContainText("INV-2001");
    await expect(page.locator("main")).not.toContainText("Guest bath tile");

    await page.getByTestId("portal-nav-contracts").click();
    // The signed contract IS the approved estimate, signature shown.
    const contracts = page.getByTestId("section-contracts");
    await expect(contracts).toContainText("E-2001");
    await expect(contracts).toContainText("Joe Kane");

    guards.assertClean("dashboard grouping + isolation");
  });

  test("curated: a document row links out to the existing public token page", async ({ page }) => {
    const guards = watchPage(page);
    await signInAsKane(page);

    const inv = await q<{ id: string }>(`select id from crm_invoices where number = 'INV-2002' limit 1`);
    await page.getByTestId("portal-nav-invoices").click();
    await page.getByTestId(`client-invoice-${inv[0].id}`).click();
    await expect(page).toHaveURL(/\/i\//);
    // The existing public invoice page renders — approve/pay surface reused.
    await expect(page.getByText(/progress draw 1/)).toBeVisible({ timeout: 15_000 });

    guards.assertClean("document link → public token page");
  });

  test("curated: sign-out clears the session and returns to the request form", async ({ page }) => {
    const guards = watchPage(page);
    await signInAsKane(page);

    await page.getByTestId("button-client-logout").click();
    await expect(page.getByTestId("input-client-email")).toBeVisible({ timeout: 15_000 });

    // The session really is gone — a reload stays signed out.
    await gotoCrm(page, "/?client=1");
    await expect(page.getByTestId("input-client-email")).toBeVisible();

    guards.assertClean("client sign-out");
  });

  test("sweep: every button and link on the dashboard", async ({ page }) => {
    await signInAsKane(page);
    const { clicked, labels } = await sweepPage(page, "/?client=1", {
      // The portal root: section testids are per-view now, so no single one
      // is on the page at load (the home view is the default).
      ready: '[data-testid="client-portal-root"]',
    });
    console.log(`client dashboard sweep clicked ${clicked}: ${labels.join(" | ")}`);
    // Sign out (skipped by the sweep guard, curated above) plus the document
    // and needs-action links.
    expect(clicked).toBeGreaterThanOrEqual(3);
  });
});
