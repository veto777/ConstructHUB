import { defineConfig } from "@playwright/test";
// Pricing p5 (copy): runs against an already-started dev server on the lane's port
// (8255, or a child server from a worktree on 8260–8280).
const port = Number(process.env.E2E_PORT);
if (!(port === 8255 || (port >= 8260 && port <= 8280)) || process.env.E2E_DB !== "constructhub_dev_a6")
  throw new Error("Pricing copy tests require port 8255 (or 8260–8280) and constructhub_dev_a6");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "pricing-copy.spec.ts",
  workers: 1,
  timeout: 60000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
});
