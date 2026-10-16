import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (Health audit) and server/ads/audit.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.health-audit", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Health audit",
  whatItIs: "The read-only audit the Agency Ads & LSA manager runs on the client accounts you pick, and the Health audit section that lists its findings.",
  whatItDoes: "For each account it checks conversion tracking (including calls), disapproved ads, presence-only location targeting and ad schedules. It flags campaigns whose budget kept their ads out of more than 10% of the searches they could have shown on, and search terms that spent money with no reported conversions; these and the charged-lead check cover the last 30 days. Every finding names the account, what was found and a severity: Needs attention, Information, or Could not be checked. Each one links to a fix: a protection preview here, the right place in Google Ads, or LSA Leads.",
  howToUse: [
    "Tick accounts (or All active clients) under Google Ads → Agency → Client accounts and choose Queue health audit.",
    "Open Health audit and read the findings; Filters narrows them to Needs attention, Information or Could not be checked.",
    "Type in the search box to find findings about one check or one account.",
    "Follow the fix: Preview presence-only, Edit negative keyword preview and Edit schedule preview open the protection form; Review in Google Ads opens Google.",
  ],
  howItWorks: "The audit only reads from Google; it never changes a campaign. A check Google does not answer is reported as Could not be checked, never as a pass. A conversion action being set up does not prove its tracking code actually fires. Audits run in the background and appear under Queue; up to 1,000 accounts can be queued at once.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected and verified Google Ads manager (MCC) account.", "Client accounts linked under the MCC."],
};
export default entry;
