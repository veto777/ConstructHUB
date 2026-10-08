import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (Remind) and the estimate reminder route as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-remind", group: "CRM", route: "/crm/clients", title: "Nudge a client about an estimate",
  whatItIs: "A one-click reminder to a client whose estimate is sent but not answered.",
  whatItDoes: "Remind sends the client an email with a link back to the estimate, and a text as well when texting is set up and the client has a mobile number. The CRM confirms what went out.",
  howToUse: [
    "CRM → Clients, and open the client.",
    "Under Estimates, find the sent estimate that is still waiting.",
    "Choose Remind.",
    "Read the confirmation: it says whether an email, a text or both were sent.",
  ],
  howItWorks: "Remind appears on an estimate once it has been sent and until the client approves or declines it. The link in the reminder opens the same estimate the client was sent.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An email address on the client.", "For the text: your own texting number set up in Settings, and a mobile number on the client."],
};
export default entry;
