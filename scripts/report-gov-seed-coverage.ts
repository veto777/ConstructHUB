/** Record exact source-to-DB coverage; never guess county IDs for unmatched municipalities. */
import {readFileSync,writeFileSync} from 'node:fs';
if(!process.env.DATABASE_URL||new URL(process.env.DATABASE_URL).pathname!=='/constructhub_dev_a4')throw Error('Only constructhub_dev_a4 is authorized');
const {db,pool}=await import('../server/db');const {counties,propertyAppraisers,permitDatabases}=await import('../shared/schema');
const apps=JSON.parse(readFileSync('server/data/appraisers.json','utf8'));const portals=JSON.parse(readFileSync('server/data/permit-portals.json','utf8'));
const cs=await db.select().from(counties);const as=await db.select().from(propertyAppraisers);const ps=await db.select().from(permitDatabases);
const norm=(s:string)=>s.toLowerCase().replace(/\bst\.?\b/g,'saint').replace(/\bste\.?\b/g,'sainte').replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/i,'').replace(/[^a-z0-9]/g,'');
const countyKeys=new Set(cs.map(c=>`${c.stateCode}/${norm(c.name)}`));
const jurisdictions=new Set(ps.map(p=>p.jurisdiction));
writeFileSync('analysis/gov-seed-coverage.json',JSON.stringify({checkedAt:new Date().toISOString(),database:'constructhub_dev_a4',appraiserRows:as.length,permitRows:ps.length,unmatchedAppraisers:apps.filter((a:any)=>!countyKeys.has(`${a.stateCode}/${norm(a.county)}`)).map((a:any)=>({state:a.stateCode,jurisdiction:a.county,name:a.name})),unmatchedPermitPortals:portals.filter((p:any)=>!jurisdictions.has(p.jurisdiction)).map((p:any)=>p.jurisdiction)},null,2)+'\n');
await pool.end();
