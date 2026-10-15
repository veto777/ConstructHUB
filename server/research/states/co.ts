/**
 * Colorado. Checked live 2026-10-15. (DORA electrical, plumbing and water-conditioning licenses are already searched
 * from the same dataset in ../licenses.ts; this pack adds the other construction credentials in it.)
 *
 *   CO DORA design and specialty licenses: data.colorado.gov 7s5z-vewr ("Professional and Occupational Licenses in
 *     Colorado", updated daily), restricted to architects (ARC), professional engineers (PE), land surveyors (PLS),
 *     landscape architects (LA), radon measurement/mitigation professionals (RMT, RME), the electrical and plumbing
 *     work permits (JEWP, MEWP, RWWP, JPWP, MPWP, RPWP), the historic emergency permits (METPE, MPTE) and the
 *     military-spouse versions of these and of the electrical/plumbing licenses. Prefixes and meanings are DORA's own
 *     (data.colorado.gov 349y-twqi, "Professional and Occupational License Types in Colorado").
 *   CO Secretary of State business entities: data.colorado.gov 4ykn-tg5h (every entity since 1864, updated daily),
 *     its status as published (Good Standing, Delinquent, Revoked, Administratively Dissolved, ...) and principal
 *     address. Companies only. (The DORA dataset publishes city, state and ZIP but no street or phone.)
 *
 * Colorado has no statewide general-contractor license: DORA's own consumer page says "Not all occupations are
 * licensed, such as roofers and general contractors" (dora.colorado.gov/consumer-protection-home-and-repair).
 */
import type { LicenseSource } from "../licenses";
import type { SodaEnforcement } from "../state-records";
import { clean } from "../bulk";
import type { StatePack } from "./types";

const soda = (domain: string, id: string) => ({ datasetUrl: `https://${domain}/d/${id}`, url: `https://${domain}/resource/${id}.json` });

const DORA_TYPES = [
  "ARC", "PE", "PLS", "LA", "RMT", "RME",
  "JEWP", "MEWP", "RWWP", "JPWP", "MPWP", "RPWP", "METPE", "MPTE",
  "MSARC", "MSPE", "MSPLS", "MSLA", "MSRMT", "MSRME",
  "MSAPE", "MSJW", "MSME", "MSRW", "MSJP", "MSMP", "MSAP", "MSRP", "MSWI", "MSWP",
];

const licenses: LicenseSource[] = [
  {
    state: "CO", source: "Colorado DORA licenses (architects, engineers, surveyors, landscape architects, radon; trade work permits)",
    ...soda("data.colorado.gov", "7s5z-vewr"),
    fields: { businessName: "entityname", licenseNumber: "licensenumber", licenseType: "licensetype", specialty: "subcategory", status: "licensestatusdescription", principal: null, city: "city", expires: "licenseexpirationdate" },
    personField: ["firstname", "middlename", "lastname"],
    filter: `licensetype in (${DORA_TYPES.map((t) => `'${t}'`).join(",")})`,
  },
];

const s = (v: unknown): string | null => clean(v == null ? null : String(v));

const enforcement: SodaEnforcement[] = [
  {
    state: "CO", source: "Colorado Secretary of State business entities", scope: "Every entity registered since 1864, updated daily",
    ...soda("data.colorado.gov", "4ykn-tg5h"), nameFields: ["entityname"],
    toHit: (r) => {
      const status = s(r.entitystatus);
      return {
        category: "business_status", name: s(r.entityname), id: s(r.entityid), date: s(r.entityformdate)?.slice(0, 10) ?? null, endDate: null,
        city: [s(r.principalcity), s(r.principalstate)].filter(Boolean).join(", ") || null,
        status: status ? `Secretary of State status: ${status}` : null,
        detail: [s(r.entitytype) ? `Entity type code ${s(r.entitytype)}` : null, s(r.jurisdictonofformation) ? `formed in ${s(r.jurisdictonofformation)}` : null].filter(Boolean).join(", ") || null,
        amount: null, adverse: status === "Revoked" ? true : null,
        address: s(r.principaladdress1) ? [s(r.principaladdress1), s(r.principaladdress2), s(r.principalcity), [s(r.principalstate), s(r.principalzipcode)].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null,
      };
    },
  },
];

export const pack: StatePack = {
  state: "CO",
  checked: "2026-10-15",
  licenses,
  enforcement,
  noStatewideGcLicense: "Colorado does not license general contractors or roofers statewide (cities and counties may); the state-licensed trades are searched above",
  blocked: [
    "DORA license lookup with discipline (apps2.colorado.gov/dora/licensing/Lookup): the search form requires a CAPTCHA",
  ],
};
