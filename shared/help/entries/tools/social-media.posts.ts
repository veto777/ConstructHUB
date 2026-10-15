import type { HelpDraft } from "../../types";

/** Written from client/src/pages/social-media.tsx (the Posts view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.posts", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Posts",
  whatItIs: "Every post for the business or for all clients: drafts, scheduled, published and failed, newest first.",
  whatItDoes: "It lists the posts with their network, time and status, 25 per page, and refreshes the status every 15 seconds. The menu narrows the list to drafts, scheduled, published or failed posts; the toolbar searches the text and filters by calendar day, status or platform. A draft can be edited, saved, approved or cancelled in its row, and a page of drafts and scheduled posts can be selected and approved or cancelled together, up to 100 at a time. A published post shows its likes, comments, shares and views when the network reports them.",
  howToUse: [
    "Open Posts and pick All, Drafts, Scheduled, Published or Failed in the menu.",
    "Search the text or filter by a day, a status or a platform to find a post.",
    "Open a draft, edit its text and save it, or approve it to queue it as written.",
    "Choose Select this page of posts, then Approve selected drafts or Cancel selected posts, to act on many at once.",
    "Read a failed post’s error, fix the cause and post it again from New post.",
  ],
  howItWorks: "Published means the network confirmed it; queued means the post is still in ConstructHUB waiting for its time; uncertain means the network did not answer clearly, so check the account before posting again. A draft edit you have not saved is kept in this browser until you save or discard it, and bulk approval waits until every selected draft is saved, so what is published is what you see. Cancelling stops drafts and queued posts; a post already handed to a network cannot be recalled. Times are shown in your browser’s timezone.",
};
export default entry;
