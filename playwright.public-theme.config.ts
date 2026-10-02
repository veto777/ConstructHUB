import { defineConfig } from "@playwright/test";

/** e2e/public-theme.spec.ts — the editorial (design B) public pages, signed out. See the spec for the server it needs. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "public-theme.spec.ts",
  workers: 1,
  timeout: 60_000,
  retries: 0,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { headless: true },
});
