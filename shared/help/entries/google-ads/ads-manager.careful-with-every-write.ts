import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (Protection previews), server/ads/routes.ts /plans/confirm and /plans/undo-preview, server/ads/worker.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.careful-with-every-write", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Careful with every write",
  whatItIs: "What the Agency Ads & LSA manager does around every change it writes to Google: expiry, confirmation, a re-check and a reversal.",
  whatItDoes: "A preview starts as Ready for review and expires after 24 hours; an expired preview cannot be confirmed and shows Expired in the list. Confirm selected previews is available only after you tick “I reviewed the selected previews and authorize these Google Ads changes”. Before anything is written, each account is read again; if it changed since the preview, nothing is written. Preview reversal of selected applied changes builds a preview that undoes an applied change, and that reversal stops too if the account has changed since the write.",
  howToUse: [
    "Open Google Ads → Agency → Protection previews in the sidebar; Filters shows one status at a time, Expired included.",
    "Choose Review preview, read it, and choose Select this preview for bulk confirmation.",
    "Tick I reviewed the selected previews, then choose Confirm selected previews.",
    "Tick an applied change and choose Preview reversal of selected applied changes to undo it, then confirm that preview the same way.",
  ],
  howItWorks: "Each preview carries a fingerprint of the account as it was read. The server reads the account again right before writing and refuses to write when the fingerprint no longer matches, so a stale preview is never applied. A write whose outcome Google did not confirm shows Outcome unknown: check it in Google Ads before creating another change. Results depend on Google accepting each change.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected and verified Google Ads manager (MCC) account.", "A preview that has not expired."],
};
export default entry;
