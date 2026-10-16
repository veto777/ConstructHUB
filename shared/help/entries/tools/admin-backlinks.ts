import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-backlinks.tsx and shared/backlinks.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-backlinks", group: "Tools", route: "/admin/backlinks", title: "Backlinks database (admin)",
  whatItIs: "A page for the people who run ConstructHUB: the database of sites a contractor’s link could come from, found, vetted and measured by a background process, which also drafts pitches.",
  whatItDoes: "Tiles count good link sources by kind, blocked PBNs (networks of fake sites), this month’s data spend, searches run and sources waiting for review, and a goal card tracks progress toward the owner’s target. Run now starts the process’s steps. Sources lists kept and rejected sites with a search and filters by kind, tier and status; opening one shows its details. Import a list sends domains or web addresses you already have through the same review.",
  howToUse: [
    "Read the tiles and the goal card for where the database stands.",
    "Filter Sources by kind, tier or status and open a row to read why it was kept or rejected.",
    "Paste domains under Import a list to vet them, or use Run now to push the process along.",
  ],
  howItWorks: "The process runs the discovery, vetting, measuring and drafting steps every minute when automation is on, and sends a pitch only after an admin approves it; nothing is trusted unread, and rejected sources keep their reason. The server refuses anyone who is not a platform admin.",
  needs: ["Platform admin access."],
};
export default entry;
