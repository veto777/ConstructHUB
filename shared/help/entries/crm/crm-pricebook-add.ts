import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-pricebook.tsx (the Add SKU dialog) as it runs. */
const entry: HelpDraft = {
  key: "crm-pricebook-add", group: "CRM", route: "/crm/pricebook", title: "Add a price book item",
  whatItIs: "The Add SKU form: one item in your price book, with its unit, its price and the scope of work your client reads.",
  whatItDoes: "Saves an item with a name, a code, a unit, a pricing mode and a description. Leave Code empty and the item gets the next SKU number. Flat price is one price for each unit; Per sq ft (measured) prices from a measured area. The form will not save an item without a price.",
  howToUse: [
    "CRM → Price book → Add SKU.",
    "Type the name and pick the unit you sell it by.",
    "Type the price for one unit. Cost is optional.",
    "Write the scope of work, then choose Add SKU.",
    "Search for the item, type a quantity and choose Preview to check the total.",
  ],
  howItWorks: "The scope of work shows on every estimate built from the item, with its line breaks kept. The pencil on an item opens the same form to change it.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
