import type { HelpDraft } from "../../types";

/** Written from client/src/pages/public-estimate.tsx (share card), client/src/components/crm-engagement.tsx and server/crm/portal.ts as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-client-share", group: "CRM", route: "/crm/estimates", title: "A client shares the estimate with someone else",
  whatItIs: "A way for a client to share an estimate with a second person, and for you to see who it went to.",
  whatItDoes: "On the estimate page, “Need someone else to see this?” takes an email address and sends that person their own secure link. On your side, the estimate on the client's page shows an access event naming who the client shared it with, and when.",
  howToUse: [
    "Point your client to “Need someone else to see this?” on the estimate.",
    "Have them type the other person's email and choose Send secure link.",
    "Open the client in the CRM and find the estimate under Estimates.",
    "Choose “access event” on the estimate to see who it was shared with.",
  ],
  howItWorks: "The second person gets their own link by email rather than the client's link. After each share the page names who was sent a link. An estimate can be shared with up to 5 people.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate that has been sent to the client."],
};
export default entry;
