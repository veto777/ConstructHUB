import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Bid discounts) and server/crm/discounts.ts as they run. */
const entry: HelpDraft = {
  key: "crm-discount-defaults", group: "CRM", route: "/crm/settings", title: "Set the discounts every bid starts with",
  whatItIs: "The discount offers every estimate starts with, set once for the whole company.",
  whatItDoes: "Bid discounts lists four built-in offers, each with a switch, and lets you add your own with a name, a percent and an optional condition. New estimates start with the offers that are switched on when they are sent.",
  howToUse: [
    "CRM → Settings, and scroll to Bid discounts.",
    "Switch on the built-in offers you give. Each change saves right away.",
    "Under “Your own offer”, type a name, a percent and what qualifies, then choose Add.",
    "Use the bin beside an offer of your own to remove it.",
  ],
  howItWorks: "Clients tick the offers they qualify for on the estimate, and the total updates. The Discounts button on a single estimate can still change the offers for that one bid.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
