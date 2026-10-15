import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (LandingDoorTab, DoorReplay), server/ads-landing.ts and server/ads-landing-recording.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.landing-door", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Landing door",
  whatItIs: "A ConstructHUB platform-admin view of the clicks that arrive on ConstructHUB’s own Google Ads landing doors; it is not shown to customers.",
  whatItDoes: "The table lists the last 200 visits to the landing doors with the time, the door, the verdict (serve, block or redirect), the reason, the IP, the country, the campaign key, the device and the network, and refreshes every 10 seconds. Replay opens a recording of what that visitor saw and did on the page, when one was captured.",
  howToUse: [
    "Sidebar → Google Ads → Agency, then choose Landing door (admin); it appears only for platform admins.",
    "Read the verdict and reason of each visit.",
    "Choose Replay on a row that has a recording to watch the session.",
  ],
  howItWorks: "Each door checks a paid click before serving the page: Google’s own verified crawlers are served; known bots and proxy networks are blocked or redirected and added to Click Guard’s blocked list for the site; everyone else needs a Google click ID and the campaign key. Every visit is recorded, and the recording is kept with the hit it belongs to.",
  needs: ["A ConstructHUB platform-admin account."],
};
export default entry;
