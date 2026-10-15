import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-backlinks.tsx and shared/backlinks.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-backlinks", group: "Tools", route: "/admin/backlinks", title: "Backlinks database (admin)",
  whatItIs: "An operator page, for the people who run ConstructHUB: the database of sites a contractor’s link could come from, found, vetted, measured and pitched by the worker.",
  whatItDoes: "Stat tiles count quality sources by kind, blocked PBNs, this month’s data spend, searches run and sources waiting to be vetted; a goal card tracks progress toward the owner’s target. Run now triggers the worker’s steps. Sources lists kept and rejected sites with a search and filters by kind, tier and status; opening one shows its details. Import a list sends domains or URLs you already have through the same vetting.",
  howToUse: [
    "Read the tiles and the goal card for where the database stands.",
    "Filter Sources by kind, tier or status and open a row to read why it was kept or rejected.",
    "Paste domains under Import a list to vet them; use Run now to push the worker along.",
  ],
  howItWorks: "The worker runs the discovery, vetting, measuring and pitching steps every minute when automation is on; nothing is trusted unread, and rejected sources keep their reason. The API answers 403 to anyone who is not a platform admin.",
  needs: ["Platform admin access."],
};
export default entry;
