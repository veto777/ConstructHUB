import type { HelpDraft } from "../../types";

/** Written from client/src/components/jobcam/feed.tsx and tag-picker.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-jobcam-tags", group: "CRM", route: "/crm/jobcam", title: "Tag job photos and filter by tag",
  whatItIs: "Tags on job-site photos and videos, so you can find them again by what they show.",
  whatItDoes: "Select lets you tick several photos and add or remove a tag on all of them at once; you can pick an existing tag or type a new one. The Tags filter beside the search box narrows the feed to the tags you tick.",
  howToUse: [
    "CRM → JobCam. Search for the job if you want only its photos.",
    "Choose Select and tick the photos.",
    "Choose Tags in the bar, pick or type a tag, close the list, then choose Add.",
    "Choose Done. Use the Tags filter beside the search box to show only tagged photos.",
  ],
  howItWorks: "Anyone on the team can make a new tag. A photo with one tag shows the tag's name in its corner; with more, it shows how many. In the Tags filter, “and” shows photos that have every ticked tag and “or” shows photos that have any of them.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "JobCam on your CRM plan."],
};
export default entry;
