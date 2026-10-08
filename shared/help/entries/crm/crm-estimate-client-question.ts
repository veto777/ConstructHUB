import type { HelpDraft } from "../../types";

/** Written from client/src/pages/public-estimate.tsx (AskQuestion), crm-inbox.tsx and server/crm/inbox.ts as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-client-question", group: "CRM", route: "/crm/estimates", title: "A client asks a question on an estimate",
  whatItIs: "The question box on the client's estimate page, and where the question lands for you.",
  whatItDoes: "A client types a question on the estimate and sends it. It appears in your Messages inbox, in that client's conversation, marked with the estimate's number. Your reply is emailed to the client and shows in their portal.",
  howToUse: [
    "Your client opens the estimate and scrolls to “Questions about this estimate?”.",
    "They type the question and choose Send.",
    "In the CRM, open Messages and choose the client's conversation.",
    "Type your answer underneath and send it.",
  ],
  howItWorks: "The question box names the salesperson on the estimate. The number beside Messages in the menu goes up until the conversation is opened.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate that has been sent to the client."],
};
export default entry;
