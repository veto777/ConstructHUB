import type { HelpDraft } from "../../types";

/** Written from client/src/pages/public-estimate.tsx (share card), client/src/components/crm-engagement.tsx and server/crm/portal.ts as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-client-share", group: "CRM", route: "/crm/estimates", title: "A client shares the estimate with someone else",
  whatItIs: "A way for a client to share an estimate with a second person, and for you to see who it went to.",
  whatItDoes: "On the estimate page, “Need someone else to see this?” takes an email address and sends that person their own secure link. On your side, the estimate on the client's page shows an access event naming who the client shared it with, and when.",
  howToUse: [
    "Your client opens the estimate and scrolls to “Need someone else to see this?”.",
    "They type the other person's email and choose Send secure link.",
    "In the CRM, open the client and find the estimate under Estimates.",
    "Choose “access event” on the estimate to see who it was shared with.",
  ],
  howItWorks: "The second person gets their own link by email rather than the client's link. The estimate page lists everyone it has been shared with.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate that has been sent to the client."],
};
export default entry;
