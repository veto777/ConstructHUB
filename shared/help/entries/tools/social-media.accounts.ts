import type { HelpDraft } from "../../types";

/** Written from client/src/components/social-connect.tsx, client/src/components/social-agency.tsx and client/src/components/social-youtube.tsx (the Accounts view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.accounts", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Accounts",
  whatItIs: "Where the business’s social accounts are connected and where its posts go by default.",
  whatItDoes: "It shows a Connect button for each network switched on for your account. Through ConstructHUB’s own apps that can be Facebook, Instagram, Threads, TikTok, X, Bluesky, Pinterest, Reddit, Mastodon and Tumblr; through its publishing account it is Facebook, Instagram, LinkedIn, TikTok, YouTube, Pinterest and Threads. A network already connected shows Add another. Each button opens that network’s own sign-in; back here, the connected accounts are listed, and Facebook and LinkedIn let you tick the pages you manage. The YouTube section connects one channel for the whole account. Map accounts and pages to this business saves which accounts a new post is ticked for by default.",
  howToUse: [
    "Open Accounts for the business and choose Connect on a network.",
    "Sign in on the network’s own page and allow the access it lists; for Facebook and LinkedIn tick the pages to post to.",
    "Repeat for each network, then open Map accounts and pages to this business and save the destinations.",
    "Connect YouTube in its own section to publish videos to your channel.",
    "Choose Disconnect all to disconnect every social account of this business.",
  ],
  howItWorks: "ConstructHUB connects through its own app on each network, or through its publishing account on some networks, and stores the sign-in encrypted. Bluesky signs in with an app password or its own sign-in page, and Mastodon with the server you name. Disconnect all removes every account connected for the business, turns its auto mode off and cancels its drafts and scheduled posts. It cannot pull back posts already published. When connecting is not switched on, the page says so instead of showing buttons.",
  needs: ["A social account you can sign in to for each network you post to."],
};
export default entry;
