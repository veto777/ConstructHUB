import type { HelpDraft } from "../../types";

/** Written from client/src/pages/client-portal.tsx (sign-in) and server/crm/client-auth.ts as they run. */
const entry: HelpDraft = {
  key: "crm-client-portal-signin", group: "CRM", route: "/crm/clients", title: "How your client signs in to their portal",
  whatItIs: "How a client gets into their portal: a sign-in link sent to their email, with no password.",
  whatItDoes: "On the portal's sign-in page the client types the email address you have on file and chooses “Email me a sign-in link”. The email carries a link that signs them in to their own portal.",
  howToUse: [
    "Make sure the client's page has their correct email address.",
    "The client opens the portal's sign-in page and types that email.",
    "They choose “Email me a sign-in link”.",
    "They open the email and choose the link. They are signed in.",
  ],
  howItWorks: "The sign-in link expires after 30 minutes; the client can ask for a new one at any time. The page gives the same answer whether or not the address is on file.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An email address on the client."],
};
export default entry;
