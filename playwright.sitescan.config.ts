import { defineConfig } from "@playwright/test";
if (
  process.env.E2E_PORT !== "8169" ||
  process.env.E2E_DB !== "constructhub_dev_a5"
)
  throw new Error("Site Scan browser tests require lane a5");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sitescan.spec.ts",
  workers: 1,
  expect: { timeout: 10000 },
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8169",
    headless: true,
    permissions: ["clipboard-read", "clipboard-write"],
  },
});
