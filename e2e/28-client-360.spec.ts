import { expect, test } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, grantClientSession, ORGS, switchOrg, watchPage, E2E_BASE_URL } from "./helpers";

/**
 * Client 360 (B4): contractor notes on the client detail page, the unified
 * activity timeline (seeded engagement row), the portal's financing section
 * with click tracking, and "see what the client sees" — the read-only
 * contractor portal preview with its banner and write refusal.
 *
 * Fixtures are throwaway customers/estimates in the Alpine org, cleaned up at
 * the end of each test so the seeded demo (and other specs' sweeps) never
 * sees them. The org's financing links are saved and restored around the
 * financing test.
 */

async function makeCustomer(page: any, name: string): Promise<string> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const r = await page.request.post("/api/crm/customers", {
    data: { displayName: `${name} ${stamp}`, email: `e2e-c360-${stamp}@example.com` },
  });
  if (!r.ok()) throw new Error(`create customer: ${r.status()} ${await r.text()}`);
  return (await r.json()).id;
}

async function makeSentEstimate(page: any, customerId: string): Promise<{ id: string; number: string }> {
  const r = await page.request.post("/api/crm/estimates", {
    data: {
      customerId,
      title: "E2E C360 estimate",
      taxRateBps: 0,
      items: [{
        kind: "labor", name: "E2E line item", description: null, unit: null,
        quantityMilli: 1000, unitPriceCents: 123_45,
        taxable: true, hiddenFromClient: false, sortOrder: 0,
      }],
    },
  });
  if (!r.ok()) throw new Error(`create estimate: ${r.status()} ${await r.text()}`);
  const id = (await r.json()).id;
  const sent = await page.request.post(`/api/crm/estimates/${id}/send`, { data: {} });
  if (!sent.ok()) throw new Error(`send estimate: ${sent.status()} ${await sent.text()}`);
  const rows = await q<{ number: string }>(`select number from crm_estimates where id = $1`, [id]);
  return { id, number: rows[0].number };
}

async function cleanupCustomer(customerId: string) {
  await q(`delete from crm_customer_notes where customer_id = $1`, [customerId]);
  await q(`delete from crm_finance_clicks where customer_id = $1`, [customerId]);
  await q(`delete from crm_client_comments where customer_id = $1`, [customerId]);
  await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%'`, [customerId]);
  await q(
    `delete from crm_engagement_sessions where doc_id in (select id from crm_estimates where customer_id = $1)`,
    [customerId],
  );
  await q(
    `delete from crm_estimate_events where estimate_id in (select id from crm_estimates where customer_id = $1)`,
    [customerId],
  );
  await q(
    `delete from crm_estimate_items where estimate_id in (select id from crm_estimates where customer_id = $1)`,
    [customerId],
  );
  await q(`delete from crm_estimates where customer_id = $1`, [customerId]);
  await q(`delete from crm_customers where id = $1`, [customerId]);
}

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("client 360 — notes", () => {
  test("add a note on the client detail page → listed with author and time", async ({ page }) => {
    const guards = watchPage(page);
    const customerId = await makeCustomer(page, "E2E Notes");
    try {
      await gotoCrm(page, `/crm/clients/${customerId}`);
      const notes = page.getByTestId("section-notes");
      await expect(notes).toBeVisible({ timeout: 15_000 });
      await expect(notes).toContainText("No notes yet");

      await page.getByTestId("input-note-body").fill("Gate code 4482 — dog on site");
      await page.getByTestId("button-add-note").click();

      await expect(notes).toContainText("Gate code 4482 — dog on site", { timeout: 10_000 });
      // Author + timestamp render under the note.
      await expect(notes).toContainText("Dev Owner");

      // The server row exists, authored by the dev member.
      const rows = await q<{ body: string; author_member_id: string }>(
        `select body, author_member_id from crm_customer_notes where customer_id = $1`, [customerId]);
      expect(rows.length).toBe(1);
      expect(rows[0].author_member_id).toBeTruthy();

      guards.assertClean("notes flow");
    } finally {
      await cleanupCustomer(customerId);
    }
  });
});

