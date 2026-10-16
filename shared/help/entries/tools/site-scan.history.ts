import type { HelpDraft } from "../../types";

/** Written from client/src/pages/site-scan.tsx (Scan history) and server/sitescan/routes.ts as they run. */
const entry: HelpDraft = {
  key: "site-scan.history", parent: "site-scan", group: "Tools", route: "/site-scan/history", title: "Site Scan → Scan history",
  whatItIs: "Every scan your account has run, newest first, each as a card with its scores.",
  whatItDoes: "Each card shows the website, when the scan ran and for which client, its state (waiting, scanning, done or failed) and how many pages were checked. A finished scan shows its overall score, the change since the last scan of that site, and the Technical, Content, Local, Performance and AI readiness scores. Open report shows the full report under the list. Until you have run a scan, two cards of sample data show what the list will look like.",
  howToUse: [
    "Open Site Scan → Scan history in the sidebar (outside the full-screen tool it is under the scan form).",
    "Search by website or client name, or filter by state.",
    "Choose “Open report” on a card, or its website name, to read the findings, the fix checklist and the follow-up actions.",
    "Use Previous scans / Next scans to page through the list, 25 at a time.",
  ],
  howItWorks: "The list shows your saved scans, 25 per page, and refreshes itself every three seconds while a scan is waiting or running. The move beside the overall score compares the card with the newest earlier scored scan of the same website on the same page of the list. The sample cards are fixed text in the page, shown only while the list is empty and never saved or sent anywhere.",
  needs: ["Any plan; the history is the scans the plan's monthly Site Scans paid for."],
};
export default entry;
