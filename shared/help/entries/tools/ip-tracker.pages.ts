import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ip-tracker.tsx (Pages) and server/routes.ts GET …/pages as they run. */
const entry: HelpDraft = {
  key: "ip-tracker.pages", parent: "ip-tracker", group: "Tools", route: "/ip-tracker", title: "IP Tracker → Pages",
  whatItIs: "The pages people landed on, most hit first.",
  whatItDoes: "It counts the pages and hits in the range and lists each landing page with its hits, unique visitors and share of all hits.",
  howToUse: [
    "Open IP Tracker → Pages and pick the site.",
    "Choose a date range preset, or type a From and To date.",
    "Read the Unique visitors column to see which pages bring new people rather than repeat loads.",
  ],
  howItWorks: "A hit is one visit recorded by the tracking code with that page as its landing page: the page the visitor arrived on, not every page opened afterwards. Pages without the code are not counted. The newest 1,000 visits in the range are loaded.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
