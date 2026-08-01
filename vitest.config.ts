import { defineConfig } from "vitest/config";
import path from "path";

// Server-side CRM tests only. Unit tests import pure modules; the money-path
// tests exercise the running dev server (CRM_TEST_BASE_URL, default local dev).
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
