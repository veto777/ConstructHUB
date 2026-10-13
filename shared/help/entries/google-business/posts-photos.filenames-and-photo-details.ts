import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Advanced photo settings") and server/gbp/content-upload.ts (seoName, preparePhoto, /prepare) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.filenames-and-photo-details", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Filenames and photo details",
  whatItIs: "Advanced photo settings: a filename pattern, a title and an optional GPS tag written into copies of your photos.",
  whatItDoes: "SEO filename pattern names the copies with the placeholders {business}, {city} and {n}: the location’s business name, its city and the photo’s number. EXIF title and the optional GPS latitude and longitude are written into the copy’s photo details. Apply filename and EXIF to selected copies makes the renamed copies in your library and ticks them in place of the originals; the same settings apply to photos you upload.",
  howToUse: [
    "Sidebar → Google Business → Posts & Photos, choose a linked location, open Photos and media library, then Advanced photo settings.",
    "Edit the SEO filename pattern, for example {business}-{city}-{n}.",
    "Type an EXIF title, and a GPS latitude and longitude if you want the photo tagged with a place.",
    "Tick the photos and choose Apply filename and EXIF to selected copies, or upload new photos with these settings.",
    "Use the renamed copies for captions and approval like any other photo.",
  ],
  howItWorks: "A copy is made for each photo with the new name and the title and GPS tag written into its details; the original stays in the library. Google strips photo details when a photo is uploaded, so the filename, title and GPS tag are for your own files and do not promise a ranking benefit. A published caption cannot be edited through Google afterwards.",
  needs: ["Any plan.", "A location linked to its Google Business Profile.", "Photos stored in the media library."],
};
export default entry;
