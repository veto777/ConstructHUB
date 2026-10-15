import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Onboarding tab) and server/agency/onboarding.ts (createOnboarding, sendOnboarding, pollInvitations, runOnboardingWorker) as they run. */
const entry: HelpDraft = {
  key: "agency.onboarding", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Onboarding",
  whatItIs: "How a client gives your agency manager access to their Google Business Profile. The client never signs in to ConstructHUB.",
  whatItDoes: "You pick the client, your agency's Google account and the business as Google names it. ConstructHUB emails the client the steps: add that Google account as a Manager on their listing. The top row counts requests waiting on the client, being accepted on Google, linked, and needing attention. Each request shows its status, when it went out, a link to the instructions and a Send reminder pill.",
  howToUse: [
    "Open the Onboarding tab under Agency; the client needs a contact email and the owner must have connected the agency Google account.",
    "Choose the client and the agency Google account.",
    "Type the business name exactly as Google shows it, with its address or Place ID.",
    "Choose Email manager instructions; the email goes out within a minute.",
    "Watch the status move from sent to linked, and use Send reminder (once a day) if the client stalls.",
  ],
  howItWorks: "The client keeps ownership and only adds your Google account as a Manager. The server checks that account's pending invitations in the background and accepts only one that matches a request, by Place ID or by name and address; a request that could match two invitations is left for you. The listing is then linked to the client, or a new location is created within the plan's allowance, and its first sync is queued. Reminders also go out on their own after 3 and 6 days, requests expire after 30 days, and the instructions link only shows the steps, with no sign-in behind it.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model).", "A connected agency Google account with Business Profile access.", "A client with a contact email."],
};
export default entry;
