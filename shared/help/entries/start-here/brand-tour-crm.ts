import type { HelpDraft } from "../../types";

/** The CRM tour's entry: one job from lead to paid. Written from the CRM pages as they run in the demo workspace. */
const entry: HelpDraft = {
  key: "brand-tour-crm", group: "Start here", route: "/crm", title: "ConstructHUB CRM in 2 minutes",
  whatItIs: "The CRM follows one job from the first call to the last payment: lead, estimate, approval, schedule, job photos, invoice, paid.",
  whatItDoes: "A lead becomes a client with a project on the pipeline. You price the work from your price book and send the estimate; the client approves it online by typing their name. The visit goes on the schedule, JobCam files the crew’s photos to the project, and the approved estimate becomes an invoice you can take payment on.",
  howToUse: [
    "CRM → Clients: add the client, then choose New estimate on their page.",
    "Add items from your price book, review the total and send it.",
    "When the client approves, put the visit on the Schedule and choose who is going.",
    "On the job, open JobCam to shoot photos that file themselves to the project.",
    "Make the invoice from the approved estimate and record the payment.",
  ],
  howItWorks: "Each step updates the same client and project, so the pipeline, the client’s page and the Home numbers stay in step. Online card and bank payments go to your own Stripe account; checks and cash are recorded by hand.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "JobCam for the job photos: part of the top CRM plan, an add-on to the others."],
  // An overview film: posted to YouTube and social only when the owner releases it (--release), never by the schedule.
  youtube: { hold: true },
};
export default entry;
