import {describe,it,expect} from 'vitest';
import {readFileSync}from'node:fs';
import type{AdapterCtx}from'./types';
import adapter,{supportedHosts}from'./city-built';
import {parseResults}from'./city-built/webapp.sjcfl.us';
import {isoDate,assertPublicPage}from'./city-built/http';
import {PortalBlockedError}from'./polite-fetch';
const ctx={databaseId:286,jurisdiction:'St. Johns County, FL',searchUrl:'https://webapp.sjcfl.us/watswebx/Permit/SearchPermit.aspx'} as AdapterCtx;
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/city-built/${name}`,import.meta.url),'utf8');
describe('city-built',()=>{
 it('parses real St. Johns results without losing records',()=>{const rows=parseResults(fixture('sjc-main2.html'),ctx);expect(rows).toHaveLength(537);expect(rows[0]).toMatchObject({permitNumber:'12611699',address:'224 N MAIN ST STE B',issuedAt:'2026-10-09',status:'Open',contractorName:'EXEMPT',databaseId:286});expect(rows[0].sourceUrl).toBe('https://webapp.sjcfl.us/watswebx/Permit/BLPermit.aspx?PermitNo=12611699&PopUp=1');expect(rows[0].raw?.html).toContain('12611699');});
 it('throws on the recorded server error instead of false no-results',()=>expect(()=>parseResults(fixture('sjc-main.html'),ctx)).toThrow());
 it('rejects unknown hosts',async()=>{expect(supportedHosts).toContain('webapp.sjcfl.us');await expect(async()=>adapter.search({...ctx,searchUrl:'https://example.com/'},{type:'permit',value:'12611699'})).rejects.toThrow('no site adapter for example.com');});
 it('recognizes CAPTCHA in the real Alamance response',()=>expect(()=>assertPublicPage(fixture('alamance-search.html'),'http://apps.alamance-nc.com/')).toThrow(PortalBlockedError));
 it('normalizes dates strictly',()=>{expect(isoDate('10/9/2026 4:32:25 PM')).toBe('2026-10-09');expect(isoDate('2/30/2026')).toBeNull();expect(isoDate('')).toBeNull();});
});
