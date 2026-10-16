import type { HelpDraft } from "../../types";

/** Written from client/src/pages/compliance-research.tsx (ResearchOrderStatusPage), server/research/runner.ts and shared/research-reports.ts as they run. */
const entry: HelpDraft = {
  key: "compliance.order", parent: "compliance", group: "Tools", route: "/compliance", title: "Compliance Dept → Your report",
  whatItIs: "One research order: its free preview and payment before the research runs, and the finished report afterwards.",
  whatItDoes: "The page shows the order number, the names, states, trades and identifiers it was made with, the purpose and the “Anything else we should know” note if you wrote them, and its status: Awaiting payment, Queued, Researching, Ready or Needs attention. Before payment it shows the free preview and the Pay button. While the bot works it says so and refreshes itself. When the report is ready it shows, for each name: License records, records matched by an identifier you gave, Related licenses and businesses (each saying what ties it: the same license number, phone, address, person or business), Permits, and for companies Consumer complaints, State enforcement and standing records, Federal court cases and OSHA inspections, then a Coverage list of every portal searched or not searched. Every finding links to its source when the agency gives a link (a permit without one says “Portal”), and “Print / save PDF” prints the report.",
  howToUse: [
    "Open the order from “Your reports” on the order form, or from the link in the email we send when it is ready.",
    "Before paying, read the free preview and the terms, then choose Pay to start the research.",
    "When the status is Ready, read each name’s sections and open the source link beside a finding before you rely on it.",
    "Choose “Print / save PDF” to keep a copy.",
  ],
  howItWorks: "The note you wrote with the order is saved with it, shown on this page and sent to our team in the email they get when the order is paid; it does not change the price or what the bot searches. A count shown as “(not searched)” means no source of that kind ran for that name; it is never shown as zero found. A record found only by a license number, phone or address you gave, but under a different name, is listed on its own rather than as the subject’s. Red marks an outcome the agency itself records as adverse; a complaint or a filed case is not a finding. A failed order is rerun by the team and needs nothing from you. A platform administrator can run an order without paying for checks.",
};
export default entry;
