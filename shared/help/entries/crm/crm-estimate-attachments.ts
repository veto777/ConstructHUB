import type { HelpDraft } from "../../types";

/** Written from client/src/components/client-uploads.tsx (EstimateAttach, public attachments) and crm-client.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-attachments", group: "CRM", route: "/crm/clients", title: "Attach files to an estimate",
  whatItIs: "Files pinned to one estimate, such as a spec sheet, a care guide or a photo, that the client can download.",
  whatItDoes: "Attach on an estimate uploads a PDF or a picture and pins it to that estimate. The client finds it under “Attached documents” on the estimate page, with a Download button. The bin beside a file takes it off again.",
  howToUse: [
    "CRM → Clients, and open the client.",
    "Under Estimates, choose Attach on the estimate and pick the file.",
    "The file's name appears under the estimate.",
    "Your client opens the estimate and chooses Download under “Attached documents”.",
  ],
  howItWorks: "A file belongs to the one estimate it was attached to. The client's Activity on their page records when a file was attached.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
