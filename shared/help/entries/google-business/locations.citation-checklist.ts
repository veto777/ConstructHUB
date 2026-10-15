import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (CitationsTab) and server/routes.ts (/api/citations/campaigns/:id/run, PATCH /api/citations/:id) as they run. */
const entry: HelpDraft = {
  key: "locations.citation-checklist", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Citation checklist",
  whatItIs: "The Citations tab of a location: a checklist of the main business directories, Google first, that you mark yourself. A citation is a listing of your business on another website.",
  whatItDoes: "A campaign builds a checklist of thirty sites contractors should be on. The Google Business Profile row fills in from your linked listing. For every other site, Search looks for your business there through Google, and you mark it Listed, Listed with wrong details, or Not listed, and paste the link. Four tiles keep the counts.",
  howToUse: [
    "Open Locations under Google Business, choose Open profile on a location, then Citations.",
    "Choose New Campaign, name it, choose Create, and open it from its card.",
    "Choose Build checklist.",
    "Choose Search on each site, mark what you found and paste the listing link.",
  ],
  howItWorks: "Building the checklist adds the thirty rows and marks only the Google row, from the linked listing. ConstructHUB does not guess: every other site stays Not checked until you mark it. Marks and links are saved at once and the tiles recount. Update checklist adds any site missing from an older campaign without touching your marks.",
  needs: ["A plan that includes citations.", "A location; the Google row needs it linked to its Google Business Profile."],
};
export default entry;
