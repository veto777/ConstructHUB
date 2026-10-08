import type { HelpDraft } from "../../types";

/** Written from client/src/components/jobcam/share-dialog.tsx, client/src/pages/jobcam/share.tsx and server/jobcam/share.ts as they run. */
const entry: HelpDraft = {
  key: "crm-jobcam-share-link", group: "CRM", route: "/crm/jobcam", title: "Send a client a photo gallery link",
  whatItIs: "A link to a job’s photos that you can email or text to a client, and switch off whenever you like.",
  whatItDoes: "Share on a job’s JobCam page makes a link to a live timeline of the job’s photos, or to a gallery of the shots you selected. You can give it a title, a password and an expiry, then copy it or send it by email or text. The list of existing links shows how many times each was viewed, and Revoke turns one off.",
  howToUse: [
    "Open the job’s JobCam page and choose Share.",
    "Pick the live timeline, or select photos first for a gallery. Add a title, and a password or expiry if you want them.",
    "Choose “Make the link”, then copy it or send it to the client by email or text.",
    "To turn a link off, choose Share again and Revoke it under Existing links.",
  ],
  howItWorks: "The person who opens the link sees your company name, the job and the photos, without signing in. A live timeline shows every photo on the job and keeps updating; a gallery shows only the photos you picked. A revoked or expired link shows a notice instead of the photos.",
  needs: ["A ConstructHub CRM plan with JobCam — the CRM is a separate product with its own plans.", "A job with photos.", "The client’s email address or mobile number, to send the link."],
};
export default entry;
