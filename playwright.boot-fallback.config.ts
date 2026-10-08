import { defineConfig } from "@playwright/test";

/**
 * e2e/boot-fallback.spec.ts against an already-started server (dev or built):
 *   BOOT_URL=http://127.0.0.1:8187 npx playwright test -c playwright.boot-fallback.config.ts
 * One worker: the Vite dev server drops page loads under parallel workers.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["boot-fallback.spec.ts"],
  workers: 1,
  timeout: 120_000,
  retries: 0,
  reporter: [["list"]],
  use: { headless: true, viewport: { width: 1440, height: 900 }, baseURL: process.env.BOOT_URL || `http://127.0.0.1:${process.env.E2E_PORT ?? "8119"}` },
});
