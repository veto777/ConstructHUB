import type { HelpDraft } from "../../types";

/** The \"why\" film's entry. Every sentence restates docs/brand/FACT-BASE.md section 2 (D1–D8). */
const entry: HelpDraft = {
  key: "brand-why-constructhub", group: "Start here", route: "/features", title: "Why ConstructHUB?",
  whatItIs: "What is different about ConstructHUB: a permit office directory with checked links, every price on one page, two products you buy separately, and job photos filed to the job.",
  whatItDoes: "Business tools include a directory of county and city permit offices and county property record offices; a link is shown as verified only once it has been checked, and where none is on record you get a web search. Every plan shows its price and a list of what it does not include. The CRM keeps the estimate, the schedule, the invoice and the JobCam photos on the same job.",
  howToUse: [
    "Browse the Database Directory at constructhub.us/databases. It opens without an account.",
    "Read the Plans page: each plan lists its price and what is not included.",
    "Choose Business tools, the CRM, or both.",
    "In the CRM, add a client and send your first estimate.",
  ],
  howItWorks: "Online card and bank payments go to your own Stripe account, and ConstructHUB adds no fee of its own; Stripe’s processing fees apply. JobCam is part of the top CRM plan and an add-on to the other two.",
  needs: ["Nothing to watch it. Each tool’s page says which plan has it."],
  // Posted to YouTube and social only when the owner releases it (--release), never by the schedule.
  youtube: { hold: true },
};
export default entry;
