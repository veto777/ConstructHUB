import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Settings tab) and server/agency/routes.ts (/api/agency/settings, /api/agency/google, /api/agency/google/refresh) + onboarding.ts (pollInvitations) as they run. */
const entry: HelpDraft = {
  key: "agency.settings", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Settings",
  whatItIs: "The owner's settings for the workspace: its name, the Google account the agency works through, and how location invitations are handled.",
  whatItDoes: "Shows the saved agency name, how many Google accounts are connected and the invitation rule, with the form to change the name and the Auto-accept switch under it. Below, each connected Google account with whether it still works, Connect agency Google account, and Refresh Google listings, which re-reads the connected accounts' Business Profiles in the background.",
  howToUse: [
    "Sidebar → Google Business → Agency → Settings (owner only).",
    "Type the agency name and choose Save agency settings. It appears in every member's workspace switcher.",
    "Choose Connect agency Google account and sign in with the Google account your clients will invite as a manager.",
    "Leave Auto-accept off unless you want every location invitation that account receives accepted, matched request or not.",
  ],
  howItWorks: "The name and the Auto-accept switch are saved on the owner's account; the form starts from the saved values. Auto-accept off means the worker accepts only an invitation that matches one of your onboarding requests; on, it accepts every pending invitation on the connected accounts, but an invitation with no matching request is still never assigned to a guessed client: its listing waits under Locations as unassigned. Refresh Google listings marks each connected account for a new discovery pass (once every ten minutes at most), run by the onboarding worker; with no connected account it refuses and says so. Connect opens Google's own sign-in; the grant is stored encrypted and shown here as connected or needing reconnect.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model).", "The owner role: members cannot open this tab."],
};
export default entry;
