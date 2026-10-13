import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (ServicesTab) as it runs. */
const entry: HelpDraft = {
  key: "locations.services-and-categories", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Services and categories",
  whatItIs: "The Services tab of a location: every service and category on the listing, as Google has them.",
  whatItDoes: "Lists the categories with the primary one marked, then each service one per row, with a badge that counts them and a search box that narrows a long list as you type.",
  howToUse: [
    "Sidebar → Google Business → Locations, then Open profile on a location.",
    "Choose Services. Categories come first, primary marked; services follow, one per row.",
    "Type in the search box to narrow the list.",
    "To add or remove a service or category, edit the listing in Google Business Profile; the next sync brings it here.",
  ],
  howItWorks: "Services and categories are read from the listing on every sync, every six hours while the Google account stays connected. The tab shows ConstructHUB’s synced copy and never edits the listing.",
  needs: ["A location linked to its Google Business Profile."],
};
export default entry;
