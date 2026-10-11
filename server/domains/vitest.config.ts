import { defineConfig } from "vitest/config";
import path from "path";
import fs from "fs";
import { parseEnv } from "node:util";

// Lane-local vitest config for the domains/mail-alerts suites: identical to the root
// vitest.config.ts except it does not register the globalSetup. That setup only resets
// auth counters for the auth integration suites, and it rejects this lane's database by
// name (constructhub_dev_fs does not match its `constructhub_dev_a\d+` allow-list). These
// suites create their own fixture users and delete them afterwards, so they need nothing
// from it. Run: npx vitest run --config server/domains/vitest.config.ts <files>
try {
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(path.resolve(import.meta.dirname, "../../.env"), "utf8")))) {
    process.env[k] ??= v;
  }
} catch { /* no .env */ }

process.env.PGOPTIONS ??= "-c TimeZone=UTC";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "../../shared"),
      "@": path.resolve(import.meta.dirname, "../../client/src"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    include: [
      "server/**/*.test.ts",
      // The client components this lane owns, unit-tested next to the source (pure logic only).
      "client/src/components/domains/**/*.test.ts",
      "client/src/components/mail-alerts/**/*.test.ts",
    ],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
