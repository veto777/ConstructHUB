import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-tickets.tsx and server/support/service.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-tickets", group: "Tools", route: "/admin/tickets", title: "Support tickets (admin)",
  whatItIs: "A page for the people who run ConstructHUB: the tickets Gabe opened on the support line after the caller verified their account.",
  whatItDoes: "Tiles count tickets by status; status chips filter the list, and you can type a status of your own. Each row shows the ticket number, title, status, category, customer number and when it was opened, with a Critical badge on critical tickets. Opening a ticket shows the customer, how they proved who they are, the device, what happened, any call recording, the steps to repeat the problem, and the notes and replies so far. You can change the status, save an internal note, or email the customer.",
  howToUse: [
    "Pick a status chip, or type a status word, and open a ticket.",
    "Read what happened and listen to the recording if there is one.",
    "Write a note and choose Save note (internal) or Email the customer.",
    "Change the status as the ticket moves along.",
  ],
  howItWorks: "A reply sent from here goes to the contact email on the ticket, the one the caller gave, which can differ from the account’s. It moves an open ticket to Waiting on customer. The server refuses anyone who is not a platform admin; open and in-progress tickets are listed first.",
  needs: ["Platform admin access."],
};
export default entry;
