import type { HelpDraft } from "../../types";

/** Written from client/src/pages/compliance-research.tsx, server/research/routes.ts and shared/research-reports.ts as they run. */
const entry: HelpDraft = {
  key: "compliance.research", parent: "compliance", group: "Tools", route: "/compliance", title: "Compliance Dept → Research reports",
  whatItIs: "The order form for a Permit & License Research Report: a paid, bot-run search of a person’s or company’s licenses, permits and public records in the states you pick.",
  whatItDoes: "You give one or more names (each marked Person or Company), pick up to three states, and optionally the trades to list first, a “permits since” year, and extra identifiers for a name: up to 5 license numbers, 3 phone numbers and 3 street addresses at no extra charge. The price follows what you enter: one name in one state is the Standard report; more names or states is the Extended report. After you tick the three agreements, Continue creates the order and opens its page with a free preview of what the research will cover; Pay opens Stripe Checkout. Your earlier orders are listed under “Your reports” with their status.",
  howToUse: [
    "Add a name and choose Company or Person; open “Also search by license number, phone or address” to add identifiers you already know.",
    "Pick the states (up to three) and, if you like, the trades to focus on and the year to search permits from.",
    "Tick the three agreements (paid up front and non-refundable; nothing is guaranteed; not a consumer report) and choose Continue. Signed out, the button asks you to sign in first.",
    "Read the free preview on the order page, then choose Pay to start the research.",
  ],
  howItWorks: "The preview is made before you pay from the same sources the report uses: how many state license sources and live permit portals will be searched in each state and whether the names already match anything. After payment the research bot searches the state license records and every live permit portal it can reach in those states, follows the license numbers, phones, addresses and people it finds to related licenses and businesses, and, for companies, adds consumer complaints, state enforcement records, federal court cases and OSHA inspections where the server has those sources. You get an email when the report is ready. Identifier entries are checked as you type: a license number, a phone or an address the rules do not recognise is flagged under the field.",
  needs: ["A ConstructHUB account.", "Payment by card through Stripe Checkout; reports are paid up front and non-refundable."],
};
export default entry;
