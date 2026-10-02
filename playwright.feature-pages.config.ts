import { defineConfig } from "@playwright/test";

/**
 * Feature intro pages (/features, /features/<slug>, /admin/feature-pages).
 * Runs against two already-started dev servers from the same checkout:
 *   FP_SIGNED_OUT_URL  DEV_AUTH_BYPASS_USER1=false (default http://127.0.0.1:$E2E_PORT)
 *   FP_SIGNED_IN_URL   DEV_AUTH_BYPASS_USER1=true  (the admin tests skip without it)
 *   FP_SCREENSHOT_DIR  (optional) review screenshots
 *
 *   npx playwright test -c playwright.feature-pages.config.ts
 *
 * One worker: the Vite dev server drops page loads under parallel workers.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "feature-pages.spec.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: { headless: true, viewport: { width: 1440, height: 900 } },
});
