import type { HelpDraft } from "../../types";

/** Written from client/src/pages/site-scan.tsx (the monthly toggle and list), server/sitescan/routes.ts and worker.ts as they run. */
const entry: HelpDraft = {
  key: "site-scan.monthly-rescan", parent: "site-scan", group: "Tools", route: "/site-scan", title: "Site Scan → Monthly rescans",
  whatItIs: "A switch under the scan form that scans the website again every month, and the list of the sites set up that way.",
  whatItDoes: "“Rescan this site every month” turns the schedule on or off for the website typed in the form, saving the form’s page counts and profile choice with it. The Monthly rescans list shows each scheduled site with its page limit and the date of its next run, and a Turn off button. Up to 10 sites can be scheduled.",
  howToUse: [
    "Type the website URL, the page counts and, if you want, the Business Profile to compare with.",
    "Turn on “Rescan this site every month”; the line beside it shows the next run date.",
    "Find the site later under Monthly rescans, where “Turn off” removes the schedule.",
    "Read each monthly report in Scan history, where the score’s move since the scan before is shown.",
  ],
  howItWorks: "A background job starts each due scan with the saved settings, one of the plan’s monthly Site Scans and one of the day’s five scans. When the plan’s monthly scans are used up the run is pushed to the next reset; when the day’s five are used up it is pushed a day. An agency member who acts through a client business can change a schedule only through that business. Turning a schedule off deletes it; reports already made stay in Scan history.",
  needs: ["Any plan; each run counts as one of the plan's monthly Site Scans."],
};
export default entry;
