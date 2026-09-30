import { defineConfig } from '@playwright/test';
const port=process.env.E2E_PORT||'8129',database=process.env.E2E_DB||'constructhub_dev_a1';
if(port!=='8129'||database!=='constructhub_dev_a1')throw new Error('Agency tests require lane a1');
export default defineConfig({testDir:'./e2e',testMatch:'agency.spec.ts',workers:1,timeout:60000,retries:0,
 use:{baseURL:`http://127.0.0.1:${port}`,headless:true,viewport:{width:1440,height:1000}},reporter:[['list']]});
