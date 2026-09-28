/** Gentle, resumable real-browser retry of blocked source-listed URLs. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { classifyGovernmentPage } from '../server/government-url-check';
const input=JSON.parse(gunzipSync(readFileSync('scripts/data/gov-round2-input.json.gz')).toString());
const file='analysis/gov-round2-browser.json';
const results:any[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
const done=new Set(results.map(r=>r.url));
const all=[...input['gov-data-audit'].records,...input['gov-browser-review'],...input['gov-jurisdiction-review'],...input['gov-replacement-review'],...Object.values(input['gov-netr-refresh'].states).flatMap((s:any)=>s.checks.flatMap((r:any)=>(r.offices||[]).map((o:any)=>({...o.verification,oldUrl:o.portalUrl,kind:'appraiser'}))))];
const candidates=new Map<string,any>();
for(const r of all) if(r.oldUrl && (r.httpStatus===403||r.httpStatus===429||r.httpStatus>=500||/timeout|timed.?out|CERT|SIGNATURE|TLS/i.test(r.reason||''))) candidates.set(r.oldUrl,r);
// Revisit shared statewide endpoints once, even when only identity was inconclusive.
for(const r of all) if(r.oldUrl && /sdat.dat.maryland.gov|svc.mt.gov\/dor/i.test(r.oldUrl))candidates.set(r.oldUrl,r);
const browser=await chromium.launch({headless:true});
let count=0;
const queue=[...candidates].filter(([url])=>!done.has(url));
let next=0;const hosts=new Map<string,Promise<void>>();
async function check(url:string,r:any){
 const context=await browser.newContext();const page=await context.newPage();
 await page.route('**/*',route=>['image','media','font'].includes(route.request().resourceType())?route.abort():route.continue());
 let result:any;
 try{
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:16000});
  await page.waitForTimeout(1800);
  const html=await page.content();const finalUrl=page.url();const httpStatus=response?.status()||null;
  result={...classifyGovernmentPage({html,finalUrl,httpStatus},r.kind),httpStatus,finalUrl,text:await page.locator('body').innerText({timeout:2000}).catch(()=>'' )};
 }catch(e:any){result={status:'unverified',reason:e.message.split('\n')[0],finalUrl:page.url()};}
 await context.close().catch(()=>{});
 results.push({url,kind:r.kind,...result,checkedAt:new Date().toISOString()});
 writeFileSync(file,JSON.stringify(results,null,2)+'\n');
 if(++count%10===0)console.log(`${results.length}/${candidates.size} browser retries`);
 await new Promise(resolve=>setTimeout(resolve,700));
 }
await Promise.all(Array.from({length:3},async()=>{
 while(next<queue.length){
  const [url,r]=queue[next++];const host=new URL(url).host;
  const task=(hosts.get(host)||Promise.resolve()).then(()=>check(url,r));hosts.set(host,task);await task;
 }
}));
await browser.close();console.log(`Complete: ${results.length} distinct URLs`);
