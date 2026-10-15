/**
 * South Carolina. Looked at live 2026-10-15: no source here can be searched within the rules yet, so the pack has
 * none (`checked` stays empty). What was tried, and why it can't be used, is in `blocked`.
 */
import type { StatePack } from "./types";

export const pack: StatePack = {
  state: "SC",
  checked: "",
  blocked: [
    "SC LLR licensee lookup (verify.llronline.com: Contractors' Licensing Board, Residential Builders, Burglar/Fire/Sprinkler, Manufactured Housing): reCAPTCHA on every search",
    "SC LLR board orders and bulk verification (eservice.llr.sc.gov/PublicOrdersWeb, /OnlineVerificationBulk): robots.txt Disallow: /",
    "SC LLR license rosters: sold by mailed request ($10 check per roster with a signed Family Privacy Protection Act statement, llr.sc.gov Statement_Compliance.pdf); needs the owner",
    "SC Secretary of State business entities (businessfilings.sc.gov): reCAPTCHA after a few searches",
    "SC Department of Environmental Services enforcement: monthly PDF reports only (des.sc.gov EnforcementReport_<Month><Year>.pdf); the DES ArcGIS hub is private",
    "SC Workers' Compensation Commission and SC Materials Management Office: no published list of penalized employers or debarred vendors (decisions are single PDFs)",
  ],
};
