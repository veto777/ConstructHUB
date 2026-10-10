import * as cheerio from 'cheerio';
import { assertPublicResponse, formValues, isoDate, portalSession } from './smartgov';
import { parsePermitTables } from './etrakit';
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from './types';

export function click2govUrl(input:string):string {
  const u=new URL(input);if(!['http:','https:'].includes(u.protocol)||!/^\/Click2GovBP(?:\/|$)/i.test(u.pathname))throw new Error('Not a Click2Gov Building Permits URL');
  // Stored CSRF tokens belong to an expired session; start a fresh public session.
  u.searchParams.delete('OWASP_CSRFTOKEN');return u.href;
}
export function click2govSearchForm(html:string,type:PermitSearchType,value:string):{action:string;body:URLSearchParams}{
  const $=cheerio.load(html);const id=type==='permit'?'is0':type==='address'?'is1':['name','company'].includes(type)?'is3':null;
  if(!id)throw new Error(`Unsupported Click2Gov search: ${type}`);
  const form=$(`#${id} form`);if(!form.length)throw new Error(`Click2Gov ${type} search form unavailable`);
  const body=formValues(html,`#${id} form`);
  const set=(name:string,text:string)=>{if(!form.find(`[name="${name}"]`).length)throw new Error(`Click2Gov field unavailable: ${name}`);body.set(name,text)};
  if(type==='permit'){
    const parts=value.trim().match(/^(\d{2})-(\d{1,8})$/);
    if(!parts)throw new Error('Click2Gov application number must use the portal format YY-NUMBER');
    set('permit.appYear',parts[1]);set('permit.appNumber',parts[2]);
  }else if(type==='address'){
    const parts=value.trim().match(/^(\d+[A-Za-z]?)\s+(.+)$/);if(parts)set('parcel.streetNumber',parts[1]);set('parcel.streetName',parts?.[2]??value);
    if(form.find('[name="streetSearchType"] option[value="C"]').length)set('streetSearchType','C');
  }else{set('searchName',value);if(form.find('[name="searchNameSearchType"] option[value="C"]').length)set('searchNameSearchType','C');}
  const button=form.find('input[type="submit"]').first();if(button.attr('name'))body.set(button.attr('name')!,button.attr('value')||'');
  return {action:form.attr('action')!,body};
}
export function parseClick2GovDetail(html:string,ctx:AdapterCtx,url:string):PermitRecord|null{
  const $=cheerio.load(html);const pairs:Record<string,string>={};
  // Exact label elements only; do not guess fields from arbitrary dates/names in the page.
  $('span,label').each((_i,e)=>{
    const el=$(e);const label=el.text().replace(/\s+/g,' ').trim();
    if(!/^(Application #|Permit #|Parcel ID|Address|Owner|Application Date|Application Type|Valuation|Issue Date|Expiration Date|Application Status|Status|Description|Contractor|General Contractor|Work Description):$/i.test(label))return;
    const container=el.closest('.row');
    const value=el.parent().next().text().replace(/\s+/g,' ').trim() || el.next().text().replace(/\s+/g,' ').trim();
    if(value && value!==label && !value.endsWith(':') && container.length)pairs[label.replace(/:$/,'').toLowerCase()]=value;
  });
  const displayedNumber=pairs['application #']||pairs['permit #'];if(!displayedNumber)return null;
  const parts=displayedNumber.match(/^(\d{2})\s*-\s*(\d+)$/);
  const number=parts?`${parts[1]}-${parts[2].padStart(8,'0')}`:displayedNumber;
  // Public selection URLs encode the displayed record identity; the POST URL alone does not.
  const source=new URL('selectpermit.html',url);
  source.searchParams.set('permit.appYearAndNumber',number);source.searchParams.set('validatePermitView','true');
  const get=(k:string)=>pairs[k]||null;const money=get('valuation')?.replace(/[$,\s]/g,'');
  return {permitNumber:number,databaseId:ctx.databaseId,jurisdiction:ctx.jurisdiction,address:get('address'),parcel:get('parcel id'),
    permitType:get('application type'),description:get('work description')||get('description'),status:get('application status')||get('status'),
    issuedAt:isoDate(get('issue date')),appliedAt:isoDate(get('application date')),expiresAt:isoDate(get('expiration date')),
    ownerName:get('owner'),contractorName:get('general contractor')||get('contractor'),valuation:money&&/^\d+(\.\d+)?$/.test(money)?Number(money):null,
    sourceUrl:source.href,raw:{html},};
}
export function parseClick2GovResults(html:string,ctx:AdapterCtx,url:string):PermitRecord[]{
  assertPublicResponse(html,url);const detail=parseClick2GovDetail(html,ctx,url);if(detail)return [detail];
  const rows=parsePermitTables(html,ctx,url,'table');
  for(const row of rows)if(row.sourceUrl){const source=new URL(row.sourceUrl);source.searchParams.delete('OWASP_CSRFTOKEN');row.sourceUrl=source.href;}
  if(rows.length)return rows;
  const $=cheerio.load(html);$('script,style').remove();
  if(/no matching records|no records (to display|found)|search returned no results|no data available in table|no permits found|no results returned/i.test($.text()))return [];
  throw new Error('Unrecognized Click2Gov results or validation failure');
}
async function run(ctx:AdapterCtx,q:{type:PermitSearchType;value:string},wantDetail=false):Promise<PermitRecord[]>{
  const request=portalSession(ctx);let page=await request(click2govUrl(ctx.searchUrl));
  let $=cheerio.load(page.html);
  if(!$('#searchMethod').length){const link=$('a[href*="selectpermit.html"]').first().attr('href');if(!link)throw new Error('Click2Gov public permit search unavailable');page=await request(new URL(link,page.url).href);}
  const form=click2govSearchForm(page.html,q.type,q.value);const action=new URL(form.action,page.url);
  if(action.origin!==new URL(page.url).origin)throw new Error('Click2Gov search form left the tenant');
  page=await request(action.href,form.body);const records=parseClick2GovResults(page.html,ctx,page.url);
  if(/serverSide\s*:\s*true|bServerSide\s*:\s*true/i.test(page.html))throw new Error('Click2Gov server-side pagination not supported; refusing incomplete results');
  if(wantDetail && records.length){
    const parts=q.value.match(/^(\d{2})-(\d+)$/)!;
    const number=`${parts[1]}-${parts[2].padStart(8,'0')}`;
    const exact=records.find(r=>r.permitNumber===number);if(!exact)throw new Error('Click2Gov returned a different permit');
    if(!exact.sourceUrl)throw new Error('Click2Gov detail link unavailable');
    if(!parseClick2GovDetail(page.html,ctx,page.url)){
      page=await request(exact.sourceUrl);const detail=parseClick2GovDetail(page.html,ctx,page.url);
      if(!detail||detail.permitNumber!==number)throw new Error('Click2Gov detail page did not match requested permit');return [detail];
    }
  }
  return records;
}
const adapter:PortalAdapter={
  platform:'Click2Gov',aliases:["CentralSquare Click2Gov", "CentralSquare Click2Gov Building Permits", "Click2Gov Building Permit", "Click2Gov Building Permits", "Click2Gov Building Permits (C.O.A.S.T)", "Click2Gov Building Permits (ePermits)"],capabilities:{search:['address','permit','name','company'],listRecent:false,detail:true},
  async search(ctx,q){if(!q.value?.trim())throw new Error('Search value is required');return run(ctx,q)},
  async listRecent(){return []},
  async detail(ctx,permitNumber){return (await run(ctx,{type:'permit',value:permitNumber},true))[0]??null},
};
export default adapter;
