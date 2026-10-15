import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ip-tracker.tsx (Traffic) and server/routes.ts GET …/analytics (trafficSources) as they run. */
const entry: HelpDraft = {
  key: "ip-tracker.traffic", parent: "ip-tracker", group: "Tools", route: "/ip-tracker", title: "IP Tracker → Traffic",
  whatItIs: "Where visits came from, one row per sending site.",
  whatItDoes: "Counts the sources, page loads and unique visitors for the range, then lists each sending site with its page loads, visitors and share. A visit without a referrer is counted under NO REFERRER DATA — typed addresses, bookmarks, and many apps and ad clicks arrive that way.",
  howToUse: [
    "IP Tracker → Traffic, and pick the site.",
    "Choose Last 7 days, Last 30 days, This month or All time, or type a From and To date.",
    "Read the share column to see which source sends the most page loads.",
  ],
  howItWorks: "The source is the referrer’s host name with www. removed, counted from the newest 1,000 visits in the range. Google Ads clicks usually arrive with google.com as the referrer or with none at all; the tool cannot tell an ad click from a search click.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
