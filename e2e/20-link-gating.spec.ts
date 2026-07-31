import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "crypto";
import { q } from "./db";
import { gotoCrm, makeEstimate, ORGS, switchOrg, watchPage } from "./helpers";

/**
 * Email gating on public estimate/invoice links (Jobber-style): the bare
 * token URL no longer opens the document — the visitor must prove they own
 * the inbox it was sent to. A forwarded link fails closed; the verified
 * client's SAME url just works; the contractor's preview bypass is read-only
 * and counts no view.
 *
 * The minted magic link is SHA-256 hashed at rest, so the redeem step
 * INSERTS a token row with a known hash (the exact shape verify-access
 * writes) — the same trick as 15-client-portal.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

test.describe("email gating on public document links", () => {
  test("full flow: challenge → verify → approve; forwarded link fails closed", async ({ page, browser }) => {
    const guards = watchPage(page);
    const { customerId, estimateId, token } = await makeEstimate(page);
    const [{ email }] = await q<{ email: string }>(
      `select email from crm_customers where id = $1`, [customerId]);
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();

    // 1. Anonymous: the challenge renders, the document does NOT.
    await gotoCrm(page, `/e/${token}`);
    await expect(page.getByTestId("doc-gate")).toBeVisible();
    await expect(page.getByText("This document is private")).toBeVisible();
    await expect(page.getByText("E2E line item")).not.toBeVisible();

    // 2. Wrong email: the same confirmation — but nothing is minted.
    const wrong = `rival-${Date.now()}@example.com`;
    await page.getByTestId("input-gate-email").fill(wrong);
    await page.getByTestId("button-gate-send").click();
    await expect(page.getByTestId("text-gate-sent")).toBeVisible();
    expect(await q(`select id from crm_client_tokens where email = $1`, [wrong])).toHaveLength(0);

    // 3. Right email (shouted — match is case-insensitive): a magic link
    //    scoped to JUST this customer is minted. (Reload for a fresh
    //    challenge — the first submit flipped the card to its confirmation.)
    await gotoCrm(page, `/e/${token}`);
    await page.getByTestId("input-gate-email").fill(email.toUpperCase());
    await page.getByTestId("button-gate-send").click();
    await expect(page.getByTestId("text-gate-sent")).toBeVisible();
    const minted = await q<{ customer_ids: string[] }>(
      `select customer_ids from crm_client_tokens where email = $1 order by created_at desc limit 1`,
      [email]);
    expect(minted.length).toBe(1);
    expect(minted[0].customer_ids).toEqual([customerId]);

    // 4. Redeem the emailed link: session cookie + straight back to the SAME
    //    original URL, which now serves. Approve-after-verify works.
    const raw = randomBytes(32).toString("hex");
    await q(
      `insert into crm_client_tokens (token_hash, customer_ids, email, expires_at)
       values ($1, $2::jsonb, $3, now() + interval '30 minutes')`,
      [sha256(raw), JSON.stringify([customerId]), email]);
    await page.goto(`/api/client/auth/verify?token=${raw}&next=${encodeURIComponent(`/e/${token}`)}`);
    await expect(page).toHaveURL(new RegExp(`/e/${token}`));
    await expect(page.getByText("E2E line item")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("input-signature").fill("Mary Homeowner");
    await page.getByTestId("button-approve").click();
    await expect(page.getByText(/Approved — thank you!/)).toBeVisible();

    // 5. The magic link is single-use.
    await page.goto(`/api/client/auth/verify?token=${raw}`);
    await expect(page).toHaveURL(/auth=invalid/);

    guards.assertClean("gated challenge → verify → approve");

    // 6. The competitor: a fresh browser holding only the forwarded bare link
    //    gets the challenge and nothing else — even though the estimate is
    //    approved (settled docs stay viewable to the CLIENT, not to anyone).
    const rival = await browser.newContext();
    try {
      const rp = await rival.newPage();
      await rp.goto(`/e/${token}`);
      await expect(rp.getByTestId("doc-gate")).toBeVisible();
      await expect(rp.getByText("E2E line item")).not.toBeVisible();
      await expect(rp.getByText(/Approved/)).not.toBeVisible();
    } finally {
      await rival.close();
    }
  });

  test("contractor preview link opens without a client session — and counts no view", async ({ page, browser }) => {
    const { estimateId } = await makeEstimate(page);
    // Sent, so a real client open WOULD count: the preview must not.
    const send = await page.request.post(`/api/crm/estimates/${estimateId}/send`, { data: {} });
    expect(send.ok()).toBeTruthy();

    const mint = await page.request.post(`/api/crm/estimates/${estimateId}/preview-link`, { data: {} });
    expect(mint.ok()).toBeTruthy();
    const { url } = await mint.json();
    expect(url).toContain("?preview=");

    // A session-less browser (the contractor in an incognito window) opens it.
    const guest = await browser.newContext();
    try {
      const gp = await guest.newPage();
      await gp.goto(url);
      await expect(gp.getByTestId("preview-banner")).toBeVisible({ timeout: 15_000 });
      await expect(gp.getByText("E2E line item")).toBeVisible();
      // Read-only: no approve box in a preview.
      await expect(gp.getByTestId("input-signature")).not.toBeVisible();
    } finally {
      await guest.close();
    }

    // The tracking strip stays honest: no view, no first-open, still "sent".
    const rows = await q<{ view_count: number | null; first_viewed_at: string | null; status: string }>(
      `select view_count, first_viewed_at, status from crm_estimates where id = $1`, [estimateId]);
    expect(rows[0].view_count ?? 0).toBe(0);
    expect(rows[0].first_viewed_at).toBeNull();
    expect(rows[0].status).toBe("sent");
  });
});
