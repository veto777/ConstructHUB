import { defineConfig } from "@playwright/test";

/**
 * Pricing, cart and Settings → Billing (growth app, not the CRM portal).
 * Start the lane first with VITE_FORCE_PORTAL=false and DEV_AUTH_BYPASS_USER1=true.
 * Every billing endpoint is mocked in the spec: nothing reaches Stripe, the
 * sales inbox or the database.
 */
process.env.E2E_PORT ??= "8254";
const port = process.env.E2E_PORT;
const database = process.env.E2E_DB ?? "constructhub_dev_a6";
if (!database.startsWith("constructhub_dev")) {
  throw new Error(`E2E_DB must start with "constructhub_dev" (got "${database}")`);
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "pricing.spec.ts",
  workers: 1,
  timeout: 60_000,
  retries: 0,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, viewport: { width: 1280, height: 900 } },
});
