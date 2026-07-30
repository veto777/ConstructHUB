import { expect, test } from "@playwright/test";
import { ALPINE_ORG, deleteInvitation, makeInvitation } from "./db";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("/crm/join", () => {
  test("curated: missing token, bogus token, real invitation accept path", async ({ page }) => {
    const guards = watchPage(page);

    // No token: explains itself instead of crashing.
    await gotoCrm(page, "/crm/join");
    await expect(page.getByText("Missing invitation link")).toBeVisible();

    // Bogus token: lookup 404 renders the error state.
    await gotoCrm(page, "/crm/join?token=definitely-not-a-real-token");
    await expect(page.getByTestId("text-invite-error")).toBeVisible();

    // Real invitation: the page renders the invite and the accept button.
    // Accepting as the wrong signed-in user must fail gracefully with a toast,
    // not a crash or a 5xx.
    const email = `e2e-join-${Date.now().toString(36)}@example.com`;
    const token = await makeInvitation(ALPINE_ORG, email);
    try {
      await gotoCrm(page, `/crm/join?token=${token}`);
      await expect(page.getByText(email, { exact: true })).toBeVisible();
      await expect(page.getByText(/invited you to ConstructHub CRM/)).toBeVisible();
      await page.getByTestId("button-accept-invite").click();
      await expect(page.getByText("Could not accept", { exact: true })).toBeVisible();
    } finally {
      await deleteInvitation(token);
    }

    guards.assertClean("join curated");
  });

  test("sweep: every button and link (valid token)", async ({ page }) => {
    const email = `e2e-join-sweep-${Date.now().toString(36)}@example.com`;
    const token = await makeInvitation(ALPINE_ORG, email, "office");
    try {
      const { clicked, labels } = await sweepPage(page, `/crm/join?token=${token}`, {
        ready: "[data-testid=button-accept-invite]",
      });
      console.log(`join sweep clicked ${clicked}: ${labels.join(" | ")}`);
      expect(clicked).toBeGreaterThanOrEqual(9);
    } finally {
      await deleteInvitation(token);
    }
  });
});
