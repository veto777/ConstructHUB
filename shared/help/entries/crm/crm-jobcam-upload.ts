import type { HelpDraft } from "../../types";

/** Written from client/src/pages/jobcam/ and client/src/pages/client-portal.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-jobcam-upload", group: "CRM", route: "/crm/jobcam", title: "Add photos to JobCam and show them to your client",
  whatItIs: "How photos you already have get onto a job, and how the ones you choose reach your client.",
  whatItDoes: "Photos you add from your computer or camera roll are filed to the project you pick. A photo stays private to your team until you mark it visible to the client; then it appears in that client’s portal.",
  howToUse: [
    "CRM → JobCam → Open camera, and choose the project.",
    "Choose the last-shot tile to add photos from your computer or camera roll.",
    "Back on the project’s JobCam page, choose Select and tick the photos.",
    "Choose to show them to the client. They appear in the client’s portal.",
  ],
  howItWorks: "Each file is queued and uploaded in the background, so you can keep working. Your client signs in to their portal with a link sent to their email — no password — and sees only the photos you made visible.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A project to file the photos to.", "The client’s email address, for their portal."],
};
export default entry;
