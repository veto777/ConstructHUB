import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx as it runs. The page-level entry for /crm/settings: the
 * other /crm/settings entries each cover one card, and the route lookup must not hand the page one of them. */
const entry: HelpDraft = {
  key: "crm-settings", group: "CRM", route: "/crm/settings", title: "Settings",
  whatItIs: "The one page for how your company is set up: what prints on your documents, which emails you get, how clients can pay, and where your leads come from.",
  whatItDoes: "Each card is one topic — Company profile, Divisions, Estimate & invoice defaults, Notifications, Bid discounts, SMS, Price floor lock, Scheduled exports, Payments, Calendar and Lead sources. Switches and colour picks save the moment you change them; forms save with their own button. Most cards have their own “i” with the long version.",
  howToUse: [
    "CRM → Settings.",
    "Start with Company profile: the name, address, phone and logo that print on estimates and invoices.",
    "Set Estimate & invoice defaults — the estimate and invoice footers, terms and conditions, warranty text, and the default deposit and sales tax percentages.",
    "Turn on the notifications you want, connect Payments, and add your lead sources.",
  ],
  howItWorks: "Settings belong to the company, not to you, so every team member who can manage settings sees the same values. Document defaults are pre-filled on every new estimate and invoice and can be changed on that document; a saved change applies to the next document you create.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "The “Manage company settings” permission — by default the owner and admins have it."],
};
export default entry;
