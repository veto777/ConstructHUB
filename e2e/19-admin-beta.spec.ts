import { expect, test } from "@playwright/test";
import { gotoCrm, watchPage } from "./helpers";
import { q } from "./db";

/**
 * Platform admin console + CRM beta invites.
 *
 * The dev-bypass user (dev@constructhub.local) is a platform admin only while
 * DEV_AUTH_BYPASS_USER1 is on (server/admin.ts), which is exactly how this
 * suite runs — so the non-admin paths are covered by temporarily pointing
 * user 1's email at a non-admin address and restoring it in a finally block.
 */

const DEV_EMAIL = "dev@constructhub.local";

// @serial: temporarily points user 1's email at a non-admin address (admin
// status is email-derived) — must not overlap specs that assume the dev
// bypass user is an admin.
test.describe("platform admin console", { tag: "@serial" }, () => {
  test("renders overview, users, orgs and the org detail drawer", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/admin");

    // Overview metric cards.
    await expect(page.getByTestId("section-overview")).toBeVisible();
    await expect(page.getByTestId("metric-users")).toBeVisible();
    await expect(page.getByTestId("metric-orgs")).toBeVisible();
    await expect(page.getByTestId("metric-payments")).toBeVisible();

    // Users table: the dev account is listed, and search filters.
    await expect(page.getByTestId("table-users")).toBeVisible();
    await expect(page.getByTestId("table-users")).toContainText(DEV_EMAIL);
    await page.getByTestId("input-user-search").fill(DEV_EMAIL);
    await expect(page.getByTestId("table-users")).toContainText(DEV_EMAIL);
    await expect(page.getByTestId("table-users")).not.toContainText("tech@example.com");
    await page.getByTestId("input-user-search").fill("nobody-matches-this");
    await expect(page.getByText("No users found")).toBeVisible();
    await page.getByTestId("input-user-search").fill("");

    // Orgs table: seeded orgs with counts; clicking a row opens the drawer.
    await expect(page.getByTestId("table-orgs")).toBeVisible();
    await expect(page.getByTestId("table-orgs")).toContainText("Aspire Interiors");
    await page.getByTestId("table-orgs").locator("tr", { hasText: "Aspire Interiors" }).first().click();
    await expect(page.getByTestId("sheet-org-detail")).toBeVisible();
    await expect(page.getByTestId("text-org-seats")).toBeVisible();
    await expect(page.getByTestId("sheet-org-detail")).toContainText("Members");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet-org-detail")).not.toBeVisible();

    // Sidebar shows the gated nav item for an admin.
    await expect(page.getByTestId("link-portal-nav-admin")).toBeVisible();

    guards.assertClean("admin console");
  });

  test("non-admin gets 403 and no nav item", async ({ page }) => {
    const guards = watchPage(page);
    await q(`update users set email = $1 where id = 1`, ["e2e-not-admin@example.com"]);
    try {
      // The API itself refuses (designed 403 — allowlisted in helpers).
      const r = await page.request.get("/api/admin/overview");
      expect(r.status()).toBe(403);

      await gotoCrm(page, "/crm/admin");
      await expect(page.getByText("Platform admins only")).toBeVisible();
      await expect(page.getByTestId("section-overview")).not.toBeVisible();

      // …and the sidebar never offers the console.
      await expect(page.getByTestId("link-portal-nav-admin")).not.toBeVisible();

      guards.assertClean("non-admin");
    } finally {
      await q(`update users set email = $1 where id = 1`, [DEV_EMAIL]);
    }
  });
});

test.describe("beta invites", { tag: "@serial" }, () => {
  test("create in the UI, accept at signup, unlimited seats", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `e2e-beta-${stamp}@example.com`;

    await gotoCrm(page, "/crm/admin");
    await expect(page.getByTestId("card-beta-invites")).toBeVisible();

    // Create through the UI; capture the API response to read the one-time link.
    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/admin/beta-invites") && r.request().method() === "POST"),
      (async () => {
        await page.getByTestId("input-beta-email").fill(email);
        await page.getByTestId("button-send-beta-invite").click();
      })(),
    ]);
    expect(createRes.status()).toBe(201);
    const { link } = await createRes.json();
    const token = new URL(link).searchParams.get("beta");
    expect(token).toBeTruthy();

    // The invite is listed as pending.
    await expect(page.getByTestId("table-beta-invites")).toContainText(email);
    await expect(
      page.getByTestId("table-beta-invites").locator("tr", { hasText: email }),
    ).toContainText("pending");

    // Accept: a NEW account signs up carrying the token.
    const signup = await page.request.post("/api/auth/signup", {
      data: { email, password: "betapassword1", displayName: "E2E Beta", beta: token },
    });
    expect(signup.status()).toBe(200);
    const flagged = await q<{ beta_at: Date | null }>(`select beta_at from users where email = $1`, [email]);
    expect(flagged[0]?.beta_at).toBeTruthy();

    // Sign in as the beta account (verify email first — the dev mailbox isn't
    // real) and see the unlimited seat count on the team page.
    await q(`update users set email_verified = true where email = $1`, [email]);
    const login = await page.request.post("/api/auth/login", { data: { email, password: "betapassword1" } });
    expect(login.status()).toBe(200);

    await gotoCrm(page, "/crm/team?tab=team");
    await expect(page.getByTestId("badge-seats")).toBeVisible();
    await expect(page.getByTestId("badge-seats")).toContainText("unlimited");

    // And /api/crm/me reports the beta plan straight up.
    const me = await (await page.request.get("/api/crm/me")).json();
    expect(me.seats.plan).toBe("beta");
    expect(me.seats.limit).toBe(-1);

    // Hand the browser back to the dev-bypass user and clean up the account.
    await page.request.post("/api/auth/logout", {});
    await q(`delete from crm_members where user_id in (select id from users where email = $1)`, [email]);
    await q(`delete from crm_orgs where owner_user_id in (select id from users where email = $1)`, [email]);
    await q(`delete from users where email = $1`, [email]);
    await q(`delete from crm_beta_invites where email = $1`, [email]);

    guards.assertClean("beta invite flow");
  });

  test("the invite list shows accepted status after acceptance", async ({ page }) => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `e2e-beta-status-${stamp}@example.com`;

    const create = await page.request.post("/api/admin/beta-invites", { data: { email } });
    expect(create.status()).toBe(201);
    const { link } = await create.json();
    const token = new URL(link).searchParams.get("beta")!;

    await page.request.post("/api/auth/signup", {
      data: { email, password: "betapassword1", beta: token },
    });

    await gotoCrm(page, "/crm/admin");
    await expect(
      page.getByTestId("table-beta-invites").locator("tr", { hasText: email }),
    ).toContainText("accepted");

    await q(`delete from crm_members where user_id in (select id from users where email = $1)`, [email]);
    await q(`delete from crm_orgs where owner_user_id in (select id from users where email = $1)`, [email]);
    await q(`delete from users where email = $1`, [email]);
    await q(`delete from crm_beta_invites where email = $1`, [email]);
  });
});
