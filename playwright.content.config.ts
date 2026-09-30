import { defineConfig } from '@playwright/test';
if (process.env.E2E_PORT !== '8149' || process.env.E2E_DB !== 'constructhub_dev_a3')
    throw new Error('Content tests require lane a3');
export default defineConfig({ testDir: './e2e', testMatch: 'gbp-content.spec.ts', workers: 1, timeout: 45000, use: { baseURL: 'http://127.0.0.1:8149', headless: true, viewport: { width: 1440, height: 1000 } } });
