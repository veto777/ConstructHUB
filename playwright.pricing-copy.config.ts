import { defineConfig } from "@playwright/test";
// Pricing p5 (copy): runs against an already-started dev server on the lane's port.
if (process.env.E2E_PORT !== "8255" || process.env.E2E_DB !== "constructhub_dev_a6")
  throw new Error("Pricing copy tests require port 8255 and constructhub_dev_a6");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "pricing-copy.spec.ts",
  workers: 1,
  timeout: 60000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8255", headless: true },
});
