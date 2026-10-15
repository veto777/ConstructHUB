import type { HelpDraft } from "../../types";

/** Written from client/src/pages/directories.tsx, server/directories/routes.ts, store.ts and nap.ts as they run. */
const entry: HelpDraft = {
  key: "directories.directory-profiles", parent: "directories", group: "Google Business", route: "/directories", title: "Directory Sync → Directory profiles",
  whatItIs: "One card per directory page about your business, each checked against your business profile.",
  whatItDoes: "You give the address of an existing page about your business on a directory (Yelp, BBB, Angi and the others in the catalogue); ConstructHUB does not create new listings. Re-check loads that page and compares its name, address and phone with your business profile, field by field, and shows Matches, Differs or Missing for each. A card is Live when the page is confirmed to be your business (its phone matches, or its name and street do) and every required detail matches; Details differ when the page is yours but a detail differs; Verified counts the live cards with matching details. When the page is blocked or does not clearly show your business, the status stays as it was and the reason is written on the card. Filter the cards by status, or type your own word to narrow the loaded cards.",
  howToUse: [
    "Choose a location and save its business profile first — the checks compare against it.",
    "Choose “Add a directory profile URL”, pick the directory and paste the page’s address.",
    "Choose Re-check on a card to compare the page now; open the comparison to see what differs.",
    "Fix the details on the directory itself (ConstructHUB cannot edit it), then re-check.",
  ],
  howItWorks: "A check fetches the public page and reads the business details it publishes, including structured data where the directory provides it. Changing your business profile sets live and differing cards back to “Waiting to check” so the next check compares against the new details. Every add, check and profile change is written to the Activity list.",
  needs: ["A business location in ConstructHUB with a saved business profile."],
};
export default entry;
