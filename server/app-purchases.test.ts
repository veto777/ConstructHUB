import { beforeAll, afterAll, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { APP_NO_PURCHASE_ROUTES } from "./app-purchases";
let child:ChildProcess, base:string;
beforeAll(async()=>{
  child=spawn(process.execPath,["--import","tsx","server/test-fixtures/app-purchases-server.ts"],{stdio:["ignore","pipe","pipe","ipc"]});
  base=await new Promise<string>((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Fixture timeout')),30000);child.once('message',(m:any)=>{clearTimeout(t);resolve(`http://127.0.0.1:${m.port}`);});child.once('exit',()=>{clearTimeout(t);reject(Error('Fixture exited'));});});
},40000);
afterAll(async()=>{if(child&&child.exitCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGTERM');});});
for(const route of APP_NO_PURCHASE_ROUTES) {
  it(`${route}: refuses both apps and permits the website handler`,async()=>{
    const path=route.replace(':token','fixture-token');
    for(const ua of ['Mozilla/5.0 ConstructHUBApp/1.0','Mozilla/5.0 ConstructHUBCRM/2.3']) {
      for(const suffix of ['', '/?app=0']) {
        const r=await fetch(base+path+suffix,{method:'POST',headers:{'user-agent':ua}});
        expect(r.status).toBe(403);
        expect(await r.json()).toEqual({code:'app_no_purchase',message:"This can't be done in the app."});
      }
    }
    for(const ua of ['Mozilla/5.0 Safari/604.1','Mozilla/5.0 Chrome/130']) {
      const r=await fetch(base+path,{method:'POST',headers:{'user-agent':ua}});
      expect(r.status).toBe(200); expect(await r.json()).toEqual({website:true});
    }
  });
}
it("keeps reads and homeowner physical-service payments available",async()=>{
  for(const [method,path] of [['GET','/api/crm/voice/numbers'],['POST','/api/crm/invoices/fixture/payment-link']]) {
    expect((await fetch(base+path,{method,headers:{'user-agent':'ConstructHUBCRM/1.0'}})).status).toBe(200);
  }
});
it("guards the complete current checkout inventory and installs before auth/routes",()=>{
  const files=['server/stripe.ts','server/routes.ts','server/voice/numbers.ts'];
  const routes=files.flatMap(f=>Array.from(readFileSync(f,'utf8').matchAll(/app\.post\("([^"]+)"/g),m=>m[1]));
  for(const route of APP_NO_PURCHASE_ROUTES) expect(routes).toContain(route);
  const selling=routes.filter(r=>/checkout|\/stripe\/(change-plan|addons|create-portal)$|\/beta-codes\/redeem$|\/crm\/voice\/numbers$/.test(r));
  expect([...selling].sort()).toEqual([...APP_NO_PURCHASE_ROUTES].sort());
  const entry=readFileSync('server/index.ts','utf8');
  expect(entry.indexOf('registerAppPurchaseGuard(app)')).toBeLessThan(entry.indexOf('await setupAuth(app)'));
  expect(entry.indexOf('registerAppPurchaseGuard(app)')).toBeLessThan(entry.indexOf('await registerRoutes(httpServer, app)'));
});
