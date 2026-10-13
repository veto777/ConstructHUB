import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("AI drafts and style") and server/gbp/content.ts (/draft, /learn, /style, draftPrompt) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.ai-drafts-in-your-voice", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → AI drafts in your voice",
  whatItIs: "The AI drafts and style section: caption and post drafts written from your instructions, your example wording and saved style guidance.",
  whatItDoes: "Instructions say what the post or caption is about; Example descriptions show the wording you like. Generate caption drafts writes one caption per ticked photo, and Generate post draft fills the Post draft box. Learn from past updates reads the posts already on the Google listing and suggests style notes. Style guidance is the voice every draft follows; it counts as a draft until you choose Save style guidance.",
  howToUse: [
    "Sidebar → Google Business → Posts & Photos, choose a linked location, and open AI drafts and style.",
    "Type Instructions and, if you like, Example descriptions.",
    "Choose Generate post draft, or tick photos first and choose Generate caption drafts. Edit the text that appears.",
    "To set the voice, edit Style guidance, or choose Learn from past updates and edit what it suggests. Choose Save style guidance to keep it.",
    "Approve the post or photos under Schedule and approve; AI text remains a draft until you do.",
  ],
  howItWorks: "A draft is written from the listing’s own business name, description and services, plus your instructions, examples and saved style guidance. A fact the instructions ask for that those sources do not supply — a price, a discount, a rating, a phone number, a date — is left out, hashtags are at most three, and a photo caption describes only what is visible in the photo. Learn from past updates summarises the listing’s earlier posts; the summary is stored only when you save it. AI drafts and publishing each have a daily cap.",
  needs: ["Any plan.", "A location linked to its Google Business Profile.", "An AI provider configured on the server."],
};
export default entry;
