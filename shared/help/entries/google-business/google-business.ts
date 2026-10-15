import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-business.tsx (the signed-in overview) as it runs. */
const entry: HelpDraft = {
  key: "google-business", group: "Google Business", route: "/google-business", title: "Google Business overview",
  whatItIs: "The front door of the Google Business tools: one page that shows how your profiles are doing and opens each tool.",
  whatItDoes: "The numbers at the top count your locations, how many are linked to Google, the Google reviews saved here, the listings the Edit Monitor tracks and the ranking scans you have run; each number opens the page it comes from. Under “Your Google tools” one row opens each tool: Profile monitor, Ranking grid, Photo optimizer, Locations and Reinstatement. “About Google Business Profile” folds out a plain explanation of how a Google listing works.",
  howToUse: [
    "Sidebar → Google Business → Overview.",
    "Read the numbers: a zero beside “Linked to Google” means your locations do not sync yet — open Locations and connect your Google account.",
    "Click a tool row to open it, or click a number to go straight to that page.",
  ],
  howItWorks: "The numbers are read from what is already saved in ConstructHUB (your locations, monitored listings and scans); opening this page never calls Google and never spends credits. A location is counted as linked when it is connected to a Google Business Profile listing.",
  needs: ["Any plan."],
};
export default entry;
