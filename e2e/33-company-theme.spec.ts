import { expect, test } from "@playwright/test";
import { gotoCrm, grantClientSession, makeEstimate, ORGS, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

// The owner picks one of 20 theme accents in Settings; client-facing
// documents render black + that accent. Picked green → the gated public
// estimate page's --primary IS green. The theme is restored to the brand
// orange in a finally block no matter how the assertions land.
test.describe("company theme colour", () => {
  test("curated: pick green → public estimate accent turns green → restore orange", async ({ page }) => {
    const guards = watchPage(page);
    try {
      // Settings: the swatch grid renders all 20 presets; click Green.
      await gotoCrm(page, "/crm/settings");
      const grid = page.getByTestId("theme-swatch-grid");
      await expect(grid).toBeVisible();
      expect(await grid.locator("button").count()).toBe(20);

      await page.getByTestId("theme-swatch-green").click();
      await expect(page.getByText("Theme saved", { exact: true })).toBeVisible();
      await expect(page.getByTestId("theme-swatch-green")).toHaveAttribute("aria-pressed", "true");

      // The live preview strip follows the pick: black band + green accents.
      await expect(page.getByTestId("theme-preview-name")).toHaveCSS("color", "rgb(22, 163, 74)");
      await expect(page.getByTestId("theme-preview-button")).toHaveCSS("background-color", "rgb(22, 163, 74)");

      // The pick survives a reload (it persists on the org).
      await gotoCrm(page, "/crm/settings");
      await expect(page.getByTestId("theme-swatch-green")).toHaveAttribute("aria-pressed", "true");

      // A gated public estimate page re-points its accent at green: the
      // --primary variable on the page root, and the letterhead accent line.
      const { customerId, token } = await makeEstimate(page);
      await grantClientSession(page, [customerId]);
      await gotoCrm(page, `/e/${token}`);
      await expect(page.getByTestId("estimate-document")).toBeVisible();

      const primary = await page.getByTestId("public-estimate-root").evaluate(
        (el) => getComputedStyle(el).getPropertyValue("--primary").trim(),
      );
      expect(primary).toBe("142 76% 36%"); // #16A34A
      // The letterhead accent line uses the exact server hex (no hsl drift);
      // the --primary-driven text/buttons sit within ±1 of it by design.
      await expect(page.getByTestId("letterhead-accent")).toHaveCSS("background-color", "rgb(22, 163, 74)");
    } finally {
      // Restore the brand orange through the UI's own API, whatever happened.
      const r = await page.request.patch("/api/crm/org", { data: { themeColor: "orange" } });
      if (!r.ok()) throw new Error(`theme restore failed: ${r.status()} ${await r.text()}`);
    }
    guards.assertClean("company theme");
  });
});
