import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-home.tsx (Needs attention, Follow-up cadences) as it runs. */
const entry: HelpDraft = {
  key: "crm-follow-up-cadence", group: "CRM", route: "/crm", title: "Put a client on a follow-up rhythm",
  whatItIs: "A weekly or biweekly reminder to check in with a client, so nobody goes cold.",
  whatItDoes: "Home lists the clients who are due under Needs attention → Due for follow-up. Done logs the follow-up under Activity and moves the client's next date on. The Follow-ups window shows everyone on a rhythm and their next due date.",
  howToUse: [
    "CRM → Home. Under Needs attention, “Due for follow-up” shows who to contact today.",
    "After you have been in touch, choose Done beside their name.",
    "Choose Follow-ups to add a client: search, click their name, and they start weekly.",
    "Use the list beside a client to switch between Weekly and Biweekly, or choose Off to stop.",
  ],
  howItWorks: "A client added to a rhythm starts weekly. When a follow-up comes due, the client appears in Needs attention until you choose Done, which starts the count again from today.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
