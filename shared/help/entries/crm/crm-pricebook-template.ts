import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-pricebook.tsx (the "Start from a template" dialog) as it runs. */
const entry: HelpDraft = {
  key: "crm-pricebook-template", group: "CRM", route: "/crm/pricebook", title: "Start a price book item from a template",
  whatItIs: "Ready-written price book items for common jobs, so you do not start the scope of work from a blank box.",
  whatItDoes: "From template lists starter items — siding, roofing, painting, gutters, windows, soffit and decking. Picking one opens the Add SKU form with the name, the unit, the pricing mode and the scope of work filled in. The price is left empty for you to set.",
  howToUse: [
    "CRM → Price book → From template.",
    "Choose the template closest to the work you sell.",
    "Type your price, and change the name or the wording if you need to.",
    "Choose Add SKU. The item is in your Price Chart.",
  ],
  howItWorks: "A template only fills in the form — nothing is saved until you choose Add SKU, and the form will not save without a price. The scope of work shows on every estimate built from the item.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
