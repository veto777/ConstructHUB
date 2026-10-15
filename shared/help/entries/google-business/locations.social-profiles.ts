import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (SocialProfilesTab), shared/social-links.ts and the PUT /api/locations/:id route as they run. */
const entry: HelpDraft = {
  key: "locations.social-profiles", parent: "locations", group: "Google Business", route: "/locations", title: "Locations → Social Profiles",
  whatItIs: "The Social Profiles tab of a location: one box per social network for the business’s own profile link.",
  whatItDoes: "You paste the full link of each profile (Facebook, Instagram, YouTube and the other networks listed) and save. Each link is checked as you type: it must be a full https link on that network’s own domain, and a short link is expanded to the full profile link when you save. For a location linked to Google, the saved links are also written to the Google Business Profile so the listing shows them.",
  howToUse: [
    "Locations → open a location → Social Profiles.",
    "Paste the profile link next to each network you use; leave the others empty.",
    "Fix any box that shows an error (the link is on the wrong site or is not a full link).",
    "Choose “Save Social Profiles”. The message tells you whether Google took the links too.",
  ],
  howItWorks: "The links are saved on the location in ConstructHUB. When the location is linked to Google, the same save pushes them to the listing through the Business Profile API; if Google refuses, the links stay saved here and the message says so. Google can take a few minutes to show them.",
  needs: ["Any plan.", "A Google-linked location, for the links to appear on the listing."],
};
export default entry;
