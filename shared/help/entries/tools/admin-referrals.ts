import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-referrals.tsx and server/referrals/service.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-referrals", group: "Tools", route: "/admin/referrals", title: "Referrals (admin)",
  whatItIs: "A page for the people who run ConstructHUB: who referred whom, how far each referral got, and the reward.",
  whatItDoes: "Tiles count referrals by status (pending, qualified, rewarded, void) and the rewards waiting or applied. Each row shows the referrer and the person referred, when they signed up, their paid invoices, the reward kind and when it is earned. Status chips filter the list, and you can type a status of your own. Void referral cancels a pending or qualified referral; Void reward cancels a reward that is still waiting to be applied.",
  howToUse: [
    "Pick a status chip, or type a status word, to narrow the list.",
    "Read a row for the referral’s progress and reward.",
    "Use Void referral or Void reward when a referral or reward should not stand.",
  ],
  howItWorks: "A referral qualifies after the paid invoices the program requires and earns its reward after the holding period. An applied reward is already in Stripe and is reversed there, not here. The server refuses anyone who is not a platform admin.",
  needs: ["Platform admin access."],
};
export default entry;
