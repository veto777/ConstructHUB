import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-reviews.tsx (the Profiles & links view) and shared/review-links.ts as they run. */
const entry: HelpDraft = {
  key: "google-reviews.profiles", parent: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews → Profiles & links",
  whatItIs: "One profile for each Google listing you ask reviews for: its Google review link, a default project description, and your pages on other review sites.",
  whatItDoes: "Add profile saves a name and the Google review link (pasted, or picked from a linked Google listing). It can also hold a project description used as the default message, and other review pages such as Yelp, BBB, Houzz, Angi or HomeAdvisor. One of those can be the main destination if you prefer it to Google, and one profile can be the default for new requests. The card under the list links to the business sign-in pages of the common review sites.",
  howToUse: [
    "Choose Add profile, name it after the listing, and paste its Google review link or pick the listing from your linked locations.",
    "Add the other review sites you want clients to see after Google, each with its link.",
    "Choose which site is primary.",
    "Tick “Default profile” on the one most requests should use, then Save.",
    "Edit a profile from its pencil icon; Delete asks you to confirm first.",
  ],
  howItWorks: "A Google review link is accepted only when it points at Google (a google.* page other than the bare homepage, g.page, goo.gl or share.google). Each other site is picked from a list (Yelp, BBB, Houzz and more, or Other with your own name), and its link must be a full web address. The link is not checked against that site. Each profile counts toward the plan's saved-profile allowance, and the page says when the limit is reached. When a request is sent, the profile's links decide which review buttons the client sees and which comes first.",
  needs: ["Any plan; the number of saved profiles depends on the plan."],
};
export default entry;
