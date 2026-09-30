import { describe, it, expect } from 'vitest';
import { mapProfile } from './client';
describe('Business Profile → location fields', () => {
  it('formats 24-hour days, split hours and closed days; names structured services from the category catalogue', () => {
    const p = mapProfile({
      title: 'X', categories: { primaryCategory: { displayName: 'Siding contractor', serviceTypes: [{ serviceTypeId: 'job_type_id:bathroom_remodeling', displayName: 'Bathroom remodeling' }] }, additionalCategories: [{ displayName: 'Deck builder' }] },
      regularHours: { periods: [
        { openDay: 'SUNDAY', openTime: {}, closeDay: 'SUNDAY', closeTime: { hours: 24 } },
        { openDay: 'MONDAY', openTime: { hours: 7 }, closeDay: 'MONDAY', closeTime: { hours: 12 } },
        { openDay: 'MONDAY', openTime: { hours: 13 }, closeDay: 'MONDAY', closeTime: { hours: 18 } } ] },
      serviceItems: [{ structuredServiceItem: { serviceTypeId: 'job_type_id:bathroom_remodeling' } }, { structuredServiceItem: { serviceTypeId: 'job_type_id:vinyl_siding_install' } }],
      openInfo: { status: 'CLOSED_TEMPORARILY', openingDate: { year: 2003, month: 2 } },
    }, [{ name: 'locations/1/attributes/url_instagram', uriValues: [{ uri: 'https://www.instagram.com/a/' }] }, { name: 'locations/1/attributes/url_facebook', uriValues: [{ uri: 'javascript:alert(1)' }] }]);
    expect(p.hours).toMatchObject({ Sunday: 'Open 24 hours', Monday: '7:00 AM – 12:00 PM, 1:00 PM – 6:00 PM', Tuesday: 'Closed' });
    expect(p.services).toEqual(['Bathroom remodeling', 'Vinyl siding install']);
    expect(p.categories).toEqual(['Siding contractor', 'Deck builder']);
    expect(p.openStatus).toBe('Temporarily closed'); expect(p.openingDate).toBe('2003-02');
    expect(p.social).toEqual({ instagram: 'https://www.instagram.com/a/' });
  });
  it('carries overnight opening hours into the next weekday, including the week boundary', () => {
    const p = mapProfile({regularHours:{periods:[
      {openDay:'MONDAY',openTime:{hours:20},closeDay:'TUESDAY',closeTime:{hours:4}},
      {openDay:'SUNDAY',openTime:{hours:22},closeDay:'MONDAY',closeTime:{hours:2}},
    ]}});
    expect(p.hours).toMatchObject({Monday:'12:00 AM – 2:00 AM, 8:00 PM – 12:00 AM',Tuesday:'12:00 AM – 4:00 AM',Sunday:'10:00 PM – 12:00 AM',Wednesday:'Closed'});
  });
  it('leaves hours null when Google has none', () => { expect(mapProfile({ title: 'Y' }).hours).toBeNull(); });
});
