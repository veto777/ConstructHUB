import {it,expect} from 'vitest';
import {preserveNewerGovernmentCheck} from './government-seed-status';
it('a seed cannot resurrect a URL rejected by a newer verifier',()=>{
 const existing={portalUrl:'https://fixture.invalid',searchUrl:'https://fixture.invalid',linkStatus:'dead',isActive:false,lastVerifiedAt:new Date('2026-09-29')};
 const incoming={...existing,linkStatus:'live',isActive:true,lastVerifiedAt:new Date('2026-09-28')};
 expect(preserveNewerGovernmentCheck(existing,incoming).linkStatus).toBe('dead');
 expect(preserveNewerGovernmentCheck(existing,{...incoming,lastVerifiedAt:null}).isActive).toBe(false);
 expect(preserveNewerGovernmentCheck(existing,{...incoming,lastVerifiedAt:new Date('2026-09-30')}).linkStatus).toBe('live');
 expect(preserveNewerGovernmentCheck(existing,{...incoming,portalUrl:null,searchUrl:null,linkStatus:'none',isActive:false}).linkStatus).toBe('none');
});

it('preserves a newer null dead verdict until the replacement is checked again',()=>{
 const existing={portalUrl:null,searchUrl:null,linkStatus:'dead',isActive:false,lastVerifiedAt:new Date('2026-09-29')};
 for(const linkStatus of ['verified','unconfirmed']){
  const incoming={...existing,portalUrl:'https://source-listed.invalid',searchUrl:'https://source-listed.invalid',linkStatus,isActive:true,lastVerifiedAt:new Date('2026-09-28')};
  expect({...incoming,...preserveNewerGovernmentCheck(existing,incoming)}).toEqual(existing);
  const newer={...incoming,lastVerifiedAt:new Date('2026-09-30')};
  expect({...newer,...preserveNewerGovernmentCheck(existing,newer)}).toEqual(newer);
 }
});
