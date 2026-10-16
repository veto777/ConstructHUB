import type { HelpDraft } from "../../types";

/** Written from client/src/pages/social-media.tsx (the Auto mode view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.auto", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Auto mode",
  whatItIs: "ConstructHUB writing posts for the business on a schedule, as drafts for your approval or straight to your accounts.",
  whatItDoes: "It turns auto mode on or off and sets how posts go out: in an approval queue every written post waits as a draft, while fully automatic publishes to your saved accounts without review. You set posts per day or week (1 to 7) and the mix: project photos, tips, review highlights, offers and recent Google updates. You also set instructions, writing examples, a time zone, quiet hours and a daily limit of 0 to 20 AI requests. Content sources hold offers you type and updates pulled from the linked Google listing, used for 30 days.",
  howToUse: [
    "Open Auto mode for the business and tick Enable auto mode.",
    "Choose the publishing mode; Approval queue is the safe choice, where generated posts wait under Posts → Drafts.",
    "Set the saved destinations with Use accounts selected in Compose, the posts per period, the content mix and your instructions.",
    "Set the timezone and blackout hours, then choose Save auto settings.",
    "Add an offer under Content sources or choose Sync recent GBP updates, and use Generate draft from saved settings to try it.",
  ],
  howItWorks: "Posts are spaced evenly over the period, with no catch-up burst after downtime; equal blackout hours mean no blackout. A generation that lacks media or sources pauses with an error shown on the page, and the next generation time is shown while auto mode is on. Fully automatic mode is your explicit permission to publish generated posts. Sources expire from generation after 30 days; remove an offer when it ends.",
  needs: ["Connected accounts saved as destinations; auto mode cannot be enabled without them."],
};
export default entry;
