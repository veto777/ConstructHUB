import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-tickets.tsx and server/support/service.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-tickets", group: "Tools", route: "/admin/tickets", title: "Support tickets (admin)",
  whatItIs: "A page for the people who run ConstructHUB: the tickets Gabe opened on the support line after the caller verified their account.",
  whatItDoes: "Tiles count tickets by status; status chips filter the list, and you can type a status of your own. Each row shows the ticket number, severity, title, category, customer number and when it was opened. Opening a ticket shows the customer, how they verified, the device, what happened, the caller’s recording when there is one, the steps to reproduce, and the notes and replies so far. You can change the status, save an internal note, or email the customer.",
  howToUse: [
    "Pick a status chip, or type a status word, and open a ticket.",
    "Read what happened and listen to the recording if there is one.",
    "Write a note and choose Save note (internal) or Email the customer.",
    "Change the status as the ticket moves along.",
  ],
  howItWorks: "A reply emailed from here goes to the contact email saved on the ticket (the one the caller gave, which can differ from the account’s) and moves an open ticket to Waiting on customer. The server refuses anyone who is not a platform admin; open and in-progress tickets are listed first.",
  needs: ["Platform admin access."],
};
export default entry;
