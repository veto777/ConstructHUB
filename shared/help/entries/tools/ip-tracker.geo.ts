import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ip-tracker.tsx (Geo), client/src/components/ip-tracker/country-names.ts and server/routes.ts GET …/geo as they run. */
const entry: HelpDraft = {
  key: "ip-tracker.geo", parent: "ip-tracker", group: "Tools", route: "/ip-tracker", title: "IP Tracker → Geo",
  whatItIs: "Where your visitors are: by country, and by city.",
  whatItDoes: "It lists countries, or cities, with their visits, unique visitors and share. Unknown holds visits recorded before Sep 30, 2026 or with no location.",
  howToUse: [
    "Open IP Tracker → Geo and pick the site.",
    "Switch between Countries and Cities.",
    "Type a country code or a city name to filter the list, and choose a date range or type two dates.",
  ],
  howItWorks: "Country and city come from Cloudflare’s lookup of the visitor’s address on visits recorded since Sep 30, 2026. A VPN or a phone carrier can place a visitor in another city, so treat the location as approximate. The newest 1,000 visits in the range are loaded.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
