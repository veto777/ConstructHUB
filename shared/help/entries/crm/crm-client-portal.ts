import type { HelpDraft } from "../../types";

/** Written from client/src/pages/client-portal.tsx and the “See what the client sees” preview (server/crm/client-auth.ts) as they run. */
const entry: HelpDraft = {
  key: "crm-client-portal", group: "CRM", route: "/crm/clients", title: "The client portal, from the client’s side",
  whatItIs: "A look at the portal each of your clients gets, opened the way they see it.",
  whatItDoes: "“See what the client sees” on a client’s page opens their portal as a read-only preview: Home with what needs their action, Estimates, Invoices & receipts, Signed contracts, Measurement reports, Photos, Messages and Contact us.",
  howToUse: [
    "CRM → Clients, and open a client.",
    "Choose See what the client sees.",
    "Click through the portal’s menu to see each section as the client does.",
  ],
  howItWorks: "The preview lasts fifteen minutes and is read-only: uploads, messages and financing applications are switched off, and it is not counted as the client opening anything. Clients only see estimates and invoices you have sent — drafts stay with you.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to manage clients."],
};
export default entry;
