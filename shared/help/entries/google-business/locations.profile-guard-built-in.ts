import type { HelpDraft } from "../../types";

/** Written from client/src/components/profile-guard.tsx and client/src/pages/locations.tsx (LocationDetail tabs) as they run. */
const entry: HelpDraft = {
  key: "locations.profile-guard-built-in", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Profile Watch built in",
  whatItIs: "The Profile Watch tab that every linked location carries, so edit alerts sit next to the listing they watch.",
  whatItDoes: "Shows the current mode and last check for this listing, the mode (Off, Notify, or Lockdown, which puts your approved value back after a change), the watched fields, the owner-approved snapshot it compares Google against, and Pending changes and history with the approved and detected value of each edit, Approve and Reject.",
  howToUse: [
    "Sidebar → Google Business → Locations, then Open profile on a linked location.",
    "Choose Profile Watch.",
    "Read the current mode and the last check; open Watched fields and Owner-approved snapshot to see what it compares.",
    "Under Pending changes and history, choose Approve to accept Google’s new value or Reject to restore yours.",
  ],
  howItWorks: "The tab is the same Profile Watch as the Monitor page, scoped to one listing. Saving Profile Watch settings asks you to confirm it is you (password, authenticator or an emailed code) once, then not again for 12 hours. Nobody can block edits at Google: Lockdown corrects a change after it is detected.",
  needs: ["Any paid plan.", "A location linked to its Google Business Profile."],
};
export default entry;
