import { readFileSync } from 'node:fs';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { AdapterCtx } from './types';
vi.mock('./polite-fetch',async importOriginal=>({...await importOriginal<typeof import('./polite-fetch')>(),politeFetch:vi.fn()}));
import { politeFetch } from './polite-fetch';
import adapter,{ftgUrl,ftgSearchBody,parseFTGResults} from './ftg';
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/ftg/${name}.html`,import.meta.url),'utf8');
const ctx:AdapterCtx={databaseId:11,databaseName:'Sarasota',jurisdiction:'Sarasota, FL',searchUrl:'https://ftgportal.sarasotafl.gov/Permits/Search.aspx?microapp=c',portalUrl:null,browser:vi.fn(),log:vi.fn(),politeness:{minDelayMs:1000}};
const response=(name:string)=>new Response(fixture(name),{status:200});
beforeEach(()=>{vi.mocked(politeFetch).mockReset();vi.useRealTimers()});
describe('FTG recorded Sarasota public responses',()=>{
  it('preserves the tenant and microapp and rejects application-only URLs',()=>{
    expect(ftgUrl(ctx.searchUrl)).toBe(ctx.searchUrl);expect(()=>ftgUrl(ctx.searchUrl.replace('/Search.aspx','/Apply.aspx'))).toThrow();
  });
  it('maps labeled application dates without mislabeling them as issue dates',()=>{
    const rows=parseFTGResults(fixture('Sarasota-address-2'),ctx,ctx.searchUrl);expect(rows).toHaveLength(10);
    expect(rows.find(r=>r.permitNumber==='2022-000107')).toMatchObject({address:'1560 MAIN ST',appliedAt:'2021-10-05',issuedAt:null,status:'Closed',contractorName:null});
    expect(rows.every(r=>r.sourceUrl?.includes('Inquiry.aspx'))).toBe(true);
  });
  it('builds distinct address, owner and contractor searches',()=>{
    const html=fixture('Sarasota-address-1');const body=ftgSearchBody(html,'address','1560 Main');
    expect([...body].find(([k])=>k.endsWith('$txtStreetNumber'))?.[1]).toBe('1560');
    expect([...body].find(([k])=>k.endsWith('$txtStreetName'))?.[1]).toBe('Main');
    const contractor=ftgSearchBody(html,'company','WILLIS');expect([...contractor].find(([k])=>k.endsWith('$txtContractor'))?.[1]).toBe('WILLIS');
  });
  it('uses the real bounded application-date dropdown instead of brute force',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    const body=ftgSearchBody(fixture('Sarasota-address-1'),'applied','2026-10-03');
    expect([...body].find(([k])=>k.endsWith('$ddReportedOn'))?.[1]).toBe('D30');
    expect(()=>ftgSearchBody(fixture('Sarasota-address-1'),'applied','2020-01-01')).toThrow('no date window');vi.useRealTimers();
  });
  it('replays a public address request and never uses storage or browser',async()=>{
    vi.mocked(politeFetch).mockResolvedValueOnce(response('Sarasota-address-1')).mockResolvedValueOnce(response('Sarasota-address-2'));
    expect(await adapter.search(ctx,{type:'address',value:'1560 Main'})).toHaveLength(10);expect(ctx.browser).not.toHaveBeenCalled();
  });
  it('replays the bounded date listing, including all pages, then filters since',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    for(let n=1;n<=44;n++)vi.mocked(politeFetch).mockResolvedValueOnce(response(`Sarasota-recent-${n}`));
    const rows=await adapter.listRecent(ctx,'2026-10-03');expect(rows).toHaveLength(171);
    expect(rows.every(r=>r.appliedAt!>='2026-10-03')).toBe(true);vi.useRealTimers();
  });
  it('recognizes the real empty-result message',()=>{
    expect(parseFTGResults(fixture('Sarasota-empty-2'),ctx,ctx.searchUrl)).toEqual([]);
  });
  it('rejects unknown layouts instead of calling them no matches',()=>{
    expect(()=>parseFTGResults(fixture('Sarasota-address-1'),ctx,ctx.searchUrl)).toThrow();
  });
});
