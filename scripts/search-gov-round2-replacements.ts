/** Revisit authoritative listings for dead URLs, then follow actual department links.
 * Never publish a guessed path, root URL, or search-engine result.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { isAssessmentOffice } from '../server/netr-office';
import { fetchGovernmentPage, classifyGovernmentPage } from '../server/government-url-check';
const decisions=JSON.parse(readFileSync('analysis/gov-round2-decisions.json','utf8')).decisions;
const file='analysis/gov-round2-replacements.json';
const results:any[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
const done=new Set(results.map(r=>`${r.kind}/${r.index}`));
const rows=decisions.filter((r:any)=>r.status==='dead'&&!done.has(`${r.kind}/${r.index}`));
let next=0;const hosts=new Map<string,Promise<any>>();
async function get(url:string){
 const host=new URL(url).host;
 const task=(hosts.get(host)||Promise.resolve()).then(async()=>{
  await new Promise(r=>setTimeout(r,500));
  return fetchGovernmentPage(url);
 });hosts.set(host,task.catch(()=>{}));return task;
}
async function check(r:any){
 const known=new Set(r.candidates.map((c:any)=>c.url));const found=new Map<string,string>();
 const sourceUrl=r.sourceUrl||r.candidateUrl;
 const source=await get(sourceUrl);let $=cheerio.load(source.html);
 if(r.kind==='appraiser'&&/netronline.com/.test(sourceUrl)){
  $('.div-table-row').each((_,el)=>{
   if(!isAssessmentOffice($(el).find('[col-name="Name"]').text()))return;
   const href=$(el).find('[col-name="Online"] a').first().attr('href');
   if(href&&/^https?:/.test(href)&&!known.has(href))found.set(href,sourceUrl);
  });
 }
 // A live, known official page can disclose a department replacement, but a
 // vendor homepage cannot establish which tenant belongs to this jurisdiction.
 let root:any=null;
 if(r.candidateUrl && /\.gov$|\.us$/.test(new URL(r.candidateUrl).hostname)){
  const rootUrl=new URL('/',r.candidateUrl).href;
  root=await get(rootUrl);$=cheerio.load(root.html);
  const topic=r.kind==='appraiser'?/assessor|apprais|property (search|records|tax)|tax assessor|real property/i:/permit|building (department|inspection)|development services/i;
  $('a[href]').each((_,el)=>{
   if(!topic.test($(el).text()))return;
   try{const href=new URL($(el).attr('href')!,root.finalUrl).href;if(/^https?:/.test(href)&&new URL(href).pathname!=='/'&&!known.has(href)&&found.size<4)found.set(href,root.finalUrl);}catch{}
  });
 }
 const candidates=[];
 for(const [url,linkedSource] of found){
  const response=await get(url);const c=classifyGovernmentPage(response,r.kind);
  const $=cheerio.load(response.html);$('script,style').remove();
  candidates.push({url,sourceUrl:linkedSource,linkedFromSource:true,...c,finalUrl:response.finalUrl,httpStatus:response.httpStatus,text:$('body').text().replace(/\s+/g,' ').slice(0,50000),checkedAt:new Date().toISOString()});
 }
 results.push({kind:r.kind,index:r.index,key:r.key,sourceUrl,sourceStatus:source.httpStatus,rootStatus:root?.httpStatus,candidates,checkedAt:new Date().toISOString()});
 writeFileSync(file,JSON.stringify(results,null,2)+'\n');
 if(results.length%10===0)console.log(`${results.length} dead-link replacement searches; ${rows.length} pending at start`);
}
await Promise.all(Array.from({length:2},async()=>{while(next<rows.length)await check(rows[next++]);}));
console.log(`Complete ${results.length} replacement searches`);
