import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-team.tsx (My profile tab) and PATCH /api/crm/profile as they run. */
const entry: HelpDraft = {
  key: "crm-team-profile", group: "CRM", route: "/crm/team", title: "Your profile",
  whatItIs: "Your own name, title and mobile number in the CRM — how you appear to your crew and on the schedule.",
  whatItDoes: "My profile holds your name, your title and your mobile number, and shows the role you have. Save profile stores them and takes you back to Home.",
  howToUse: [
    "CRM → Team & Company → My profile, or click your name at the bottom of the menu.",
    "Check your name, then type your title and your mobile number.",
    "Choose Save profile.",
  ],
  howItWorks: "Your role is shown here but is not changed here: roles are set on the Team tab. Saving a mobile number does not sign you up for text alerts — those are switched on separately, in Settings → Notifications.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
