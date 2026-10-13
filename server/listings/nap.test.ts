import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeListing, checkListing, normalizeAddress, normalizeName, normalizePhone, parseBusinesses, isBillable, matchNap, type NapProfile } from './nap';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`,import.meta.url),'utf8');
const p: NapProfile = {name:'Fixture Roofing LLC',phone:'2125550100',street_address:'12 N Main St',address_line2:'Ste 4',city:'Albany',state:'NY',postal_code:'12207',service_area_only:false};
const page = (body:string,status=200)=>({url:'https://directory.example/fixture',body,status});
const json = (data:any)=>`<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const seen = {name:p.name,phone:p.phone,street_address:'12 N Main St Ste 4',city:'Albany',state:'NY',postal_code:'12207'};
describe('normalization and NAP evidence',()=> {
 it('normalizes phones, suite/directions, case/punctuation and legal suffixes',()=> {
  expect(normalizePhone('+1 (212) 555-0100 ext. 77')).toBe('2125550100');
  expect(normalizeAddress('12 North Main Street Suite 4')).toBe(normalizeAddress('12 N. Main St. #4'));
  expect(normalizeName('Fixture Roofing, L.L.C.')).toBe(normalizeName('Roofing Fixture Inc.'));
  expect(normalizeName('Fixture Roofing')).not.toBe(normalizeName('Fixture Plumbing'));
 });
 it.each(['local-business','microdata','visible'])('confirms complete NAP from %s fixture',name=> {
  const r=analyzeListing(page(fixture(name)),p); expect(r.status).toBe('live'); expect(r.billable).toBe(true);
  expect(r.nap?.fields.phone.observed).toBeTruthy(); expect(r.evidence.confirmation).toBe('confirmed');
 });
 it('returns actual diffs',()=> {
  const r=analyzeListing(page(fixture('local-business').replaceAll('555-0100','555-0199')),p);
  expect(r.status).toBe('mismatch'); expect(r.billable).toBe(false); expect(r.nap?.fields.phone.result).toBe('differs');
  expect(r.nap?.fields.phone.observed).toContain('0199');
 });
 it('tolerates hidden addresses only for explicit service-area profiles',()=> {
  const body=json({'@type':'LocalBusiness',name:p.name,telephone:p.phone});
  expect(analyzeListing(page(body),{...p,service_area_only:true}).billable).toBe(true);
  expect(analyzeListing(page(body),p).status).toBe('mismatch');
  expect(analyzeListing(page(body),{...p,service_area_only:null}).billable).toBe(false);
 });
 it('does not bill unknown canonical names or phones',()=> {
  expect(matchNap({...p,phone:null},seen).matches).toBe(false);
  expect(matchNap({...p,name:null},seen).matches).toBe(false);
 });
 it.each(['queued','live','mismatch'])('bot walls preserve %s but remove billability',status=> {
  const r=analyzeListing(page(fixture('bot-wall')),p,status);
  expect(r.status).toBe(status);expect(r.billable).toBe(false);expect(r.evidence.confirmation).toBe('unconfirmed');
 });
 it('HTTP errors and fetch errors never certify',async()=> {
  expect(analyzeListing(page(fixture('local-business'),403),p).billable).toBe(false);
  const r=await checkListing('https://directory.example',p,'live',async()=>{throw new Error('DNS');});
  expect(r.status).toBe('live');expect(r.billable).toBe(false);expect(r.nap).toBeNull();
 });
 it('never joins NAP across entities or ambiguous duplicates',()=> {
  const body=json([{'@type':'LocalBusiness',name:p.name,telephone:'2125550199'}, {'@type':'LocalBusiness',name:'Other Company',telephone:p.phone}]);
  expect(analyzeListing(page(body),p).evidence.confirmation).toBe('unconfirmed');
  expect(analyzeListing(page(fixture('local-business')+fixture('local-business')),p).billable).toBe(false);
 });
 it('ignores malformed data and hidden/script-only plain text',()=> {
  expect(parseBusinesses('<script type="application/ld+json">{bad</script>').businesses).toEqual([]);
  expect(analyzeListing(page('<h1>Fixture Roofing</h1><div hidden>212-555-0100</div>'),p).billable).toBe(false);
 });
 it('preserves duplicate/suppression states even with matching NAP',()=> {
  for(const status of ['duplicate','suppressed']) { const r=analyzeListing(page(fixture('local-business')),p,status);expect(r.status).toBe(status);expect(r.billable).toBe(false); }
 });
 it('requires live + matches + confirmed to bill',()=> {
  const nap=matchNap(p,seen);expect(nap.matches).toBe(true);
  for(const s of ['queued','submitted','needs_owner_action','mismatch','duplicate','suppressed','failed']) expect(isBillable(s,nap,true)).toBe(false);
  expect(isBillable('live',nap,false)).toBe(false);expect(isBillable('live',null,true)).toBe(false);expect(isBillable('live',nap,true)).toBe(true);
 });
});
