import type { HelpDraft } from "../../types";

/** Written from client/src/components/gbp-connection.tsx (GbpConnection, GbpLinkCell) and server/gbp/grants.ts as they run. */
const entry: HelpDraft = {
  key: "locations.several-google-accounts", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Several Google accounts",
  whatItIs: "The Google connection section at the bottom of Locations: every Google account you connected, and which listing syncs through which.",
  whatItDoes: "Lists each connected account with its state (Connected, or Reconnect needed when its access expired), View profiles and Open in Google for a connected one, and a summary that counts listings synced, ready to link, not in a connected account, or needing reconnect. Sync details names the account each listing syncs through, with the last success of its performance, profile and reviews parts, and a Sync now per listing.",
  howToUse: [
    "Sidebar → Google Business → Locations, and scroll to Google connection.",
    "Read each account’s state; Reconnect signs an expired one in again.",
    "Connect another Google account adds the next login that manages some of your listings.",
    "Open Sync details to see which account each listing syncs through and when each part last succeeded.",
  ],
  howItWorks: "Each imported listing remembers the Google account that manages it and syncs through that account’s access. A listing whose account expired shows Needs reconnect until that account signs in again; a listing managed by a Google login you have not connected is counted as not in a connected account. Syncs run every six hours while the account stays connected; Sync now runs one listing sooner.",
  needs: ["Any plan.", "A Google account that owns or manages each listing."],
};
export default entry;
