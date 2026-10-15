/**
 * Delaware. Checked live 2026-10-15. Delaware licenses no general contractor: a contractor needs a Division of Revenue
 * business license (resident or non-resident contractor), which is searched here. The Division of Professional
 * Regulation's electrical and plumbing/HVACR licensees are already in ../licenses.ts.
 *
 * Licenses (open data, data.delaware.gov):
 *   Delaware Division of Revenue business licenses, contractor categories       5zy2-grhr
 *   Delaware DPR licensees: architects, landscape architects, land surveyors,
 *     geologists, home inspectors                                              pjnv-eaih (profession filter)
 *   DNREC water well and pump installer contractors                            2dnk-irgr
 *   DNREC on-site wastewater (septic) licensees: designers, site evaluators,
 *     system contractors, inspectors, liquid waste haulers                     56uc-mvju
 *   DNREC certified asbestos firms (abatement contractors, professional services) f677-ahd9
 */
import type { LicenseSource } from "../licenses";
import type { StatePack } from "./types";

const soda = (id: string) => ({ datasetUrl: `https://data.delaware.gov/d/${id}`, url: `https://data.delaware.gov/resource/${id}.json` });

const LICENSES: LicenseSource[] = [
  { state: "DE", source: "Delaware Division of Revenue contractor business licenses", ...soda("5zy2-grhr"),
    fields: { businessName: "business_name", licenseNumber: null, licenseType: "category", specialty: "trade_name", status: null, principal: null, city: "city", expires: "current_license_valid_to" },
    // license_number is a number column the shared license-number search can't query: left out until it casts (::text).
    personField: null, address: "address_1", zip: "zip",
    filter: "category in ('RESIDENT CONTRACTOR','NON-RESIDENT CONTRACTOR','CONSTRUCTION MANAGER','CONSTRUCTION TRANSPORTATION CONTRACTOR','NON-RESIDENT CONST TRANSPORT CONTRACTOR')" },
  { state: "DE", source: "Delaware Division of Professional Regulation (architects, surveyors, geologists, home inspectors)", ...soda("pjnv-eaih"),
    fields: { businessName: null, licenseNumber: "license_no", licenseType: "license_type", specialty: "profession_id", status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: ["first_name", "last_name"],
    filter: "profession_id in ('Architecture','Landscape Architecture','Land Surveyors','Geologists','Home Inspectors')" },
  { state: "DE", source: "Delaware DNREC water well and pump installer contractors", ...soda("2dnk-irgr"),
    fields: { businessName: "orgname", licenseNumber: null, licenseType: "licensesubtype", specialty: null, status: "licstatus", principal: null, city: null, expires: "licenseexpires" },
    personField: null, address: "workaddress", phone: "workphone" }, // licensenumber: a number column too (left out)
  { state: "DE", source: "Delaware DNREC on-site wastewater system licensees", ...soda("56uc-mvju"),
    fields: { businessName: "companyname", licenseNumber: "licensenumber", licenseType: "licensesubtype", specialty: null, status: "licstatus", principal: "displayname", city: null, expires: null },
    personField: "displayname", address: "companyaddress", phone: "companyphone" },
  { state: "DE", source: "Delaware DNREC certified asbestos firms", ...soda("f677-ahd9"),
    fields: { businessName: "name", licenseNumber: "certno", licenseType: "certtype", specialty: null, status: null, principal: null, city: "city", expires: "expdate" },
    personField: null, address: "address1", zip: "zipcode", phone: "phone1" },
];

export const pack: StatePack = {
  state: "DE",
  checked: "2026-10-15",
  licenses: LICENSES,
  noStatewideGcLicense: "Delaware does not license general contractors; contractors hold a Division of Revenue contractor business license (searched above), and electricians, plumbers and HVACR contractors are licensed by the Division of Professional Regulation (searched above)",
  blocked: [
    "Delaware Division of Corporations entity search (icis.corp.delaware.gov): CAPTCHA on the search",
    "Delaware DPR disciplinary actions (data.delaware.gov dz6p-akeq): names individual licensees only (no business), so it can't be searched for companies",
    "Delaware DOL prevailing-wage debarment list: printed only inside each project's bid PDFs (bidcondocs.delaware.gov), no standing list or dataset",
    "Delaware court records: no court dataset on data.delaware.gov",
  ],
};
