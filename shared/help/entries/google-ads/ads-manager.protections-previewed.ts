import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (Bulk protection preview, Protection previews) and server/ads/protections.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.protections-previewed", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Protections, previewed",
  whatItIs: "The five bulk protections of the Agency Ads & LSA manager and the preview each account gets before anything is written to Google.",
  whatItDoes: "Bulk protection preview, under Client accounts → Advanced, offers five protections with their own settings. They are presence-only location targeting (people actually in your area), Click Guard IP blocks (the oldest are dropped to stay under Google’s 500 limit), shared negative keywords, account-wide placement exclusions and an ad schedule. Queue protection previews builds one preview per selected account. Protection previews lists them; Review preview opens one with its summary, warnings, number of operations and expiry, and Technical details holds the raw operations.",
  howToUse: [
    "Open Google Ads → Agency → Client accounts in the sidebar, then open Advanced · Bulk protections and domain mapping.",
    "Choose a Protection and check its settings: the negative keyword list, the placements, or the schedule lines.",
    "Tick the client accounts and choose Queue protection previews.",
    "Open Protection previews and choose Review preview on each account to read the summary and the warnings.",
  ],
  howItWorks: "A preview is built from a fresh read of the account and lists every change it would make, campaign by campaign. IP exclusions take the newest flagged addresses from the client’s mapped Click Guard site and rotate out the oldest existing exclusions to stay within Google’s 500 per campaign. A shared negative list also affects campaigns already attached to it, and a phrase like “free” can suppress “free estimate”, so the starter list is there to edit. Nothing is written until the preview is confirmed.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected and verified Google Ads manager (MCC) account.", "For IP exclusions: the client mapped to its Click Guard website."],
};
export default entry;
