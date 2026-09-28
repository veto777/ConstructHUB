import {defineConfig} from '@playwright/test';
const port=process.env.E2E_PORT,db=process.env.E2E_DB;
if(port!=='8139'||db!=='constructhub_dev_a2') throw new Error('GBP audit requires lane a2');
export default defineConfig({testDir:'./e2e',testMatch:'gbp.spec.ts',workers:1,timeout:30000,use:{baseURL:`http://127.0.0.1:${port}`,headless:true,viewport:{width:1440,height:1000}}});
