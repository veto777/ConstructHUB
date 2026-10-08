import type { HelpDraft } from "../../types";

/** Written from client/src/components/crm-create-menu.tsx as it runs. */
const entry: HelpDraft = {
  key: "crm-create-menu", group: "CRM", route: "/crm", title: "The Create button",
  whatItIs: "One button at the top of the CRM menu that starts an estimate, an invoice, a lead, a message or a new client from any page.",
  whatItDoes: "Estimate opens the estimate builder. Invoice makes a draft invoice with one line for a client you pick. Lead adds the person as a client and puts a project in the Lead column of the pipeline. Message emails a client a short note. Customer adds a new client, whose portal is created automatically.",
  howToUse: [
    "Click Create at the top of the menu on the left.",
    "Choose Estimate, Invoice, Lead, Message or Customer.",
    "Fill in the short form — for a lead: a name, a phone or email, the address and a note.",
    "Choose the button at the bottom, such as Add lead. The CRM takes you to the pipeline, where the lead is in the Lead column.",
  ],
  howItWorks: "A lead is a project in the first pipeline stage, so it shows on the board straight away. If the email or phone already belongs to a client, the form says so and links to that client instead of making a second one. Each item appears only for team members whose role allows it.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
