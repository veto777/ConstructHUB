import { defineConfig } from '@playwright/test';
if(process.env.E2E_PORT!=='8129'||process.env.E2E_DB!=='constructhub_dev_a1') throw new Error('Account security browser tests require lane a1');
export default defineConfig({testDir:'./e2e',testMatch:'account-security.spec.ts',workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:8129',headless:true,viewport:{width:1440,height:1000}}});
