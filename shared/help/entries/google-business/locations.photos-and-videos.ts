import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (PhotosTab) and server/gbp/service.ts (syncLocation) as they run. */
const entry: HelpDraft = {
  key: "locations.photos-and-videos", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Photos and videos",
  whatItIs: "The Photos & Videos tab of a linked location: the media on the listing, synced from Google.",
  whatItDoes: "Two tiles count business photos and videos (the ones you posted) and customer photos and videos (the ones customers added) separately. Choose a tile to see that set, with when it synced; click a photo to open it on Google. A button leads to Posts & Photos for adding or scheduling new ones.",
  howToUse: [
    "Sidebar → Google Business → Locations, then Open profile on a linked location.",
    "Choose Photos & Videos. Business photos show first.",
    "Choose Customer photos & videos for what customers added.",
    "Click a photo to open it on Google. To put new ones on the listing, use Add or schedule photos in Posts & Photos.",
  ],
  howItWorks: "Photos sync along with reviews and performance, every six hours while the Google account stays connected. The counts come from the listing on a successful profile sync; until Google has reported them the tiles show a dash. A location that is not linked shows no photos.",
  needs: ["A location linked to its Google Business Profile."],
};
export default entry;
