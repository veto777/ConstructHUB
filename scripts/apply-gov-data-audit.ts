/** Apply completed URL/source audits. Unknown links become null, never guessed.
 * All decisions, old values, source URLs and per-state counts remain in the audit.
 */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {isGenericGovernmentVendorUrl} from '../server/government-url-check';
import {createHash} from 'node:crypto';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const report=read('analysis/gov-data-audit.json');
const netr=read('analysis/gov-netr-refresh.json');
const reviews=[...read('analysis/gov-jurisdiction-review.json'), ...(existsSync('analysis/gov-browser-review.json')?read('analysis/gov-browser-review.json'):[])];
const replacementReviews=existsSync('analysis/gov-replacement-review.json')?read('analysis/gov-replacement-review.json'):[];
for(const r of [...reviews,...replacementReviews]) if(r.finalUrl && isGenericGovernmentVendorUrl(r.finalUrl)){r.status='dead';r.reason='generic vendor homepage';}
const manual=existsSync('analysis/gov-manual-verification.json')?read('analysis/gov-manual-verification.json'):[];
const apps=read('server/data/appraisers.json');const permits=read('server/data/permit-portals.json');
const hashes=()=>Object.fromEntries(['appraisers','permit-portals'].map(name=>[name,createHash('sha256').update(readFileSync(`server/data/${name}.json`)).digest('hex')]));
const beforeHashes=hashes();
if(JSON.stringify(report.appliedOutputHashes)===JSON.stringify(beforeHashes)){console.log('Audit already applied; no changes.');process.exit(0);}
if(!report.completedAt||!netr.completedAt||report.records.length!==apps.length+permits.length)throw Error('Both audits must finish before application');
if(report.inputHashes&&JSON.stringify(report.inputHashes)!==JSON.stringify(beforeHashes))throw Error('Input JSON changed after audit');
const reviewMap=new Map<string,any>(reviews.map((r:any)=>[`${r.kind}/${r.index}`,r]));
const sources=new Map<number,any>(Object.entries(netr.states).flatMap(([state,s]:any)=>s.checks.map((r:any)=>({...r,state}))).map((r:any)=>[r.index,r]));
const phoneValid=(s:any)=>typeof s==='string'&&/^(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?$/i.test(s);
const counts:any={appraiser:{},permit:{}};
for(const r of report.records){
 const row=r.kind==='appraiser'?apps[r.index]:permits[r.index];
 if(!row)throw Error(`Missing record ${r.key}`);
 const review=reviewMap.get(`${r.kind}/${r.index}`);
 if(r.status==='live'&&!review)throw Error(`Jurisdiction review missing for ${r.key}`);
 if(review&&review.oldUrl!==r.oldUrl)throw Error(`Mismatched review ${r.key}`);
 let verified=review?.status==='live'?review:null;
 let sourceUrl:string|null=null;
 let candidateUrl=r.checkedUrl||r.oldUrl||null;
 r.oldPhone=row.phone??null;r.oldName=row.name??null;
 if(r.kind==='appraiser'){
  const source=sources.get(r.index);
  if(source && (source.county!==row.county || source.state!==row.stateCode))throw Error(`Source identity mismatch: ${r.key}`);
  r.sourceCheck=source?.source||null;
  const offices=(source?.offices||[]).map((o:any)=>({...o,check:o.portalUrl===r.oldUrl?review:replacementReviews.find((v:any)=>v.index===r.index&&v.oldUrl===o.portalUrl)}));
  offices.sort((a:any,b:any)=>Number(b.check?.status==='live')-Number(a.check?.status==='live')||Number(/apprais/i.test(b.name))-Number(/apprais/i.test(a.name))||Number(b.name===row.name)-Number(a.name===row.name));
  const office=offices[0];
  if(office){
   candidateUrl=office.portalUrl||candidateUrl;
   row.name=office.name;row.phone=phoneValid(office.phone)?office.phone:null;
   row.sourceUrl=source.source;row.sourceVerifiedAt=source.checkedAt;
   if(office.check?.status==='live'){verified=office.check;sourceUrl=source.source;}
  }else{
   row.phone=null; // No current source office: do not retain an unconfirmed phone.
   if(row.name===`${row.county} Assessor`){row.name=`${row.county} property records`;row.phone=null;}
  }
  row.officeVerified=!!office || !!verified;
 }
 const replacement=manual.find((m:any)=>m.kind===r.kind&&m.key===r.key&&m.status==='live'&&m.linkedFromSource);
 if(replacement){verified=replacement;sourceUrl=replacement.sourceUrl;if(r.kind==='appraiser')row.officeVerified=true;}
 const newUrl=verified?.finalUrl||null;
 r.jurisdictionReview=review?{status:review.status,reason:review.reason,checkedAt:review.checkedAt}:null;
 r.newUrl=newUrl;r.newPhone=row.phone??null;r.newName=row.name??null;
 r.replacementSource=sourceUrl;
 r.decision=newUrl?(r.oldUrl?newUrl===r.oldUrl?'retained':'fixed':'added'):r.oldUrl?'nulled':'none';
 r.decisionReason=verified?'Live on-topic page with jurisdiction/source evidence':review?.reason||r.reason;
 row[r.kind==='appraiser'?'portalUrl':'url']=newUrl;
 row.candidateUrl=newUrl||candidateUrl;
 row.linkStatus=newUrl?'live':'none';
 row.lastVerifiedAt=verified?.checkedAt||r.checkedAt;
 if(!newUrl)row.platform=null;
 else if(!r.oldUrl || new URL(newUrl).hostname.replace(/^www\./,'') !== new URL(r.oldUrl).hostname.replace(/^www\./,'')) row.platform=null; // do not carry a stale vendor label across a host migration
 if(sourceUrl)row.sourceUrl=sourceUrl;
 const c=counts[r.kind][r.state]??={records:0,beforeUrls:0,beforeLive:0,beforeDead:0,beforeUnverified:0,beforeNone:0,afterLive:0,afterNull:0,fixed:0,nulled:0,added:0,phonesAdded:0,phonesChanged:0};
 c.records++;if(r.oldUrl)c.beforeUrls++;
 const status=review?.status||r.status;
 c[status==='live'?'beforeLive':status==='dead'?'beforeDead':status==='none'?'beforeNone':'beforeUnverified']++;
 c[newUrl?'afterLive':'afterNull']++;
 if(['fixed','nulled','added'].includes(r.decision))c[r.decision]++;
 if(!r.oldPhone&&r.newPhone)c.phonesAdded++;
 if(r.oldPhone!==r.newPhone)c.phonesChanged++;
}
report.inputHashes??=beforeHashes;
report.appliedAt=new Date().toISOString();report.counts=counts;
writeFileSync('server/data/appraisers.json',JSON.stringify(apps,null,2)+'\n');
writeFileSync('server/data/permit-portals.json',JSON.stringify(permits,null,2)+'\n');
report.appliedOutputHashes=hashes();
writeFileSync('analysis/gov-data-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(counts,null,2));
