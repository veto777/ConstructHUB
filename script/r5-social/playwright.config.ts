// Round-5 Social lane e2e: runs the social-media spec (mocked tests) against the lane dev server
// on port 8462 (lane DB constructhub_dev_fs). The DB-backed agency test is a4-only — it fails on
// this lane at origin/main too (verified by stashing), so it is excluded here like in round 4.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../e2e",
  testMatch: "social-media.spec.ts",
  grepInvert: /agency searches 1,000 saved businesses/,
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://127.0.0.1:8462",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
});
