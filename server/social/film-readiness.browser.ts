/** Read-only checks against the lane app. Run from this worktree after starting the sample server. */
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = new URL(process.env.SOCIAL_SCREEN_BASE ?? "http://127.0.0.1:8197");
if (!["127.0.0.1", "localhost"].includes(base.hostname) || !base.port || ["5432", "5433"].includes(base.port)) {
  throw new Error("Use a local development app port for SOCIAL_SCREEN_BASE");
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await fs.mkdir("/tmp/r8-social-screens", { recursive: true });
  await page.goto(new URL("/social-media?business=910001", base).href);
  await expect(page.getByRole("heading", { name: "Compose", exact: true })).toBeVisible();
  const notice = page.getByTestId("alert-social-setup");
  await expect(notice).toBeVisible();
  await expect(page.getByRole("button", { name: "Post now", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await page.screenshot({ path: "/tmp/r8-social-screens/compose-desktop.png", fullPage: true });
  await page.getByText("Map accounts and pages to this business", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^Map:/ }).first()).toBeVisible();
  await page.getByRole("checkbox", { name: /^Map:/ }).first().focus();
  await page.screenshot({ path: "/tmp/r8-social-screens/mapping-focus.png", fullPage: true });
  await page.getByRole("button", { name: "Auto mode", exact: true }).click();
  const saved = page.locator("p").filter({ hasText: /^Saved destinations:/ });
  await expect(saved).not.toContainText("fs-b-");
  await expect(saved).toContainText("Summit");
  await page.getByRole("button", { name: "Calendar & queue", exact: true }).click();
  const queue = page.locator("section").filter({ has: page.getByRole("heading", { name: "Calendar & queue", exact: true }) });
  await expect.poll(async () => queue.evaluate(el => Math.abs(el.getBoundingClientRect().top))).toBeLessThan(40);
  await page.screenshot({ path: "/tmp/r8-social-screens/queue-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await notice.scrollIntoViewIfNeeded();
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/r8-social-screens/compose-phone.png", fullPage: true });
} finally {
  await browser.close();
}
