import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["client/src/components/hub/hub-widget.test.ts"], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false } });
