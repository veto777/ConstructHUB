import type { HelpDraft } from "../../types";
import { MODULE_NAMES, PLANS, planForModule } from "../../../plans";

/** Written from client/src/pages/gbp-content.tsx ("AI drafts and style") and server/gbp/content.ts (/draft, /learn, /style, draftPrompt) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.ai-drafts-in-your-voice", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → AI drafts in your voice",
  whatItIs: "The AI drafts and style section: post and caption drafts written from your instructions, your example wording and your saved style.",
  whatItDoes: "Instructions say what the post or caption is about, and Example descriptions show the wording you like. On Photos, Generate caption drafts writes one caption per ticked photo. On Posts, Generate post draft fills the Post draft box. Learn from past updates reads the posts already on your Google listing and suggests style notes. Style guidance is the voice every draft follows, and it stays a draft until you choose Save style guidance.",
  howToUse: [
    "Open Posts (for post drafts) or Photos (for caption drafts) under Google Business, choose a linked location, and open AI drafts and style.",
    "Type Instructions and, if you like, Example descriptions.",
    "Choose Generate post draft, or tick photos first and choose Generate caption drafts, then edit the text.",
    "Edit Style guidance, or choose Learn from past updates and edit what it suggests, then Save style guidance.",
    "Approve the post or photos under Schedule and approve; AI text stays a draft until you do.",
  ],
  howItWorks: "A draft is written from the listing's own name, description and services, plus your instructions, examples and saved style. The AI is told to leave out any fact those sources do not give, such as a price, discount, rating, phone number or date. It is also told to use at most three hashtags and to describe only what is in the photo. Nothing checks this afterwards, so read each draft before approving. Learn from past updates sums up the listing's earlier posts, stored only when you save it. AI drafts and publishing each have a daily cap.",
  needs: [`The ${PLANS[planForModule("autoPosts")].name} plan, which includes the “${MODULE_NAMES.autoPosts}” module.`, "A location linked to its Google Business Profile.", "An AI service set up on the server."],
};
export default entry;
