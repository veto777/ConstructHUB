import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Financing links), client-portal.tsx, public-estimate.tsx and server/crm/notes-timeline.ts as they run. */
const entry: HelpDraft = {
  key: "crm-financing", group: "CRM", route: "/crm/settings", title: "Offer financing",
  whatItIs: "A place to keep your lender's application link, so clients can find it from their portal, estimates and invoices.",
  whatItDoes: "Financing links holds up to ten lender or partner links. The one marked Primary appears as “Finance this project” on your estimates and invoices and under Financing in the client portal.",
  howToUse: [
    "CRM → Settings, and scroll to Financing links at the end of Payments.",
    "Type the label your client will see and paste the lender's link, then choose Add link.",
    "The first link is the primary one. With more than one, choose Set primary on the link clients should see.",
    "Use the bin to remove a link.",
  ],
  howItWorks: "The CRM does not lend or approve anything: it shows your link, and the lender's own page takes the application. When a client clicks the financing option, the Financing interest notification alerts you.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A financing link from your own lender."],
};
export default entry;
