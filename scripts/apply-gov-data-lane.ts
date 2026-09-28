/** Prove bundled changes reconcile existing lane rows without losing IDs or notes. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
if(!process.env.DATABASE_URL||new URL(process.env.DATABASE_URL).pathname!=='/constructhub_dev_a4')throw Error('Only constructhub_dev_a4 is authorized');
const {db,pool}=await import('../server/db');
const {propertyAppraisers,permitDatabases}=await import('../shared/schema');
const {seedAllAppraisers}=await import('../server/seed-all-appraisers');
const {seedPermitPortals}=await import('../server/seed-permit-portals');
const snapshot=async()=>({appraisers:await db.select().from(propertyAppraisers),permits:await db.select().from(permitDatabases)});
const before=await snapshot();
await seedAllAppraisers();await seedPermitPortals();
const after=await snapshot();
await seedAllAppraisers();await seedPermitPortals();
const repeated=await snapshot();
const evidence:any={database:'constructhub_dev_a4',checkedAt:new Date().toISOString(),tables:{}};
for(const name of ['appraisers','permits'] as const){
 const map=new Map(after[name].map(r=>[r.id,r]));const repeat=new Map(repeated[name].map(r=>[r.id,r]));
 let urlsChanged=0,phonesChanged=0,statusChanged=0;
 for(const old of before[name]){
  const next=map.get(old.id);assert(next,`Lost ${name} ID ${old.id}`);assert.equal(next.notes,old.notes);
  if(next.portalUrl!==old.portalUrl||next.searchUrl!==old.searchUrl)urlsChanged++;
  if(next.phone!==old.phone)phonesChanged++;
  if(next.linkStatus!==old.linkStatus||next.isActive!==old.isActive)statusChanged++;
 }
 assert.equal(repeated[name].length,after[name].length);
 for(const row of after[name])assert.deepEqual(repeat.get(row.id),row);
 evidence.tables[name]={before:before[name].length,after:after[name].length,afterRepeat:repeated[name].length,urlsChanged,phonesChanged,statusChanged,allPriorIdsRetained:true,allPriorNotesRetained:true,repeatChangedRows:0};
}
writeFileSync('analysis/gov-data-db-proof.json',JSON.stringify(evidence,null,2)+'\n');
await pool.end();console.log('Full seed proof passed');
