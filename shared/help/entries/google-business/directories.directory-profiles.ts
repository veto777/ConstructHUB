import type { HelpDraft } from "../../types";

/** Written from client/src/pages/directories.tsx, server/directories/routes.ts, store.ts and nap.ts as they run. */
const entry: HelpDraft = {
  key: "directories.directory-profiles", parent: "directories", group: "Google Business", route: "/directories", title: "Directory Sync → Directory profiles",
  whatItIs: "One card for each page about your business on a directory site, checked against your business profile.",
  whatItDoes: "You paste the address of a page that already exists about your business on Yelp, BBB, Angi or another directory; ConstructHUB does not create listings. Re-check loads that page and compares its name, address and phone with your profile, showing Matches, Differs or Missing for each. A card is Live when the page is confirmed to be yours and every required detail matches, and Details differ when something is off. When the page is blocked or unclear, the status stays as it was and the reason is written on the card.",
  howToUse: [
    "Choose a location and save its business profile first; every check compares against it.",
    "Choose “Add a directory profile URL”, pick the directory and paste the page's address.",
    "Choose Re-check on a card, then open the comparison to see what differs.",
    "Fix the details on the directory site itself, then re-check.",
  ],
  howItWorks: "A check reads the public page and the business details it publishes. ConstructHUB cannot edit the directory for you. Changing your business profile sets live and differing cards back to “Waiting to check”, so the next check uses the new details. Every add, check and profile change is written to the Activity list.",
  needs: ["A business location in ConstructHUB with a saved business profile."],
};
export default entry;
