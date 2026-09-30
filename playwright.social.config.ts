import { defineConfig } from "@playwright/test";
if (
  process.env.E2E_PORT !== "8159" ||
  process.env.E2E_DB !== "constructhub_dev_a4"
)
  throw new Error("Social E2E requires a4 port and database");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "social-media.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8159",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
});
