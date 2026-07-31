import { expect, test, type Page } from "@playwright/test";
import { gotoCrm, ORGS, sweepPage, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

async function openTab(page: Page, testid: string) {
  await page.getByTestId(testid).click();
  await expect(page.getByTestId(testid)).toHaveAttribute("data-state", "active");
}

test.describe("/crm/team", () => {
  test("curated: profile save, company save, invite + revoke, member controls", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/team?tab=profile");
    await expect(page.locator("h1")).toContainText("Team & Company");

    // Profile: change the name and save.
    await openTab(page, "tab-profile");
    await page.getByTestId("input-profile-name").fill("E2E Owner Name");
    await page.getByTestId("input-profile-title").fill("General Manager");
    await page.getByTestId("input-profile-phone").fill("555-0100");
    await page.getByTestId("button-save-profile").click();
    await expect(page.getByText("Profile saved", { exact: true })).toBeVisible();

    // Saving advances onboarding, which may navigate away — go back explicitly.
    await gotoCrm(page, "/crm/team?tab=company");
    // Company: edit a field and save.
    await openTab(page, "tab-company");
    await page.getByTestId("input-org-phone").fill("555-0200");
    await page.getByTestId("button-save-org").click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();

    // Team: invite, then revoke the invitation.
    await gotoCrm(page, "/crm/team?tab=team");
    await openTab(page, "tab-team");
    const inviteBtn = page.getByTestId("button-send-invite");
    const email = `e2e-invite-${Date.now().toString(36)}@example.com`;
    await page.getByTestId("input-invite-email").fill(email);
    await page.getByTestId("select-invite-role").click();
    await page.getByRole("option", { name: "field" }).click();
    if (await inviteBtn.isEnabled()) {
      await inviteBtn.click();
      await expect(
        page.getByText("Invitation sent", { exact: true })
          .or(page.getByText("Invitation created", { exact: true })),
      ).toBeVisible();
      // Pending invitation appears; revoke it.
      const inviteRow = page.locator('[data-testid^="invite-"]', { hasText: email });
      await expect(inviteRow).toBeVisible();
      await inviteRow.locator("button").click();
      await expect(page.getByText("Invitation revoked", { exact: true })).toBeVisible();
      await expect(inviteRow).toHaveCount(0);
    } else {
      await expect(page.getByTestId("text-seat-limit")).toBeVisible();
    }

    // A non-owner member: role select, permission switch, cost rate all fire.
    const memberRow = page.locator('[data-testid^="member-"]', { hasNotText: "owner" }).first();
    await expect(memberRow).toBeVisible();
    const memberId = (await memberRow.getAttribute("data-testid"))!.replace("member-", "");
    const roleSelect = page.getByTestId(`select-role-${memberId}`);
    if (await roleSelect.isVisible().catch(() => false)) {
      // Idempotent: remember the current role, switch to any NON-owner option
      // (owner is the first option — picking it exhausts the non-owner pool
      // and breaks the next run), then restore the original.
      const originalRole = (await roleSelect.innerText()).trim();
      await roleSelect.click();
      await page.getByRole("option", { name: /field|office/i }).first().click();
      await expect(page.getByText("Team member updated", { exact: true })).toBeVisible();
      await roleSelect.click();
      await page.getByRole("option", { name: originalRole, exact: true }).first().click();
      await expect(page.getByText("Team member updated", { exact: true })).toBeVisible();
    }
    const permSwitch = page.locator(`[data-testid^="switch-"][data-testid$="-${memberId}"]`).first();
    if (await permSwitch.isVisible().catch(() => false)) {
      await permSwitch.click();
      await expect(page.getByText("Team member updated", { exact: true })).toBeVisible();
    }
    const costInput = page.getByTestId(`input-cost-${memberId}`);
    if (await costInput.isVisible().catch(() => false)) {
      await costInput.fill("45.00");
      await costInput.blur();
      await expect(page.getByText("Team member updated", { exact: true })).toBeVisible();
    }

    guards.assertClean("team curated");
  });

  for (const [tab, testid] of [["profile", "tab-profile"], ["company", "tab-company"], ["team", "tab-team"]] as const) {
    test(`sweep: every button and link (${tab} tab)`, async ({ page }) => {
      const { clicked } = await sweepPage(page, `/crm/team?tab=${tab}`, {
        ready: 'h1:has-text("Team & Company")',
        beforeEach: async (p) => openTab(p, testid),
      });
      console.log(`team ${tab} sweep clicked ${clicked}`);
      expect(clicked).toBeGreaterThanOrEqual(10);
    });
  }
});
