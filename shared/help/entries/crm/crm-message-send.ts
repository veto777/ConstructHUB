import type { HelpDraft } from "../../types";

/** Written from client/src/components/crm-create-menu.tsx (MessageDialog) and the client page timeline as they run. */
const entry: HelpDraft = {
  key: "crm-message-send", group: "CRM", route: "/crm", title: "Send a client an email or text",
  whatItIs: "A quick message to one client, started from the Create button on any CRM page.",
  whatItDoes: "Create → Message opens a short form: pick the client, choose Email or Text, write the message and send. The message is recorded on that client’s Activity timeline. Text is greyed out, with a link to Settings → SMS, until texting is turned on.",
  howToUse: [
    "Choose Create, then Message.",
    "Search for the client and pick them.",
    "Leave Email selected, or choose Text when it is available.",
    "Write the message and choose Send email.",
    "Open the client’s page to see it under Activity.",
  ],
  howItWorks: "Email needs an email address on the client, and Text needs a phone number; the form says so when one is missing. Texting clients has to be set up under Settings → SMS before Text can be chosen.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An email address on the client, to send an email."],
};
export default entry;
