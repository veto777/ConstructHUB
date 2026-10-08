import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx, client-portal.tsx and server/crm/client-auth.ts as they run. */
const entry: HelpDraft = {
  key: "crm-client-portal-preview", group: "CRM", route: "/crm/clients", title: "See what the client sees",
  whatItIs: "A read-only look at one client's portal, exactly as that client sees it.",
  whatItDoes: "“See what the client sees” on a client's page opens their portal in a new tab with a Contractor preview banner: their home page, estimates, invoices and receipts, signed contracts, measurement reports, photos, messages and your contact details. Uploads, messages and financing applications are switched off in the preview.",
  howToUse: [
    "CRM → Clients, and open the client.",
    "Choose “See what the client sees”, under their name.",
    "Use the client's menu on the left to look at each section.",
    "Close the tab to come back. “Copy portal link” copies the client's own link to send them.",
  ],
  howItWorks: "The preview is opened for you without signing the client in, and it does not count as the client visiting. The portal link is personal to that client.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
