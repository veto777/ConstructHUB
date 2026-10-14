import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  cacheDir: path.resolve(import.meta.dirname, "../../.cache/directories-vitest"),
  resolve: {
    alias: { "@shared": path.resolve(import.meta.dirname, "../../shared") },
  },
  test: { include: ["server/directories/**/*.test.ts"], fileParallelism: false },
});
