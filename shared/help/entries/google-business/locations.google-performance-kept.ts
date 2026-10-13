import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (InsightsTab) and server/gbp/service.ts (syncLocation) as they run. */
const entry: HelpDraft = {
  key: "locations.google-performance-kept", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Google performance, kept",
  whatItIs: "The Insights tab of a linked location: the performance report Google shares for a verified listing, stored in ConstructHUB.",
  whatItDoes: "Shows Search and Maps views split by mobile and desktop, website clicks, call clicks and direction requests, by day, week or month, from the last 30 days up to all stored history. The Total row sums the range. The newest days are marked “not final yet”, because Google corrects recent days after the fact.",
  howToUse: [
    "Sidebar → Google Business → Locations, then Open profile on a linked location.",
    "The location opens on Insights. Read the Total row for the range shown.",
    "Pick a range, from Last 30 days to All stored history, and group it by day, week or month.",
    "Days marked “not final yet” are re-read on the next syncs.",
  ],
  howItWorks: "A sync reads Google’s daily performance report every six hours while the Google account stays connected. The first sync asks for about 90 days and then back-fills the older days Google still holds; every later sync re-reads the last seven days. Every day synced stays stored, so the history keeps growing past Google’s own window.",
  needs: ["A location linked to its Google Business Profile.", "A verified listing — Google shares performance figures only for those."],
};
export default entry;
