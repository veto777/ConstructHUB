import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (SettingsTab) and the PUT/DELETE /api/locations/:id routes as they run. */
const entry: HelpDraft = {
  key: "locations.settings", parent: "locations", group: "Google Business", route: "/locations", title: "Locations → Settings",
  whatItIs: "The Settings tab of a location: its notification email, and the button that deletes it from ConstructHUB.",
  whatItDoes: "“Use account-level settings” keeps the account's email for this location; switch it off to save a different email for this location only. ConstructHUB does not send location notifications yet, so nothing is emailed to that address today. Delete Location removes ConstructHUB's copy of the location after you type its name to confirm.",
  howToUse: [
    "Open a location under Locations and choose Settings.",
    "Switch off “Use account-level settings”, type the address and save, to use a different email here.",
    "Choose Delete Location, type the business name exactly and confirm, to remove the location.",
  ],
  howItWorks: "Deleting removes the location and everything ConstructHUB stored for it: reviews and stats, Profile Watch settings and history, scheduled posts and photos, social profile links and citation campaigns. The Google Business Profile listing itself is not deleted, closed or changed; do that in Google Business Profile. A deleted location can be added again, but its ConstructHUB history does not come back.",
  needs: ["Any plan."],
};
export default entry;
