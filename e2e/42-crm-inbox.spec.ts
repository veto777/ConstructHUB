import { expect, test } from "@playwright/test";
import { gotoCrm, grantClientSession, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * Messages inbox + notifications bell — the two-pane inbox shipped without
 * e2e. Covers the regression that motivated it: thread select / back /
 * bell-item navigation all ride on the ?c= query param, which wouter's
 * useLocation does NOT subscribe to (pathname only) — the pane used to stay
 * frozen until a poll re-rendered.
 */

async function makeCustomer(page: any, name: string): Promise<string> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const r = await page.request.post("/api/crm/customers", {
    data: { displayName: `${name} ${stamp}`, email: `e2e-inbox-${stamp}@example.com` },
  });
  if (!r.ok()) throw new Error(`create customer: ${r.status()} ${await r.text()}`);
  return (await r.json()).id;
}

async function cleanupCustomer(customerId: string) {
  await q(`delete from crm_notifications where link like '%' || $1 || '%'`, [customerId]);
  await q(`delete from crm_client_comments where customer_id = $1`, [customerId]);
  await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%'`, [customerId]);
  await q(`delete from crm_customers where id = $1`, [customerId]);
}

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

/** The client sends a portal message; returns the customer id. */
async function clientSays(page: any, name: string, body: string): Promise<string> {
  const customerId = await makeCustomer(page, name);
  await grantClientSession(page, [customerId]);
  const r = await page.request.post(`/api/client/comments?customerId=${customerId}`, {
    data: { body },
  });
  if (!r.ok()) throw new Error(`client comment failed: ${r.status()} ${await r.text()}`);
  return customerId;
}

test.describe("/crm/inbox messages", () => {
  test("thread select, mark-read, Enter-reply, bell item deep-links the thread", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = Date.now().toString(36);
    const customerId = await clientSays(page, `E2E Inbox ${stamp}`, `E2E hello ${stamp} — can you make it Thursday?`);

    try {
      // Fresh load of the inbox: the new thread is there, unread.
      await gotoCrm(page, "/crm/inbox");
      const thread = page.getByTestId(`thread-${customerId}`);
      await expect(thread).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId(`thread-unread-${customerId}`)).toBeVisible();

      // Clicking the thread opens the conversation IMMEDIATELY (the useSearch
      // regression: URL changed, pane froze).
      await thread.click();
      await expect(page).toHaveURL(new RegExp(`/crm/inbox\\?c=${customerId}`));
      const convo = page.getByTestId("inbox-conversation");
      await expect(convo).toBeVisible();
      await expect(convo).toContainText(`E2E hello ${stamp}`, { timeout: 15_000 });

      // Opening marked it read — the unread pill clears without a reload.
      await expect(page.getByTestId(`thread-unread-${customerId}`)).toBeHidden({ timeout: 15_000 });

      // Enter sends the reply; it lands in the thread.
      await page.getByTestId("input-inbox-reply").fill(`E2E reply ${stamp} — Thursday works.`);
      await page.keyboard.press("Enter");
      await expect(convo).toContainText(`E2E reply ${stamp}`, { timeout: 15_000 });

      // The bell picked up the client message; its item deep-links the thread.
      await gotoCrm(page, "/crm");
      const bellBadge = page.getByTestId("badge-notifications-unread");
      await expect(bellBadge).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("button-notifications-bell").click();
      const item = page.locator('[data-testid^="notification-item-"]', { hasText: "sent a message" }).first();
      await expect(item).toBeVisible();
      await item.click();
      await expect(page).toHaveURL(/\/crm\/inbox\?c=/);
      await expect(page.getByTestId("inbox-conversation")).toBeVisible({ timeout: 15_000 });

      guards.assertClean("inbox flow");
    } finally {
      await cleanupCustomer(customerId);
    }
  });

  test("mark all read clears the bell badge", async ({ page }) => {
    const guards = watchPage(page);
    const stamp = Date.now().toString(36);
    const customerId = await clientSays(page, `E2E Inbox ${stamp}`, `E2E bell ${stamp}`);

    try {
      await gotoCrm(page, "/crm");
      await expect(page.getByTestId("badge-notifications-unread")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("button-notifications-bell").click();
      await page.getByTestId("button-notifications-read-all").click();
      await expect(page.getByTestId("badge-notifications-unread")).toBeHidden({ timeout: 15_000 });
      guards.assertClean("bell read-all");
    } finally {
      await cleanupCustomer(customerId);
    }
  });

  test("mobile: thread opens, back button returns to the list", async ({ page }) => {
    const guards = watchPage(page);
    await page.setViewportSize({ width: 375, height: 760 });
    const stamp = Date.now().toString(36);
    const customerId = await clientSays(page, `E2E Inbox ${stamp}`, `E2E mobile ${stamp}`);

    try {
      await gotoCrm(page, "/crm/inbox");
      await page.getByTestId(`thread-${customerId}`).click();
      await expect(page.getByTestId("inbox-conversation")).toBeVisible({ timeout: 15_000 });

      await page.getByTestId("button-back-to-threads").click();
      await expect(page).toHaveURL(/\/crm\/inbox$/);
      await expect(page.getByTestId("inbox-thread-list")).toBeVisible({ timeout: 15_000 });
      guards.assertClean("inbox mobile back");
    } finally {
      await cleanupCustomer(customerId);
    }
  });
});
