import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-photos.tsx and server/crm/photo-library.ts as they run. */
const entry: HelpDraft = {
  key: "crm-photos", group: "CRM", route: "/crm/photos", title: "Photos",
  whatItIs: "Every project photo across your jobs in one place: crew shots marked in progress or finished, photos clients shared from their portal, and HOVER capture photos.",
  whatItDoes: "Browse by job (one card per client with a cover photo and counts) or as one grid of all photos. Filter by stage, by whether the job is under way or completed, by client name or address and by date. Select photos to send them to the Photo Optimizer, attach them to a Google review request, save them to the Media library or download them as a zip.",
  howToUse: [
    "Open Photos in the CRM.",
    "Choose By job or All photos, then a stage tab: All, In progress, Finished, From clients or HOVER captures.",
    "Click a photo to see it full size; tick the circle on a photo to select it.",
    "With photos selected, choose Optimize for Google profile, Use in a review request, Save to Media library or Download.",
  ],
  howItWorks: "You see the photos of the clients you can see in the CRM, so a team member limited to one division or to their own jobs sees only those. A photo with no stage tag that did not come from HOVER is shown as from the client. Google does not let ConstructHub post to your Business Profile, so the Photo Optimizer prepares geo-tagged copies for you to upload on Google yourself. The Optimizer takes 10 photos at a time, a review request 30, the Media library 60 and a download 100.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to add job photos (manage jobs or clients) to send photos to the Google tools."],
};
export default entry;
