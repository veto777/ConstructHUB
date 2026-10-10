import * as cheerio from 'cheerio';
import { assertPublicResponse, formValues, isoDate, portalSession, usDate } from './smartgov';
import { PortalBlockedError } from './polite-fetch';
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from './types';

export function etrakitUrl(input: string): string {
  const u = new URL(input);
  if (!['http:','https:'].includes(u.protocol)) throw new Error('Not an eTRAKiT URL');
  const root = u.pathname.match(/^(.*\/(?:community-etrakit|etrakit(?:3|_prod)?))(?:\/|$)/i)?.[1];
  if (root) return new URL(`${root}/Search/permit.aspx`,u).href;
  // Some agencies install eTRAKiT at the web root. The response must also identify eTRAKiT.
  if (/etrakit/i.test(u.hostname)) return new URL('/Search/permit.aspx',u).href;
  if (u.pathname === '/') return new URL('/Search/permit.aspx',u).href;
  throw new Error('Not a recognized eTRAKiT URL shape');
}
export function publicRecordUrl(href: string | undefined, base: string): string | null {
  if (!href || /^(javascript:|#)/i.test(href)) return null;
  try { const u = new URL(href,base); return ['http:','https:'].includes(u.protocol) && u.origin === new URL(base).origin ? u.href : null; } catch { return null; }
}
/** Header-based parsing avoids treating contractor IDs or pager links as permits. */
export function parsePermitTables(html: string, ctx: AdapterCtx, url: string, selector: string): PermitRecord[] {
  assertPublicResponse(html,url);
  const $ = cheerio.load(html); const out: PermitRecord[] = [];
  $(selector).each((_i,table) => {
    const t = $(table);
    const headers = t.find('tr').filter((_j,r) => $(r).children('th').length > 0).first().children('th,td').map((_j,e)=>$(e).text().replace(/\s+/g,' ').trim()).get();
    const key = headers.findIndex(h => /^(permit\s*(number|no\.?|#)?|application\s*(number|no\.?|#|id))$/i.test(h));
    if (key < 0) return;
    t.find('tr').each((_j,row) => {
      const r = $(row); if (r.children('th').length || r.hasClass('rgPager') || r.hasClass('rgNoRecords')) return;
      const cells = r.children('td'); if (cells.length !== headers.length) return;
      const values = cells.map((_k,e)=>$(e).text().replace(/\s+/g,' ').trim()).get();
      const permitNumber = values[key]; if (!permitNumber) return;
      const get = (pattern: RegExp) => {const i=headers.findIndex(h=>pattern.test(h));return i<0 ? null : values[i] || null;};
      out.push({ permitNumber, databaseId:ctx.databaseId,jurisdiction:ctx.jurisdiction,
        address:get(/^(site\s*)?address$/i),parcel:get(/^(parcel(\s*(id|number|no\.?|#))?|apn)$/i),
        permitType:get(/^(permit\s*|application\s*)?type$/i),workClass:get(/^(permit\s*)?subtype$/i),
        description:get(/^(work\s*)?description$/i),status:get(/^(permit\s*|application\s*)?status$/i),
        issuedAt:isoDate(get(/^(date\s*issued|issued(\s*(date|on))?|issue date)$/i)),
        appliedAt:isoDate(get(/^(applied(\s*(date|on))?|application date|date applied)$/i)),
        expiresAt:isoDate(get(/^(expiration date|expires)$/i)),
        contractorName:get(/^(contractor|contractor name|primary contractor)$/i),
        contractorLicense:get(/^(contractor license|license number)$/i),
        applicantName:get(/^(applicant|applicant name)$/i),ownerName:get(/^(owner|owner name)$/i),
        sourceUrl:publicRecordUrl(cells.eq(key).find('a[href]').first().attr('href'),url),raw:{html:$.html(row)},
      });
    });
  });
  return [...new Map(out.map(r=>[r.permitNumber,r])).values()];
}
export function parseETRAKiTResults(html: string, ctx: AdapterCtx, url: string): PermitRecord[] {
  const rows = parsePermitTables(html,ctx,url,"table[id*='rgSearchRslts'],table[id*='SearchResults'],table[id*='dgResults']");
  if (rows.length) return rows;
  const $ = cheerio.load(html);
  if (/no results|no records/i.test($("[id*='lblNoSearchRslts'],.rgNoRecords,[id*='SearchResults']").text())) return [];
  throw new Error('Unrecognized eTRAKiT result page (not an empty search)');
}
export function etrakitSearchBody(html: string, type: PermitSearchType | 'issued', value: string): URLSearchParams {
  const $ = cheerio.load(html); const data = formValues(html);
  const by = $("select[id*='ddSearchBy'],select[id*='ddlSearchBy']").first();
  const input = $("input[id*='txtSearchString'],input[name*='SearchString']").first();
  const btn = $("input[id*='btnSearch'],button[id*='btnSearch']").first();
  if (!by.length || !input.length || !btn.length) throw new Error('eTRAKiT public permit search form unavailable');
  const patterns: Record<string,RegExp> = { permit:/^(permit\s*(#|number|no\.?)?)$/i,address:/^(site\s*)?address$/i,
    name:/^(applicant|applicant name|owner|owner name)$/i,company:/^(contractor|contractor name)$/i,
    license:/^(contractor license|license number)$/i,keyword:/^description$/i,issued:/^(issued|issue date|date issued)$/i };
  const option = by.find('option').filter((_i,e)=>patterns[type].test($(e).text().trim())).first();
  if (!option.length) throw new Error(`eTRAKiT tenant does not expose ${type} in public permit search`);
  data.set(by.attr('name')!,option.attr('value')!);
  const operator = $("select[id*='ddSearchOper'],select[id*='ddlSearchOper']").first();
  const op = operator.find('option').filter((_i,e)=>(type==='issued' ? /^at least$/i : type==='permit' ? /^equals$/i : /^contains$/i).test($(e).text().trim())).first();
  if (!op.length) throw new Error('eTRAKiT requested search operator unavailable');
  data.set(operator.attr('name')!,op.attr('value')!);data.set(input.attr('name')!,value);
  data.set('__EVENTTARGET',btn.attr('name')!);data.set('__EVENTARGUMENT','');
  if (btn.attr('type')==='submit') data.set(btn.attr('name')!,btn.attr('value') || 'Search');
  return data;
}

export function nextETRAKiTPostback(html: string): {target:string;argument:string} | null {
  const $ = cheerio.load(html);
  const custom = $('input.NextPage:not([disabled])').first();
  if (custom.length) {
    const tableName = custom.attr('name')!.split('$ctl03$')[0];
    const target = tableName.replace(/\$ctl00$/, '');
    return { target, argument: `FireCommand:${tableName};Page;Next` };
  }
  const next = $('input.rgPageNext:not([disabled]),a.rgPageNext:not([disabled]),a[title="Next Page"]:not([disabled])').first();
  if (!next.length) return null;
  const event = (next.attr('href') ?? next.attr('onclick') ?? '').match(/__doPostBack\(['"]([^'"]+)['"],\s*['"]([^'"]*)['"]\)/);
  if (event) return {target:event[1],argument:event[2]};
  if (next.attr('name')) return {target:next.attr('name')!,argument:''};
  throw new Error('Unrecognized eTRAKiT next-page control');
}
async function run(ctx:AdapterCtx,type:PermitSearchType|'issued',value:string):Promise<PermitRecord[]> {
  const url=etrakitUrl(ctx.searchUrl); const request=portalSession(ctx); let page=await request(url);
  if (!/etrakit/i.test(page.html)) throw new Error('Response is not an eTRAKiT portal');
  if (/\/login\.aspx/i.test(page.url)) throw new PortalBlockedError(page.url,401,'eTRAKiT requires login; no public permit search');
  const body=etrakitSearchBody(page.html,type,value); page=await request(page.url,body);
  const records:PermitRecord[]=[];const seen=new Set<string>();
  for(let n=0;n<1000;n++) {
    const rows=parseETRAKiTResults(page.html,ctx,page.url);
    if(n && !rows.some(r=>!seen.has(r.permitNumber))) throw new Error('eTRAKiT pagination did not advance; refusing partial results');
    rows.forEach(r=>{if(!seen.has(r.permitNumber)){seen.add(r.permitNumber);records.push(r)}});
    const next=nextETRAKiTPostback(page.html);if(!next)return records;
    const data=formValues(page.html);data.set('__EVENTTARGET',next.target);data.set('__EVENTARGUMENT',next.argument);
    page=await request(page.url,data);
  }
  throw new Error('eTRAKiT pagination limit exceeded; results incomplete');
}
const adapter:PortalAdapter={
  platform:'eTRAKiT', aliases:["CentralSquare eTRAKiT", "CentralSquare eTRAKiT online permitting", "eTRAKiT (Building Portal)", "eTRAKiT (CentralSquare cloud)", "eTRAKiT (CentralSquare)", "eTRAKiT (independent city)"],
  capabilities:{search:['address','permit','name','company','license','keyword'],listRecent:true,detail:false},
  async search(ctx,q){if(!q.value?.trim())throw new Error('Search value is required');return run(ctx,q.type,q.value)},
  async listRecent(ctx,since){return run(ctx,'issued',usDate(since))},
};
export default adapter;
