import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-integrations.tsx (API keys and Webhooks cards) as they run. */
const entry: HelpDraft = {
  key: "crm-api-keys", group: "CRM", route: "/crm/integrations", title: "API keys and webhooks",
  whatItIs: "Two ways to connect your own tools to the CRM: a read-only API key, and webhooks that tell your system when something happens.",
  whatItDoes: "An API key gives a tool read-only access to your CRM data. A webhook sends a signed message to an address you choose when the events you ticked happen — an estimate approved, an invoice paid, an appointment scheduled and so on.",
  howToUse: [
    "CRM → Integrations, and scroll to API keys.",
    "Name the key, choose Create key, and copy it straight away.",
    "Under Webhooks, type your endpoint address, tick the events and choose Add webhook.",
    "Copy the signing secret straight away.",
  ],
  howItWorks: "A new key and a new signing secret are each shown in full once, when they are created; after that the list keeps only the key’s name and its first characters. The trash can beside a key revokes it, and the one beside a webhook deletes it.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to manage integrations."],
};
export default entry;
