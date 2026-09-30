import { defineConfig } from "@playwright/test";
if (
  process.env.E2E_PORT !== "8189" ||
  process.env.E2E_DB !== "constructhub_dev_a7"
)
  throw new Error("a7 browser tests require port 8189 and constructhub_dev_a7");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "domains-mail.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8189",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
});
