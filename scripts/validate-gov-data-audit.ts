/** Independent artifact checks: every published URL and phone needs audit evidence. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isGenericGovernmentVendorUrl} from '../server/government-url-check';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const audit=read('analysis/gov-data-audit.json');const netr=read('analysis/gov-netr-refresh.json');
const apps=read('server/data/appraisers.json');const permits=read('server/data/permit-portals.json');
const evidence=[...read('analysis/gov-jurisdiction-review.json'),...read('analysis/gov-browser-review.json'),...read('analysis/gov-replacement-review.json'),...read('analysis/gov-manual-verification.json')];
const sources=new Map(Object.values(netr.states).flatMap((s:any)=>s.checks).map((r:any)=>[r.index,r]));
assert.equal(audit.records.length,apps.length+permits.length);assert.equal(sources.size,apps.length);assert.equal(Object.keys(netr.states).length,51);
assert.equal(new Set(audit.records.map((r:any)=>`${r.kind}/${r.index}`)).size,audit.records.length);
let urls=0,phones=0;
for(const r of audit.records){
 const row=r.kind==='appraiser'?apps[r.index]:permits[r.index];const url=r.kind==='appraiser'?row.portalUrl:row.url;
 assert.equal(url,r.newUrl);
 if(url){
  assert.equal(row.linkStatus,'live');assert.equal(isGenericGovernmentVendorUrl(url),false);
  assert(evidence.some((e:any)=>e.kind===r.kind&&e.key===r.key&&e.status==='live'&&e.finalUrl===url&&(e.jurisdictionMatched||e.linkedFromSource)),`No jurisdiction/source evidence for ${r.key}`);urls++;
 }else assert.equal(row.linkStatus,'none');
 if(r.kind==='appraiser'&&row.phone){
  const source:any=sources.get(r.index);
  assert(source?.offices?.some((o:any)=>o.name===row.name&&o.phone===row.phone),`No current NETR phone evidence for ${r.key}`);phones++;
 }
}
writeFileSync('analysis/gov-data-validation.json',JSON.stringify({checkedAt:new Date().toISOString(),records:audit.records.length,netrRecords:sources.size,states:51,verifiedUrls:urls,sourceVerifiedPhones:phones,assertions:['every published URL has successful jurisdiction/source evidence','no generic vendor homepages retained','every published appraiser phone matches the current NETR office row','all record indices are unique and covered','null URLs have none status']},null,2)+'\n');
console.log(`Validated ${urls} URLs and ${phones} source-backed phones across ${audit.records.length} records`);
