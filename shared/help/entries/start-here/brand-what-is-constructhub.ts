import type { HelpDraft } from "../../types";

/**
 * The overview film's entry. Written from docs/brand/FACT-BASE.md (shared/plans.ts, shared/crm-plans.ts,
 * the feature pages, the directory as it is served) — nothing here that the fact base does not carry.
 */
const entry: HelpDraft = {
  key: "brand-what-is-constructhub", group: "Start here", route: "/", title: "What is ConstructHUB?",
  whatItIs: "ConstructHUB is two products for contractors: Business tools for finding work and looking after your Google listing, and a CRM for running the jobs you win.",
  whatItDoes: "Business tools hold the permit office directory, permit search, county property records, your Google Business Profile, reviews, Site Scan and the other marketing tools. The CRM holds clients, the pipeline, estimates clients approve online, the schedule, invoices and payments, and JobCam for job-site photos. Each product has its own plans, so you buy one or both.",
  howToUse: [
    "Open constructhub.us and create an account.",
    "Choose Business tools, the CRM, or both. Each has its own plans on the Plans page.",
    "In Business tools, start with the Database Directory: pick a state to see its permit offices.",
    "In the CRM, add a client and write your first estimate.",
  ],
  howItWorks: "Permit office links are checked. One that could not be confirmed is labeled, and where no link is on record you get a web search instead of a made-up address. The CRM is a separate product with its own subscription, and JobCam comes with the top CRM plan or as an add-on to the other two.",
  needs: ["A ConstructHUB account. Each tool’s page says which plan has it."],
  // An overview film: posted to YouTube and social only when the owner releases it (--release), never by the schedule.
  youtube: { hold: true },
};
export default entry;
