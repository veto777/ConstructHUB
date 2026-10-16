import type { HelpDraft } from "../../types";

/** Written from client/src/pages/seo/audit.tsx, audit-pages.tsx, outgoing-links.tsx, render.tsx and server/seo/audit.ts, audit-pages.ts as they run. */
const entry: HelpDraft = {
  key: "seo.audit", parent: "seo", group: "Tools", route: "/seo/audit", title: "SEO Suite → Site audit",
  whatItIs: "A scan that reads every page of your website and lists what is broken and what to improve. Its health score shows how the site changes from scan to scan.",
  whatItDoes: "A scan reads up to 150 pages the way a simple search robot does. It checks each for broken pages and redirects, missing titles and descriptions, thin pages and oversized pages, pages Google can’t list or is told to skip, pages nothing links to or buried deep, and the site’s links in and out. Page speed is measured on one page only. Issues are grouped by how serious they are and by area, each with its change since the last scan. You can compare two scans, send an issue on the newest scan to the Action plan, and export the issues, the pages and the link lists.",
  howToUse: [
    "Pick the site and press Run first crawl (later, Run new crawl); it uses one of your plan’s monthly Site Scans, not SEO data, and the page updates itself while it runs.",
    "Start with Errors, then Warnings: open an issue to see every page it affects and what to do about it.",
    "Use the Pages, Internal links, Outgoing links and Rendering tabs to look at the site page by page.",
    "Choose Add to plan on an issue of the newest crawl to keep it in your Action plan.",
    "Pick an earlier crawl, or compare two, to see what was fixed and what is new.",
  ],
  howItWorks: "The scan is a Site Scan: it reads each page as sent, without running scripts, follows links up to the page limit and obeys the site’s rules for robots, so a page it did not reach may still exist. Opening the audit never spends SEO data. A link from the dashboard or a report opens the same issue and page.",
};
export default entry;
