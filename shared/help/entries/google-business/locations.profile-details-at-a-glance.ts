import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (LocationInfoTab) and server/gbp/service.ts (syncLocation) as they run. */
const entry: HelpDraft = {
  key: "locations.profile-details-at-a-glance", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Profile details at a glance",
  whatItIs: "The Location Info tab of a location: the profile as Google has it, read on the last sync.",
  whatItDoes: "Shows the business name, description, address, service areas, phone, website, categories, number of services, hours for every day, opening date and open status, exactly as Google reported them. Reading only: nothing on this tab edits the listing.",
  howToUse: [
    "Sidebar → Google Business → Locations, then Open profile on a location.",
    "Choose Location Info.",
    "Read the fields; the Services tab lists each service the count refers to.",
    "To change a field, edit it in Google Business Profile; the next sync brings the change here.",
  ],
  howItWorks: "A sync reads the profile part of the listing (name, address, phone, website, categories, services, hours, service areas, open status) every six hours while the Google account stays connected. If that part of a sync fails, the last good copy stays in place and the location says what went wrong.",
  needs: ["A location linked to its Google Business Profile, or added by searching Google."],
};
export default entry;
