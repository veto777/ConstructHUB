import { defineConfig } from "@playwright/test";

/**
 * Account settings: the settings shell (nav, Limits & usage, Audit log,
 * Integrations) and the Billing / API keys / API usage panels + /developers
 * (growth app, not the CRM portal). Start the lane first with
 * VITE_FORCE_PORTAL=false and DEV_AUTH_BYPASS_USER1=true. Every account
 * endpoint is mocked in the specs: nothing reaches Stripe, the database or an
 * email sink.
 *
 *   E2E_PORT=8341 SETTINGS_SHOTS_DIR=<dir> npx playwright test -c playwright.account.config.ts
 */
process.env.E2E_PORT ??= "8341";
const port = process.env.E2E_PORT;
const database = process.env.E2E_DB ?? "constructhub_dev_a6";
if (!database.startsWith("constructhub_dev")) {
  throw new Error(`E2E_DB must start with "constructhub_dev" (got "${database}")`);
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["settings-shell.spec.ts", "account-billing-api.spec.ts"],
  workers: 2,
  timeout: 90_000,
  retries: 0,
  // A Vite dev server serving the whole module graph on every full navigation can take a while to mount the app.
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`, headless: true, viewport: { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  },
});
