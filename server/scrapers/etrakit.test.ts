import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterCtx } from './types';
vi.mock('./polite-fetch',async importOriginal=>({...await importOriginal<typeof import('./polite-fetch')>(),politeFetch:vi.fn()}));
import { politeFetch,PortalBlockedError } from './polite-fetch';
import adapter,{etrakitUrl,etrakitSearchBody,parseETRAKiTResults,nextETRAKiTPostback} from './etrakit';
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/etrakit/${name}.html`,import.meta.url),'utf8');
const ctx:AdapterCtx={databaseId:7,databaseName:'Hillsborough',jurisdiction:'Hillsborough, CA',searchUrl:'https://hills-trk.aspgov.com/eTRAKiT/default.aspx',portalUrl:null,browser:vi.fn(),log:vi.fn(),politeness:{minDelayMs:1000}};
const response=(name:string)=>new Response(fixture(name),{status:200});
beforeEach(()=>vi.mocked(politeFetch).mockReset());
describe('eTRAKiT recorded public responses',()=>{
  it('derives paths from different tenants including cloud and root installs',()=>{
    expect(etrakitUrl(ctx.searchUrl)).toBe('https://hills-trk.aspgov.com/eTRAKiT/Search/permit.aspx');
    expect(etrakitUrl('https://permits.shastacounty.gov/etrakit/Search/permit.aspx')).toContain('/etrakit/Search/permit.aspx');
    expect(etrakitUrl('https://communitydevelopment.hanovercounty.gov/eTRAKiT/')).toContain('hanovercounty.gov/eTRAKiT/Search/permit.aspx');
    expect(etrakitUrl('https://prsct.csqrcloud.com/community-etrakit/')).toContain('/community-etrakit/Search/permit.aspx');
    expect(()=>etrakitUrl('https://example.com/not-a-portal')).toThrow();
  });
  it('maps tenant-specific columns by labels',()=>{
    const rows=parseETRAKiTResults(fixture('Hillsborough-address-2'),ctx,ctx.searchUrl);
    expect(rows).toHaveLength(7);expect(rows[0]).toMatchObject({permitNumber:'03PLB-00458',address:'100 EUCALYPTUS',issuedAt:'2003-12-30',permitType:'PLUMBING',contractorName:null});
    expect(rows[0].raw?.html).toContain('replace 50 gal water heater');
    expect(parseETRAKiTResults(fixture('Shasta-address-2'),ctx,ctx.searchUrl).length).toBeGreaterThan(0);
  });
  it('uses public form fields for address, permit and issued-date searches',()=>{
    const html=fixture('Hillsborough-address-1');const body=etrakitSearchBody(html,'issued','10/03/2026');
    expect(body.get('ctl00$cplMain$ddSearchBy')).toBe('Permit_Main.ISSUED');
    expect(body.get('ctl00$cplMain$ddSearchOper')).toBe('AT LEAST');
    expect(body.get('__EVENTTARGET')).toBe('ctl00$cplMain$btnSearch');
    expect(etrakitSearchBody(html,'permit','03PLB-00458').get('ctl00$cplMain$ddSearchOper')).toBe('EQUALS');
    expect(()=>etrakitSearchBody(fixture('Shasta-address-1'),'issued','10/03/2026')).toThrow('does not expose issued');
    expect(()=>etrakitSearchBody(html,'company','Construction')).toThrow('does not expose company');
  });
  it('replays two date-result pages without returning only the first page',async()=>{
    vi.mocked(politeFetch).mockResolvedValueOnce(response('Hillsborough-recent-1')).mockResolvedValueOnce(response('Hillsborough-recent-2')).mockResolvedValueOnce(response('Hillsborough-recent-3'));
    const rows=await adapter.listRecent(ctx,'2026-10-03');expect(rows).toHaveLength(33);
    expect(rows.every(r=>r.issuedAt!>='2026-10-03')).toBe(true);
    expect(nextETRAKiTPostback(fixture('Hillsborough-recent-2'))?.argument).toContain(';Page;Next');
    expect(nextETRAKiTPostback(fixture('Hillsborough-recent-3'))).toBeNull();
    expect(vi.mocked(politeFetch).mock.calls.every(c=>c[0].includes('hills-trk.aspgov.com'))).toBe(true);
  });
  it('does not parse login pages or initial forms as empty results',()=>{
    expect(()=>parseETRAKiTResults(fixture('prescott-initial'),ctx,ctx.searchUrl)).toThrow();
    expect(()=>parseETRAKiTResults(fixture('Hillsborough-address-1'),ctx,ctx.searchUrl)).toThrow();
    expect(parseETRAKiTResults(fixture('hillsborough-main'),ctx,ctx.searchUrl)).toEqual([]);
  });
  it('rejects a login redirect with a typed blocked error',async()=>{
    vi.mocked(politeFetch).mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'login.aspx?lt=contractor'}})).mockResolvedValueOnce(response('prescott-initial'));
    await expect(adapter.search(ctx,{type:'permit',value:'03PLB-00458'})).rejects.toBeInstanceOf(PortalBlockedError);
  });
});
