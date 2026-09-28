/** Read-only government API coverage plus an isolated empty-scope search, using curl. */
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const base='http://127.0.0.1:8159';
const results:any[]=[];
function call(path:string, body?:any, method?:string){
 const args=['-fsS','--max-time','30',base+path];
 if(body)args.push('-H','Content-Type: application/json','--data',JSON.stringify(body));
 if(method)args.push('-X',method);
 const value=JSON.parse(execFileSync('curl',args,{maxBuffer:30*1024*1024}).toString());
 results.push({path,method:method||(body?'POST':'GET'),status:200,records:Array.isArray(value)?value.length:undefined});return value;
}
const counties=call('/api/counties');call('/api/databases/counts');
const databases=call('/api/databases');call('/api/databases?filtered=true&stateCode=WA&limit=25');
const apps=call('/api/property-appraisers');
const countyId=apps[0].countyId;
call(`/api/property-appraisers/county/${countyId}`);call(`/api/databases/county/${countyId}`);
call(`/api/property-records/${countyId}`);call('/api/property-lookup',{countyId,address:'Unmatched audit fixture'});
const empty=counties.find((c:any)=>!databases.some((d:any)=>d.countyId===c.id&&d.isActive&&(d.portalUrl||d.searchUrl)));
if(!empty)throw Error('No empty scope available; refusing broad live scrape');
const search=call('/api/search',{searchType:'address',searchValue:'Unmatched audit fixture',scopeCountyId:empty.id});
await new Promise(r=>setTimeout(r,1000));
call(`/api/search/live/${search.searchId}`);
call(`/api/search-queries/${search.query.id}`,undefined,'DELETE');
writeFileSync('analysis/gov-api-smoke.json',JSON.stringify({checkedAt:new Date().toISOString(),base,emptySearchCountyId:empty.id,results},null,2)+'\n');
console.log(`Verified ${results.length} lane API calls with curl`);
