import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (the contact row under the client's name) as it runs. */
const entry: HelpDraft = {
  key: "crm-client-contact-shortcuts", group: "CRM", route: "/crm/clients", title: "Call, text, email or map a client",
  whatItIs: "The contact row at the top of a client's page: the email address, the phone number with a call and a text button, and the address — each one a link.",
  whatItDoes: "The email address starts a new email to the client. The phone number and the small phone button call the number. The speech-bubble button starts a text message to it. The address opens in Maps in a new tab.",
  howToUse: [
    "CRM → Clients, and click the client's name.",
    "Click the email address to write to them, or the phone number to call.",
    "Use the small buttons beside the number to call or text.",
    "Click the address to open it in Maps.",
  ],
  howItWorks: "These are ordinary email, phone and text links, so they open the mail app, phone or messaging app of the device you are on. A link shows only when the client has that detail filled in.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An email address, phone number or address on the client."],
};
export default entry;
