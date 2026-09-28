/** Validate the published tier artifact against source/check provenance. No network or DB. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isGenericGovernmentVendorUrl } from '../server/government-url-check';
const input=JSON.parse(gunzipSync(readFileSync('scripts/data/gov-round2-input.json.gz')).toString());
const report=JSON.parse(readFileSync('analysis/gov-round2-decisions.json','utf8'));
const read=(name:string)=>JSON.parse(readFileSync(`server/data/${name}.json`,'utf8'));
const data={appraiser:read('appraisers'),permit:read('permit-portals')};
assert.equal(report.decisions.length,5117);
assert.equal(new Set(report.decisions.map((r:any)=>`${r.kind}/${r.index}`)).size,5117);
let visible=0,phones=0;
for(const r of report.decisions){
 const row=data[r.kind as keyof typeof data][r.index];
 const baseline=input.baseline[r.kind==='appraiser'?'appraisers':'permit-portals'][r.index];
 const url=r.kind==='appraiser'?row.portalUrl:row.url;
 assert.equal(url,r.url);assert.equal(row.linkStatus,r.status);
 assert.equal(r.kind==='appraiser'?row.county:row.jurisdiction,r.kind==='appraiser'?baseline.county:baseline.jurisdiction);
 if(url){
  assert(['verified','unconfirmed'].includes(row.linkStatus));
  assert(!isGenericGovernmentVendorUrl(url));assert(/^https?:/.test(url));
  assert(r.candidates.some((c:any)=>c.status===row.linkStatus&&c.checkedAt),`No checked source candidate: ${r.key}`);
  assert(row.lastVerifiedAt && !Number.isNaN(Date.parse(row.lastVerifiedAt)),`Missing check date: ${r.key}`);
  visible++;
 }else assert(['dead','none'].includes(row.linkStatus));
 if(r.kind==='appraiser'){
  assert.equal(row.phone,baseline.phone);assert.equal(row.name,baseline.name);
  if(row.phone)phones++;
 }
}
const maryland=data.appraiser.filter((r:any)=>r.stateCode==='MD');
assert.equal(maryland.length,24);assert(maryland.every((r:any)=>r.linkStatus==='verified'));
// Every dead candidate received a fresh replacement-source search before nulling.
const replacementPath='analysis/gov-round2-replacements.json';
const replacements=existsSync(replacementPath)?JSON.parse(readFileSync(replacementPath,'utf8')):JSON.parse(gunzipSync(readFileSync('scripts/data/gov-round2-replacements.json.gz')).toString());
for(const r of report.decisions.filter((r:any)=>r.status==='dead'))assert(replacements.some((s:any)=>s.kind===r.kind&&s.index===r.index),`No replacement search: ${r.key}`);
const result={records:5117,visibleUrls:visible,unchangedSourcePhones:phones,marylandVerified:24,allDeadCandidatesResearched:true};
writeFileSync('analysis/gov-round2-validation.json',JSON.stringify(result,null,2)+'\n');console.log(result);
