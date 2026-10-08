import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Notifications card) and the bell in the CRM header as they run. */
const entry: HelpDraft = {
  key: "crm-notifications", group: "CRM", route: "/crm/settings", title: "Notifications",
  whatItIs: "The switches that decide which alerts the CRM sends you, and whether each one arrives in the app, by email or by text.",
  whatItDoes: "Each row of the Notifications card is one event — a client opened an estimate, an estimate was approved, a payment arrived, a website lead came in — with an In-app, an Email and a Text switch. In-app alerts are listed under the bell at the top of every CRM page.",
  howToUse: [
    "CRM → Settings, and scroll to Notifications.",
    "Find the event, and flip its In-app, Email or Text switch.",
    "Open the bell at the top of the page to read your in-app alerts.",
  ],
  howItWorks: "A switch is saved the moment you flip it. These switches only cover messages to you: the emails that carry an estimate or an invoice to your client always send. Text alerts also need a text sender set up in the SMS card of Settings.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
