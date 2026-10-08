import type { HelpDraft } from "../../types";

/** Written from client/src/components/client-uploads.tsx (PamphletManager, portal pamphlets) and crm-client.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-pamphlets", group: "CRM", route: "/crm/clients", title: "Brochures for your clients",
  whatItIs: "Company-wide documents, such as a brochure, a warranty or a care guide, that every client can download from their portal.",
  whatItDoes: "“Company pamphlets” at the bottom of any client's page uploads a PDF or a picture for the whole company. Each client sees it on the Home page of their portal, under your company's name, with a Download button.",
  howToUse: [
    "CRM → Clients, and open any client.",
    "Scroll to “Company pamphlets” at the bottom of the page.",
    "Choose Upload PDF and pick the file.",
    "Use the bin beside a file to remove it for every client.",
  ],
  howItWorks: "A pamphlet is not tied to one client: upload it on any client's page and it appears on all of them, and in every client's portal.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
