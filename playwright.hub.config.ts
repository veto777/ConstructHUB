import { defineConfig } from "@playwright/test";

/**
 * Hub widget (the corner assistant). Runs against two already-started dev
 * servers on the same scratch DB:
 *   HUB_SIGNED_IN_URL  (default http://127.0.0.1:8301) DEV_AUTH_BYPASS_USER1=true
 *   HUB_SIGNED_OUT_URL (default http://127.0.0.1:8302) DEV_AUTH_BYPASS_USER1=false
 *   HUB_SCREENSHOT_DIR (optional) where the 1280 / 390 widget screenshots go
 *
 *   npx playwright test -c playwright.hub.config.ts
 *
 * The signed-in chat tests mock /api/hub/chat in the browser (no model call);
 * the server side of chat is covered by server/hub/routes.test.ts with a stub model.
 */
process.env.HUB_E2E = "1";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "hub-widget.spec.ts",
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: { headless: true, viewport: { width: 1280, height: 800 } },
});
