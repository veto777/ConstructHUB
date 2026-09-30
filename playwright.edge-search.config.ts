import { defineConfig } from "@playwright/test";
if (
  process.env.E2E_PORT !== "8169" ||
  process.env.E2E_DB !== "constructhub_dev_a5"
)
  throw Error("Edge/Search E2E requires a5 port/database");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "edge-search.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8169",
    headless: true,
    viewport: { width: 1440, height: 1100 },
  },
  reporter: "list",
});
