/** Render JS-only government portals with Chromium. No login, form submission or CAPTCHA bypass. */
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import * as cheerio from 'cheerio';
import {classifyGovernmentPage} from '../server/government-url-check';
const file='analysis/gov-browser-review.json';
const results:any[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
const audit=JSON.parse(readFileSync('analysis/gov-data-audit.json','utf8'));
for(let i=results.length-1;i>=0;i--) if(results[i].checkedAt<audit.startedAt) results.splice(i,1);
const done=new Set(results.map(r=>`${r.kind}/${r.index}`));
const identityReviews=existsSync('analysis/gov-jurisdiction-review.json')?JSON.parse(readFileSync('analysis/gov-jurisdiction-review.json','utf8')):[];
const identityMap=new Map(identityReviews.map((r:any)=>[`${r.kind}/${r.index}`,r]));
const rows=audit.records.map((r:any)=>{const v:any=identityMap.get(`${r.kind}/${r.index}`);return v?.status==='unverified'?{...r,...v}:r;}).filter((r:any)=>r.status==='unverified'&&r.httpStatus===200&&!done.has(`${r.kind}/${r.index}`)).sort((a:any,b:any)=>Number(b.kind==='permit')-Number(a.kind==='permit'));
const normalize=(s:string)=>s.toLowerCase().replace(/\bsaint\b/g,'st').replace(/[^a-z0-9]/g,'');
const browser=await chromium.launch({headless:true});
let i=0;const hosts=new Map<string,Promise<void>>();
async function check(r:any){
 const context=await browser.newContext({userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'});
 const page=await context.newPage();
 await page.route('**/*', route=>['image','media','font'].includes(route.request().resourceType())?route.abort():route.continue());
 let result:any;
 try{
  const res=await page.goto(r.finalUrl||r.oldUrl,{waitUntil:'commit',timeout:18000});
  await page.waitForLoadState('domcontentloaded',{timeout:8000}).catch(()=>{});
  await page.waitForTimeout(2500);
  const html=await page.content();const finalUrl=page.url();
  const $=cheerio.load(html);$('script,style').remove();
  const jurisdiction=(r.kind==='appraiser'?r.key.slice(3):r.key.split(',')[0]).replace(/\s*\([^)]*\)/g,'').replace(/\b(county|parish|borough|municipality|city and borough)\b/gi,'').trim();
  const jurisdictionMatched=normalize($('body').text()+' '+$('title').text()).includes(normalize(jurisdiction));
  const c=classifyGovernmentPage({html,finalUrl,httpStatus:res?.status()||null},r.kind);
  result={...c,finalUrl,httpStatus:res?.status(),jurisdictionMatched,status:c.status==='live'&&!jurisdictionMatched?'unverified':c.status,reason:c.status==='live'&&!jurisdictionMatched?'rendered page does not identify expected jurisdiction':c.status==='live'?'On-topic content identifies the expected jurisdiction':c.reason};
 }catch(e:any){result={status:'unverified',reason:e.name,finalUrl:page.url()};}
 finally{await context.close().catch(()=>{});}
 results.push({kind:r.kind,index:r.index,key:r.key,oldUrl:r.oldUrl,...result,checkedAt:new Date().toISOString(),method:'Chromium GET + 2.5 second render; no interaction'});
 if(results.length%10===0){writeFileSync(file,JSON.stringify(results,null,2)+'\n');console.log(`Browser reviewed ${results.length}`);}
}
await Promise.all(Array.from({length:4},async()=>{while(i<rows.length){const r=rows[i++];const host=new URL(r.finalUrl||r.oldUrl).host;const task=(hosts.get(host)||Promise.resolve()).then(()=>check(r));hosts.set(host,task);await task;}}));
await browser.close();writeFileSync(file,JSON.stringify(results,null,2)+'\n');console.log(`Done ${rows.length}; cumulative ${results.length}`);
