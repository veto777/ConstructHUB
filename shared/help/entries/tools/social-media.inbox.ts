import type { HelpDraft } from "../../types";

/** Written from client/src/components/social-insights.tsx (the Inbox view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.inbox", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Inbox",
  whatItIs: "The comments on the business's published posts, answered from one place.",
  whatItDoes: "Lists the published posts; Comments on a post loads its comments and replies from the network, where you can reply, hide a comment or delete one, as far as the network allows for that comment.",
  howToUse: [
    "Open Inbox for the business.",
    "Choose Comments on a post to read what people wrote.",
    "Type a reply and send it, or hide or delete a comment where the network allows it.",
    "Load more to read older comments.",
  ],
  howItWorks: "Comments are read live from the network when you open them, for accounts connected through ConstructHUB's own apps. Hide and Delete are shown only when the network says that action is allowed for the comment. A reply is posted under your account on the network.",
};
export default entry;
