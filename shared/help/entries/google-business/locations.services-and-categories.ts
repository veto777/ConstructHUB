import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (ServicesTab) as it runs. */
const entry: HelpDraft = {
  key: "locations.services-and-categories", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Services and categories",
  whatItIs: "The Services tab of a location: every service and category on the listing, as Google has them.",
  whatItDoes: "It lists the categories with the main one marked, then each service one per row. A badge counts the services. With more than 12, a search box narrows the list as you type.",
  howToUse: [
    "Open Locations under Google Business and choose Open profile on a location.",
    "Choose Services; categories come first, then services one per row.",
    "With more than 12 services, type in the search box to narrow the list.",
    "Add or remove a service or category in Google Business Profile itself; the next sync brings it here.",
  ],
  howItWorks: "Services and categories are pulled from the listing on every sync, every six hours while the Google account stays connected. The tab shows ConstructHUB's copy and never edits the listing.",
  needs: ["A location linked to its Google Business Profile."],
};
export default entry;
