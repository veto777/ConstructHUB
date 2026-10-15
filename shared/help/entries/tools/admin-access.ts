import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-access.tsx and server/access-grants.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-access", group: "Tools", route: "/admin/access", title: "Access grants (admin)",
  whatItIs: "A page for the people who run ConstructHUB: give an account a plan for a number of days without a card, and take it back.",
  whatItDoes: "Find an account by email, name, company or account number (the newest accounts are listed before you search). Open one, pick a plan, a number of days (1–1000, with quick picks) and an optional note only admins see, and grant. Active grants lists each grant with its plan, who granted it, start, end and days left, and a Revoke button; Ended grants keeps the history.",
  howToUse: [
    "Search for the account and open it.",
    "Choose the plan and the days, add a note if useful, and confirm the grant.",
    "Grant again to extend, or Revoke to end it early.",
  ],
  howItWorks: "A grant is the account’s subscription row without Stripe; it stops counting at its end date. The server refuses anyone who is not a platform admin and asks for a recent identity check.",
  needs: ["Platform admin access."],
};
export default entry;
