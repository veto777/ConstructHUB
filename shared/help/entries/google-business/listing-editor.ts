import type { HelpDraft } from "../../types";

/** Written from client/src/pages/listing-editor.tsx, server/gbp/listing-editor.ts and shared/gbp-listing.ts as they run. */
const entry: HelpDraft = {
  key: "listing-editor", group: "Google Business", route: "/listing-editor", title: "Listing editor",
  whatItIs: "A form for changing what Google shows about a linked location, saved straight to its Google Business Profile.",
  whatItDoes: "It loads the live listing and lets you edit the name, categories, phones, website, description, address or service area, hours, opening date, status, attributes, services and private labels. A side panel shows how the values will look and lists every changed field. Save to Google sends only those fields and shows Google's answer for each: Saved, Pending Google review, Not confirmed, or Rejected with Google's reason. The same change can be copied to more of your linked locations.",
  howToUse: [
    "Open Listing editor under Google Business and choose a linked location.",
    "Edit the fields; limits (750-character description, 9 extra categories, 2 extra phones, 20 service areas) are checked as you type.",
    "Read “What Google will see” and the Changes list, then choose Save to Google.",
    "Check the result beside each field; a pending field is not saved until Google reviews it.",
    "Tick fields and locations under “Apply to other locations” and choose Apply now to copy the change.",
  ],
  howItWorks: "Only the changed fields go to Google, and the form flags what the server would refuse because both run the same rules. A field counts as Saved only when Google's reply carries the value sent; Pending when Google reports it under review; Not confirmed otherwise, so reload and check before trying again. Every save is written to your account activity and sends you a notice, and where Profile Watch is on, it learns the new values as yours. Changing the address can make Google ask you to verify the listing again.",
  needs: ["Any plan that includes locations.", "A location linked to its Google Business Profile, through a Google account that owns or manages the listing."],
};
export default entry;
