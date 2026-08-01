import { expect, request as pwRequest, test } from "@playwright/test";
import { q } from "./db";
import { E2E_BASE_URL, gotoCrm, grantClientSession, makeEstimate, ORGS, switchOrg, watchPage } from "./helpers";

/**
 * The signed-contract flow, end to end:
 *   1. BEFORE signing, the public estimate is a real document (letterhead,
 *      facts, prepared-for, footer band) with NO pdf/print affordance.
 *   2. Approving (signing) mints the signed-contract PDF server-side.
 *   3. The client portal's contracts section gains a working PDF download
 *      (session-gated, content-type application/pdf).
 */
test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("signed contract PDF", () => {
  test("approve a gated estimate → letterhead renders, contract PDF lands in the client portal", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId, token } = await makeEstimate(page);
    // The portal shows only SENT estimates — put this one in the sent state
    // (exactly what POST /api/crm/estimates/:id/send stamps).
    await q(`update crm_estimates set sent_at = now(), status = 'sent',
             expires_at = now() + interval '7 days' where id = $1`, [estimateId]);
    await grantClientSession(page, [customerId]);

    // ── Pre-signature: the document letterhead, no PDF/print affordance. ──
    await gotoCrm(page, `/e/${token}`);
    await expect(page.getByTestId("doc-wordmark")).toHaveText("ESTIMATE");
    await expect(page.getByTestId("estimate-document")).toContainText("Aspire Interiors");
    const addr = page.getByTestId("text-company-address");
    await expect(addr).toContainText("1847 Main Street");
    await expect(addr).toContainText("Sarasota, FL 34236");
    await expect(page.getByTestId("prepared-for")).toBeVisible();
    const footer = page.getByTestId("document-footer");
    await expect(footer).toContainText("Aspire Interiors");
    await expect(footer).toContainText("License #CBC1264418");
    await expect(footer).toContainText("aspireinteriors.example.com");

    // No download-PDF affordance anywhere before signing…
    await expect(page.locator('[data-testid^="client-contract-download-"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: /download/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /print|pdf/i })).toHaveCount(0);
    // …and the print lockdown is mounted (hidden on screen, the only thing
    // visible under print media — curated fully in 17-engagement-expiry).
    expect(await page.getByTestId("print-lockdown-notice").count()).toBe(1);
    // No contract row exists yet — the PDF is minted BY the signature.
    const pre = await q(`select id from crm_attachments where kind = 'contract' and ref_id = $1`, [estimateId]);
    expect(pre.length).toBe(0);

    // ── Sign. ─────────────────────────────────────────────────────────────
    await page.getByTestId("input-signature").fill("Mary Homeowner");
    await page.getByTestId("button-approve").click();
    await expect(page.getByText(/Approved — thank you!/)).toBeVisible();
    // The signed page keeps the letterhead and shows the approved total.
    await expect(page.getByTestId("doc-wordmark")).toHaveText("ESTIMATE");
    await expect(page.getByTestId("doc-total")).toHaveText("$123.45");

    // ── The contract PDF is generated server-side (async pipeline). ───────
    let att: { id: string; mime: string } | null = null;
    for (let i = 0; i < 24; i++) {
      const rows = await q<{ id: string; mime: string }>(
        `select id, mime from crm_attachments where kind = 'contract' and ref_id = $1`, [estimateId]);
      if (rows.length) { att = rows[0]; break; }
      await page.waitForTimeout(500);
    }
    expect(att, "signed-contract attachment row").toBeTruthy();
    expect(att!.mime).toBe("application/pdf");

    // ── The client portal: contracts section + working download. ─────────
    await gotoCrm(page, "/?client=1");
    const contracts = page.getByTestId("section-contracts");
    await expect(contracts).toContainText("E2E throwaway estimate");
    await expect(contracts).toContainText("Mary Homeowner");
    const dl = page.getByTestId(`client-contract-download-${estimateId}`);
    await expect(dl).toBeVisible();

    const href = await dl.getAttribute("href");
    expect(href).toBe(`/api/client/attachments/${att!.id}/download`);
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // The same URL without a client session is refused.
    const anonCtx = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    try {
      const bare = await anonCtx.get(href!);
      expect(bare.status()).toBe(401);
    } finally {
      await anonCtx.dispose();
    }

    guards.assertClean("signed contract flow");
  });

  test("the invoice page wears the same letterhead", async ({ page }) => {
    const guards = watchPage(page);
    const { customerId, estimateId, token } = await makeEstimate(page);
    await grantClientSession(page, [customerId]);
    const respond = await page.request.post(`/api/public/estimates/${token}/respond`, {
      data: { decision: "approve", signatureName: "Mary Homeowner" },
    });
    expect(respond.ok()).toBeTruthy();
    const conv = await page.request.post(`/api/crm/estimates/${estimateId}/invoice`, { data: {} });
    expect(conv.ok()).toBeTruthy();
    const invoice = await conv.json();
    const invoiceId = invoice.id ?? invoice.invoice?.id;
    const rows = await q<{ public_token: string }>(
      `select public_token from crm_invoices where id = $1`, [invoiceId]);

    await gotoCrm(page, `/i/${rows[0].public_token}`);
    await expect(page.getByTestId("doc-wordmark")).toHaveText("INVOICE");
    await expect(page.getByTestId("text-company-address")).toContainText("Sarasota, FL 34236");
    await expect(page.getByTestId("prepared-for")).toBeVisible();
    const footer = page.getByTestId("document-footer");
    await expect(footer).toContainText("Aspire Interiors");
    await expect(footer).toContainText("License #CBC1264418");

    guards.assertClean("invoice letterhead");
  });
});
