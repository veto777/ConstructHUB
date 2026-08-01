import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";
import { q, ASPIRE_ORG } from "./db";

/**
 * The pm (project manager) role: coordinates the work — jobs, estimates,
 * customers across the whole book — but is cost-blind. Two things pinned
 * here: the role is selectable everywhere roles render on the team page, and
 * cost data is hidden for a pm both server-side (presentMember strips
 * hourlyCostCents, following the same redaction pattern as the estimate
 * presenters) and in the UI (the cost-rate inputs are gated on seeCosts).
 *
 * Uses the divisions spec's trick: temporarily re-role the dev-bypass user's
 * membership via SQL, exercise the API/UI, restore the owner seat in a
 * finally block. Throwaway dev DB only.
 */
test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("pm role", () => {
  test("pm is selectable in the invite form and member role selects", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/team?tab=team");
    await expect(page.locator("h1")).toContainText("Team & Company");

    // Invite form role select offers pm.
    await page.getByTestId("select-invite-role").click();
    await expect(page.getByRole("option", { name: "pm", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // A non-owner member's role select offers pm too.
    const memberRow = page.locator('[data-testid^="member-"]', { hasNotText: "owner" }).first();
    await expect(memberRow).toBeVisible();
    const memberId = (await memberRow.getAttribute("data-testid"))!.replace("member-", "");
    await page.getByTestId(`select-role-${memberId}`).click();
    await expect(page.getByRole("option", { name: "pm", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    guards.assertClean("pm selectable");
  });

  test("a pm never sees cost data — redacted server-side, gated in the UI", async ({ page }) => {
    const guards = watchPage(page);
    try {
      await q(`update crm_members set role = 'pm' where org_id = $1 and user_id = 1`, [ASPIRE_ORG]);

      // The role boot delivers pm defaults: prices on, costs off.
      const me = await (await page.request.get("/api/crm/me")).json();
      expect(me.member.role).toBe("pm");
      expect(me.permissions.seePrices).toBe(true);
      expect(me.permissions.seeCosts).toBe(false);
      expect(me.permissions.manageJobs).toBe(true);
      expect(me.permissions.manageTeam).toBe(false);

      // presentMember strips hourlyCostCents for anyone without seeCosts.
      const { members } = await (await page.request.get("/api/crm/members")).json();
      expect(members.length).toBeGreaterThan(0);
      for (const m of members) {
        expect(m.hourlyCostCents, `hourlyCostCents leaked for ${m.email}`).toBeUndefined();
      }

      // The team page renders — but not a single cost-rate input.
      await gotoCrm(page, "/crm/team?tab=team");
      await expect(page.locator("h1")).toContainText("Team & Company");
      await expect(page.locator('[data-testid^="input-cost-"]')).toHaveCount(0);

      // The pm's own role pill renders on the profile tab.
      await gotoCrm(page, "/crm/team?tab=profile");
      await expect(page.getByTestId("badge-my-role")).toContainText("pm");
    } finally {
      // ALWAYS restore the dev user's owner membership — every other suite
      // depends on it.
      await q(`update crm_members set role = 'owner', division_id = null where org_id = $1 and user_id = 1`, [ASPIRE_ORG]);
    }

    // Restored: cost data flows to the owner again.
    const me = await (await page.request.get("/api/crm/me")).json();
    expect(me.member.role).toBe("owner");
    expect(me.permissions.seeCosts).toBe(true);

    guards.assertClean("pm cost redaction");
  });
});
