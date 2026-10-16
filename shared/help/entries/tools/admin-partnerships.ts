import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-partnerships.tsx and shared/media-inbox.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-partnerships", group: "Tools", route: "/admin/partnerships", title: "Partnerships (admin)",
  whatItIs: "A page for the people who run ConstructHUB: the media@ relationships inbox. Every company we are building a relationship with, what was agreed, and every email sent and received.",
  whatItDoes: "Tiles count companies agreed, finalized and talking, emails sent and received, the directory queue, and emails waiting for you. Companies lists each one with its kind, email count and what is left to finalize; opening it shows the agreement, cost terms, the owner decision and its emails. Emails lists messages with tabs for sent, received and waiting for you. Inbox laws lists the rules the AI answering media@ must follow, and Email a company sends a first contact from media@.",
  howToUse: [
    "Read the tiles; Waiting for you is what needs a decision.",
    "Open a company to change its status, edit what is left to finalize and read its emails.",
    "Mark a waiting email handled once you have answered it.",
    "Use Check now to read the inbox right away, or Email a company for a first contact.",
  ],
  howItWorks: "The server reads media@ every 30 minutes and answers each email; anything that would cost money waits for the owner. Laws marked Checked in code are verified on every reply before it is sent.",
  needs: ["Platform admin access."],
};
export default entry;
