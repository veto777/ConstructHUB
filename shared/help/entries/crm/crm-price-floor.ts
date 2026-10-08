import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Price floor lock) and server/crm/price-floor.ts as they run. */
const entry: HelpDraft = {
  key: "crm-price-floor", group: "CRM", route: "/crm/settings", title: "Stop bids going below your floor",
  whatItIs: "A lock that stops your team from pricing an estimate below your floor.",
  whatItDoes: "With Lock pricing on, an estimate that prices an item below its floor is refused, with a message naming the item and the floor. The floor is each price book item's current price, or cost plus the margin you type.",
  howToUse: [
    "CRM → Settings, and scroll to Price floor lock (the owner sees this card).",
    "Switch on Lock pricing.",
    "Optionally type a floor margin over cost and choose Save floor.",
    "Your team now prices at or above the floor; a lower price is refused when the estimate is saved or sent.",
  ],
  howItWorks: "An item is matched to the price book by its name or its code. Lines you write yourself that match nothing in the price book have no floor unless they carry a cost. The owner is never blocked and can still change prices and discounts.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "You are the owner of the workspace.", "Price book items with prices."],
};
export default entry;
