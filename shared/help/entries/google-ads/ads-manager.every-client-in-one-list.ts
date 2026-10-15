import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (the Client accounts section) and server/ads/routes.ts GET /accounts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.every-client-in-one-list", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Every client in one list",
  whatItIs: "The Client accounts list of the Agency Ads & LSA manager: every account under your Google Ads manager account (the MCC), one row each.",
  whatItDoes: "Each row shows the customer ID, name, status, currency and timezone, whether Local Services campaigns were found (LSA account, No LSA campaigns found, or LSA not checked), the Click Guard domain mapping and when the account was last checked. Campaigns opens the campaigns from the last audit with their IDs and types. The search box matches a name or customer ID; Filters adds a status filter and an LSA filter.",
  howToUse: [
    "Open Google Ads → Agency → Client accounts in the sidebar.",
    "Read a row: status, currency and timezone, the LSA result and when it was last checked.",
    "Choose Campaigns on a row to list that client’s campaigns from the last audit.",
    "Open Filters to keep only one status or only LSA accounts, or type a name or customer ID in the search box.",
  ],
  howItWorks: "The list is what the last Discover clients run found under the manager account. The LSA result and the campaigns come from each account’s last health audit, so an account that was never audited shows LSA not checked and Never audited. A suspended account shows Google’s reason and cannot be ticked for an audit or a protection.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected and verified Google Ads manager (MCC) account."],
};
export default entry;
