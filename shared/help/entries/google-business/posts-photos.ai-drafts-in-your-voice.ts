import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("AI drafts and style") and server/gbp/content.ts (/draft, /learn, /style, draftPrompt) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.ai-drafts-in-your-voice", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → AI drafts in your voice",
  whatItIs: "The AI drafts and style section: post and caption drafts written from your instructions, your example wording and your saved style.",
  whatItDoes: "Instructions say what the post or caption is about, and Example descriptions show the wording you like. Generate caption drafts writes one caption per ticked photo; Generate post draft fills the Post draft box. Learn from past updates reads the posts already on your Google listing and suggests style notes. Style guidance is the voice every draft follows, and it stays a draft until you choose Save style guidance.",
  howToUse: [
    "Open Posts & Photos under Google Business, choose a linked location, and open AI drafts and style.",
    "Type Instructions and, if you like, Example descriptions.",
    "Choose Generate post draft, or tick photos first and choose Generate caption drafts, then edit the text.",
    "Edit Style guidance, or choose Learn from past updates and edit what it suggests, then Save style guidance.",
    "Approve the post or photos under Schedule and approve; AI text stays a draft until you do.",
  ],
  howItWorks: "A draft is written from the listing's own name, description and services, plus your instructions, examples and saved style. A fact those sources do not supply (a price, a discount, a rating, a phone number, a date) is left out, hashtags stop at three, and a caption describes only what is visible in the photo. Learn from past updates sums up the listing's earlier posts, stored only when you save it. AI drafts and publishing each have a daily cap.",
  needs: ["Any plan.", "A location linked to its Google Business Profile.", "An AI service set up on the server."],
};
export default entry;
