import type { HelpDraft } from "../../types";

/** Written from client/src/pages/site-scan.tsx (Bulk scan client sites) and server/sitescan/agency.ts as they run. */
const entry: HelpDraft = {
  key: "site-scan.agency-bulk", parent: "site-scan", group: "Tools", route: "/site-scan", title: "Site Scan → Bulk scan client sites",
  whatItIs: "The folded block under the scan form where an agency starts one scan per client location in one go.",
  whatItDoes: "It lists your locations that are linked to a Google Business Profile, with each one’s website. Tick the ones to scan (or “Select this page”), and “Queue selected sites” starts a scan of each website with the “Pages to check” and “Pages to speed-test” values from the form above. Each scan compares the website with that location’s profile; the first one opens right away, and the rest appear in Scan history.",
  howToUse: [
    "Set “Pages to check” and “Pages to speed-test” in the scan form first; the bulk scans use them.",
    "Open “Bulk scan client sites — for agencies” and tick the locations, or choose “Select this page”; with more than 25 locations, use the location search above the block to page through them.",
    "Choose “Queue selected sites”.",
    "Watch Scan history: the scans run in the background one after another.",
  ],
  howItWorks: "The server accepts up to 1,000 location IDs per request and up to 1,000 bulk scans a day for the account. Every location must be yours, linked to a Google Business Profile, with a synced profile that has a website; otherwise the whole request is refused and nothing is started. The queued scans are ordinary Site Scans: the same page limits, the same PageSpeed budget, and the plan’s monthly Site Scans apply.",
  needs: ["Locations linked to their Google Business Profiles, each with a synced profile that has a website.", "Scans left on the plan's monthly Site Scans — one per location queued."],
};
export default entry;
