import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/reports.tsx and server/seo/site-report.ts, site-report-send.ts, report-recipients.ts as they run. */
const entry: HelpDraft = {
  key: "seo.reports", parent: "seo", group: "Tools", route: "/seo/reports", title: "SEO Suite → Reports",
  whatItIs: "A plain-English report of where a site stands and what changed — to read here, download as a PDF, or have emailed every week or month to you or a client.",
  whatItDoes: "Rankings and movement, what to fix first from the audit, work done from the plan, visibility by tag and the local grid, each figure a link to the tool it came from. Download PDF gives the same content as a file, under your own name and logo when you set them under Site Scan → Branding. A schedule emails it with the PDF attached every week or on the 1st of each month to up to 5 addresses; Send now sends it at once.",
  howToUse: [
    "Pick the site; the report builds itself from the rank tracker, Site explorer, Site audit, the plan and the local grid.",
    "Choose Download PDF for a file, or set the schedule — how often and who to — and Save schedule.",
    "Press Send now to email it right away. A new address gets a confirmation email first and the report once it has confirmed.",
    "Set your own name and logo under Site Scan → Branding when you send reports to clients.",
  ],
  howItWorks: "Built from saved numbers only: making, downloading or sending a report never spends SEO data. The keyword table keeps up to 50 keywords. Arriving by link never sends or schedules anything.",
};
export default entry;
