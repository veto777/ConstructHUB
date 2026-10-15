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
/** Some tenants (Miami Lakes, FL) show raw column names: PERMIT_NO, SITE_ADDR, CONTRACTOR_NAME. */
export function etrakitLabel(text: string): string {
  return text.replace(/_/g,' ').replace(/\s+/g,' ').trim().replace(/\baddr$/i,'address');
}
/** Header-based parsing avoids treating contractor IDs or pager links as permits. */
export function parsePermitTables(html: string, ctx: AdapterCtx, url: string, selector: string): PermitRecord[] {
  assertPublicResponse(html,url);
  const $ = cheerio.load(html); const out: PermitRecord[] = [];
  $(selector).each((_i,table) => {
    const t = $(table);
    const headers = t.find('tr').filter((_j,r) => $(r).children('th').length > 0).first().children('th,td').map((_j,e)=>etrakitLabel($(e).text())).get();
    // Aventura, FL (CentralSquare cloud) labels the column "PERMIT/PROCESS NUMBER" and the parcel "FOLIO NUMBER".
    const key = headers.findIndex(h => /^(permit(\s*\/\s*process)?\s*(number|no\.?|#)?|application\s*(number|no\.?|#|id))$/i.test(h));
    if (key < 0) return;
    t.find('tr').each((_j,row) => {
      const r = $(row); if (r.children('th').length || r.hasClass('rgPager') || r.hasClass('rgNoRecords')) return;
      const cells = r.children('td'); if (cells.length !== headers.length) return;
      const values = cells.map((_k,e)=>$(e).text().replace(/\s+/g,' ').trim()).get();
      const permitNumber = values[key]; if (!permitNumber) return;
      const get = (pattern: RegExp) => {const i=headers.findIndex(h=>pattern.test(h));return i<0 ? null : values[i] || null;};
      out.push({ permitNumber, databaseId:ctx.databaseId,jurisdiction:ctx.jurisdiction,
        address:get(/^(site\s*)?address$/i),parcel:get(/^(parcel(\s*(id|number|no\.?|#))?|apn|folio(\s*(number|no\.?|#))?)$/i),
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
  const unique=new Map<string,PermitRecord>();
  for(const row of out){
    const prior=unique.get(row.permitNumber);
    if(!prior)unique.set(row.permitNumber,row);
    else prior.raw={...prior.raw,additionalRows:[...((prior.raw?.additionalRows as unknown[])??[]),row.raw]};
  }
  return [...unique.values()];
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
  const patterns: Record<string,RegExp> = { permit:/^(permit(\s*\/\s*process)?\s*(#|number|no\.?)?)$/i,address:/^(site\s*)?address$/i,
    name:/^(applicant|applicant name|owner|owner name)$/i,company:/^(contractor|contractor name)$/i,
    license:/^(contractor license|license number)$/i,keyword:/^description$/i,issued:/^(issued|issue date|date issued)$/i };
  const option = by.find('option').filter((_i,e)=>patterns[type].test(etrakitLabel($(e).text()))).first();
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
/**
 * eTRAKiT search pages linked from a city landing page. Only links the page itself publishes, on another host or
 * path, and only when exactly one portal is linked; a jurisdiction's portal is never guessed.
 */
export function etrakitLinks(html: string, landingUrl: string): string[] {
  const $ = cheerio.load(html); const found = new Set<string>();
  let own: string | null = null;
  try { own = etrakitUrl(landingUrl); } catch { /* the landing page is not itself under an eTRAKiT path */ }
  $('a[href]').each((_i,e) => {
    try {
      const u = new URL($(e).attr('href')!, landingUrl);
      // The landing site's own pages (Highlands County's /etrakit/definitions.php) are help pages, not the portal.
      if (!['http:','https:'].includes(u.protocol) || u.origin === new URL(landingUrl).origin || u.pathname === '/' || !/etrakit/i.test(u.hostname + u.pathname)) return;
      const search = etrakitUrl(u.href);
      if (search !== own) found.add(search);
    } catch { /* not an eTRAKiT application link */ }
  });
  return [...found];
}

/** The stored URL, or the eTRAKiT portal its landing page redirects or links to (Pinecrest, Highlands County, FL). */
async function openSearchPage(request: ReturnType<typeof portalSession>, stored: string): Promise<{ html: string; url: string }> {
  let direct: string | null = null;
  try { direct = etrakitUrl(stored); } catch { /* a landing page, resolved below */ }
  if (direct) {
    try {
      const page = await request(direct);
      if (/etrakit/i.test(page.html)) return page;
    } catch (e: any) {
      if (e instanceof PortalBlockedError || !/^HTTP 404\b/.test(String(e?.message))) throw e;
    }
  }
  const landing = await request(stored);
  let target: string | null = null;
  try { target = etrakitUrl(landing.url); } catch { /* not redirected to an eTRAKiT host */ }
  if (!target || target === direct) {
    const links = etrakitLinks(landing.html, landing.url).filter(l => l !== direct);
    if (links.length > 1) throw new Error('Landing page links to more than one eTRAKiT portal; configure the portal URL');
    target = links[0] ?? null;
  }
  if (!target || target === direct) throw new Error(direct ? 'Response is not an eTRAKiT portal' : 'Not a recognized eTRAKiT URL shape');
  return request(target);
}

async function run(ctx:AdapterCtx,type:PermitSearchType|'issued',value:string):Promise<PermitRecord[]> {
  const request=portalSession(ctx); let page=await openSearchPage(request,ctx.searchUrl);
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
