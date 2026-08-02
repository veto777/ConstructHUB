import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { q } from "./db";
import { gotoCrm, watchPage } from "./helpers";

/**
 * Quick Bid, end to end: a client with a ready HOVER measurement report gets
 * a bid priced per sqft straight from the report — pick siding + paint, one
 * click, edit-first review, then the send dialog's message box goes out by
 * email (dev SMTP sinks to tmp/email-outbox.jsonl).
 *
 * No @serial tag: the spec only touches its own throwaway customer, SKUs,
 * measurement and estimate, like the other document specs.
 */

const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const EMAIL = `e2e-qb-${STAMP}@example.com`;

// 2,210 sq ft siding, 12% waste → 2,475.2 sq ft billable.
const SIDING_RATE = 450; // $4.50/sq ft → 2475.2 * 4.50 = $11,138.40
const PAINT_RATE = 175;  // $1.75/sq ft → 2475.2 * 1.75 = $4,331.60
const SIDING_LINE = 1_113_840;
const PAINT_LINE = 433_160;

let customerId = "";
let estimateId = "";
let sidingItemId = "";
let paintItemId = "";

test.afterAll(async () => {
  if (customerId) {
    await q(`delete from crm_estimate_items where estimate_id in (select id from crm_estimates where customer_id = $1)`, [customerId]).catch(() => {});
    await q(`delete from crm_estimate_events where estimate_id in (select id from crm_estimates where customer_id = $1)`, [customerId]).catch(() => {});
    await q(`delete from crm_estimates where customer_id = $1`, [customerId]).catch(() => {});
    await q(`delete from crm_measurements where customer_id = $1`, [customerId]).catch(() => {});
    await q(`delete from crm_customers where id = $1`, [customerId]).catch(() => {});
  }
  for (const id of [sidingItemId, paintItemId].filter(Boolean)) {
    await q(`delete from crm_pb_items where id = $1`, [id]).catch(() => {});
  }
});

