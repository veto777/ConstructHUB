import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (LocationInfoTab) and server/gbp/service.ts (syncLocation) as they run. */
const entry: HelpDraft = {
  key: "locations.profile-details-at-a-glance", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Profile details at a glance",
  whatItIs: "The Location Info tab of a location: the listing as Google has it, read on the last sync.",
  whatItDoes: "It shows the business name, description, address, service areas, phone, website, categories, number of services, hours for every day, opening date and open status, exactly as Google reported them. It is read-only; nothing on this tab edits the listing.",
  howToUse: [
    "Open Locations under Google Business and choose Open profile on a location.",
    "Choose Location Info.",
    "Read the fields; the Services tab lists each service the count refers to.",
    "Edit a field in Google Business Profile itself; the next sync brings the change here.",
  ],
  howItWorks: "A sync pulls the profile part of the listing (name, address, phone, website, categories, services, hours, service areas, open status) every six hours while the Google account stays connected. If that part fails, the last good copy stays in place and the location says what went wrong.",
  needs: ["A location linked to its Google Business Profile, or added by searching Google."],
};
export default entry;
