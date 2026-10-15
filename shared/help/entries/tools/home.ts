import type { HelpDraft } from "../../types";

/** Written from client/src/pages/home.tsx, client/src/components/dashboard/* and shared/dashboard.ts as they run. */
const entry: HelpDraft = {
  key: "home", group: "Tools", route: "/", title: "Home dashboard",
  whatItIs: "The page you land on when you sign in: what needs you today, your CRM numbers, this month’s meters and one tile per tool you have.",
  whatItDoes: "Needs today lists the action items the tools raised (a review waiting for a reply, a failed post, a limit nearly reached, an unread alert, a payment past due) with a link to each; items you clear stay away. Below it: the CRM card (money and today’s work), the Getting started checklist, Plan usage meters, then the tiles, grouped Grow, Protect, Win jobs, Run the business and Learn, each with its key numbers and a link into the tool. A locked tile says which plan includes it, and Recent activity and Gabe’s nudge sit at the bottom.",
  howToUse: [
    "Start with Needs today and open each item; the list shrinks as you handle them.",
    "Read a tile’s numbers and click it to open the tool; a locked tile links to what it does and the plans.",
    "Use Refresh (the arrow beside the plan chip) for fresh numbers; otherwise they are at most a minute old.",
    "Use Customize to hide or reorder tiles and sections, or Reset to put the default layout back.",
  ],
  howItWorks: "One request gathers every tool’s numbers for the account; the server keeps them for 60 seconds and Refresh skips that saved copy. Which tiles show depends on your plan, modules and add-ons. Your layout is saved on the account. On a brand-new account the numbers can be clearly marked sample data until the tools have real data.",
  needs: ["A ConstructHUB account; the tiles reflect the plan."],
};
export default entry;
