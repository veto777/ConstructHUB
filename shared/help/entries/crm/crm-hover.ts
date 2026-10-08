import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-integrations.tsx, crm-client.tsx (Measurements card) and server/crm/hover.ts as they run. */
const entry: HelpDraft = {
  key: "crm-hover", group: "CRM", route: "/crm/integrations", title: "HOVER reports on your clients",
  whatItIs: "What the CRM does with HOVER measurement reports once your HOVER account is connected.",
  whatItDoes: "Completed HOVER jobs are brought in on their own and matched to the client at that address. The client's page then shows the roof and siding measurements, the PDF report, a link to the 3D model, and HOVER's photo of the house.",
  howToUse: [
    "CRM → Integrations. The HOVER card shows connected, the webhook and the last sync.",
    "Choose Sync now to check for completed jobs right away, or set how often Auto-sync runs.",
    "Open the client and scroll to Measurements for the report, the PDF and the 3D model.",
    "HOVER's photo of the house is under Project Photos on the same page.",
  ],
  howItWorks: "Connecting is a one-time sign-in to your own HOVER account. A completed job is matched to a client by email, phone or the address of the house; when nobody matches, a new client is created from the job. The same job is never imported twice.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Your own HOVER account, connected on the Integrations page."],
};
export default entry;
