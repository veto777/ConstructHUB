import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (InsightsTab) and server/gbp/service.ts (syncLocation) as they run. */
const entry: HelpDraft = {
  key: "locations.google-performance-kept", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Google performance, kept",
  whatItIs: "The Insights tab of a linked location: the performance report Google shares for a verified listing, kept in ConstructHUB so the history keeps growing.",
  whatItDoes: "It shows Search and Maps views split by mobile and desktop, website clicks, call clicks and direction requests. You can group by day, week or month, from the last 30 days up to all stored history, and the Total row adds up the range. The newest days are marked “not final yet” because Google corrects recent days after the fact.",
  howToUse: [
    "Open Locations under Google Business and choose Open profile on a linked location.",
    "Read the Total row on the Insights tab, where the location opens.",
    "Pick a range, from Last 30 days to All stored history.",
    "Group it by day, week or month.",
  ],
  howItWorks: "A sync pulls Google's daily performance report every six hours while the Google account stays connected. The first sync asks for about 90 days and then fills in the older days Google still holds; every later sync re-reads the last seven days. Every day synced stays stored, so the history grows past Google's own window.",
  needs: ["A location linked to its Google Business Profile.", "A verified listing — Google shares performance figures only for those."],
};
export default entry;
