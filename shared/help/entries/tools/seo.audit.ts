import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/audit.tsx, audit-pages.tsx, outgoing-links.tsx, render.tsx and server/seo/audit.ts, audit-pages.ts as they run. */
const entry: HelpDraft = {
  key: "seo.audit", parent: "seo", group: "Tools", route: "/seo/audit", title: "SEO Suite → Site audit",
  whatItIs: "A crawl (an automatic read of every page) of your website that lists what is broken and what to improve, with a health score you can watch change from crawl to crawl.",
  whatItDoes: "A crawl reads up to 150 pages the way a simple crawler does and checks each for broken pages and redirects, missing titles and descriptions, thin content, slow pages, pages that are not indexable, canonical and robots problems, orphan and deep pages, and the site’s internal and outgoing links. Issues are grouped by severity and area, each with its change since the crawl before. Two crawls can be compared, an issue can be sent to the Action plan, and everything exports.",
  howToUse: [
    "Pick the site and press Run new crawl; it uses one of your plan’s monthly Site Scans, not SEO data, and the page updates itself while it runs.",
    "Start with Errors, then Warnings: open an issue to see every page it affects and what to do about it.",
    "Use the Pages, Internal links, Outgoing links and Rendering tabs to look at the site page by page.",
    "Choose Add to plan on an issue to keep it in your Action plan.",
    "Pick an earlier crawl, or compare two, to see what was fixed and what is new.",
  ],
  howItWorks: "The crawl is a Site Scan: it reads each page’s HTML as sent, without running JavaScript, follows links up to the page limit and respects robots rules, so a page it did not reach may still exist. Opening the audit never spends SEO data. The tab, severity, area, issue and page in view are in the address, so a link from the dashboard or a report lands on the same thing.",
};
export default entry;
