import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdapterCtx } from './types';
vi.mock('../storage',()=>({storage:{}}));
vi.mock('./polite-fetch',async importOriginal=>({...await importOriginal<typeof import('./polite-fetch')>(),politeFetch:vi.fn()}));
import { politeFetch, PortalBlockedError } from './polite-fetch';
import etrakit from './etrakit';
import click2gov from './click2gov';
import ftg from './ftg';
import adapter, {parseSmartGovResults,parseSmartGovDetail,smartgovUrl,smartgovSearchBody,isoDate,assertPublicResponse} from './smartgov';
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/smartgov/${name}.html`,import.meta.url),'utf8');
const ctx:AdapterCtx={databaseId:42,databaseName:'Coconino County',jurisdiction:'Coconino County, AZ',searchUrl:'https://co-coconino-az.smartgovcommunity.com/Public/Home',portalUrl:null,browser:vi.fn(),log:vi.fn(),politeness:{minDelayMs:1}};
const response=(name:string)=>new Response(fixture(name),{status:200});
beforeEach(()=>vi.mocked(politeFetch).mockReset());
describe('SmartGov recorded public responses',()=>{
  it('parses advanced rows without treating an arbitrary status date as issuance',()=>{
    const basic=parseSmartGovResults(fixture('coconino-main'),ctx,smartgovUrl(ctx.searchUrl));
    expect(basic[0]).toMatchObject({permitNumber:'EQ-22-1477',issuedAt:null,contractorName:null,databaseId:42});
    const advanced=parseSmartGovResults(fixture('Coconino-address-2'),ctx,'https://co-coconino-az.smartgovcommunity.com/ApplicationPublic/ApplicationSearchAdvanced/Search');
    expect(advanced).toHaveLength(10);expect(advanced[0]).toMatchObject({permitNumber:'PZ-LDP-00-099',address:'MAINE AVE, PARKS, AZ',issuedAt:'2011-05-31'});
    expect(advanced[0].raw?.listedNames).toEqual(['HANSON ROBERT & MARY CPWROS']);
    expect(advanced[0].sourceUrl).toContain('/ApplicationSearchAdvanced/Detail/');expect(advanced[0].raw?.html).toContain('PZ-LDP-00-099');
  });
  it('parses labeled details, dates and contact roles',()=>{
    const detail=parseSmartGovDetail(fixture('coconino-detail'),ctx,'https://co-coconino-az.smartgovcommunity.com/detail');
    expect(detail).toMatchObject({permitNumber:'PZ-LDP-00-099',issuedAt:'2011-05-31',appliedAt:'2011-05-31',expiresAt:'2011-11-27',parcel:'20333049',ownerName:'HANSON ROBERT & MARY CPWROS',contractorName:null});
  });
  it('replays a complete two-page address search without browser or storage',async()=>{
    vi.mocked(politeFetch).mockResolvedValueOnce(response('Coconino-address-1')).mockResolvedValueOnce(response('Coconino-address-2')).mockResolvedValueOnce(response('Coconino-address-3'));
    const rows=await adapter.search(ctx,{type:'address',value:'Main'});expect(rows).toHaveLength(11);expect(ctx.browser).not.toHaveBeenCalled();
    const calls=vi.mocked(politeFetch).mock.calls;expect(calls[1][1]?.body?.toString()).toContain('SiteAddress.Street1=Main');expect(calls[1][1]?.body?.toString()).toContain('Module=Permitting');expect(calls[2][0]).toContain('SearchPage');expect(calls[0][2]?.minDelayMs).toBe(1000);
  });
  it('preserves date filter through all recent pages',async()=>{
    vi.mocked(politeFetch).mockResolvedValueOnce(response('Coconino-recent-1'));
    for(let n=2;n<=9;n++)vi.mocked(politeFetch).mockResolvedValueOnce(response(`Coconino-recent-${n}`));
    expect(await adapter.listRecent(ctx,'2026-10-03')).toHaveLength(78);
    expect(vi.mocked(politeFetch).mock.calls[1][1]?.body?.toString()).toContain('IssuedOn=10%2F03%2F2026');
  });
  it('distinguishes true empty results from an initial/unrecognized page',()=>{
    expect(parseSmartGovResults(fixture('Stevens-address-2'),ctx,ctx.searchUrl)).toEqual([]);
    expect(()=>parseSmartGovResults(fixture('coconino-detail'),ctx,ctx.searchUrl)).toThrow();
  });
  it('rejects bad URL shapes and preserves blocked errors',async()=>{
    expect(()=>smartgovUrl('https://example.com')).toThrow();
    await expect(adapter.search(ctx,{type:'keyword',value:'Main'})).rejects.toThrow('Unsupported');
    vi.mocked(politeFetch).mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl,403));
    await expect(adapter.search(ctx,{type:'permit',value:'PZ-LDP-00-099'})).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it('registers all four adapters and their aliases while retaining Skagit',async()=>{
    const {getAdapter}=await import('./registry');
    for(const registered of [adapter,etrakit,click2gov,ftg]){
      for(const label of [registered.platform,...registered.aliases!])expect(getAdapter(label.toUpperCase())).toBe(registered);
    }
    expect(getAdapter('Skagit County')?.platform).toBe('Skagit County');
  });
  it('validates dates and uses the portal form validator',()=>{
    expect(isoDate('02/30/2026')).toBeNull();expect(isoDate('10/3/2026')).toBe('2026-10-03');
    const body=smartgovSearchBody(fixture('Coconino-address-1'),{IssuedOn:'10/03/2026 To 10/10/2026'});
    expect(body.get('__submitFormValidator__')).toMatch(/^[a-z]+\d+[a-z]$/);
  });
});
describe('SmartGov tenant form differences (recorded 2026-10-15)',()=>{
  const bal:AdapterCtx={...ctx,databaseId:7,databaseName:'Bal Harbour',jurisdiction:'Bal Harbour, FL',searchUrl:'https://vlg-balharbour-fl.smartgovcommunity.com/Public/Home'};
  it('searches a permitting-only tenant whose form has no Module selector',async()=>{
    vi.mocked(politeFetch).mockResolvedValueOnce(response('Bal Harbour-advanced-form')).mockResolvedValueOnce(response('Bal Harbour-company-1'));
    const rows=await adapter.search(bal,{type:'company',value:'RJ Electric'});
    expect(rows).toHaveLength(6);
    // Two-column result rows: no site address is published, so it stays unknown; the names are not mistaken for one.
    expect(rows[0]).toMatchObject({permitNumber:'EO-19-10-019',permitType:'Electrical - Other',status:'Certificate of Completion',address:null});
    expect(rows[0].raw?.listedNames).toEqual(['BAL HARBOUR SHOPS LLC','RJ ELECTRIC LLC']);
    expect(rows.every(r=>(r.raw?.listedNames as string[]).some(n=>/RJ ELECTRIC/.test(n)))).toBe(true);
    const body=vi.mocked(politeFetch).mock.calls[1][1]?.body?.toString()??'';
    expect(body).toContain('PrimaryContractor.Contact.DisplayName=RJ+Electric');
    expect(body).not.toContain('Module=');
  });
  it('says the tenant does not publish name search when its form hides contact fields',async()=>{
    const tomball:AdapterCtx={...ctx,jurisdiction:'Tomball, TX',searchUrl:'https://ci-tomball-tx.smartgovcommunity.com/Public/Home'};
    for(const type of ['company','name'] as const){
      vi.mocked(politeFetch).mockResolvedValueOnce(response('Tomball-advanced-form'));
      await expect(adapter.search(tomball,{type,value:'Joe Bland Construction'})).rejects.toThrow(/field unavailable: Primary(Contractor|Contact)\.Contact\.DisplayName \(this tenant does not publish name search\)/);
    }
    expect(politeFetch).toHaveBeenCalledTimes(2);
  });
  it('follows a stored bit.ly link only to the SmartGov tenant it redirects to (Sachse, TX)',async()=>{
    const sachse:AdapterCtx={...ctx,jurisdiction:'Sachse, TX',searchUrl:'https://bit.ly/SachsePermits'};
    vi.mocked(politeFetch)
      .mockResolvedValueOnce(new Response(null,{status:301,headers:{location:'https://ci-sachse-tx.smartgovcommunity.com/Public/Home'}}))
      .mockResolvedValueOnce(response('Tomball-advanced-form'))
      .mockResolvedValueOnce(response('Tomball-advanced-form'));
    await expect(adapter.search(sachse,{type:'company',value:'Joe Bland Construction'})).rejects.toThrow('does not publish name search');
    expect(vi.mocked(politeFetch).mock.calls.map(c=>String(c[0]))).toEqual(['https://bit.ly/SachsePermits','https://ci-sachse-tx.smartgovcommunity.com/Public/Home','https://ci-sachse-tx.smartgovcommunity.com/ApplicationPublic/ApplicationSearch/AdvancedSearch']);
    vi.mocked(politeFetch).mockReset().mockResolvedValueOnce(new Response(null,{status:301,headers:{location:'https://example.com/elsewhere'}})).mockResolvedValueOnce(new Response('<html></html>'));
    await expect(adapter.search(sachse,{type:'company',value:'x'})).rejects.toThrow('Not a SmartGov community portal URL');
  });
});
