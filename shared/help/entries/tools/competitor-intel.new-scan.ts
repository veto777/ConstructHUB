import type { HelpDraft } from "../../types";

/** Written from client/src/pages/competitors.tsx and server/routes.ts (POST /api/competitors/scans) as they run. */
const entry: HelpDraft = {
  key: "competitor-intel.new-scan", parent: "competitor-intel", group: "Tools", route: "/competitors", title: "Competitor Intel → New market scan",
  whatItIs: "The three-field form at the top of Competitor Intel that starts a scan of one trade around one place.",
  whatItDoes: "It sends the trade, the place and the radius to the scanner, which looks up the businesses Google lists for that trade within that distance and saves them as a scan you can open any time. Each scan uses one of the plan’s monthly Competitor Intel scans; a cancelled scan is given back.",
  howToUse: [
    "Trade: pick one from the list, or choose “Something else — type it” and write your own, such as “Pool builder” (up to 120 characters).",
    "Location: a city, a ZIP or a street address, such as “Tampa, FL”.",
    "Radius: tap 10, 25, 50 or 100 miles, or type any whole number of miles from 1 to 100 in the box beside them.",
    "Choose Scan market. The new scan appears in the list as Queued, then Scanning, then Completed; open it when it finishes.",
    "To scan the same market again later, use Re-run on its card — it starts a new scan with the same trade, place and radius.",
  ],
  howItWorks: "The server checks the three values (a trade of 1 to 120 characters, a place of up to 250, a radius of 1 to 100 miles), reserves one scan from the month’s allowance and queues the job; a background worker then reads Google’s public business listings and saves each one with its rating, review count, category, phone, website and address. The page refreshes every one and a half seconds while a scan is queued or running. The line in the form’s corner shows how many scans the account has used this month.",
  needs: ["A plan that includes Competitor Intel, with scans left this month."],
};
export default entry;
