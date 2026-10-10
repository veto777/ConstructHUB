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

it('treats the multi-tenant eTRAKiT adapter as searchable on any verified tenant URL',()=>{
 // The eTRAKiT adapter is multi-tenant (etrakit.REPORT.md): it derives the app root from
 // the target URL and verifies the portal, so it is searchable on any tenant, not just Bellingham.
 const row={platform:'eTRAKiT',portalUrl:'https://hills-trk.aspgov.com/eTRAKiT/default.aspx',searchUrl:null};
 expect(canScrapeGovernmentPortal(row)).toBe(true);
 expect(canScrapeGovernmentPortal({...row,portalUrl:'https://permits.cob.org/eTRAKiT/'})).toBe(true);
 expect(canScrapeGovernmentPortal({...row,portalUrl:'https://permits.shastacounty.gov/etrakit/Search/permit.aspx'})).toBe(true);
 // A non-http(s) URL is still rejected.
 expect(canScrapeGovernmentPortal({...row,portalUrl:'ftp://x.invalid/eTRAKiT/'})).toBe(false);
});

it('keeps the single-tenant Skagit/Custom adapter pinned to skagitcounty.net',()=>{
 const row={platform:'Skagit County',portalUrl:'https://www.skagitcounty.net/permits',searchUrl:null};
 expect(canScrapeGovernmentPortal(row)).toBe(true);
 expect(canScrapeGovernmentPortal({...row,portalUrl:'https://other-county.invalid/permits'})).toBe(false);
 expect(canScrapeGovernmentPortal({...row,platform:'Custom / GovPlatform'})).toBe(true);
 expect(canScrapeGovernmentPortal({...row,platform:'Custom / GovPlatform',portalUrl:'https://other-county.invalid/permits'})).toBe(false);
});

it('never labels a blocked or non-adapter platform searchable',()=>{
 const base={portalUrl:'https://portal.invalid/permits',searchUrl:null};
 for (const platform of ['iWorQ','OpenGov','CitizenServe','MyGovernmentOnline','City Website',null]) {
   expect(canScrapeGovernmentPortal({...base,platform})).toBe(false);
 }
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

it('dates the label in the visitor\'s time zone, not UTC', () => {
  // 2026-09-30 23:30 UTC is still 2026-09-30 in US time zones; a UTC date read
  // one day ahead (the old toISOString slice). Pin the zone so the assertion
  // holds on any machine.
  const previousTz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const row = { linkStatus: 'unconfirmed', lastVerifiedAt: '2026-10-01T01:30:00Z' };
    expect(governmentLinkNotice(row)).toBe('Official site · not auto-verified · Last checked 2026-09-30');
  } finally {
    if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz;
  }
});
