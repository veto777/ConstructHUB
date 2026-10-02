import { defineConfig } from "@playwright/test";

/**
 * Admin access grants (/admin/access) and the trial-code card's 1–1000 days.
 * Runs against an already-started dev server from the same checkout (no
 * ADMIN_GATE_USER/PASS), on a scratch DB (constructhub_dev*):
 *
 *   AA_BASE_URL        DEV_AUTH_BYPASS_USER1=true server (user 1 is a platform admin in dev)
 *   AA_SCREENSHOT_DIR  optional: where the review screenshots go
 *   DATABASE_URL       the same DB as the server (fixture accounts are inserted and deleted)
 *
 *   npx playwright test -c playwright.admin-access.config.ts
 *
 * One worker: the specs share the dev-bypass admin's session state.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "admin-access.spec.ts",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["list"]],
  use: { headless: true, viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 },
});
