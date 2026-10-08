import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx (JobCam tab) and client/src/pages/jobcam/project.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-jobcam-project", group: "CRM", route: "/crm/pipeline", title: "Photos on a project",
  whatItIs: "One job’s photos and video, on the project they belong to.",
  whatItDoes: "The JobCam tab of a project shows that job’s shots, newest first. Open feed gives them a page of their own, with the same search, filters, timeline and Select as the main JobCam feed, plus Share. Open camera is where new shots for the job are taken.",
  howToUse: [
    "CRM → Pipeline, open the project, and choose the JobCam tab.",
    "Click a shot to see it full size.",
    "Choose Open feed for the job’s own photo page.",
    "Search, filter or switch to Timeline there, the same way as in the main feed.",
  ],
  howItWorks: "A shot is filed to one project, so it appears here and in the main JobCam feed.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "JobCam on your plan."],
};
export default entry;
