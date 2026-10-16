import type { HelpDraft } from "../../types";

/** Written from client/src/pages/seo/reports.tsx and server/seo/site-report.ts, site-report-send.ts, report-recipients.ts as they run. */
const entry: HelpDraft = {
  key: "seo.reports", parent: "seo", group: "Tools", route: "/seo/reports", title: "SEO Suite → Reports",
  whatItIs: "A plain-English report of where a site stands and what changed. Read it here, download a PDF, or have it emailed every week or month to you or a client.",
  whatItDoes: "It covers rankings and movement, what to fix first, work done from the plan, visibility by tag and the local grid. Each figure links to the tool it came from. Download PDF gives the same content as a file, under your own name and logo when you set them under Site Scan → Branding. A schedule emails it with the PDF attached every week or on the 1st of each month to up to 5 addresses; Send now sends it at once.",
  howToUse: [
    "Pick the site; the report builds itself from the rank tracker, Site explorer, Site audit, the plan and the local grid.",
    "Choose Download PDF for a file, or set the schedule (how often and who to) and Save schedule.",
    "Press Send now to email it right away. A new address is skipped and gets a confirmation email instead; it receives the reports sent after it confirms. Your own and your team’s addresses need no confirmation.",
    "Set your own name and logo under Site Scan → Branding when you send reports to clients.",
  ],
  howItWorks: "Built from saved numbers only: making, downloading or sending a report never spends SEO data. The keyword table keeps up to 50 keywords. Arriving by link never sends or schedules anything.",
};
export default entry;
