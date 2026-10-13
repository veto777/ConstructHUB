import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  cacheDir: path.resolve(import.meta.dirname, "../../.cache/listings-vitest"),
  resolve: {
    alias: { "@shared": path.resolve(import.meta.dirname, "../../shared") },
  },
  test: { include: ["server/listings/**/*.test.ts"], fileParallelism: false },
});