test.describe("Quick Bid", () => {
  test("measurement → per-sqft bid → edit → send via the message box", async ({ page }) => {
    const guards = watchPage(page);

    // ── Throwaway client + ready HOVER report + two per-sqft SKUs ────────
    const cust = await page.request.post("/api/crm/customers", {
      data: { displayName: `E2E QuickBid ${STAMP}`, email: EMAIL },
    });
    expect(cust.status()).toBe(201);
    customerId = (await cust.json()).id;

    const meas = await page.request.post("/api/crm/measurements", {
      data: {
        customerId, provider: "hover",
        roofAreaSf: 2874.5, wallAreaSf: 2210, wasteSuggestionBps: 1200,
        addressLine1: "456 Cedar Ave", city: "Tacoma", state: "WA",
      },
    });
    expect(meas.status()).toBe(201);

    const mkSku = async (name: string, rateCentsPerSqft: number) => {
      const r = await page.request.post("/api/crm/pricebook/items", {
        data: { name, pricingMode: "per_sqft", rateCentsPerSqft, sqftMetric: "siding" },
      });
      expect(r.status()).toBe(201);
      return (await r.json()).id as string;
    };
    sidingItemId = await mkSku(`E2E QB Siding ${STAMP}`, SIDING_RATE);
    paintItemId = await mkSku(`E2E QB Paint ${STAMP}`, PAINT_RATE);

    // ── A client WITHOUT a report: the button stays honestly disabled ────
    const bare = await page.request.post("/api/crm/customers", {
      data: { displayName: `E2E QuickBid Bare ${STAMP}` },
    });
    const bareId = (await bare.json()).id;
    await gotoCrm(page, `/crm/clients/${bareId}`);
    await expect(page.getByTestId("button-quick-bid")).toBeDisabled();
    await q(`delete from crm_customers where id = $1`, [bareId]);

    // ── Client page → Quick Bid → pick siding + paint ────────────────────
    await gotoCrm(page, `/crm/clients/${customerId}`);
    await expect(page.getByTestId("card-measurements")).toContainText("Siding 2,210 sq ft");
    await page.getByTestId("button-quick-bid").click();

    await expect(page.getByTestId("dialog-quick-bid")).toBeVisible();
    await expect(page.getByTestId("text-quick-bid-measurement")).toContainText("Siding 2,210 sq ft");
    await expect(page.getByTestId("text-quick-bid-measurement")).toContainText("Waste 12%");
    await page.getByTestId(`check-quick-bid-item-${sidingItemId}`).click();
    await page.getByTestId(`check-quick-bid-item-${paintItemId}`).click();
    await page.getByTestId("button-create-quick-bid").click();

    // ── Edit-first review: sqft-filled lines, cents-exact totals ─────────
    await expect(page.getByTestId("dialog-quick-bid-review")).toBeVisible();
    await expect(page.getByTestId("input-quick-bid-qty-0")).toHaveValue("2475.2");
    await expect(page.getByTestId("input-quick-bid-qty-1")).toHaveValue("2475.2");
    await expect(page.getByTestId("text-quick-bid-line-total-0")).toHaveText("$11,138.40");
    await expect(page.getByTestId("text-quick-bid-line-total-1")).toHaveText("$4,331.60");
    await expect(page.getByTestId("text-quick-bid-subtotal")).toHaveText("$15,470.00");
    await expect(page.getByTestId("text-quick-bid-total")).toHaveText("$15,470.00");

    // Edit-first: bump the siding rate, save, and the server agrees.
    await page.getByTestId("input-quick-bid-price-0").fill("5");
    await expect(page.getByTestId("text-quick-bid-line-total-0")).toHaveText("$12,376.00");
    await expect(page.getByTestId("text-quick-bid-total")).toHaveText("$16,707.60");
    await page.getByTestId("button-quick-bid-save").click();
    await expect(page.getByTestId("button-quick-bid-save")).toBeDisabled(); // saved → not dirty

    const rows = await q<{ id: string; subtotal_cents: number; total_cents: number; number: string }>(
      `select e.id, e.subtotal_cents, e.total_cents, e.number
         from crm_estimates e where e.customer_id = $1 order by e.created_at desc limit 1`,
      [customerId],
    );
    estimateId = rows[0].id;
    expect(rows[0].subtotal_cents).toBe(1_237_600 + PAINT_LINE);
    expect(rows[0].total_cents).toBe(1_237_600 + PAINT_LINE);
    const estNumber = rows[0].number;

    // ── Send dialog: prefilled editable message → Send (dev SMTP sink) ───
    await page.getByTestId("button-quick-bid-send-open").click();
    await expect(page.getByTestId("dialog-quick-bid-send")).toBeVisible();
    await expect(page.getByTestId("input-quick-bid-email")).toHaveValue(EMAIL);
    const msg = page.getByTestId("textarea-quick-bid-message");
    await expect(msg).toHaveValue(new RegExp(`your estimate ${estNumber} for 456 Cedar Ave, Tacoma, WA`));
    await msg.fill(`E2E custom note — estimate ${estNumber} ready for review.`);
    await page.getByTestId("button-quick-bid-send").click();

    // Sent toast + the row flipped to sent with the email recorded.
    await expect(
      page.getByText("Estimate sent", { exact: true })
        .or(page.getByText("Email failed — link copied", { exact: true })),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        const r = await q<{ status: string; sent_to_email: string }>(
          `select status, sent_to_email from crm_estimates where id = $1`, [estimateId]);
        return r[0]?.status === "sent" && r[0]?.sent_to_email === EMAIL;
      }, { timeout: 15_000 })
      .toBe(true);

    // Dev SMTP never really sends — it logs to the sink; the message box's
    // custom note must be in that logged email.
    const outbox = path.join(process.cwd(), "tmp", "email-outbox.jsonl");
    await expect
      .poll(() => {
        try {
          return fs.readFileSync(outbox, "utf8")
            .includes(`E2E custom note — estimate ${estNumber} ready for review.`);
        } catch { return false; }
      }, { timeout: 15_000 })
      .toBe(true);

    guards.assertClean("quick-bid e2e");
  });
});
