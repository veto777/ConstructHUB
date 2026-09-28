import {it,expect} from 'vitest';
import {isAssessmentOffice} from './netr-office';
it('recognizes regional office names observed on current NETR listings',()=>{
 for(const name of ['Autauga Revenue Commission','Tarrant Appraisal District','Adair Property Valuation','Bergen Board of Taxation','Albany Real Property Tax Service','Botetourt Commissioner of Revenue','Adams Property Lister','Bertie Tax Administration','Pierce Assessor / Treasurer'])expect(isAssessmentOffice(name),name).toBe(true);
 for(const name of ['Pierce Auditor / Recorder','Albany County Clerk','Historic Aerials','Bertie Mapping / GIS','Adams Treasurer','Adams Register of Deeds'])expect(isAssessmentOffice(name),name).toBe(false);
});
