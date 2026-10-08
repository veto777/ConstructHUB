import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-home.tsx and server/crm/follow-ups.ts as they run. */
const entry: HelpDraft = {
  key: "crm-follow-ups", group: "CRM", route: "/crm", title: "Work your follow-ups",
  whatItIs: "The Needs attention card on Home: follow-ups that are due, new leads, and leads that still need an estimate.",
  whatItDoes: "Follow-ups gives a client a weekly or biweekly rhythm. When one comes due, the client appears under Needs attention with a Done button. New leads and leads without an estimate are listed on the same card.",
  howToUse: [
    "CRM → Home, and find Needs attention.",
    "Choose Follow-ups, search for a client and click their name. They start on a weekly rhythm.",
    "Change the rhythm to Biweekly, or to Off to stop it.",
    "When a client shows as due for follow-up, contact them and choose Done.",
  ],
  howItWorks: "A follow-up comes due one rhythm after the last time you chose Done, or after the client was added if you never have. Done starts the count again. A lead counts as new for two weeks, and needs an estimate until it or its client has one.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
