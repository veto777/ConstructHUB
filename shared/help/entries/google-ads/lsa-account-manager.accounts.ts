import type { HelpDraft } from "../../types";

/** Written from client/src/pages/lsa-account-manager.tsx (AccountsTab, AccountDetailView) and server/routes.ts /api/admin/lsa/accounts* as they run. */
const entry: HelpDraft = {
  key: "lsa-account-manager.accounts", parent: "lsa-account-manager", group: "Google Ads", route: "/lsa-account-manager", title: "LSA account manager → Accounts",
  whatItIs: "The list of client Google Ads accounts the central manager knows, with each account’s campaigns and leads behind View.",
  whatItDoes: "Each account shows its name, customer ID, the owner’s email when a ConstructHUB user connected it, the link type (central, self or both), the link status, its lead, charged and disputed counts, its spend and whether it runs Local Services Ads. The search box matches a customer ID or a name; Add account records an account by hand. View opens the account: Campaigns lists its campaigns live from Google with their status and daily budget, and offers Rename, Budget, Pause and Enable. Leads lists the synced leads, Sync Leads imports the latest 200 from Google, and a charged lead can be disputed once with a reason.",
  howToUse: [
    "Open /lsa-account-manager → Accounts and use the search box to find a client by name or customer ID.",
    "Choose Add account and type the customer ID to record an account that is not under the manager account.",
    "Choose View on an account, then Campaigns: Rename, Budget, Pause or Enable each ask you to confirm.",
    "Choose Leads, then Sync Leads to pull the latest leads; choose Dispute on a charged lead and pick a reason.",
  ],
  howItWorks: "Accounts are read from Google through the central manager when they were linked that way, and through the owner’s own connection otherwise. Every write here (a budget, a status, a name, a dispute, a lead sync) goes straight to Google and is recorded in the Audit log with its result. A lead can only be disputed once, and Google decides whether it is credited.",
  needs: ["A ConstructHUB platform-admin account.", "A connected central manager (MCC) with a developer token for the campaign and lead calls."],
};
export default entry;
