import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-business.tsx (the signed-in overview) as it runs. */
const entry: HelpDraft = {
  key: "google-business", group: "Google Business", route: "/google-business", title: "Google Business overview",
  whatItIs: "The front door of the Google Business tools: how your listings are doing, and a row to open each tool.",
  whatItDoes: "The numbers at the top count your locations, show your Google connection (Connected, Needs reconnect or Not connected) with its last sync, the Google reviews saved here, the listings the Edit Monitor tracks and the ranking scans you have run. Each number opens the page it comes from. Under “Your Google tools” one row opens each tool. “About Google Business Profile” folds out a plain explanation of how a Google listing works.",
  howToUse: [
    "Open Overview under Google Business in the sidebar.",
    "Read the numbers; “Needs reconnect” or “Not connected” under Google connection means your locations do not sync right now.",
    "Open Locations and connect your Google account if that is the case.",
    "Click a tool row or a number to go straight to that page.",
  ],
  howItWorks: "The numbers come from what is already saved in ConstructHUB. Opening this page never calls Google and never spends credits. Google connection reads the same status as Locations, Google Reviews and the home dashboard: Connected when a linked listing's Google account still gives access, Needs reconnect when that access ended.",
  needs: ["Any plan."],
};
export default entry;
