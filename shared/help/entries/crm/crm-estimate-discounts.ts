import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-estimate-detail.tsx (Discounts dialog; a line of kind "discount" in the editor) as it runs. */
const entry: HelpDraft = {
  key: "crm-estimate-discounts", group: "CRM", route: "/crm/estimates", title: "Add a discount to an estimate",
  whatItIs: "Two ways to take money off an estimate: optional offers the client can choose, and a fixed discount line you put in yourself.",
  whatItDoes: "Discounts, under the total, lists offers with a percent off and a condition — tick the ones this client may choose on their estimate page, or add a custom offer with your own label, percent and conditions. For a fixed amount, Edit → Add line with Kind set to discount subtracts that amount from the total.",
  howToUse: [
    "CRM → Estimates, open the estimate, and choose Discounts under the total.",
    "Tick the offers this client may choose, or fill in Custom offer and choose Add custom offer.",
    "Choose Save offers.",
    "For a fixed amount: Edit → Add line, set Kind to discount, type the amount, and save.",
  ],
  howItWorks: "Offers are optional for the client and each carries its condition; the estimate’s total is worked out again on our side when they approve. A discount line is part of the estimate itself and shows as its own line.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate that is not approved yet."],
};
export default entry;
