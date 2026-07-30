import { defineConfig } from "@playwright/test";

/**
 * CRM click-through suite. Runs against the dev server on :8119 started with
 * DEV_AUTH_BYPASS_USER1=true and VITE_FORCE_PORTAL=true (portal shell on
 * localhost). Single worker: every spec shares the same throwaway dev DB.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8119",
    headless: true,
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
  },
});
