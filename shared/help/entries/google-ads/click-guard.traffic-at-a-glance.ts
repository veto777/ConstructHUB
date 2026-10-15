import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-ads.tsx (Dashboard, Traffic sources, Traffic signals tabs) and server/routes.ts GET …/analytics as they run. */
const entry: HelpDraft = {
  key: "click-guard.traffic-at-a-glance", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → Traffic at a glance",
  whatItIs: "The traffic numbers Click Guard shows for the dates you pick.",
  whatItDoes: "The Dashboard counts visits, blocked IPs, unique visitors and visits per visitor for Daily, Last 7 days or Last 30 days. It shows the threat level (the share of visits flagged), a visit trend by day, visits by device and a browser breakdown. Traffic sources lists the sites that sent each visit with their share, page loads and visitors. Under Traffic signals, the Countries, Multi-Clicks, Devices, Browsers and OS tabs break the same visits down.",
  howToUse: [
    "Open Google Ads → Click Guard in the sidebar, pick the website at the top and a range: Daily, Last 7 days or Last 30 days.",
    "Read the four counts, the threat level and the visit trend.",
    "Choose Traffic sources for the sites that sent each visit.",
    "Choose Traffic signals, then Countries or Multi-Clicks for those breakdowns.",
  ],
  howItWorks: "Everything here comes from visits the tracking code recorded, so pages without the code and browsers that block scripts are not counted. Country comes from the request on new visits; earlier visits show as Unknown.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield).", "The tracking code on the pages your ads point to."],
};
export default entry;
