import { defineConfig } from "@playwright/test";

const port = process.env.E2E_PORT || "8149";
const database = process.env.E2E_DB || "constructhub_dev_a3";
if (port !== "8149" || database !== "constructhub_dev_a3") {
  throw new Error("Growth audit is restricted to lane a3");
}
export default defineConfig({
  testDir: "./e2e", testMatch: "growth-reviews.spec.ts", workers: 1,
  timeout: 30_000, use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  // Start the lane separately with DEV_AUTH_BYPASS_USER1=false. The tests
  // assert an anonymous session, so an accidentally reused bypass fails.
});
