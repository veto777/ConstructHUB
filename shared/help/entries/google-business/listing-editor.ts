import type { HelpDraft } from "../../types";

/** Written from client/src/pages/listing-editor.tsx, server/gbp/listing-editor.ts and shared/gbp-listing.ts as they run. */
const entry: HelpDraft = {
  key: "listing-editor", group: "Google Business", route: "/listing-editor", title: "Listing editor",
  whatItIs: "A form for editing what Google shows for a linked location, saved straight to its Google Business Profile.",
  whatItDoes: "It loads the live listing from Google and lets you edit the business name, categories, phone numbers, website, description, address or service area, regular and special hours, opening date and status, attributes, services and private labels. A side panel shows ConstructHUB’s own rendering of the values and lists every changed field. Save to Google sends only those fields and shows Google’s answer for each one: Saved, Pending Google review, Not confirmed, or Rejected with Google’s own message. The same change can be applied to more of your linked locations, each with its own result.",
  howToUse: [
    "Sidebar → Google Business → Listing editor, and choose a linked location. If none is listed, link one under Locations first.",
    "Edit the fields. Rules and limits are checked as you type: 750 characters for the description, one primary category plus up to 9 more from Google’s list, up to 2 additional phones, up to 20 service areas picked from a place search.",
    "Read “What Google will see” and the Changes list, then choose Save to Google. The button stays off while a field has an error; Reset puts the loaded values back.",
    "Check the verdict beside each field. A pending field is not saved yet — Google reviews it and publishes or declines. “Not confirmed” means to reload and check before trying again.",
    "To copy the same change to other locations, tick the fields and the locations under “Apply to other locations”, review the list and choose Apply now.",
  ],
  howItWorks: "Only the fields that changed are sent to Google’s Business Information API, with an update mask naming exactly those fields; the form flags what the server would refuse, because both run the same rules. A field counts as Saved only when Google’s reply carries the value that was sent; Pending when Google reports edits under review instead; Not confirmed otherwise. Every save is written to your account activity and sends you a notice of the change. Profile Watch learns applied values as approved, and remembers a pending value as yours so it is not reported as a foreign change when Google publishes it. Categories, attributes and Google’s service types are read from Google; service areas are found through Google’s place search, which needs a key configured on the server. Changing the address can make Google ask you to verify the listing again.",
  needs: ["Any plan that includes locations.", "A location linked to its Google Business Profile, through a Google account that owns or manages the listing."],
};
export default entry;
