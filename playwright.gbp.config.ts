import {defineConfig} from '@playwright/test';
const port=process.env.E2E_PORT,db=process.env.E2E_DB;
// Lane a2, or the theme lane's ports (8470–8479) on the a6 scratch DB.
if(!((port==='8139'&&db==='constructhub_dev_a2')||(Number(port)>=8470&&Number(port)<=8479&&db==='constructhub_dev_a6'))) throw new Error('GBP audit requires lane a2 (8139) or 8470–8479 on constructhub_dev_a6');
export default defineConfig({testDir:'./e2e',testMatch:['gbp.spec.ts','profile-guard.spec.ts'],workers:1,timeout:30000,use:{baseURL:`http://127.0.0.1:${port}`,headless:true,viewport:{width:1440,height:1000}}});
