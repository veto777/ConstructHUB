import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx as it runs. The page-level entry for /crm/settings: the
 * other /crm/settings entries each cover one card, and the route lookup must not hand the page one of them. */
const entry: HelpDraft = {
  key: "crm-settings", group: "CRM", route: "/crm/settings", title: "Settings",
  whatItIs: "The one page for how your company is set up: what prints on your documents, which emails you get, how clients can pay, and where your leads come from.",
  whatItDoes: "Each card is one topic — Company profile, Divisions, Estimate & invoice defaults, Notifications, Bid discounts, SMS, Price floor lock, Scheduled exports, Payments, Calendar and Lead sources. Most switches and colour picks save the moment you change them. The Scheduled exports switch and the card-fee switch save with their card’s button, and forms save with their own button. Most cards have their own “i” with the long version.",
  howToUse: [
    "Open CRM → Settings.",
    "Start with Company profile: the name, address, phone and logo that print on estimates and invoices.",
    "Set Estimate & invoice defaults — the estimate and invoice footers, terms and conditions, warranty text, and the default deposit and sales tax percentages.",
    "Turn on the notifications you want and connect Payments; the Lead sources card only shows the sources already on your clients.",
  ],
  howItWorks: "Settings belong to the company, not to you, so every team member who can manage settings sees the same values. Today only some defaults are used. The terms are copied onto each new estimate, and the sales tax rate is used when an estimate has none of its own. The warranty text and terms also show on the client’s estimate page and contract, including ones already sent, so a change shows there too. The footers and the default deposit are saved but not used on documents.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "The “Manage company settings” permission — by default the owner and admins have it."],
};
export default entry;
