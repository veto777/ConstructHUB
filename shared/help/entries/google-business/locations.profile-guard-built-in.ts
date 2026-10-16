import type { HelpDraft } from "../../types";

/** Written from client/src/components/profile-guard.tsx and client/src/pages/locations.tsx (LocationDetail tabs) as they run. */
const entry: HelpDraft = {
  key: "locations.profile-guard-built-in", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Profile Watch built in",
  whatItIs: "The Profile Watch tab every linked location carries, so edit alerts sit next to the listing they watch.",
  whatItDoes: "It shows the mode: Off, Notify, or Lockdown (which puts your approved value back after a change). It also shows the last check, the watched fields and the approved copy it compares Google against. Pending changes and history lists each edit with the approved and the detected value, with Approve and Reject.",
  howToUse: [
    "Open Locations under Google Business and choose Open profile on a linked location.",
    "Choose Profile Watch.",
    "Read the mode and the last check, then open Watched fields and Owner-approved snapshot to see what it compares.",
    "Choose Approve to accept Google's new value, or Reject to restore yours, under Pending changes and history.",
  ],
  howItWorks: "The tab is the same Profile Watch as the Monitor page, for one listing. Saving its settings asks you to confirm it is you (password, authenticator or an emailed code) once, then not again for 12 hours. Nobody can block edits at Google: Lockdown corrects a change after it is detected.",
  needs: ["Any paid plan.", "A location linked to its Google Business Profile."],
};
export default entry;
