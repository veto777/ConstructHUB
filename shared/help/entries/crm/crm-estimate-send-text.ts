import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (Also text it) and crm-settings.tsx (SMS card) as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-send-text", group: "CRM", route: "/crm/clients", title: "Send an estimate by text as well",
  whatItIs: "A box beside Send that texts the client a link to the estimate as well as emailing it.",
  whatItDoes: "With “Also text it” ticked, Send (or Resend) emails the estimate and texts the client a link to it, and the CRM confirms both. “Text estimates to clients” in Settings ticks the box by default.",
  howToUse: [
    "Open CRM → Clients and open the client.",
    "Tick “Also text it” beside the Send button under Estimates.",
    "Choose Send.",
    "Switch on Settings → SMS → “Text estimates to clients” to have it ticked every time.",
  ],
  howItWorks: "The text goes to the mobile number on the client's page. The box only appears when texting is set up with a client-texting number and the client has a phone number; a client without one gets the email only.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Your own texting number set up in Settings.", "A mobile number on the client."],
};
export default entry;
