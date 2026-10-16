import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/account-panels.tsx, settings/billing/* and settings/plan-billing.tsx as they run. */
const entry: HelpDraft = {
  key: "account.billing", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Billing",
  whatItIs: "Your subscription, add-ons, invoices, payment methods and one-off purchases, as Stripe records them.",
  whatItDoes: "Four tabs. Subscriptions shows the statement, the current plan, its usage this month and the add-ons with + and − to change them. Invoices lists past invoices, Payment methods shows the cards on file, and Purchases lists one-off orders. Manage billing opens Stripe’s secure portal for cards, invoices and cancellation.",
  howToUse: [
    "Open Settings → Billing, or follow a Manage plan link from the dashboard.",
    "Read the Subscriptions tab for the current plan, its renewal date and add-ons.",
    "Use + and − on an add-on to change it; the change is prorated and invoiced.",
    "Open Invoices, Payment methods or Purchases for the records, or Manage billing for Stripe’s portal.",
  ],
  howItWorks: "Your subscription, invoices, cards and purchases are Stripe’s records. Prices come from ConstructHUB’s price list and usage from its own counters; no plan name is typed into the page. An add-on change goes to Stripe right away. A bigger amount is charged now for the rest of the billing period (a year on a yearly plan), a smaller one becomes account credit, and if the card fails nothing changes. Links such as ?tab=invoices open the matching tab.",
  needs: ["Not shown in the iPhone apps, which sell nothing."],
};
export default entry;
