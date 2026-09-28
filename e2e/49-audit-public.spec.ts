import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

test("public change order: sign, reload, and refuse a second response", async ({ page }) => {
  await switchOrg(page, ORGS.alpine);
  const guards = watchPage(page);
  const customer = await (await page.request.post("/api/crm/customers", { data: { displayName: "Audit public CO", email: "audit-co@example.invalid" } })).json();
  const project = await (await page.request.post("/api/crm/projects", { data: { customerId: customer.id, name: "Audit change order project" } })).json();
  let co: any;
  try {
    const created = await page.request.post(`/api/crm/projects/${project.id}/change-orders`, { data: { title: "Additional trim", amountCents: 12345, scheduleImpactDays: 2 } });
    expect(created.status()).toBe(201);
    co = await created.json();
    await gotoCrm(page, co.publicPath);
    await expect(page.getByTestId("doc-total")).toHaveText("$123.45");
    await page.getByLabel("Your full name").fill("Audit Homeowner");
    await page.getByRole("button", { name: /Approve/ }).click();
    await expect(page.getByText("Change order approved — thank you!")).toBeVisible();
    await expect(page.getByText("Your response has been recorded.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Change order approved — thank you!")).toBeVisible();
    guards.assertClean("public change order");
    const token = co.publicPath.split("/").pop();
    expect((await page.request.post(`/api/public/change-orders/${token}/respond`, { data: { decision: "decline" } })).status()).toBe(409);
  } finally {
    if (co?.id) await q("delete from crm_change_orders where id=$1", [co.id]);
    await q("delete from crm_projects where id=$1", [project.id]);
    await q("delete from crm_customers where id=$1", [customer.id]);
  }
});

for (const path of ["/crm-terms", "/crm-privacy"]) {
  test(`legal page ${path} renders on mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = watchPage(page);
    await gotoCrm(page, path);
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.locator("body").innerText()).toMatch(/ConstructHub|ConstructHUB/);
    guards.assertClean(path);
  });
}
