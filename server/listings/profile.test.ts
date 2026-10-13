import { it, expect } from 'vitest';
import { importedProfile, mergeImport, profileInput } from './profile';
it('imports known local fields, leaving unknown values null',()=> {
 const p=importedProfile({business_name:'Fixture',address:'12 Main St',phone:null});
 expect(p.name).toBe('Fixture');expect(p.service_area_only).toBeNull();expect(p.phone).toBeNull();expect(p.year_founded).toBeNull();expect(p.logo_key).toBeNull();
});
it('imports live GBP including service areas, hours, categories and services without cached address leakage',()=> {
 const p=importedProfile({address:'PRIVATE CACHE'}, {title:'Fixture',serviceArea:{businessType:'CUSTOMER_LOCATION_ONLY',places:{placeInfos:[{placeName:'Albany'}]}},categories:{primaryCategory:{displayName:'Roofer'}},regularHours:{periods:[]},specialHours:{specialHourPeriods:[]},serviceItems:[{freeFormServiceItem:{label:{displayName:'Roof repair'}}}]});
 expect(p.street_address).toBeNull();expect(p.service_area_only).toBe(true);expect(p.primary_category).toBe('Roofer');expect(p.service_areas).toHaveLength(1);expect(p.holiday_hours).toEqual({specialHourPeriods:[]});expect(p.services).toHaveLength(1);
});
it('preserves owner edits, including explicit nulls, while refreshing untouched fields',()=> {
 const p=mergeImport({name:'Owner name',phone:null,owner_edited_fields:['name','phone']},{name:'Google name',phone:'2125550100',website:'https://example.com'});
 expect(p.name).toBe('Owner name');expect(p.phone).toBeNull();expect(p.website).toBe('https://example.com');
});
it('rejects ownership, status and billability fields in profile input',()=> {
 for(const key of ['user_id','source','billable','status','owner_edited_fields']) expect(profileInput.safeParse({[key]:true}).success).toBe(false);
});
