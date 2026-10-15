import type { HelpDraft } from "../../types";

/** Written from client/src/components/gbp-connection.tsx (GbpConnection, GbpLinkCell) and server/gbp/grants.ts as they run. */
const entry: HelpDraft = {
  key: "locations.several-google-accounts", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Several Google accounts",
  whatItIs: "The Google connection section at the bottom of Locations: every Google account you connected, and which listing syncs through which.",
  whatItDoes: "It lists each connected account as Connected, or Reconnect needed when its access expired, with View profiles and Open in Google. A summary counts listings synced, ready to link, not in a connected account, or needing reconnect. Sync details names the account each listing syncs through, when each part last succeeded, and a Sync now per listing.",
  howToUse: [
    "Open Locations under Google Business and scroll to Google connection.",
    "Read each account's state; choose Reconnect to sign an expired one in again.",
    "Choose Connect another Google account for the next login that manages some of your listings.",
    "Open Sync details to see which account each listing uses and when each part last succeeded.",
  ],
  howItWorks: "Each imported listing remembers the Google account that manages it and syncs through that account's access. A listing whose account expired shows Needs reconnect until that account signs in again. A listing managed by a Google login you have not connected counts as not in a connected account. Syncs run every six hours while the account stays connected, and Sync now runs one listing sooner.",
  needs: ["Any plan.", "A Google account that owns or manages each listing."],
};
export default entry;
