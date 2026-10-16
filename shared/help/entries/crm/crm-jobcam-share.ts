import type { HelpDraft } from "../../types";

/** Written from client/src/pages/jobcam/index.tsx (tiles and the open shot's "Visible to client" switch) as it runs. */
const entry: HelpDraft = {
  key: "crm-jobcam-share", group: "CRM", route: "/crm/jobcam", title: "Show a photo to your client",
  whatItIs: "The switch that decides whether a client can see a job-site shot.",
  whatItDoes: "Every shot is either Hidden from client — kept out of the homeowner’s portal — or Visible to client, which shows it there. A green eye on a tile marks the shots the client can see.",
  howToUse: [
    "Open CRM → JobCam and click a shot to open it.",
    "Click the switch under the photo. It changes from Hidden from client to Visible to client.",
    "Close the shot. Its tile now carries the green eye.",
    "Open a visible shot and click the same switch to hide it again.",
  ],
  howItWorks: "The switch is kept per shot, so you choose photo by photo what the portal shows. Share links follow the same switch: a hidden shot never shows on a live timeline or a gallery.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "JobCam on your plan."],
};
export default entry;