test.describe("client 360 — timeline", () => {
  test("timeline shows a seeded engagement row with the dwell time", async ({ page }) => {
    const guards = watchPage(page);
    const customerId = await makeCustomer(page, "E2E Timeline");
    try {
      const est = await makeSentEstimate(page, customerId);
      // A dwell session, exactly as the heartbeat flow would have written.
      await q(
        `insert into crm_engagement_sessions (org_id, doc_type, doc_id, started_at, last_ping_at, duration_secs)
         values ($1, 'estimate', $2, now() - interval '8 minutes', now() - interval '4 minutes', 252)`,
        [ORGS.alpine, est.id],
      );

      await gotoCrm(page, `/crm/clients/${customerId}`);
      const timeline = page.getByTestId("section-timeline");
      await expect(timeline).toBeVisible({ timeout: 15_000 });
      await expect(timeline).toContainText(`Opened estimate ${est.number} · stayed 4m 12s`);
      // …and the send event from the real flow sits in the same feed.
      await expect(timeline).toContainText(`Estimate ${est.number} sent to the client`);

      guards.assertClean("timeline flow");
    } finally {
      await cleanupCustomer(customerId);
    }
  });
});

test.describe("client 360 — financing", () => {
  test("portal financing tab renders, and a click is recorded before the link opens", async ({ page }) => {
    const guards = watchPage(page);
    const customerId = await makeCustomer(page, "E2E Finance");
    const saved = await q<{ custom_fields: any }>(`select custom_fields from crm_orgs where id = $1`, [ORGS.alpine]);
    const original = saved[0]?.custom_fields ?? null;
    const setLinks = (links: any) =>
      q(`update crm_orgs set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{financingLinks}', $1::jsonb) where id = $2`,
        [JSON.stringify(links), ORGS.alpine]);

    try {
      await grantClientSession(page, [customerId]);

      // No links configured → the honest empty state, not a dead tab.
      await setLinks([]);
      await gotoCrm(page, "/?client=1");
      const section = page.getByTestId("section-financing");
      await expect(section).toBeVisible({ timeout: 15_000 });
      await expect(section).toContainText("No financing options yet");

      // One primary link → renders; clicking records, THEN opens the lender.
      await setLinks([{ label: "Acme Finance", url: `${E2E_BASE_URL}/e2e-finance-target`, primary: true }]);
      await gotoCrm(page, "/?client=1");
      await expect(section).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("financing-link-0")).toContainText("Acme Finance");

      const [popup] = await Promise.all([
        page.waitForEvent("popup", { timeout: 15_000 }),
        page.getByTestId("button-financing-0").click(),
      ]);
      await popup.close();

      // Recorded on the customer, attributed to the link label.
      await expect
        .poll(async () => (await q(`select label from crm_finance_clicks where customer_id = $1`, [customerId])).length)
        .toBe(1);
      const rows = await q<{ label: string }>(`select label from crm_finance_clicks where customer_id = $1`, [customerId]);
      expect(rows[0].label).toBe("Acme Finance");

      // …and the click is on the contractor's timeline for this client.
      await gotoCrm(page, `/crm/clients/${customerId}`);
      await expect(page.getByTestId("section-timeline")).toContainText("Applied for financing via Acme Finance", { timeout: 15_000 });

      guards.assertClean("financing flow");
    } finally {
      await q(`update crm_orgs set custom_fields = $1::jsonb where id = $2`,
        [original === null ? null : JSON.stringify(original), ORGS.alpine]);
      await cleanupCustomer(customerId);
    }
  });
});

test.describe("client 360 — view as client", () => {
  test("contractor preview opens the portal read-only: banner shows, comment post is refused", async ({ page }) => {
    const guards = watchPage(page);
    const customerId = await makeCustomer(page, "E2E Preview");
    try {
      await gotoCrm(page, `/crm/clients/${customerId}`);
      await expect(page.getByTestId("button-view-as-client")).toBeVisible({ timeout: 15_000 });

      const [popup] = await Promise.all([
        page.waitForEvent("popup", { timeout: 15_000 }),
        page.getByTestId("button-view-as-client").click(),
      ]);

      try {
        // The portal loads AS the customer, under the read-only banner.
        await expect(popup.getByTestId("banner-contractor-preview")).toBeVisible({ timeout: 20_000 });
        await expect(popup.getByTestId("text-org-name")).toBeVisible();

        // A comment post refuses with a clear toast — and writes nothing.
        await popup.getByTestId("input-client-comment").fill("Preview must not post this");
        await popup.getByTestId("button-send-comment").click();
        await expect(popup.getByText(/read-only — sign in as the client/i)).toBeVisible({ timeout: 10_000 });
        const rows = await q(`select id from crm_client_comments where customer_id = $1`, [customerId]);
        expect(rows.length).toBe(0);
      } finally {
        await popup.close();
      }

      guards.assertClean("view-as-client flow");
    } finally {
      await cleanupCustomer(customerId);
    }
  });
});
