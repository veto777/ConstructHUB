import type { HelpDraft } from "../../types";
import { MODULE_NAMES, PLANS, planForModule } from "../../../plans";

/** Written from client/src/pages/gbp-content.tsx ("Photos and media library"), server/gbp/content-upload.ts and server/gbp/content.ts as they run. */
const entry: HelpDraft = {
  key: "posts-photos.photos-by-category", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Photos by category",
  whatItIs: "The Photos and media library section: job photos from your library or freshly uploaded, captioned and filed under a Google photo category.",
  whatItDoes: "Upload photos takes up to 100 JPEG, PNG or WebP files at a time, 15 MB each, and adds them to your media library. Ticking a photo opens a caption box under it (up to 1,500 characters). Photo category is Google's own list (exterior, interior, at work, team, cover and the rest) and applies to every ticked photo. Approve & queue photos makes one queued item per ticked photo.",
  howToUse: [
    "Open Photos under Google Business, choose a linked location, and open Photos and media library.",
    "Choose Upload photos, or tick photos already in the library.",
    "Type a caption under each ticked photo, or generate drafts under AI drafts and style and edit them.",
    "Choose the Photo category the photos belong to.",
    "Choose Approve & queue photos under Schedule and approve; each photo becomes its own item in Calendar, queue & history.",
  ],
  howItWorks: "Each queued photo is sent to Google in the chosen category with its caption as the description, at its scheduled time. Google strips the hidden details (EXIF) from uploaded photos, and a published caption cannot be edited through Google afterwards. A cover photo takes no caption.",
  needs: [`The ${PLANS[planForModule("autoPosts")].name} plan, which includes the “${MODULE_NAMES.autoPosts}” module.`, "A location linked to its Google Business Profile.", "Photos in the media library."],
};
export default entry;
