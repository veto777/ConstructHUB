import type { HelpDraft } from "../../types";
import { CRM_TRIAL_DAYS } from "../../../crm-plans";

/** The Jobber comparison's entry — docs/brand/VIDEO-SCRIPTS.md 5a; figures from docs/brand/sources/2026-10-08/. */
const entry: HelpDraft = {
  key: "brand-vs-jobber", group: "Start here", route: "/pricing", title: "Jobber vs ConstructHUB CRM",
  whatItIs: "A side-by-side look at the published list prices of ConstructHUB CRM and Jobber, for the same number of people, as each company’s pricing page showed them on 8 October 2026.",
  whatItDoes: "For one person the monthly list prices are close. For five people, Jobber’s lowest plan that includes five users lists at about twice ConstructHUB CRM Essentials, which has five seats. Jobber sells its sales pipeline as an add-on; ConstructHUB CRM has a pipeline on every plan. The two products do not have the same features: Jobber lists an app marketplace and other tools ConstructHUB CRM does not have. ConstructHUB’s permit office directory, in Business tools, is free to browse.",
  howToUse: [
    "Open constructhub.us/pricing and read each CRM plan’s price, its seats and its Not included list.",
    "Open Jobber’s pricing page and compare the same number of people, on the same billing period.",
    "Compare the feature lists, not only the prices.",
    `Start the ${CRM_TRIAL_DAYS}-day CRM trial and run a real job through it.`,
  ],
  howItWorks: "Prices are list prices billed monthly, read from each company’s own pricing page on 8 October 2026; introductory offers are left out. Prices change, so check both pages on the day you decide. Jobber is a trademark of its owner; ConstructHUB is not affiliated with it.",
  needs: ["Nothing to watch it. The CRM is a separate product with its own plans."],
  // Posted to YouTube and social only when the owner releases it (--release), never by the schedule.
  youtube: { hold: true },
  // Not in the app until the owner has re-checked the prices and released it: then remove this line and commit the manifest (docs/brand/VIDEO-SCRIPTS.md, "Releasing a held film").
  unlisted: true,
};
export default entry;
