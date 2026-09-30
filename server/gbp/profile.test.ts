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
  it('maps every supported profile and social field from a complete Google fixture', () => {
    const networks=['facebook','instagram','linkedin','pinterest','tiktok','twitter','youtube'];
    const social=Object.fromEntries(networks.map(name=>[name,`https://${name}.example.invalid/fixture`]));
    expect(mapProfile({title:'Profile fixture',phoneNumbers:{primaryPhone:'+15550100000'},websiteUri:'https://fixture.example.invalid',
      storefrontAddress:{addressLines:['Fixture street','Fixture unit'],locality:'Fixture city',administrativeArea:'WA',postalCode:'98000',regionCode:'US'},
      categories:{primaryCategory:{displayName:'Contractor'},additionalCategories:[{displayName:'Roofing contractor'}]},
      profile:{description:'Fixture description'},serviceArea:{places:{placeInfos:[{placeName:'Fixture service area'}]}},
      serviceItems:[{freeFormServiceItem:{label:{displayName:'Fixture service'}}}],openInfo:{status:'OPEN',openingDate:{year:2000,month:1,day:2}},
      metadata:{placeId:'fixture-place',mapsUri:'https://maps.google.com/?cid=123'},
    },networks.map(name=>({name:`attributes/url_${name}`,uriValues:[{uri:social[name]}]})))).toEqual({
      businessName:'Profile fixture',phone:'+15550100000',website:'https://fixture.example.invalid',address:'Fixture street, Fixture unit',city:'Fixture city',state:'WA',zipCode:'98000',country:'US',
      categories:['Contractor','Roofing contractor'],description:'Fixture description',serviceAreas:['Fixture service area'],services:['Fixture service'],hours:null,openingDate:'2000-01-02',openStatus:'Open',placeId:'fixture-place',googleCid:'https://maps.google.com/?cid=123',social,
    });
  });
  it('leaves hours null when Google has none', () => { expect(mapProfile({ title: 'Y' }).hours).toBeNull(); });
});
