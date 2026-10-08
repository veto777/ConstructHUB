import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (the tracking strip), client/src/components/crm-engagement.tsx and client/src/pages/crm-settings.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-tracking", group: "CRM", route: "/crm/clients", title: "See whether your client opened the estimate",
  whatItIs: "The tracking lines under a sent estimate on the client’s page.",
  whatItDoes: "A sent estimate shows when it was sent and “Not opened yet”. Once the client opens it, the line shows when it was first opened and how many views it has had, and a second line counts the visits, the total time spent and how long ago the last visit was. Click that line to list each visit.",
  howToUse: [
    "CRM → Clients, and open the client.",
    "Under Estimates, find the estimate you sent and read the line under its buttons.",
    "Click the visits line to see each visit with its time and length.",
    "On the Estimates page, an opened estimate’s status reads “viewed”.",
  ],
  howItWorks: "The estimate’s own page records each time the client opens it and how long they stay. In Settings, “Estimate viewed” alerts you the first time a client opens an estimate.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate that has been sent to the client."],
};
export default entry;
