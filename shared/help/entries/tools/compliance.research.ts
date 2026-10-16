import type { HelpDraft } from "../../types";

/** Written from client/src/pages/compliance-research.tsx, server/research/routes.ts and shared/research-reports.ts as they run. */
const entry: HelpDraft = {
  key: "compliance.research", parent: "compliance", group: "Tools", route: "/compliance", title: "Compliance Dept → Research reports",
  whatItIs: "The order form for a Permit & License Research Report: a paid, bot-run search of a person’s or company’s licenses, permits and public records in the states you pick.",
  whatItDoes: "You give one or more names (each marked Person or Company), pick up to three states, and can add trades to list first, a “permits since” year, and up to 5 license numbers, 3 phones and 3 addresses per name for free. An “Anything else we should know” note (up to 500 characters) goes to our team and changes neither the price nor the search. One name in one state is the Standard report; more names or states is the Extended report. After you tick the three agreements, Continue opens the order with a free preview of what the research will cover, Pay opens Stripe Checkout, and earlier orders are listed under “Your reports”.",
  howToUse: [
    "Add a name and choose Company or Person; open “Also search by license number, phone or address” to add identifiers you already know.",
    "Pick the states (up to three) and, if you like, the trades to focus on and the year to search permits from.",
    "Tick the three agreements (paid up front and non-refundable; nothing is guaranteed; not a consumer report) and choose Continue; signed out, the button asks you to sign in first.",
    "Read the free preview on the order page, then choose Pay to start the research.",
  ],
  howItWorks: "The free preview uses the same sources as the report: how many license sources and live permit portals each state has, and whether the names already match anything. After payment the research bot searches the state license records and every live permit portal it can reach, and follows the license numbers, phones, addresses and people it finds to related licenses and businesses. For companies it adds complaints, state enforcement records, federal court cases and OSHA inspections where ConstructHUB has those sources, and you get an email when the report is ready. License numbers, phones and addresses are checked as you type, and one the rules do not recognize is flagged under the field.",
  needs: ["A ConstructHUB account.", "Payment by card through Stripe Checkout; reports are paid up front and non-refundable."],
};
export default entry;
