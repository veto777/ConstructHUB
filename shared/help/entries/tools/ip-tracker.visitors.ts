import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ip-tracker.tsx (Visitors) and server/routes.ts GET …/visitors and …/visitors/:ip as they run. */
const entry: HelpDraft = {
  key: "ip-tracker.visitors", parent: "ip-tracker", group: "Tools", route: "/ip-tracker", title: "IP Tracker → Visitors",
  whatItIs: "The list of everyone who visited, one row per IP address.",
  whatItDoes: "Each row shows the address, visits and pages, city and country, device and browser, and when it was last seen. A green dot means seen in the last 20 minutes, and a Suspicious mark means Click Guard flagged it. Open a row for the browser, system, screen, language, time zone, computer ID (fingerprint), first and last visit, and any flag reasons. It also lists the 50 newest visits with where each came from and landed. The panel reads only the site's newest 1,000 visits, so on a busy site the first visit and the totals come from that window.",
  howToUse: [
    "Open IP Tracker → Visitors and pick the site at the top.",
    "Type part of an address in the search box to find one visitor.",
    "Choose a date range preset, or type a From and To date.",
    "Pick 20 minutes, an hour, a day or any time under “Seen within”, or type the number of minutes you want.",
    "Choose a row to open its full record.",
  ],
  howItWorks: "Rows are grouped by IP address from the newest 1,000 visits in the range, most recent last visit first, and refresh every 15 seconds while the page is open. The online dot and “Seen within” go by the time of the last visit, not a live connection. Several people behind one office or phone network can share an address.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield).", "The tracking code on the pages you want to watch."],
};
export default entry;
