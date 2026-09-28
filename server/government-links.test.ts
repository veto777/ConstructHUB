import { describe, it, expect } from 'vitest';
import { governmentLinkNotice, governmentLinksAvailable, governmentLinksForDisplay, canScrapeGovernmentPortal, governmentPermitForDisplay } from '../shared/government-links';
describe('government link visibility', () => {
  it('requires a verified, active link', () => {
    expect(governmentLinksAvailable({isActive: true, linkStatus: 'live'})).toBe(true);
    for (const linkStatus of ['dead', 'unverified', 'unchecked', 'none', null, undefined]) {
      expect(governmentLinksAvailable({isActive: true, linkStatus})).toBe(false);
    }
    expect(governmentLinksAvailable({isActive: false, linkStatus: 'live'})).toBe(false);
  });
});

it('property lookup API keeps office and phone but suppresses unverified URLs', () => {
  const office = { name: 'Fixture office', phone: null, isActive: true, linkStatus: 'dead', portalUrl: 'https://dead.invalid', searchUrl: 'https://dead.invalid' };
  expect(governmentLinksForDisplay(office)).toEqual({ ...office, portalUrl: null, searchUrl: null });
  expect(office.portalUrl).toBe('https://dead.invalid');
});

it('does not route an unrelated jurisdiction to a hardcoded scraper',()=>{
 const row={platform:'eTRAKiT',portalUrl:'https://other-city.invalid/eTRAKiT/',searchUrl:null};
 expect(canScrapeGovernmentPortal(row)).toBe(false);
 expect(canScrapeGovernmentPortal({...row,portalUrl:'https://permits.cob.org/eTRAKiT/'})).toBe(true);
 expect(canScrapeGovernmentPortal({...row,platform:'Custom / GovPlatform'})).toBe(false);
 expect(canScrapeGovernmentPortal({...row,platform:null})).toBe(false);
 expect(canScrapeGovernmentPortal({...row,platform:'City Website'})).toBe(false);
});

it('retains verified permit links while withholding unsourced legacy contact fields',()=>{
 const row={portalUrl:'https://fixture.invalid',searchUrl:null,isActive:true,linkStatus:'live',phone:'555-555-5555',email:'fixture@example.invalid',address:'Fixture address'};
 expect(governmentPermitForDisplay(row)).toEqual({...row,phone:null,email:null,address:null});
 expect(row.phone).toBe('555-555-5555');
});

it('keeps source-listed unconfirmed links visible with an honest dated label', () => {
  const row = {isActive:true, linkStatus:'unconfirmed', portalUrl:'https://fixture.invalid', searchUrl:null, lastVerifiedAt:'2026-09-28T12:00:00Z'};
  expect(governmentLinksAvailable(row)).toBe(true);
  expect(governmentLinksForDisplay(row).portalUrl).toBe(row.portalUrl);
  expect(governmentLinkNotice(row)).toBe('Official site · not auto-verified · Last checked 2026-09-28');
  expect(governmentLinkNotice({...row, lastVerifiedAt:null})).toContain('Check date unavailable');
  expect(governmentLinksAvailable({...row,linkStatus:'verified'})).toBe(true);
  expect(governmentLinksAvailable({...row,isActive:false})).toBe(false);
});
