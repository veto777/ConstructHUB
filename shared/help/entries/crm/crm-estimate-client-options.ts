import type { HelpDraft } from "../../types";

/** Written from client/src/pages/public-estimate.tsx, client/src/pages/crm-client.tsx (the Options dialog), client/src/components/crm-discounts.tsx and server/crm/portal.ts as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-client-options", group: "CRM", route: "/crm/estimates", title: "How a client picks options and discounts",
  whatItIs: "The part of the client’s estimate page where they choose between the options you offered and tick the discounts they qualify for.",
  whatItDoes: "When an estimate has options built from price book lines, the client’s page shows “Choose your scopes”: each option with its price and a tick box, and a total that updates as they tick. Offers you allowed appear under “Optional discounts”. “Review selection” lists the totals, and “Generate my estimate” makes a new estimate with only their choices, for them to approve.",
  howToUse: [
    "On the client’s page, choose Options on the estimate. Name each option and add its lines from the price book.",
    "Choose Discounts, tick the offers this client may choose, and save.",
    "The client opens the estimate, ticks the option they want, and ticks any discount they qualify for.",
    "They choose “Review selection”, then “Generate my estimate”. The new estimate appears on the client’s page in the CRM.",
  ],
  howItWorks: "An option with no lines is shown as a price tier only and cannot be ticked. Nothing is final until the client approves the new estimate. Discounts are worked out again on the server when they approve.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate sent to a client who has an email address.", "Items in your price book, to build the options from."],
};
export default entry;
