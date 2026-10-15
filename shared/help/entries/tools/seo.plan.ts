import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/plan.tsx, plan-button.tsx and server/seo/tasks.ts as they run. */
const entry: HelpDraft = {
  key: "seo.plan", parent: "seo", group: "Tools", route: "/seo/plan", title: "SEO Suite → Action plan",
  whatItIs: "The to-do list for one site: what you decided to do about what the SEO tools found, and what is done.",
  whatItDoes: "Tasks arrive from Add to plan on Opportunities, Content gap, Link intersect, Backlinks, Mentions and Site audit, or you write your own. Each task has a kind — keywords, new pages, win back a link, ask for a link, site fixes, other — a status (to do, doing, done, dropped), an optional due date and a link back to the finding it came from. The lists: open tasks, past due, due this week, done and dropped, and by kind.",
  howToUse: [
    "Pick the site; its open tasks show first.",
    "Add a task of your own with the box at the top, or send findings here from the other tools with Add to plan.",
    "Move a task along — to do, doing, done — or drop it; give it a due date to see it under Past due and Due this week.",
    "Follow a task's link back to the finding it came from: the audit issue, the lost link, the keyword, the mention.",
  ],
  howItWorks: "Free: the plan is saved on your account and spends no SEO data. The list, kind and task in view are in the address, so a link from a report or the dashboard's open-task count lands on the same list; the dashboard card and the report count a site's open tasks from here.",
};
export default entry;
