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

    // Team: invite, resend, reset-password, revoke — then a second invite to
    // cover the trash-button revoke path.
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

      // Pending invitation appears; resend it (SMTP failure is fine — the API
      // answers 200 with emailed:false either way).
      const inviteRow = page.locator('[data-testid^="invite-"]', { hasText: email });
      await expect(inviteRow).toBeVisible();
      const inviteId = (await inviteRow.getAttribute("data-testid"))!.replace("invite-", "");
      await page.getByTestId(`button-resend-invite-${inviteId}`).click();
      await expect(page.getByText("Invitation resent", { exact: true })).toBeVisible();

      // The invited member has a placeholder row; fire the password reset.
      const invitedMemberRow = page.locator('[data-testid^="member-"]', { hasText: email });
      await expect(invitedMemberRow).toBeVisible();
      const invitedMemberId = (await invitedMemberRow.getAttribute("data-testid"))!.replace("member-", "");
      await page.getByTestId(`button-reset-password-${invitedMemberId}`).click();
      await expect(
        page.getByText("Password reset email sent", { exact: true })
          .or(page.getByText("Couldn't send the reset email", { exact: true })),
      ).toBeVisible();

      // Revoke access from the member row — this also kills the pending invite.
      await page.getByTestId(`button-remove-${invitedMemberId}`).click();
      await expect(page.getByText("Team member deactivated", { exact: true })).toBeVisible();
      await expect(inviteRow).toHaveCount(0);

      // Second invite (the seat was released above) to cover trash-button revoke.
      const email2 = `e2e-invite2-${Date.now().toString(36)}@example.com`;
      await page.getByTestId("input-invite-email").fill(email2);
      await page.getByTestId("select-invite-role").click();
      await page.getByRole("option", { name: "field" }).click();
      await inviteBtn.click();
      await expect(
        page.getByText("Invitation sent", { exact: true })
          .or(page.getByText("Invitation created", { exact: true })),
      ).toBeVisible();
      const inviteRow2 = page.locator('[data-testid^="invite-"]', { hasText: email2 });
      await expect(inviteRow2).toBeVisible();
      await inviteRow2.getByTestId(/^button-revoke-/).click();
      await expect(page.getByText("Invitation revoked", { exact: true })).toBeVisible();
      await expect(inviteRow2).toHaveCount(0);
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

    // Owner audit view: my own row's activity dropdown opens and shows fresh
    // entries — the profile save and member edits this test just made are in
    // the accountability log. Read-only: nothing here needs restoring.
    const meJson = await (await page.request.get("/api/crm/me")).json();
    const myMemberId = meJson.member.id as string;
    await page.getByTestId(`button-activity-${myMemberId}`).click();
    const firstActivity = page.locator('[data-testid^="row-activity-"]').first();
    await expect(firstActivity).toBeVisible();
    await expect(firstActivity).toContainText("updated");

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
