import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx (Change orders tab, the totals strip) as it runs. */
const entry: HelpDraft = {
  key: "crm-change-orders", group: "CRM", route: "/crm/pipeline", title: "Write a change order",
  whatItIs: "Extra or changed work on a job that is already under way, written down with its price and its effect on the schedule.",
  whatItDoes: "The Change orders tab on a project adds a change order with a title, an amount and the days it adds. It starts as a draft with its own number. “Mark sent & copy link” marks it sent and copies the client’s approval link for you to share. The Revised contract figure at the top of the project shows how much of it is change orders.",
  howToUse: [
    "CRM → Pipeline, then open the job.",
    "Choose the Change orders tab.",
    "Type a title, the amount and the extra days, then choose the plus button.",
    "Choose Mark sent & copy link and share the link with the client.",
  ],
  howItWorks: "The client approves or declines on the page behind the link. An approved change order adjusts the contract value and the schedule together. A sent change order shows whether the client has opened it yet.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A project on the pipeline."],
};
export default entry;
