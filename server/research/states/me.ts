/**
 * Maine. Checked 2026-10-15: no source could be searched.
 *
 * Maine licenses no general contractors: the Attorney General's consumer page "Home Construction and Repair"
 * (www.maine.gov/ag/consumer-protection/consumer-help-topics/housing/home-construction-and-repair) says "In Maine,
 * general contractors - and trades such as roofing and framing - are not licensed or regulated", and that the
 * state licenses plumbers and electricians.
 */
import type { StatePack } from "./types";

export const pack: StatePack = {
  state: "ME",
  checked: "2026-10-15",
  noStatewideGcLicense: "Maine does not license general contractors or trades such as roofing and framing (Maine Attorney General); electricians, plumbers and oil and solid fuel technicians are licensed by the Office of Professional and Occupational Regulation, whose license search could not be used",
  blocked: [
    "OPOR license search (www.pfr.maine.gov/ALMSOnline/ALMSQuery): robots.txt disallows SearchResults.aspx, the detail pages and the CSV export, so the search can't be used",
    "www1.maine.gov/cgi-bin/online/licensing (InforME license lookups): robots.txt on www.maine.gov disallows /cgi-bin/",
    "Secretary of State corporate search (icrs.informe.org): did not answer",
    "The electricians', plumbers' and fuel boards' pages publish no licensee lists or disciplinary action lists",
  ],
};
