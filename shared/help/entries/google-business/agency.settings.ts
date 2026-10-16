import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Settings tab) and server/agency/routes.ts (/api/agency/settings, /api/agency/google, /api/agency/google/refresh) + onboarding.ts (pollInvitations) as they run. */
const entry: HelpDraft = {
  key: "agency.settings", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Settings",
  whatItIs: "The owner's settings for the workspace: its name, the Google account the agency works through, and how listing invitations are handled.",
  whatItDoes: "It shows the agency name, how many Google accounts are connected and the invitation rule, with the form to change the name and the Auto-accept switch. Below that, each connected Google account shows whether it still works. Connect agency Google account adds one; Refresh Google listings re-reads the connected accounts' listings in the background.",
  howToUse: [
    "Open the Settings tab under Agency (owner only).",
    "Type the agency name and choose Save agency settings; it shows in every member's workspace switcher.",
    "Choose Connect agency Google account and sign in with the account your clients will invite as a manager.",
    "Leave Auto-accept off unless you want every invitation that account receives accepted, matched or not.",
  ],
  howItWorks: "The name and the Auto-accept switch are saved on the owner's account. With Auto-accept off, only an invitation that matches one of your onboarding requests is accepted; with it on, every waiting invitation is, but a listing that matches no client waits under Locations as unassigned. Refresh Google listings looks at the connected accounts again, at most twice in any ten minutes, and refuses when no account is connected. Connect opens Google's own sign-in; the access is stored encrypted and shown here as connected or needing reconnect.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model).", "The owner role: members cannot open this tab."],
};
export default entry;
