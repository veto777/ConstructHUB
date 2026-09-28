/** Second content review: reject portals that do not identify the expected jurisdiction.
 * Can run while the primary audit progresses; reruns check only newly completed records.
 */
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { fetchGovernmentPage,classifyGovernmentPage } from '../server/government-url-check';
const replacements=process.argv.includes('--replacements');
const file=replacements?'analysis/gov-replacement-review.json':'analysis/gov-jurisdiction-review.json';
const results:any[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
const audit=JSON.parse(readFileSync('analysis/gov-data-audit.json','utf8'));
if(replacements){
 const netr=JSON.parse(readFileSync('analysis/gov-netr-refresh.json','utf8'));
 audit.records=Object.entries(netr.states).flatMap(([state,s]:any)=>s.checks.flatMap((r:any)=>(r.offices||[]).filter((o:any)=>o.verification?.httpStatus===200&&o.verification?.status!=='dead').map((o:any)=>({kind:'appraiser',index:r.index,key:`${state}/${r.county}`,oldUrl:o.portalUrl,...o.verification,status:'live'}))));
}

for(let i=results.length-1;i>=0;i--) if(results[i].checkedAt<audit.startedAt) results.splice(i,1);
const done=new Set(results.map(r=>`${r.kind}/${r.index}/${r.oldUrl}`));
const candidates=audit.records.filter((r:any)=>r.status==='live'&&!done.has(`${r.kind}/${r.index}/${r.oldUrl}`));
const normalize=(s:string)=>s.toLowerCase().replace(/\bsaint\b/g,'st').replace(/[^a-z0-9]/g,'');
let idx=0;const hosts=new Map<string,Promise<void>>();
async function check(r:any){
 const p=await fetchGovernmentPage(r.finalUrl||r.oldUrl);const c=classifyGovernmentPage(p,r.kind);
 const $=cheerio.load(p.html);$('script,style').remove();
 const jurisdiction=(r.kind==='appraiser'?r.key.slice(3):r.key.split(',')[0]).replace(/\s*\([^)]*\)/g,'').replace(/\b(county|parish|borough|municipality|city and borough)\b/gi,'').trim();
 const identity=normalize($('body').text()+' '+$('title').text());
 const jurisdictionMatched=identity.includes(normalize(jurisdiction));
 results.push({kind:r.kind,index:r.index,key:r.key,oldUrl:r.oldUrl,finalUrl:p.finalUrl,httpStatus:p.httpStatus,...c,jurisdictionMatched,status:c.status==='live'&&!jurisdictionMatched?'unverified':c.status,reason:c.status==='live'&&!jurisdictionMatched?'page does not identify expected jurisdiction':c.status==='live'?'On-topic content identifies the expected jurisdiction':c.reason,checkedAt:new Date().toISOString()});
 if(results.length%20===0)writeFileSync(file,JSON.stringify(results,null,2)+'\n');
 await new Promise(r=>setTimeout(r,200));
}
await Promise.all(Array.from({length:4},async()=>{while(idx<candidates.length){const r=candidates[idx++];const host=new URL(r.finalUrl||r.oldUrl).host;const task=(hosts.get(host)||Promise.resolve()).then(()=>check(r));hosts.set(host,task);await task;}}));
writeFileSync(file,JSON.stringify(results,null,2)+'\n');console.log(`Reviewed ${candidates.length}; cumulative ${results.length}`);
