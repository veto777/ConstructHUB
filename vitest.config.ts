import { defineConfig } from "vitest/config";
import path from "path";
import fs from "fs";
import { parseEnv } from "node:util";

// Server-side CRM tests only. Unit tests import pure modules; the money-path
// tests exercise the running dev server (CRM_TEST_BASE_URL, default local dev).
//
// The dev-server suites need CRM_TEST_BASE_URL / CRM_TEST_DATABASE_URL from
// .env — vitest does NOT populate process.env from .env, so load it here
// (existing process env wins, so CI can still override). Node 20's parseEnv
// means no dotenv dependency.
try {
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(path.resolve(import.meta.dirname, ".env"), "utf8")))) {
    process.env[k] ??= v;
  }
} catch { /* no .env — the suite falls back to its built-in defaults */ }

// Resolve every integration target and child port from this checkout's lane.
const lanePort = Number(process.env.E2E_PORT || process.env.PORT || 8119);
process.env.CRM_TEST_BASE_URL ??= `http://127.0.0.1:${lanePort}`;
process.env.CRM_TEST_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.TEST_GATE_PORT = String(lanePort + 1);
process.env.TEST_HOVER_PORT = String(lanePort + 2);

//
// Files run SERIALLY (fileParallelism:false): the dev-server suites share one
// dev-bypass user and one org — several flip the user's role via SQL
// (divisions, client-360, owner-delete) and the auth gates sit behind
// in-memory per-IP rate limiters, so parallel files race each other into
// spurious 403s/429s. The e2e suite solves the same problem with lanes and
// @serial tags; vitest gets the blunt instrument.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    include: ["server/**/*.test.ts"],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
