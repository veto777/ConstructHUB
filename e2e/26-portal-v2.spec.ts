import { expect, test, request as pwRequest } from "@playwright/test";
import { q } from "./db";
import { gotoCrm, grantClientSession, makeEstimate, ORGS, switchOrg, watchPage, E2E_BASE_URL } from "./helpers";

/**
 * Client portal v2 (B3): org pamphlets in the portal's "From <company>"
 * shelf, files pinned to estimates surfacing on the email-gated public page,
 * homeowner photo uploads landing on the contractor's client detail, and
 * portal comments reaching the contractor with mark-read. Everything is
 * session-scoped — cross-customer writes/reads are rejected, never re-scoped.
 *
 * Fixtures are throwaway customers/estimates in the Alpine org, cleaned up at
 * the end of each test so the seeded demo (and other specs' sweeps) never
 * sees them.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4 e2e portal-v2 fixture");

async function makeCustomer(page: any, name: string): Promise<string> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const r = await page.request.post("/api/crm/customers", {
    data: { displayName: `${name} ${stamp}`, email: `e2e-pv2-${stamp}@example.com` },
  });
  if (!r.ok()) throw new Error(`create customer: ${r.status()} ${await r.text()}`);
  return (await r.json()).id;
}

async function cleanupCustomer(customerId: string, extraEstimateIds: string[] = []) {
  await q(`delete from crm_attachments where ref_id = $1 or ref_id = any($2)`, [customerId, extraEstimateIds]);
  await q(`delete from crm_client_comments where customer_id = $1`, [customerId]);
  await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%'`, [customerId]);
  for (const e of extraEstimateIds) {
    await q(`delete from crm_estimate_items where estimate_id = $1`, [e]);
    await q(`delete from crm_estimates where id = $1`, [e]);
  }
  await q(`delete from crm_customers where id = $1`, [customerId]);
}

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

test.describe("client portal v2 — pamphlets", () => {
  test("pamphlet upload → visible in portal → session-gated download", async ({ page }) => {
    const guards = watchPage(page);
    const customerId = await makeCustomer(page, "E2E Pamphlet");

    const up = await page.request.post("/api/crm/attachments", {
      multipart: {
        kind: "pamphlet",
        file: { name: "e2e-brochure.pdf", mimeType: "application/pdf", buffer: PDF },
      },
    });
    expect(up.status()).toBe(201);
    const pamphlet = await up.json();

    try {
      await grantClientSession(page, [customerId]);
      await gotoCrm(page, "/?client=1");

      const shelf = page.getByTestId("section-pamphlets");
      await expect(shelf).toBeVisible({ timeout: 15_000 });
      await expect(shelf).toContainText("From Alpine Exteriors Test");
      await expect(page.getByTestId(`pamphlet-${pamphlet.id}`)).toContainText("e2e-brochure.pdf");

      // With the session: the gated route streams the file.
      const dl = await page.request.get(`/api/client/attachments/${pamphlet.id}/download`);
      expect(dl.status()).toBe(200);
      expect(dl.headers()["content-type"]).toBe("application/pdf");

      // Without it: 401 — never a bare public path.
      const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
      const nope = await anon.get(`/api/client/attachments/${pamphlet.id}/download`);
      expect(nope.status()).toBe(401);
      await anon.dispose();

      guards.assertClean("pamphlet portal flow");
    } finally {
      await page.request.delete(`/api/crm/attachments/${pamphlet.id}`);
      await cleanupCustomer(customerId);
    }
  });
});

test.describe("client portal v2 — estimate attachments", () => {
  test("attached file appears on the gated public estimate page after verify", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId, token } = await makeEstimate(page);

    const up = await page.request.post("/api/crm/attachments", {
      multipart: {
        kind: "estimate",
        refId: estimateId,
        file: { name: "e2e-scope.pdf", mimeType: "application/pdf", buffer: PDF },
      },
    });
    expect(up.status()).toBe(201);
    const att = await up.json();

    try {
      // Anonymous: the email gate seals the document AND its attachments.
      await gotoCrm(page, `/e/${token}`);
      await expect(page.getByTestId("doc-gate")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("estimate-attachments")).toHaveCount(0);
      const anonList = await page.request.get(`/api/public/estimates/${token}/attachments`);
      expect(anonList.status()).toBe(401);

      // Verified client: the attachment is right there, and downloads.
      await grantClientSession(page, [customerId]);
      await gotoCrm(page, `/e/${token}`);
      const row = page.getByTestId(`public-attachment-${att.id}`);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText("e2e-scope.pdf");

      const dl = await page.request.get(`/api/public/estimates/${token}/attachments/${att.id}`);
      expect(dl.status()).toBe(200);

      // The portal documents payload carries attachments[] per document —
      // send the estimate so it lists there (drafts stay internal).
      const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
      expect(send.status()).toBe(200);
      const docs = await page.request.get("/api/client/documents");
      expect(docs.status()).toBe(200);
      const docsJson = await docs.json();
      const docEst = docsJson.estimates.find((e: any) => e.id === estimateId);
      expect(docEst).toBeTruthy();
      expect(docEst.attachments.map((a: any) => a.id)).toContain(att.id);

      guards.assertClean("estimate attachment public flow");
    } finally {
      await page.request.delete(`/api/crm/attachments/${att.id}`);
      await cleanupCustomer(customerId, [estimateId]);
    }
  });
});

test.describe("client portal v2 — photos + comments", () => {
  test("photo upload from the portal → visible on the client detail", async ({ page }) => {
    const guards = watchPage(page);
    const customerId = await makeCustomer(page, "E2E Photos");

    try {
      await grantClientSession(page, [customerId]);
      await gotoCrm(page, "/?client=1");
      // Photos live behind the sidebar's Photos view.
      await page.getByTestId("portal-nav-photos").click();
      await expect(page.getByTestId("section-photo-share")).toBeVisible({ timeout: 15_000 });

      await page.getByTestId("input-client-photo").setInputFiles({
        name: "roof-damage.png", mimeType: "image/png", buffer: PNG,
      });
      await expect(page.getByText("Photo shared", { exact: true })).toBeVisible();
      const grid = page.getByTestId("client-photo-grid");
      await expect(grid).toBeVisible();
      const photoId = (await grid.locator("a").first().getAttribute("data-testid"))!.replace("client-photo-", "");

      // Contractor side: the client detail page shows the same photo.
      await gotoCrm(page, `/crm/clients/${customerId}`);
      const strip = page.getByTestId("customer-photo-strip");
      await expect(strip).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId(`customer-photo-${photoId}`)).toBeVisible();

      await page.request.delete(`/api/crm/attachments/${photoId}`);
      guards.assertClean("photo upload flow");
    } finally {
      await cleanupCustomer(customerId);
    }
  });

  test("comment from the portal → contractor sees it, marks it read (DB row)", async ({ page }) => {
    const guards = watchPage(page);
    const customerId = await makeCustomer(page, "E2E Comments");

    try {
      await grantClientSession(page, [customerId]);
      await gotoCrm(page, "/?client=1");
      // Comments live behind the sidebar's Messages view.
      await page.getByTestId("portal-nav-messages").click();
      await expect(page.getByTestId("section-comment-box")).toBeVisible({ timeout: 15_000 });

      await page.getByTestId("input-client-comment").fill("Can we move the start date to next Friday?");
      await page.getByTestId("button-send-comment").click();
      await expect(page.getByTestId("text-comment-sent")).toBeVisible();

      // The email is stubbed/logged in dev — the DB row is the record.
      const rows = await q<{ id: string; read_at: Date | null }>(
        `select id, read_at from crm_client_comments where customer_id = $1`, [customerId]);
      expect(rows.length).toBe(1);
      expect(rows[0].read_at).toBeNull();

      // Contractor side: the comment shows on the client detail…
      await gotoCrm(page, `/crm/clients/${customerId}`);
      const card = page.getByTestId(`client-comment-${rows[0].id}`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText("next Friday");

      // …and mark-read sticks.
      await page.getByTestId(`button-read-comment-${rows[0].id}`).click();
      await expect.poll(async () =>
        (await q(`select read_at from crm_client_comments where id = $1`, [rows[0].id]))[0]?.read_at,
      ).not.toBeNull();

      guards.assertClean("comment flow");
    } finally {
      await cleanupCustomer(customerId);
    }
  });

  test("cross-customer isolation: session can only write/read its own customer id", async ({ page }) => {
    const custA = await makeCustomer(page, "E2E Iso A");
    const custB = await makeCustomer(page, "E2E Iso B");

    try {
      await grantClientSession(page, [custA]);

      // Comment as B with A's session → 403.
      const comment = await page.request.post("/api/client/comments", {
        data: { customerId: custB, body: "intrusion attempt" },
      });
      expect(comment.status()).toBe(403);

      // Photo upload as B with A's session → 403.
      const photo = await page.request.post("/api/client/photos", {
        multipart: {
          customerId: custB,
          file: { name: "intrusion.png", mimeType: "image/png", buffer: PNG },
        },
      });
      expect(photo.status()).toBe(403);

      // B uploads a photo with B's own session; A still can't download it.
      const { makeClientSession } = await import("./db");
      const rawB = await makeClientSession([custB]);
      const bCtx = await pwRequest.newContext({
        baseURL: E2E_BASE_URL,
        extraHTTPHeaders: { cookie: `crm_client=${rawB}` },
      });
      const upB = await bCtx.post("/api/client/photos", {
        multipart: {
          customerId: custB,
          file: { name: "b-photo.png", mimeType: "image/png", buffer: PNG },
        },
      });
      expect(upB.status()).toBe(201);
      const photoB = await upB.json();
      await bCtx.dispose();

      const steal = await page.request.get(`/api/client/attachments/${photoB.id}/download`);
      expect(steal.status()).toBe(404);

      await q(`delete from crm_attachments where id = $1`, [photoB.id]);
    } finally {
      await cleanupCustomer(custA);
      await cleanupCustomer(custB);
    }
  });
});
