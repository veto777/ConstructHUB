import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-pricebook.tsx (Formulas tab) and server/crm/pricebook.ts (formula test) as they run. */
const entry: HelpDraft = {
  key: "crm-pricebook-formulas", group: "CRM", route: "/crm/pricebook", title: "Test a price book formula",
  whatItIs: "A tester for price book formulas: the math that turns a measurement into a quantity.",
  whatItDoes: "The Formulas tab takes a formula and sample numbers for squares and waste, and shows the answer and the symbols the formula used. You can change the numbers or type a formula of your own.",
  howToUse: [
    "CRM → Price book → Formulas.",
    "Leave the sample formula, or type your own with symbols in square brackets.",
    "Type sample numbers for squares and waste.",
    "Choose Test and read the answer.",
  ],
  howItWorks: "A formula may use numbers, + - * / %, parentheses and min, max, ceil, floor and round. The tab lists every symbol a formula may use. Dividing by zero gives 0, and a symbol the tester has no number for is flagged with a warning.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
