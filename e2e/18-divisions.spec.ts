import { expect, test } from "@playwright/test";
import { gotoCrm, grantClientSession, ORGS, switchOrg, watchPage } from "./helpers";
import { q, ASPIRE_ORG } from "./db";

/**
 * Multi-division support: the owner runs a WA headquarters and a FL division
 * of one company. Covers the settings CRUD card, document branding (a Florida
 * estimate must never carry the WA HQ address), division list-scoping for
 * scoped members, and the team page's per-member division select.
 */
test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

async function divisionsByCode(page: any) {
  const r = await page.request.get("/api/crm/divisions");
  if (!r.ok()) throw new Error(`GET divisions: ${r.status()}`);
  const rows = (await r.json()) as { id: string; code: string }[];
  return new Map(rows.map((d) => [d.code, d.id]));
}

test.describe("divisions", () => {
  test("settings card: create, edit, set HQ", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = Date.now().toString(36).slice(-6);
    await gotoCrm(page, "/crm/settings");
    await expect(page.getByTestId("card-divisions")).toBeVisible();
    // Seeded reality: WA HQ + FL already exist.
    await expect(page.getByText("Aspire Interiors — Washington")).toBeVisible();
    await expect(page.getByText("Aspire Interiors — Florida")).toBeVisible();

    // Create a third division through the form.
    await page.getByTestId("input-division-name").fill(`E2E Division ${stamp}`);
    await page.getByTestId("input-division-code").fill(`E${stamp}`.slice(0, 20));
    await page.getByTestId("input-division-address1").fill("1 E2E Plaza");
    await page.getByTestId("input-division-city").fill("Tampa");
    await page.getByTestId("input-division-state").fill("FL");
    await page.getByTestId("input-division-postal").fill("33602");
    await page.getByTestId("input-division-license-number").fill("E2ELIC99");
    await page.getByTestId("input-division-license-state").fill("FL");
    await page.getByTestId("button-save-division").click();
    await expect(page.getByText("Division created", { exact: true })).toBeVisible();

    const codeMap = await divisionsByCode(page);
    const newId = codeMap.get(`E${stamp}`.slice(0, 20));
    expect(newId).toBeTruthy();
    const row = page.getByTestId(`row-division-${newId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("1 E2E Plaza, Tampa, FL");
    await expect(row).toContainText("License E2ELIC99 (FL)");

    // Edit: change the city; it must persist on the row.
    await page.getByTestId(`button-edit-division-${newId}`).click();
    await page.getByTestId("input-division-city").fill("St. Petersburg");
    await page.getByTestId("button-save-division").click();
    await expect(page.getByText("Division updated", { exact: true })).toBeVisible();
    await expect(row).toContainText("St. Petersburg");

    // Set it as HQ (single-winner), then hand HQ back to Washington so the
    // seeded reality is intact for the next suite run.
    await page.getByTestId(`button-set-hq-${newId}`).click();
    await expect(page.getByText("Headquarters updated", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`pill-hq-${newId}`)).toBeVisible();
    const waId = codeMap.get("WA");
    await page.getByTestId(`button-set-hq-${waId}`).click();
    await expect(page.getByTestId(`pill-hq-${waId}`)).toBeVisible();

    guards.assertClean("divisions settings card");
  });

  test("a Florida project's public estimate carries the FL letterhead — never the WA HQ", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = Date.now().toString(36);

    // A division with a distinctive address, a project inside it, an estimate
    // on that project — all through the real API.
    const div = await page.request.post("/api/crm/divisions", {
      data: {
        name: `E2E Gulf Coast ${stamp}`, code: `G${stamp}`.slice(0, 20),
        addressLine1: "9 E2E Blvd", city: "Tampa", state: "FL", postalCode: "33602",
        licenseNumber: "GULF123", licenseState: "FL",
      },
    });
    expect(div.ok()).toBeTruthy();
    const division = await div.json();

    const cust = await page.request.post("/api/crm/customers", {
      data: { displayName: `E2E Div Client ${stamp}`, email: `e2e-div-${stamp}@example.com` },
    });
    const customer = await cust.json();
    const proj = await page.request.post("/api/crm/projects", {
      data: { customerId: customer.id, name: `E2E division project ${stamp}`, divisionId: division.id },
    });
    expect(proj.ok()).toBeTruthy();
    const project = await proj.json();
    expect(project.divisionId).toBe(division.id);

    const est = await page.request.post("/api/crm/estimates", {
      data: {
        customerId: customer.id, projectId: project.id, title: "E2E division estimate",
        items: [{ kind: "labor", name: "E2E line", quantityMilli: 1000, unitPriceCents: 50000, taxable: true }],
      },
    });
    const estimate = await est.json();
    const [{ public_token: token }] = await q<{ public_token: string }>(
      `select public_token from crm_estimates where id = $1`, [estimate.id],
    );

    await grantClientSession(page, [customer.id]); // the public page is email-gated
    await gotoCrm(page, `/e/${token}`);
    await expect(page.locator("h1")).toContainText(`E2E Gulf Coast ${stamp}`);
    const addr = page.getByTestId("text-company-address");
    await expect(addr).toBeVisible();
    await expect(addr).toContainText("9 E2E Blvd");
    await expect(addr).toContainText("Tampa, FL 33602");
    await expect(page.getByText("License GULF123 (FL)")).toBeVisible();
    // The WA headquarters address must appear NOWHERE on Florida work.
    await expect(page.getByText(/Bellingham/)).toHaveCount(0);
    await expect(page.getByText(/Meridian St/)).toHaveCount(0);

    guards.assertClean("division estimate branding");
  });

  test("a WA-scoped admin sees ONLY WA work — FL and unassigned rows vanish; the owner sees all", async ({ page }) => {
    const stamp = Date.now().toString(36);
    const codeMap = await divisionsByCode(page);
    const waId = codeMap.get("WA")!;
    const flId = codeMap.get("FL")!;

    // One throwaway project per division, plus one with NO division (the
    // unassigned commons — under STRICT scoping a scoped member loses these).
    const mk = async (divisionId: string | null, tag: string) => {
      const cust = await page.request.post("/api/crm/customers", {
        data: { displayName: `E2E scope ${tag} ${stamp}`, email: `e2e-scope-${tag}-${stamp}@example.com` },
      });
      const customer = await cust.json();
      const proj = await page.request.post("/api/crm/projects", {
        data: { customerId: customer.id, name: `E2E scope ${tag} ${stamp}`, ...(divisionId ? { divisionId } : {}) },
      });
      const project = await proj.json();
      const est = await page.request.post("/api/crm/estimates", {
        data: {
          customerId: customer.id, projectId: project.id,
          items: [{ kind: "labor", name: "L", quantityMilli: 1000, unitPriceCents: 1000, taxable: true }],
        },
      });
      return { projectId: project.id as string, estimateId: (await est.json()).id as string };
    };
    const wa = await mk(waId, "wa");
    const fl = await mk(flId, "fl");
    const unassigned = await mk(null, "unassigned");

    // As the owner, all three are visible.
    const before = await page.request.get("/api/crm/projects");
    const beforeIds = (await before.json()).projects.map((p: any) => p.id);
    expect(beforeIds).toContain(wa.projectId);
    expect(beforeIds).toContain(fl.projectId);
    expect(beforeIds).toContain(unassigned.projectId);

    // Flip the dev user's Aspire membership to a WA-scoped admin, exercise the
    // lists, and ALWAYS restore the owner seat.
    try {
      await q(`update crm_members set role = 'admin', division_id = $1 where org_id = $2 and user_id = 1`, [waId, ASPIRE_ORG]);

      const projects = await page.request.get("/api/crm/projects");
      const projIds = (await projects.json()).projects.map((p: any) => p.id);
      expect(projIds).toContain(wa.projectId);
      expect(projIds).not.toContain(fl.projectId);
      expect(projIds).not.toContain(unassigned.projectId); // STRICT: commons are not shared

      const estimates = await page.request.get("/api/crm/estimates");
      const estIds = (await estimates.json()).map((e: any) => e.id);
      expect(estIds).toContain(wa.estimateId);
      expect(estIds).not.toContain(fl.estimateId);
      expect(estIds).not.toContain(unassigned.estimateId);
    } finally {
      await q(`update crm_members set role = 'owner', division_id = null where org_id = $1 and user_id = 1`, [ASPIRE_ORG]);
    }

    // Restored: the owner sees both again.
    const after = await page.request.get("/api/crm/projects");
    const afterIds = (await after.json()).projects.map((p: any) => p.id);
    expect(afterIds).toContain(fl.projectId);
    expect(afterIds).toContain(unassigned.projectId);
  });

  test("team page: a member's division select persists", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/team?tab=team");
    await expect(page.locator("h1")).toContainText("Team & Company");

    const memberRow = page.locator('[data-testid^="member-"]', { hasNotText: "owner" }).first();
    await expect(memberRow).toBeVisible();
    const memberId = (await memberRow.getAttribute("data-testid"))!.replace("member-", "");
    const select = page.getByTestId(`select-division-${memberId}`);
    await expect(select).toBeVisible();

    await select.click();
    await page.getByRole("option", { name: /Florida \(FL\)/ }).click();
    await expect(page.getByText("Team member updated", { exact: true })).toBeVisible();

    // Survives a reload…
    await gotoCrm(page, "/crm/team?tab=team");
    await expect(page.getByTestId(`select-division-${memberId}`)).toContainText("Florida");

    // …and restore "All divisions" so no suite inherits a scoped member.
    await page.getByTestId(`select-division-${memberId}`).click();
    await page.getByRole("option", { name: "All divisions" }).click();
    await expect(page.getByText("Team member updated", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`select-division-${memberId}`)).toContainText("All divisions");

    guards.assertClean("team division select");
  });
});
