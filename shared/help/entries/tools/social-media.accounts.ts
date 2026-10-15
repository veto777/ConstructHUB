import type { HelpDraft } from "../../types";

/** Written from client/src/components/social-connect.tsx, client/src/components/social-agency.tsx and client/src/components/social-youtube.tsx (the Accounts view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.accounts", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Accounts",
  whatItIs: "Where the business's social accounts are connected and where its posts go by default.",
  whatItDoes: "Shows one Connect button per network ConstructHUB can publish to: Facebook, Instagram, Threads, X, LinkedIn, TikTok, YouTube, Pinterest, Bluesky, Reddit, Mastodon and Tumblr. Each button opens that network's own sign-in; back here, the connected accounts are listed, and Facebook and LinkedIn let you tick the pages you manage. The YouTube section connects one channel for the whole account. Map accounts and pages to this business saves which accounts a new post is ticked for by default.",
  howToUse: [
    "Open Accounts for the business and choose Connect on a network.",
    "Sign in on the network's own page and allow the access it lists; for Facebook and LinkedIn tick the pages to post to.",
    "Repeat for each network, then open Map accounts and pages to this business and save the destinations.",
    "Connect YouTube in its own section to publish videos to your channel.",
    "Choose Disconnect on a network to stop ConstructHUB posting to it.",
  ],
  howItWorks: "ConstructHUB connects your accounts through its own apps on each network, or through its publishing account when a network is set up that way; the sign-in each network returns is stored encrypted and never shown again. Bluesky signs in with an app password or its own sign-in page, and Mastodon with the server you name. Disconnecting stops ConstructHUB's queue for that network but cannot recall posts the network already published. When connecting is not switched on for this server, the page says so instead of showing buttons.",
  needs: ["A social account you can sign in to for each network you post to."],
};
export default entry;
