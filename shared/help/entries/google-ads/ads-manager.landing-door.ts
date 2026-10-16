import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (LandingDoorTab, DoorReplay), server/ads-landing.ts and server/ads-landing-recording.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.landing-door", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Landing door",
  whatItIs: "A view for ConstructHUB’s own platform admins of the clicks that arrive on ConstructHUB’s Google Ads landing pages (the landing doors). It is not shown to customers.",
  whatItDoes: "The table lists the last 200 visits to the landing doors with the time, door, verdict (serve, block or redirect) and reason. It also shows the IP address, country, campaign key, device and network, and refreshes every 10 seconds. Replay opens a recording of what that visitor saw and did on the page, when one was captured.",
  howToUse: [
    "Open Google Ads → Agency in the sidebar, then choose Landing door (admin); it appears only for platform admins.",
    "Read the verdict and reason of each visit.",
    "Choose Replay on a row that has a recording to watch the session.",
  ],
  howItWorks: "Each door checks a paid click before serving the page. Google’s own checked robots get the page, while known bots and proxy networks are blocked or sent away and added to Click Guard’s blocked list for the site. Everyone else needs a Google click ID and the campaign key and must be in the US. An address flagged as a bot or proxy in the last 60 days is sent away. Every visit is recorded, kept with the hit it belongs to.",
  needs: ["A ConstructHUB platform-admin account."],
};
export default entry;
