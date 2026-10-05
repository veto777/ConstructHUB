import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";
// These tests own their fixtures and budgets; do not clear other suites' auth counters.
export default mergeConfig(base, defineConfig({ test: { globalSetup: [] } }));
