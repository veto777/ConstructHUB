import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (the Quick actions card and its dialogs) as it runs. */
const entry: HelpDraft = {
  key: "crm-client-quick-actions", group: "CRM", route: "/crm/clients", title: "Quick actions on a client",
  whatItIs: "A row of buttons under a client's details that starts the common jobs for that client: Schedule appointment, New estimate, Add to pipeline and Take a payment.",
  whatItDoes: "Schedule appointment books a visit that shows on the client's page and on the calendar. New estimate starts an estimate for this client. Add to pipeline creates a project for them in the Lead column. Take a payment opens the payment form for this client.",
  howToUse: [
    "CRM → Clients, and click the client's name.",
    "Choose Schedule appointment, give the visit a title, a start and an end, and choose Schedule.",
    "Choose Add to pipeline, name the project and choose Create project.",
    "Choose New estimate or Take a payment when you need them.",
  ],
  howItWorks: "Each button shows only when your role allows that job. A new appointment warns you when it overlaps another visit.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
