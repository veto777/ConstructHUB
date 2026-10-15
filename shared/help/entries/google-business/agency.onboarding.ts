import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Onboarding tab) and server/agency/onboarding.ts (createOnboarding, sendOnboarding, pollInvitations, runOnboardingWorker) as they run. */
const entry: HelpDraft = {
  key: "agency.onboarding", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Onboarding",
  whatItIs: "The way a client gives your agency manager access to their Google Business Profile without ever signing in to ConstructHUB.",
  whatItDoes: "You choose the client, your connected agency Google account and the business as Google names it, and ConstructHUB emails the client the steps: add that Google account as a Manager on their profile. The row at the top counts requests waiting on the client, being accepted on Google, linked, and needing attention. Each request shows its status, when it was sent, a copyable link to the instructions and a Send reminder pill.",
  howToUse: [
    "Sidebar → Google Business → Agency → Onboarding. The client needs a contact email first (Clients tab), and the owner must have connected the agency Google account (Settings).",
    "Choose the client and the agency Google account, type the business name exactly as Google shows it, and give its address or Place ID.",
    "Choose Email manager instructions. The email goes out on the worker's next pass, within a minute, and the request appears below.",
    "Watch the status: sent, opened, invitation received, accepted, linked. Use Send reminder (once a day) if the client has not acted; reminders also go out on their own after 3 and 6 days.",
    "Once linked, the listing appears under Locations assigned to that client, with its first sync queued.",
  ],
  howItWorks: "The client keeps ownership and only adds the agency's Google account as a Manager. A background worker checks the connected account's pending invitations and accepts only one that matches a request — by Place ID when both have one, otherwise by business name and address; a request that could match more than one invitation is left for you. The listing is then linked to the client (or a new location row is created, within the plan's location allowance) and its first sync queued; you get a notice either way. Requests expire after 30 days; an email that could not be sent shows its error on the request and is retried. The instructions link is a one-off token with no sign-in behind it, so the client can only read the steps.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model).", "A connected agency Google account with the Business Profile scope.", "A client with a contact email."],
};
export default entry;
