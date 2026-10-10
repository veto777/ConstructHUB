import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterCtx } from './types';
vi.mock('./polite-fetch',async importOriginal=>({...await importOriginal<typeof import('./polite-fetch')>(),politeFetch:vi.fn()}));
import { politeFetch,PortalBlockedError } from './polite-fetch';
import adapter,{click2govUrl,click2govSearchForm,parseClick2GovResults,parseClick2GovDetail} from './click2gov';
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/click2gov/${name}.html`,import.meta.url),'utf8');
const ctx:AdapterCtx={databaseId:9,databaseName:'Tamarac',jurisdiction:'Tamarac, FL',searchUrl:'https://e-gov.tamarac.org/Click2GovBP/index.html',portalUrl:null,browser:vi.fn(),log:vi.fn(),politeness:{minDelayMs:1000}};
const response=(name:string)=>new Response(fixture(name),{status:200});
beforeEach(()=>vi.mocked(politeFetch).mockReset());
describe('Click2Gov recorded public responses',()=>{
  it('starts with a fresh session and rejects other Click2Gov modules',()=>{
    expect(click2govUrl(ctx.searchUrl+'?OWASP_CSRFTOKEN=expired')).toBe(ctx.searchUrl);
    expect(()=>click2govUrl('https://e-gov.tamarac.org/Click2GovTX/index.html')).toThrow();
  });
  it('submits only the selected read-only search form and preserves its CSRF token',()=>{
    const address=click2govSearchForm(fixture('Tamarac-address-2'),'address','7800 University');
    expect(address.body.get('parcel.streetNumber')).toBe('7800');expect(address.body.get('parcel.streetName')).toBe('University');
    expect(address.body.get('OWASP_CSRFTOKEN')).toBeTruthy();expect(address.body.has('permit.appNumber')).toBe(false);
    const permit=click2govSearchForm(fixture('Tamarac-address-2'),'permit','00-00002397');
    expect(permit.body.get('permit.appYear')).toBe('00');expect(permit.body.get('permit.appNumber')).toBe('00002397');
    expect(()=>click2govSearchForm(fixture('Tamarac-address-2'),'permit','bad')).toThrow();
  });
  it('parses the full server response and deduplicates application numbers',()=>{
    const rows=parseClick2GovResults(fixture('Tamarac-address-3'),ctx,ctx.searchUrl);
    expect(rows).toHaveLength(77);expect(rows[0]).toMatchObject({permitNumber:'00-00002397',address:'7800 N UNIVERSITY DR',status:'CANCELLED',issuedAt:null,contractorName:null});
    // Contractor/Other Name is ambiguous and must not be relabeled as a contractor.
    expect(rows[0].raw?.html).toContain('KING KOTE ASPHALT');expect(rows[0].sourceUrl).toContain('permit.appYearAndNumber=00-00002397');
  });
  it('reads explicit detail fields and normalizes the displayed application number',()=>{
    const row=parseClick2GovDetail(fixture('tamarac-detail'),ctx,ctx.searchUrl);
    expect(row).toMatchObject({permitNumber:'00-00002397',address:'7800 N UNIVERSITY DR',status:'CANCELLED',parcel:'494103150220'});
  });
  it('replays the public index, search form and result response',async()=>{
    vi.mocked(politeFetch).mockResolvedValueOnce(response('Tamarac-address-1')).mockResolvedValueOnce(response('Tamarac-address-2')).mockResolvedValueOnce(response('Tamarac-address-3'));
    expect(await adapter.search(ctx,{type:'address',value:'7800 University'})).toHaveLength(77);expect(ctx.browser).not.toHaveBeenCalled();
  });
  it('throws on a real CentralSquare error page and propagates HTTP blocking',async()=>{
    expect(()=>parseClick2GovResults(fixture('Seminole-address-1'),ctx,ctx.searchUrl)).toThrow('Portal error');
    expect(()=>parseClick2GovResults(fixture('Tamarac-address-2'),ctx,ctx.searchUrl)).toThrow();
    vi.mocked(politeFetch).mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl,429));
    await expect(adapter.search(ctx,{type:'name',value:'Construction'})).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it('recognizes a real no-results response',()=>{
    expect(parseClick2GovResults(fixture('Tamarac-empty-3'),ctx,ctx.searchUrl)).toEqual([]);
  });
  it('does not invent date-search support',async()=>{
    expect(adapter.capabilities.listRecent).toBe(false);expect(await adapter.listRecent(ctx,'2026-10-03')).toEqual([]);expect(politeFetch).not.toHaveBeenCalled();
  });
});
