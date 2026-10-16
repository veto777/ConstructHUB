import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (the LSA filter, Campaigns, Health audit) and server/ads/audit.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.local-services-checks", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Local Services checks",
  whatItIs: "What the Agency Ads & LSA manager shows for client accounts that run Local Services Ads.",
  whatItDoes: "Client accounts marks each client as LSA account, No LSA campaigns found or LSA not checked, and the LSA filter keeps only one of those. Campaigns lists a client’s campaigns, Local Services ones included. For an LSA account the health audit also reads the service areas, job types and budget Google has on file, and counts the charged leads that still need feedback. That finding links to LSA Leads, where you review each lead with its dispute evidence.",
  howToUse: [
    "Open Google Ads → Agency → Client accounts in the sidebar, open Filters and set LSA to LSA identified.",
    "Choose Campaigns on a client to see its Local Services campaign beside the search campaigns.",
    "Open Health audit and search for leads to find the charged leads that still need feedback.",
    "Choose Review leads and dispute evidence to open LSA Leads for that account.",
  ],
  howItWorks: "The LSA result comes from the campaigns found in the account’s last health audit, so an account that was never audited reads LSA not checked. An unrated charged lead is not invalid and not eligible for credit by itself. A dispute is made in LSA Leads with a reason you choose, and that account has to be connected there too.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected and verified Google Ads manager (MCC) account.", "A client account with Local Services campaigns, audited at least once."],
};
export default entry;
