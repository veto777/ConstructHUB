import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-pricebook.tsx (Materials and Labor tabs) as it runs. */
const entry: HelpDraft = {
  key: "crm-pricebook-materials-labor", group: "CRM", route: "/crm/pricebook", title: "Materials and labor rates",
  whatItIs: "The Materials and Labor tabs of the price book: what each material and each hour of labor costs you, and what you charge.",
  whatItDoes: "A material has a name, a unit, a cost, a price and a waste percent, and the list shows its margin. A labor rate has a cost per hour and a price per hour. The pencil on a row changes it and the bin removes it.",
  howToUse: [
    "CRM → Price book → Materials.",
    "Type the name, choose the unit, type the cost and the price, and click the plus button.",
    "Use the pencil on a row to change a price, then save.",
    "Open the Labor tab to add or change hourly rates the same way.",
  ],
  howItWorks: "Cost is what you pay and price is what you charge. The waste percent is applied to the quantity when a price book item that uses the material is priced. Removing a material or a rate asks you to confirm first.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to manage the price book."],
};
export default entry;
