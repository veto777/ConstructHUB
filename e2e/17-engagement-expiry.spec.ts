import { expect, test } from "@playwright/test";
import { gotoCrm, grantClientSession, makeEstimate, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("engagement + expiry + print lockdown", () => {
  test("heartbeat pings accumulate duration; CRM row shows the visits", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId, token } = await makeEstimate(page);

    // Engagement only tracks live (sent) documents.
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();

    // The page is email-gated: open it as the verified client.
    await grantClientSession(page, [customerId]);

    // Loading the public page opens an engagement session on its own.
    const startPromise = page.waitForResponse((r) => r.url().includes("/api/public/engagement/start"));
    await gotoCrm(page, `/e/${token}`);
    const startResp = await startPromise;
    const { sessionId } = await startResp.json();
    expect(sessionId).toBeTruthy();

    // Short real pings (no fake timers): two ~1.4s gaps → ~2s accumulated.
    await page.waitForTimeout(1400);
    const p1 = await page.request.post("/api/public/engagement/ping", { data: { sessionId } });
    expect(p1.ok()).toBeTruthy();
    await page.waitForTimeout(1400);
    const p2 = await page.request.post("/api/public/engagement/ping", { data: { sessionId } });
    expect(p2.ok()).toBeTruthy();

    const eng = await page.request.get(`/api/crm/estimates/${estimateId}/engagement`);
    expect(eng.ok()).toBeTruthy();
    const summary = await eng.json();
    expect(summary.visits).toBeGreaterThanOrEqual(1);
    expect(summary.totalSecs).toBeGreaterThanOrEqual(2);
    // IPs never leave the CRM read endpoint unredacted.
    for (const s of summary.sessions) {
      if (s.ip) expect(s.ip).toMatch(/\/24|\/48/);
    }

    // The estimate row on the client page shows the engagement summary.
    await gotoCrm(page, `/crm/clients/${customerId}`);
    const row = page.getByTestId(`engagement-${estimateId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("visit");

    guards.assertClean("engagement pings");
  });

  test("expired estimate shows the contact page; extend makes it viewable again", async ({ page }) => {
    const { customerId, estimateId, token } = await makeEstimate(page);
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();
    // The 410 page sits behind the email gate too — browse as the client.
    await grantClientSession(page, [customerId]);

    // Push expiry into the past — the document must 410 with no content leak.
    // (No watchPage here: the 410 is the designed behaviour under test.)
    await q(`update crm_estimates set expires_at = now() - interval '1 day' where id = $1`, [estimateId]);
    await gotoCrm(page, `/e/${token}`);
    const notice = page.getByTestId("expired-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("This estimate expired on");
    await expect(notice).toContainText("for a fresh one");
    await expect(page.getByText("E2E line item")).not.toBeVisible();

    // Extend (+7 days) re-opens it.
    const ext = await page.request.post(`/api/crm/estimates/${estimateId}/extend`, { data: { days: 7 } });
    expect(ext.ok()).toBeTruthy();
    await gotoCrm(page, `/e/${token}`);
    await expect(page.getByText("E2E line item")).toBeVisible();
    await expect(page.getByTestId("input-signature")).toBeVisible();
  });

  test("print media hides the document and shows only the lockdown notice", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, token } = await makeEstimate(page);
    await grantClientSession(page, [customerId]);
    await gotoCrm(page, `/e/${token}`);
    await expect(page.getByTestId("input-signature")).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.locator("main")).toBeHidden();
    await expect(page.getByTestId("print-lockdown-notice")).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByTestId("input-signature")).toBeVisible();

    guards.assertClean("print lockdown");
  });
});
