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
