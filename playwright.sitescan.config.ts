import { defineConfig } from "@playwright/test";
if (
  process.env.E2E_PORT !== "8139" ||
  process.env.E2E_DB !== "constructhub_dev_a2"
)
  throw new Error("Site Scan browser tests require lane a2");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sitescan.spec.ts",
  workers: 1,
  expect: { timeout: 30000 },
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8139",
    headless: true,
    permissions: ["clipboard-read", "clipboard-write"],
  },
});
