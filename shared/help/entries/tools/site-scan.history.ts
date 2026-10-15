import type { HelpDraft } from "../../types";

/** Written from client/src/pages/site-scan.tsx (Scan history) and server/sitescan/routes.ts as they run. */
const entry: HelpDraft = {
  key: "site-scan.history", parent: "site-scan", group: "Tools", route: "/site-scan/history", title: "Site Scan → Scan history",
  whatItIs: "Every scan your account has run, newest first, each as a card with its scores.",
  whatItDoes: "Each card shows the website, when the scan ran and for which client, its state (waiting, scanning, done or failed), how many pages were checked, the overall score with its move since the scan before of the same site, and the Technical, Content, Local, Performance and AI readiness scores. A scan that is still running or failed says so in place of the scores. Open report shows the full report under the list. Until you have run a scan, the list shows two cards of sample data so you can see what it will look like.",
  howToUse: [
    "Open Site Scan → Scan history in the sidebar (outside the full-screen tool it is under the scan form).",
    "Search by website or client name, or filter by state; “History for selected client” narrows the list to the client chosen in the scan form, and “All clients” widens it again.",
    "Choose “Open report” on a card, or its website name, to read the findings, the fix checklist and the follow-up actions.",
    "Use Previous scans / Next scans to page through the list, 25 at a time.",
  ],
  howItWorks: "The list is read from the scans saved on the server, 25 per page, and refreshes itself every three seconds while a scan is waiting or running. The move beside the overall score compares the card with the newest earlier scan of the same website that has a score. The sample cards are fixed text in the page, shown only while the list is empty and never saved or sent anywhere.",
  needs: ["Any plan; the history is the scans the plan's monthly Site Scans paid for."],
};
export default entry;
