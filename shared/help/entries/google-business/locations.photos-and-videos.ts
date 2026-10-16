import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (PhotosTab) and server/gbp/service.ts (syncLocation) as they run. */
const entry: HelpDraft = {
  key: "locations.photos-and-videos", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Photos and videos",
  whatItIs: "The Photos & Videos tab of a linked location: the photos and videos on the listing, pulled from Google.",
  whatItDoes: "Two tiles count business photos and videos (the ones you posted) and customer photos and videos (the ones customers added). Choose a tile to see that set and when it was last pulled. Click a photo to open it on Google. A fold-out, “Upload & schedule photos”, lets you upload, caption and schedule new ones right on this tab.",
  howToUse: [
    "Open Locations under Google Business and choose Open profile on a linked location.",
    "Choose Photos & Videos; business photos show first.",
    "Choose Customer photos & videos for what customers added.",
    "Click a photo to open it on Google, or open Upload & schedule photos to put new ones on the listing.",
  ],
  howItWorks: "Photos are pulled along with reviews and performance, every six hours while the Google account stays connected. The counts come from the listing on a successful sync; until Google has reported them the tiles show a dash. A location that is not linked shows no photos.",
  needs: ["A location linked to its Google Business Profile."],
};
export default entry;
