import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-business.tsx (the signed-in overview) as it runs. */
const entry: HelpDraft = {
  key: "google-business", group: "Google Business", route: "/google-business", title: "Google Business overview",
  whatItIs: "The front door of the Google Business tools: how your listings are doing, and a row to open each tool.",
  whatItDoes: "The numbers at the top count your locations, how many are linked to Google, the Google reviews saved here, the listings the Edit Monitor tracks and the ranking scans you have run. Each number opens the page it comes from. Under “Your Google tools” one row opens each tool. “About Google Business Profile” folds out a plain explanation of how a Google listing works.",
  howToUse: [
    "Open Overview under Google Business in the sidebar.",
    "Read the numbers; a zero beside “Linked to Google” means your locations do not sync yet.",
    "Open Locations and connect your Google account if that is the case.",
    "Click a tool row or a number to go straight to that page.",
  ],
  howItWorks: "The numbers come from what is already saved in ConstructHUB. Opening this page never calls Google and never spends credits. A location counts as linked when it is connected to a Google Business Profile listing.",
  needs: ["Any plan."],
};
export default entry;
