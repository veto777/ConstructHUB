/** Verify explicitly source-discovered replacements; never invent a URL. */
import { readFileSync, writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { fetchGovernmentPage, classifyGovernmentPage } from '../server/government-url-check';
const candidates = JSON.parse(readFileSync('analysis/gov-manual-candidates.json','utf8'));
const results=[];
for(const c of candidates){
 const source=await fetchGovernmentPage(c.sourceUrl);
 const $=cheerio.load(source.html);
 const linked=c.url===c.sourceUrl || $('a[href]').toArray().some(el=>{try{return new URL($(el).attr('href')!,source.finalUrl).href===c.url;}catch{return false;}});
 const p=c.url===c.sourceUrl ? source : await fetchGovernmentPage(c.url);
 results.push({...c,sourceStatus:source.httpStatus,linkedFromSource:linked,finalUrl:p.finalUrl,httpStatus:p.httpStatus,...classifyGovernmentPage(p,c.kind),checkedAt:new Date().toISOString()});
}
writeFileSync('analysis/gov-manual-verification.json',JSON.stringify(results,null,2)+'\n');
console.log(results.map(r=>({key:r.key,status:r.status,linked:r.linkedFromSource})));
