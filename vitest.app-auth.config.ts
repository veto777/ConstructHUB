import { defineConfig } from "vitest/config";
import base from "./vitest.config";
// Assign directly: mergeConfig concatenates arrays and would retain the global
// auth-counter reset. These tests may only change their own fixtures/budgets.
export default defineConfig({ ...base, test: { ...base.test, globalSetup: [] } });
