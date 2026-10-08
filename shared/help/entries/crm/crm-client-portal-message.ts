import type { HelpDraft } from "../../types";

/** Written from client/src/components/portal-messages.tsx, client/src/pages/crm-inbox.tsx and server/crm/inbox.ts as they run. */
const entry: HelpDraft = {
  key: "crm-client-portal-message", group: "CRM", route: "/crm/inbox", title: "A client sends you a message",
  whatItIs: "What happens when a client writes to you from their portal, and how you answer.",
  whatItDoes: "The client's message appears in Messages with an unread dot, with an unread count beside Messages in the menu and a timer showing how long they have waited. Your reply shows in their portal and is sent to their email.",
  howToUse: [
    "Your client signs in to their portal, chooses Messages, writes and sends.",
    "In the CRM, the number beside Messages goes up. Open Messages.",
    "Choose the conversation to read it.",
    "Type your answer underneath and send it.",
  ],
  howItWorks: "A client can address a message to the whole office or to one person on their job. Opening a conversation marks it read. A reply is posted to the portal first and then emailed to the client's address; they can answer from the portal or by replying to the email.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An email address on the client, so they can sign in to their portal."],
};
export default entry;
