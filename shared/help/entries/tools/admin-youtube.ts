import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-youtube.tsx and server/youtube/routes.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-youtube", group: "Tools", route: "/admin/youtube", title: "YouTube channel (admin)",
  whatItIs: "A page for the people who run ConstructHUB: connect the company YouTube channel once so the help videos can be uploaded by a script.",
  whatItDoes: "It shows whether the channel is connected, which channel, who connected it and when, and the permissions Google granted. Connect sends you to Google and back; Disconnect deletes the saved sign-in here and cancels it at Google. Before you connect lists what to check first; Good to know explains privacy and the daily upload limit.",
  howToUse: [
    "Read Before you connect and sign in to the Google account that owns the channel.",
    "Choose Connect YouTube channel and allow the permissions Google asks for.",
    "Check the channel shown is the expected one, and Reconnect if the connection expired.",
  ],
  howItWorks: "Connect is a plain link: the server sends the browser to Google and back with ?result=connected or failed, and this page never receives a sign-in token. Uploads start as Private; a scheduled one is made public by YouTube at its publish time.",
  needs: ["Platform admin access and Google sign-in set up on the server."],
};
export default entry;
