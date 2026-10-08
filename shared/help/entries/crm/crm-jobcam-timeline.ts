import type { HelpDraft } from "../../types";

/** Written from client/src/pages/jobcam/index.tsx (feed, timeline, lightbox) as it runs. */
const entry: HelpDraft = {
  key: "crm-jobcam-timeline", group: "CRM", route: "/crm/jobcam", title: "JobCam timeline and a photo’s details",
  whatItIs: "The JobCam feed read day by day, and everything kept with one shot.",
  whatItDoes: "Timeline groups the feed by day, newest first, with the project named beside each day. Opening a shot shows it full size with when it was taken, who took it, the location when one was saved, its project, its tag and its caption. From there you can star it, download it, delete it, or move to the next shot.",
  howToUse: [
    "CRM → JobCam → Timeline.",
    "Click a shot to open it.",
    "Read the line under the photo: time, person, location and project.",
    "Click the star to mark a favorite, and the arrows to move between shots.",
    "Close the photo, then choose Grid to go back to the tiles.",
  ],
  howItWorks: "The tag and the caption sit at the bottom of an open shot and can be changed there. The “i” button hides the details so more of the photo shows.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "JobCam on your plan."],
};
export default entry;
