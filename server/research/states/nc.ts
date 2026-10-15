/**
 * North Carolina. Checked live 2026-10-15. Three licensing boards share one public portal product (./lib/g3-arls.ts),
 * each searched live per report (no CAPTCHA; robots.txt absent):
 *
 *   NC Licensing Board for General Contractors (portal.nclbgc.org): licenses and qualifiers, with each license's
 *     "Disciplinary Action (2022-present)" list (case number, date, the order as a document) as enforcement
 *   NC Board of Examiners of Electrical Contractors (arls-public.ncbeec.org): licenses and their qualifiers
 *   NC State Board of Examiners of Plumbing, Heating & Fire Sprinkler Contractors (public.nclicensing.org): licenses
 *     and their classification holders (this board shows no license status)
 *
 * Each board is also searched by license number, phone and street address (the portal's own form fields). Every hit
 * carries the published address, phone and people (qualifiers, classification holders, contact) with their roles.
 */
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";
import { searchArlsBy, searchArlsLicenses, searchArlsMatters, type ArlsBoard } from "./lib/g3-arls";

const NCLBGC: ArlsBoard = {
  state: "NC", source: "NC Licensing Board for General Contractors", base: "https://portal.nclbgc.org",
  classField: "ClassificationDefinitionIdnt", licenseLabel: "General Contractor License", qualifierField: true, mattersPath: "/Public/_ShowNCLBGCPublicMatters/",
};
const NCBEEC: ArlsBoard = {
  state: "NC", source: "NC Board of Examiners of Electrical Contractors", base: "https://arls-public.ncbeec.org",
  classField: "AccountDefinitionIdnt", licenseLabel: "Electrical Contractor License",
};
const NCPHFS: ArlsBoard = {
  state: "NC", source: "NC Board of Examiners of Plumbing, Heating & Fire Sprinkler Contractors", base: "https://public.nclicensing.org",
  classField: "ClassificationDefinitionIdnt", licenseLabel: "Plumbing, Heating or Fire Sprinkler Contractor License", noQualifiers: true,
};

const live = (b: ArlsBoard): LiveLicenseSearch => ({ source: b.source, sourceUrl: `${b.base}/Public/Search`, search: (name, kind) => searchArlsLicenses(b, name, kind), searchBy: (q) => searchArlsBy(b, q) });

const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [
  { source: "NC Licensing Board for General Contractors: disciplinary actions", scope: "Disciplinary actions on general contractor licenses, 2022 to today", search: (name) => searchArlsMatters(NCLBGC, name) },
];

export const pack: StatePack = {
  state: "NC",
  checked: "2026-10-15",
  liveLicenses: [live(NCLBGC), live(NCBEEC), live(NCPHFS)],
  liveEnforcement: LIVE_ENFORCEMENT,
  blocked: [
    "nclbgc.org (the board's main site, including its disciplinary news): Cloudflare challenge on every page; the portal.nclbgc.org search is used instead",
    "NCBEEC public matters (/Public/_ShowAccountPublicMatters/): endpoint exists but no populated example was found to verify its layout, so it isn't searched",
    "NC Secretary of State business registration: bulk data is a paid subscription and the SOS bars automated searching of its online tools",
    "NC Industrial Commission (workers' comp penalties, stop-work): no published list of penalized or noncompliant employers",
  ],
};
