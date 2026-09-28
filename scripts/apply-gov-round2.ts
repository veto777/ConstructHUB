/** Reclassify preserved source evidence; no crawl and no fabricated replacements.
 * --preview writes decisions/counts only. Applying is deterministic and rerunnable.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { classifySourceListedLink, type LinkEvidence } from '../server/government-link-policy';
const input=JSON.parse(gunzipSync(readFileSync('scripts/data/gov-round2-input.json.gz')).toString());
const optional=(name:string)=>existsSync(`analysis/${name}.json`)?JSON.parse(readFileSync(`analysis/${name}.json`,'utf8')):existsSync(`scripts/data/${name}.json.gz`)?JSON.parse(gunzipSync(readFileSync(`scripts/data/${name}.json.gz`)).toString()):[];
const statewide=JSON.parse(readFileSync('scripts/data/gov-round2-statewide.json','utf8'));
const manual=JSON.parse(readFileSync('scripts/data/gov-round2-manual.json','utf8'));
const browser=optional('gov-round2-browser');const replacements=optional('gov-round2-replacements');
const audit=input['gov-data-audit'];const data=structuredClone(input.baseline);
const sources=new Map<number,any>(Object.values(input['gov-netr-refresh'].states).flatMap((s:any)=>s.checks).map((r:any)=>[r.index,r]));
const reviews=[...input['gov-jurisdiction-review'],...input['gov-browser-review'],...input['gov-replacement-review']];
const counts:any={appraiser:{},permit:{}};const decisions:any[]=[];
for(const r of audit.records){
 const row=r.kind==='appraiser'?data.appraisers[r.index]:data['permit-portals'][r.index];
 const field=r.kind==='appraiser'?'portalUrl':'url';
 const identity={state:r.state,jurisdiction:r.kind==='appraiser'?row.county:row.jurisdiction.split(',')[0],sourceListed:true};
 const source=sources.get(r.index);
 const candidates:any[]=[];
 function add(url:string|null|undefined,check:any,sourceUrl:string|null,priority=0){
  if(!url)return;
  const retry=browser.find((b:any)=>b.url===url||b.url===check?.oldUrl||b.url===check?.finalUrl);
  // New real-browser outcomes supersede stale transport/content verdicts.
  const independent=manual.find((m:any)=>m.url===url&&m.state===r.state);
  const evidence=independent && (!retry || classifySourceListedLink(url,retry,identity)!=='dead') ? independent : retry||check;
  const status=classifySourceListedLink(url,evidence,identity);
  candidates.push({url,status,evidence,sourceUrl,priority});
 }
 const originalReview=reviews.filter((v:any)=>v.kind===r.kind&&v.index===r.index&&v.oldUrl===r.oldUrl).at(-1)||r;
 add(r.oldUrl,originalReview,r.sourceCheck||row.sourceUrl||null);
 for(const o of (r.kind==='appraiser'?source?.offices||[]:[])){
  if(!o.portalUrl)continue;
  const check=reviews.filter((v:any)=>v.kind===r.kind&&v.index===r.index&&v.oldUrl===o.portalUrl).at(-1)||(o.portalUrl===r.oldUrl?originalReview:o.verification);
  add(o.portalUrl,check,source.source,1);
 }
 // Keep already verified round-1 replacements with their evidence.
 if(row[field]){
  const check=input['gov-manual-verification'].find((v:any)=>v.kind===r.kind&&v.key===r.key&&v.status==='live'&&v.finalUrl===row[field]&&v.linkedFromSource)||reviews.find((v:any)=>v.kind===r.kind&&v.index===r.index&&v.status==='live'&&v.finalUrl===row[field]);
  if(!check)throw Error(`Missing accepted evidence: ${r.key}`);
  add(row[field],check,row.sourceUrl||r.replacementSource||r.sourceCheck||null,2);
 }
 for(const replacement of replacements.filter((v:any)=>v.kind===r.kind&&v.index===r.index)){
  for(const c of replacement.candidates||[])if(c.linkedFromSource)add(c.url,c,c.sourceUrl||replacement.sourceUrl,3);
 }
 if(r.kind==='appraiser' && r.state===statewide.state && statewide.linkedFromSource && statewide.sourceStatus===200 &&
    candidates.some(c=>['www.assessment.cot.tn.gov','assessment.cot.tn.gov'].includes(new URL(c.url).hostname)))
  add(statewide.url,statewide,statewide.sourceUrl,3);
 const rank:any={verified:3,unconfirmed:2,dead:1,none:0};
 candidates.sort((a,b)=>rank[b.status]-rank[a.status]||b.priority-a.priority);
 const chosen=candidates[0];
 const before=row[field]?'verified':candidates.length?'dead':'none';
 const status=chosen?.status||'none';
 const url=status==='verified'||status==='unconfirmed'?(status==='verified'&&/^https?:/.test(chosen.evidence?.finalUrl||'')?chosen.evidence.finalUrl:chosen.url):null;
 const previousUrl=row[field];
 row[field]=url;row.linkStatus=status;
 row.lastVerifiedAt=chosen?.evidence?.checkedAt||row.lastVerifiedAt||null;
 if(chosen?.sourceUrl)row.sourceUrl=chosen.sourceUrl;
 row.candidateUrl=url||chosen?.url||null;
 if(!url || (previousUrl && new URL(previousUrl).host!==new URL(url).host))row.platform=null;
 const c=counts[r.kind][r.state]??={before:{verified:0,unconfirmed:0,dead:0,none:0},after:{verified:0,unconfirmed:0,dead:0,none:0}};
 c.before[before]++;c.after[status]++;
 decisions.push({kind:r.kind,index:r.index,key:r.key,state:r.state,beforeUrl:previousUrl,url,status,sourceUrl:chosen?.sourceUrl||null,candidateUrl:chosen?.url||null,checkedAt:row.lastVerifiedAt,reason:chosen?.evidence?.reason||'No source URL',candidates:candidates.map(c=>({url:c.url,status:c.status,sourceUrl:c.sourceUrl,reason:c.evidence?.reason,checkedAt:c.evidence?.checkedAt}))});
}
writeFileSync('analysis/gov-round2-decisions.json',JSON.stringify({counts,decisions},null,2)+'\n');
if(!process.argv.includes('--preview')){
 const manifestFile='scripts/data/gov-round2-output-hashes.json';
 const prior=existsSync(manifestFile)?JSON.parse(readFileSync(manifestFile,'utf8')):{};
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const outputs:any={};const hashes:any={};
 for(const name of ['appraisers','permit-portals']){
  outputs[name]=JSON.stringify(data[name],null,2)+'\n';hashes[name]=hash(outputs[name]);
  const current=hash(readFileSync(`server/data/${name}.json`,'utf8'));
  if(![hash(JSON.stringify(input.baseline[name],null,2)+'\n'),prior[name],hashes[name]].includes(current))throw Error(`Refusing to overwrite unrelated changes in ${name}`);
 }
 for(const name of Object.keys(outputs))writeFileSync(`server/data/${name}.json`,outputs[name]);
 writeFileSync(manifestFile,JSON.stringify(hashes,null,2)+'\n');
}
for(const kind of Object.keys(counts)){
 const total:any={before:{},after:{}};
 for(const c of Object.values(counts[kind]) as any[])for(const when of ['before','after'])for(const [tier,n] of Object.entries(c[when]))total[when][tier]=(total[when][tier]||0)+Number(n);
 console.log(kind,JSON.stringify(total));
}
