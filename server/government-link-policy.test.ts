import { describe, it, expect } from 'vitest';
import { classifySourceListedLink as classify } from './government-link-policy';
const identity={state:'WA',jurisdiction:'Fixture County',sourceListed:true};
const url='https://fixture.gov/assessor';
describe('three-tier source-listed government links',()=>{
 it('restores blocks, transient failures, JS shells and inconclusive identity without certifying them',()=>{
  for(const reason of ['HTTP 403 (blocked/transient)','HTTP 429 (blocked/transient)','TimeoutError','no on-topic page content (manual/browser review required)','rendered page does not identify expected jurisdiction'])
   expect(classify(url,{status:'unverified',reason},identity)).toBe('unconfirmed');
 });
 it('keeps hard failures and generic homepages dead',()=>{
  for(const reason of ['ENOTFOUND','ECONNREFUSED','CERT_HAS_EXPIRED','net::ERR_CERT_AUTHORITY_INVALID','generic homepage; department URL required','soft 404','parked/for-sale domain'])
   expect(classify(url,{status:'unverified',reason},identity)).toBe('dead');
  for(const httpStatus of [404,410])expect(classify(url,{httpStatus},identity)).toBe('dead');
 });
 it('requires both topic and identity for verification',()=>{
  expect(classify(url,{status:'live',httpStatus:200,title:'Fixture County Assessor'},identity)).toBe('verified');
  expect(classify(url,{status:'live',httpStatus:200,title:'Other County Assessor'},identity)).toBe('unconfirmed');
  expect(classify(url,{status:'unverified',httpStatus:403,title:'Fixture County Assessor'},identity)).toBe('unconfirmed');
 });
 it('accepts state agency identity only for the matching state and official host',()=>{
  const evidence={status:'unverified',httpStatus:200,reason:'rendered page does not identify expected jurisdiction',title:'SDAT Real Property Data Search'};
  expect(classify('https://sdat.dat.maryland.gov/RealProperty/Pages/default.aspx',evidence,{...identity,state:'MD'})).toBe('verified');
  expect(classify('https://sdat.dat.maryland.gov/RealProperty/Pages/default.aspx',evidence,identity)).toBe('unconfirmed');
  expect(classify('https://impostor.invalid',evidence,{...identity,state:'MD'})).toBe('unconfirmed');
  expect(classify('https://svc.mt.gov/dor/property',{...evidence,title:'Property.MT.Gov'},{...identity,state:'MT'})).toBe('verified');
 });
 it('recovers a jurisdiction-specific OpenGov home, but not a vendor home',()=>{
  const e={status:'unverified',httpStatus:200,reason:'generic homepage; department URL required',jurisdictionMatched:true};
  expect(classify('https://fixture.portal.opengov.com/',e,identity)).toBe('verified');
  expect(classify('https://opengov.com/',e,identity)).toBe('dead');
 });
 it('requires source evidence and keeps absent URLs separate from dead ones',()=>{
  expect(()=>classify(url,{status:'live',jurisdictionMatched:true},{...identity,sourceListed:false})).toThrow('source evidence');
  expect(classify(null,undefined,identity)).toBe('none');
 });
});
