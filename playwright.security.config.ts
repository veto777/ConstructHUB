import { defineConfig } from '@playwright/test';
const securityPort=Number(process.env.E2E_PORT);
// Lane a1, or the theme lane's signed-out server (8470–8479) on the a6 scratch DB.
if(!((securityPort===8129&&process.env.E2E_DB==='constructhub_dev_a1')||(securityPort>=8470&&securityPort<=8479&&process.env.E2E_DB==='constructhub_dev_a6'))) throw new Error('Account security browser tests require lane a1 (8129) or 8470–8479 on constructhub_dev_a6');
export default defineConfig({testDir:'./e2e',testMatch:'account-security.spec.ts',workers:1,timeout:60000,use:{baseURL:`http://127.0.0.1:${securityPort}`,headless:true,viewport:{width:1440,height:1000}}});
