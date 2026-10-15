import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterCtx } from './types';
vi.mock('./polite-fetch',async importOriginal=>({...await importOriginal<typeof import('./polite-fetch')>(),politeFetch:vi.fn()}));
import { politeFetch,PortalBlockedError } from './polite-fetch';
import adapter,{etrakitUrl,etrakitSearchBody,parseETRAKiTResults,nextETRAKiTPostback,etrakitLinks} from './etrakit';
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
describe('eTRAKiT CentralSquare cloud labels (Aventura, FL, recorded 2026-10-15)',()=>{
  const aventura:AdapterCtx={...ctx,databaseName:'Aventura',jurisdiction:'Aventura, FL',searchUrl:'https://aven.csqrcloud.com/community-etrakit/'};
  it('reads PERMIT/PROCESS NUMBER and FOLIO NUMBER columns instead of rejecting the page',async()=>{
    vi.mocked(politeFetch).mockResolvedValueOnce(response('Aventura-form')).mockResolvedValueOnce(response('Aventura-company-1'));
    const rows=await adapter.search(aventura,{type:'company',value:'Able Construction'});
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({permitNumber:'BRES2405-0033',address:'20000 E COUNTRY CLUB DR 804',parcel:'2812350880490',status:'FINALED',contractorName:'A A RELIABLE CONSTRUCTION INC'});
    expect(vi.mocked(politeFetch).mock.calls[1][1]?.body?.toString()).toContain('Able+Construction');
  });
  it('finds the permit-number search option under its cloud label',()=>{
    const body=etrakitSearchBody(fixture('Aventura-form'),'permit','BRES2405-0033');
    expect([...body.values()]).toContain('BRES2405-0033');
  });
});
describe('eTRAKiT raw column names (Miami Lakes, FL, recorded 2026-10-15)',()=>{
  const lakes:AdapterCtx={...ctx,databaseName:'Miami Lakes',jurisdiction:'Miami Lakes, FL',searchUrl:'https://trakit.miamilakes-fl.gov/etrakit/'};
  it('maps CONTRACTOR_NAME / PERMIT_NO / SITE_ADDR options and headers',()=>{
    const body=etrakitSearchBody(fixture('Miami Lakes-form'),'company','Able Construction');
    expect([...body.values()]).toContain('Able Construction');
    expect(()=>etrakitSearchBody(fixture('Miami Lakes-form'),'name','x')).toThrow('does not expose name');
    const rows=parseETRAKiTResults(fixture('Miami Lakes-company-1'),lakes,'https://trakit.miamilakes-fl.gov/etrakit/Search/permit.aspx');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({permitNumber:'B2011-1357',address:'16741 NW 77 PL',parcel:'3220150390320',contractorName:'A A RELIABLE CONSTRUCTION INC'});
    expect(nextETRAKiTPostback(fixture('Miami Lakes-company-1'))).not.toBeNull();
  });
});
describe('eTRAKiT behind a city landing page',()=>{
  it('follows the city page\'s own redirect to its eTRAKiT host (Pinecrest, FL)',async()=>{
    const pinecrest:AdapterCtx={...ctx,jurisdiction:'Pinecrest, FL',searchUrl:'https://www.pinecrest-fl.gov/Government/Building/Online-Permitting-System-Etrakit'};
    expect(()=>etrakitUrl(pinecrest.searchUrl)).toThrow('Not a recognized eTRAKiT URL shape');
    vi.mocked(politeFetch)
      .mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://pine-trk.aspgov.com/eTRAKiT/'}}))
      .mockResolvedValueOnce(response('Aventura-form'))
      .mockResolvedValueOnce(response('Aventura-form'))
      .mockResolvedValueOnce(response('Aventura-company-1'));
    expect(await adapter.search(pinecrest,{type:'company',value:'Able Construction'})).toHaveLength(12);
    expect(vi.mocked(politeFetch).mock.calls.map(c=>String(c[0]))).toEqual([
      pinecrest.searchUrl,'https://pine-trk.aspgov.com/eTRAKiT/','https://pine-trk.aspgov.com/eTRAKiT/Search/permit.aspx','https://pine-trk.aspgov.com/eTRAKiT/Search/permit.aspx']);
  });
  it('uses the one portal a county page links to, never its own help pages (Highlands County, FL)',()=>{
    expect(etrakitLinks(fixture('Highlands County-landing'),'https://www.highlandsfl.gov/etrakit/index.php')).toEqual(['https://hic.csqrcloud.com/community-etrakit/Search/permit.aspx']);
    expect(etrakitLinks('<a href="https://a-trk.aspgov.com/eTRAKiT/">A</a><a href="https://b.csqrcloud.com/community-etrakit/">B</a>','https://city.gov/permits')).toHaveLength(2);
    expect(etrakitLinks('<a href="https://example.com/">home</a><a href="/building">b</a>','https://city.gov/permits')).toEqual([]);
  });
  it('refuses a landing page that links to several portals instead of picking one',async()=>{
    const city:AdapterCtx={...ctx,searchUrl:'https://city.gov/permits'};
    vi.mocked(politeFetch).mockResolvedValueOnce(new Response('<a href="https://a-trk.aspgov.com/eTRAKiT/">A</a><a href="https://b.csqrcloud.com/community-etrakit/">B</a>'));
    await expect(adapter.search(city,{type:'company',value:'x'})).rejects.toThrow('more than one eTRAKiT portal');
  });
});
