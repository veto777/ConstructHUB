import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-estimate-detail.tsx (editor) and server/crm/portal.ts (client view) as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-tax-deposit", group: "CRM", route: "/crm/estimates", title: "Tax, deposit and hidden lines on an estimate",
  whatItIs: "The settings on a single estimate beyond its lines: the tax rate, a deposit, which lines are taxed and which lines the client sees.",
  whatItDoes: "In the editor, Tax % sets the rate for that estimate and Deposit sets the amount due up front. Under each line, Taxable decides whether the line is taxed and “Hidden from client” keeps it off the client's copy. The tax and total update as you edit.",
  howToUse: [
    "CRM → Estimates, open the estimate and choose Edit.",
    "Type the Tax % and the Deposit.",
    "Under a line, untick Taxable or tick “Hidden from client”.",
    "Choose Save changes, then Preview to see the client's view.",
  ],
  howItWorks: "A hidden line is marked hidden on your copy and is not listed on the client's page; its price still counts in the total. The deposit shows under the total as “Deposit due”. An estimate can be edited until the client approves it.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
