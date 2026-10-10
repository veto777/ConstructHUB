import * as cheerio from 'cheerio';
import { assertPublicResponse, formValues, isoDate, portalSession } from './smartgov';
import { parsePermitTables } from './etrakit';
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from './types';

export function ftgUrl(input:string):string {
  const u=new URL(input);
  if(!['http:','https:'].includes(u.protocol)||!/\/Permits\/Search\.aspx$/i.test(u.pathname))throw new Error('Not an FTG public permit search URL');
  return u.href;
}
export function ftgSearchBody(html:string,type:PermitSearchType|'applied',value:string):URLSearchParams {
  const $=cheerio.load(html);const body=formValues(html);
  if(!$('[id*="FTGSearchControl"]').length)throw new Error('Response is not an FTG search form');
  const fill=(selector:string,text:string)=>{const input=$(selector).first();if(!input.length)throw new Error(`FTG search field unavailable: ${type}`);body.set(input.attr('name')!,text)};
  switch(type){
    case 'applied':{
      const since=isoDate(value);if(!since)throw new Error('Expected an ISO date');
      const days=(Date.now()-Date.parse(since))/86400000;
      const choices=[{code:'D30',days:29},{code:'M3',days:85},{code:'Y1',days:364}];
      const input=$('select[id$="ddReportedOn"]');
      const range=choices.find(c=>days<=c.days&&input.find(`option[value="${c.code}"]`).length);
      if(!range)throw new Error('FTG has no date window covering since; refusing an incomplete listing');
      body.set(input.attr('name')!,range.code);break;
    }
    case 'address':{const parts=value.trim().match(/^(\d+[A-Za-z]?)\s+(.+)$/);if(parts)fill('input[id$="txtStreetNumber"]',parts[1]);fill('input[id$="txtStreetName"]',parts?.[2]??value);break;}
    case 'permit':fill('input[id$="txtCaseID"],input[id*="PermitNumber"],input[id*="ApplicationID"]',value);break;
    case 'company':fill('input[id$="txtContractor"]',value);break;
    case 'name':fill('input[id$="txtOwnerName"]',value);break;
    default:throw new Error(`Unsupported FTG search: ${type}`);
  }
  const button=$('input[id$="btnSearch"][value="Search"]').first();if(!button.length)throw new Error('FTG search button missing');
  body.set(button.attr('name')!,'Search');return body;
}
export function parseFTGResults(html:string,ctx:AdapterCtx,url:string):PermitRecord[]{
  assertPublicResponse(html,url);
  const rows=parsePermitTables(html,ctx,url,'table.GeneralGrid,table[id*="dgExisting"],table[id*="Grid"]');if(rows.length)return rows;
  const $=cheerio.load(html);$('script,style').remove();
  if(/no (matching )?(records|results|applications|permits)( (were )?found| to display| match)|search (returned|found) (no|0)|entered criteria did not yield any results/i.test($.text()))return [];
  throw new Error('Unrecognized FTG result page (not an empty search)');
}
async function run(ctx:AdapterCtx,q:{type:PermitSearchType|'applied';value:string}):Promise<PermitRecord[]>{
    if(!q.value?.trim())throw new Error('Search value is required');
    const request=portalSession(ctx);let page=await request(ftgUrl(ctx.searchUrl));
    const data=ftgSearchBody(page.html,q.type,q.value);const $=cheerio.load(page.html);
    const action=new URL($('form').first().attr('action')||page.url,page.url);
    if(action.origin!==new URL(page.url).origin)throw new Error('FTG search form left the tenant');
    page=await request(action.href,data);const out:PermitRecord[]=[];const seen=new Set<string>();
    for(let index=0;index<1000;index++){
      const rows=parseFTGResults(page.html,ctx,page.url);
      if(index&&!rows.some(r=>!seen.has(r.permitNumber)))throw new Error('FTG pagination repeated a page');
      for(const row of rows)if(!seen.has(row.permitNumber)){seen.add(row.permitNumber);out.push(row)}
      const dom=cheerio.load(page.html);
      const direct=dom('.PagingButton a[href]').filter((_i,e)=>/^next page$/i.test(dom(e).text().trim())).first();
      if(direct.length){
        const url=new URL(direct.attr('href')!,page.url);
        if(url.origin!==new URL(page.url).origin)throw new Error('FTG next page left the tenant');
        page=await request(url.href);continue;
      }
      const next=dom('a[href*="Page$"]').filter((_i,e)=>/^(next|>|»|\.\.\.)$/i.test(dom(e).text().trim())).first();
      if(!next.length){
        const future=dom('a[href*="Page$"]').toArray().some(e=>Number(dom(e).text().trim())>index+1);
        if(future)throw new Error('FTG numbered pagination is unsupported; refusing partial results');
        if(q.type==='applied' && out.some(r=>!r.appliedAt))throw new Error('FTG date listing returned an unknown application date');
        return q.type==='applied'?out.filter(r=>r.appliedAt!>=isoDate(q.value)!):out;
      }
      const event=next.attr('href')?.match(/__doPostBack\(['"]([^'"]+)['"],['"]([^'"]+)['"]\)/);
      if(!event)throw new Error('FTG next-page postback unavailable');
      const body=formValues(page.html);body.set('__EVENTTARGET',event[1]);body.set('__EVENTARGUMENT',event[2]);page=await request(page.url,body);
    }
    throw new Error('FTG pagination limit exceeded');
}
const adapter:PortalAdapter={
  platform:'FTG Portal',aliases:['FTG'],capabilities:{search:['address','permit','name','company'],listRecent:true,detail:false},
  search:run,
  async listRecent(ctx,since){return run(ctx,{type:'applied',value:since})},
};
export default adapter;
