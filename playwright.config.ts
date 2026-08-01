import { defineConfig } from "@playwright/test";

/**
 * CRM click-through suite. Each run owns an isolated lane: its own dev
 * server on E2E_PORT (started by the webServer block below) against its own
 * database E2E_DB (a constructhub_dev_* clone — see script/e2e-lane.ts), so
 * swarm agents verify in parallel instead of serialising on :8119.
 *
 *   E2E_PORT    dev-server port + baseURL          (default 8119)
 *   E2E_DB      database name                      (default constructhub_dev)
 *   E2E_WORKERS playwright workers                 (default 4)
 *
 * Specs that mutate cross-suite shared state (the dev-bypass user's role or
 * email, live document counts) are tagged @serial and run in a separate
 * single-worker phase — see the test:e2e scripts in package.json.
 */
const e2ePort = process.env.E2E_PORT ?? "8119";
const e2eDb = process.env.E2E_DB ?? "constructhub_dev";

// The live database is never a valid e2e target. Same guard as e2e/db.ts and
// script/e2e-lane.ts — a stray E2E_DB must fail fast, not write to prod data.
if (!e2eDb.startsWith("constructhub_dev")) {
  throw new Error(
    `E2E_DB must start with "constructhub_dev" (got "${e2eDb}") — refusing to touch the live database`,
  );
}

const baseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: Number(process.env.E2E_WORKERS ?? 4),
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
  },
  webServer: {
    // The suite boots its own server on the lane's port against the lane's
    // DB. Explicit env beats --env-file=.env (node does not override
    // pre-existing vars), so the lane can never fall back to the .env DB.
    command: "npx tsx --env-file=.env server/index.ts",
    env: {
      DATABASE_URL: `postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/${e2eDb}`,
      DEV_AUTH_BYPASS_USER1: "true",
      VITE_FORCE_PORTAL: "true",
      PORT: e2ePort,
      NODE_ENV: "development",
    },
    url: `${baseURL}/api/crm/me`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
