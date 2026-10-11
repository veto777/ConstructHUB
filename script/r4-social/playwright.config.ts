// Round-4 Social lane e2e: runs the mocked (non-DB) social-media spec against the lane dev
// server on port 8458 (lane DB constructhub_dev_fs). The DB-backed agency test is a4-only by its
// own guard, so it is excluded here.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../e2e",
  testMatch: "social-media.spec.ts",
  grepInvert: /agency searches 1,000 saved businesses/,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:8458",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
});
