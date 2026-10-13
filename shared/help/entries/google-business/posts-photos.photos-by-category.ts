import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Photos and media library"), server/gbp/content-upload.ts and server/gbp/content.ts as they run. */
const entry: HelpDraft = {
  key: "posts-photos.photos-by-category", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Photos by category",
  whatItIs: "The Photos and media library section: job photos picked from your media library or uploaded, captioned and filed under a Google photo category.",
  whatItDoes: "Upload photos takes up to 100 JPEG, PNG or WebP files at a time, 15 MB each, and adds them to your media library. Ticking a photo opens a caption box under it (up to 1,500 characters). Photo category is Google’s own list — additional, exterior, interior, product, at work, food and drink, menu, common area, rooms, teams, cover — and applies to every ticked photo. Approve & queue photos makes one queued item per ticked photo.",
  howToUse: [
    "Sidebar → Google Business → Posts & Photos, choose a linked location, and open Photos and media library.",
    "Choose Upload photos to add files, or tick photos already in the library. The count of ticked photos is shown under the grid.",
    "Type a caption under each ticked photo, or generate caption drafts under AI drafts and style and edit them.",
    "Choose the Photo category the photos belong to.",
    "Choose Approve & queue photos under Schedule and approve. Each photo becomes its own item in Calendar, queue & history.",
  ],
  howItWorks: "Each queued photo is sent to Google as a media item in the chosen category with its caption as the description, at its scheduled time. Google strips EXIF data from uploaded photos, and a published caption cannot be edited through Google afterwards. A cover photo takes no caption.",
  needs: ["Any plan.", "A location linked to its Google Business Profile.", "Photos in the media library."],
};
export default entry;
