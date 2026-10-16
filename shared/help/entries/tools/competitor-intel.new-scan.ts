import type { HelpDraft } from "../../types";

/** Written from client/src/pages/competitors.tsx and server/routes.ts (POST /api/competitors/scans) as they run. */
const entry: HelpDraft = {
  key: "competitor-intel.new-scan", parent: "competitor-intel", group: "Tools", route: "/competitors", title: "Competitor Intel → New market scan",
  whatItIs: "The three-field form at the top of Competitor Intel that starts a scan of one trade around one place.",
  whatItDoes: "It looks up the businesses Google lists for your trade within that distance of the place. They are saved as a scan you can open any time. Each scan uses one of the plan’s monthly Competitor Intel scans; a canceled scan is given back.",
  howToUse: [
    "Pick a trade from the list, or choose “Something else — type it” and write your own, such as “Pool builder” (up to 120 characters).",
    "Type a location: a city, a ZIP or a street address, such as “Tampa, FL”.",
    "Tap a radius of 10, 25, 50 or 100 miles, or type any whole number of miles from 1 to 100 in the box beside them.",
    "Choose Scan market; the new scan appears in the list as Queued, then Scanning, then Completed, and you open it when it finishes.",
    "Use Re-run on a scan’s card to scan the same market again later; it starts a new scan with the same trade, place and radius.",
  ],
  howItWorks: "Starting a scan sets aside one scan from the month’s allowance. ConstructHUB then reads Google’s public business listings in the background and saves each one with its rating, review count, category, phone, website and address. The page refreshes every one and a half seconds while a scan is queued or running. The line in the form’s corner shows how many scans the account has used this month.",
  needs: ["A plan that includes Competitor Intel, with scans left this month."],
};
export default entry;
