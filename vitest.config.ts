import { defineConfig } from "vitest/config";
import path from "path";

// Server-side CRM tests only. Unit tests import pure modules; the money-path
// tests exercise the running dev server (CRM_TEST_BASE_URL, default local dev).
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    include: ["server/**/*.test.ts"],
    testTimeout: 20000,
  },
});
