import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { PLANS, PLAN_KEYS } from "../plans";
import { joinNames, planNamesWhere } from "../plan-copy";

/**
 * Profile Guard (the "Profile Guard" tab of a location in Locations; the dashboard tile's name) — every claim
 * is backed by the code in `sources`:
 *   - needs a location linked to its Google listing through a connected account: client/src/components/profile-guard.tsx
 *     (GuardUnlinked), server/gbp/guard.ts (clientFor + the location's gbp_location_name)
 *   - preview the live Google values, choose watched fields, approve the snapshot: guard.ts previewSnapshot/configureGuard
 *   - the 11 watched fields: guard.ts GUARD_FIELDS, profile-guard.tsx fieldLabels
 *   - modes Off / Notify / Lockdown; Lockdown restores after detection and confirms Google accepted the value;
 *     it cannot block edits at Google; Maps publication may lag: guard.ts checkGuard + resolveLocked, profile-guard.tsx copy
 *   - check cadence per plan (guardCadenceMinutes), only owners with an active plan: guard.ts runGuardWorker, shared/plans.ts
 *   - one guarded location per covered location (the plan's `locations` allowance, add-ons included):
 *     server/routes.ts registerPlanGates PUT /api/gbp/locations/:id/guard
 *   - alerts in the app and by email (defaults): server/notification-kinds.ts gbp.profile_change / gbp.suggested_edit /
 *     gbp.change_reverted, server/account-events.ts notifyUser
 *   - approved vs detected values, source and Google's evidence; Google does not identify the editor:
 *     guard.ts differences() (evidence.attribution)
 *   - Approve / Reject per change, Check now, Report → Google's official form: profile-guard.tsx, server/gbp/guard-routes.ts
 *   - saving asks you to confirm it's you, once per 12 hours: profile-guard.tsx copy, guard-routes.ts
 *   - GMB Edit Monitor (any public listing, on-demand checks only, no automatic checks or alerts):
 *     client/src/pages/gmb-monitor.tsx, server/routes.ts /api/gmb/listings/:id/check
 */

const GUARDED: FeatureAllowance = { limit: "locations", unit: "guarded locations", period: "count" };

/** "every 15 minutes on Starter, Pro and Growth and every 30 minutes on Agency", from the price book. */
const CADENCE_LINE = joinNames(
  [...new Set(PLAN_KEYS.map((k) => PLANS[k].limits.guardCadenceMinutes))]
    .sort((a, b) => a - b)
    .map((m) => `every ${m} minutes on ${planNamesWhere((plan) => plan.limits.guardCadenceMinutes === m)}`),
);
const FASTEST = Math.min(...PLAN_KEYS.map((k) => PLANS[k].limits.guardCadenceMinutes));

const page: FeaturePage = {
  key: "profileGuard",
  slug: "profile-guard",
  group: "grow",
  status: "ready",
  title: "Profile Guard",
  kicker: "Edit alerts",
  headline: { lead: "Know When Your Google Profile ", swipe: "Gets Changed" },
  lede:
    "Profile Guard checks your Google Business Profile on a schedule, compares it with the values you approved, " +
    "and alerts you when your name, phone, website, hours or other details change. In Lockdown it puts your values back.",
  hero: { mascot: "standing", bubble: "I'll keep an eye on your listing." },
  steps: [
    {
      title: "Link your location",
      body: "Profile Guard works on a location linked to its Google listing through a Google account you've connected.",
    },
    {
      title: "Approve your snapshot",
      body: "Preview the values Google has now, choose the fields to watch, and approve them as your baseline.",
    },
    {
      title: "Pick a mode",
      body: "Notify alerts you to each change. Lockdown also restores your approved value once it finds a change.",
    },
    {
      title: "Review what changed",
      body: "Each change shows your approved value next to the new one. Approve it into your snapshot, or reject it to restore yours at Google.",
    },
  ],
  cards: [
    {
      icon: "clock",
      title: "Checked on a schedule",
      body: `Checks run ${CADENCE_LINE}, and you can run one any time with Check now.`,
    },
    {
      icon: "eye",
      title: "The fields that matter",
      body: "Business name, phone numbers, website, address, categories, description, regular and special hours, service area, opening date and open status.",
    },
    {
      icon: "lock",
      title: "Lockdown",
      body: "After a change is found, Profile Guard writes your approved value back to Google and checks that Google accepted it.",
    },
    {
      icon: "bell",
      title: "Alerts by email and in the app",
      body: "A notice when a change is found, when Google or the public suggests an edit, and when Lockdown restores a value.",
    },
    {
      icon: "history",
      title: "Change history with evidence",
      body: "Every change keeps the old and new value, when it was found, and what Google reported about it.",
    },
    {
      icon: "shield-alert",
      title: "Report to Google",
      body: "For a misleading or fraudulent edit, copy a report with the evidence and open Google's official form.",
    },
    {
      icon: "key",
      title: "Settings that need you",
      body: "Changing Guard settings asks for your password, authenticator or an emailed code, so a signed-in session can't quietly switch it off.",
    },
    {
      icon: "search",
      title: "GMB Edit Monitor",
      body: "No Google connection? Check any public listing against Google's public data when you choose, and keep a history of what changed.",
    },
  ],
  spotlight: {
    kicker: "Honest Alerts",
    heading: { title: "What Google Tells Us, ", em: "and What It Doesn't" },
    points: [
      "Lockdown restores a value after it finds the change. It can't stop Google or the public from editing your listing.",
      "Google doesn't say who made an edit, or tell a public suggestion apart from its own update, so the alert shows the source as Google reports it.",
      "A restored value can take a while to appear on Google Maps.",
      "Turning a field off stops watching it; it doesn't close the changes already on record.",
    ],
    panel: {
      label: "A detected change",
      title: "What every change records",
      items: [
        "Field", "Approved value", "Detected value", "Detected at", "Source", "Status", "Google's evidence", "Reported to Google",
      ],
      note: "Approve, reject or report each one from the location's Profile Guard tab.",
    },
  },
  audience: [
    {
      title: "Owners who can't check daily",
      body: "A wrong phone number or new hours on your listing is easy to miss. Find out at the next check.",
    },
    {
      title: "Multi-location companies",
      body: "Guard every branch's listing, each with its own snapshot and history.",
    },
    {
      title: "Agencies",
      body: "Watch every client listing from one account and keep the evidence when something changed.",
    },
  ],
  pricing: {
    kind: "plan",
    allowance: GUARDED,
    note: `Guard can run on as many locations as your plan covers, extra locations included. Checks run ${CADENCE_LINE}.`,
  },
  faqs: [
    {
      q: "What does it need from me?",
      a: "A location linked to its Google listing through a connected Google account with owner or manager access. When you save Guard settings, you confirm it's you once; it doesn't ask again for 12 hours.",
    },
    {
      q: "Which plans include it, and how often does it check?",
      a: `Every plan includes it, on as many locations as the plan covers. ${allowanceLine(GUARDED)}. Checks run ${CADENCE_LINE}.`,
    },
    {
      q: "Can it stop someone from editing my profile?",
      a: `No. Google lets the public and Google itself change listings. Profile Guard finds a change at its next check, as often as every ${FASTEST} minutes, and in Lockdown it restores your approved value. Google may take a while to show the restored value on Maps.`,
    },
    {
      q: "Will it tell me who made the change?",
      a: "No. Google doesn't identify who edited a listing. Profile Guard shows what changed, when it found it, and what Google reported about the change.",
    },
    {
      q: "What is the GMB Edit Monitor?",
      a: "A simpler checker for any public listing, with no Google connection needed. It compares the listing with Google's public data when you click Check now or Check all and keeps the history. It runs no automatic checks and sends no alerts.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the snapshot and the eleven fields are
  // server/gbp/guard.ts previewSnapshot/configureGuard + GUARD_FIELDS; the two reads per check (live + getGoogleUpdated),
  // the order-insensitive comparison and the source label are guard.ts checkGuard, canonical()/same() and differences();
  // one alert per pending change is the observed/pending check in checkGuard; restore-one-field-then-confirm is
  // guard.ts resolveLocked (PATCH ?updateMask=<field>, "Google did not confirm the restored value"); the cadence, and
  // no checks without an active plan with settings kept, are guard.ts runGuardWorker + shared/plans.ts guardCadenceMinutes.
  inDepth: {
    heading: { title: "Google Business Profile Edit Alerts, ", em: "Explained" },
    paragraphs: [
      "Anyone can suggest an edit to a Google Business Profile, and Google can change a listing itself. A different " +
        "phone number, new hours or another website on your listing can go unnoticed until a customer can't reach you. " +
        "Profile Guard is the edit alert that watches for it, and in Lockdown it puts your own values back.",
      "It starts from a snapshot you approve. Profile Guard reads the values Google has now, you choose which of the " +
        "eleven fields to watch, and those values become your baseline. At every check it reads your listing twice: " +
        "the live version, and Google's own record of what it has changed. Each watched field is compared with your " +
        "baseline in a way that ignores harmless differences, such as the order your categories are listed in, so an " +
        "alert means a value really changed.",
      "When a field differs, Profile Guard records the change with your approved value, the new value, when it was " +
        "found and what Google reported about it, and alerts you in the app and by email. If the change shows up in " +
        "Google's record, the alert says it came from Google; otherwise it says the edit was made outside " +
        "ConstructHUB. Google doesn't say who made an edit, so neither does the alert. A change still waiting for your " +
        "decision isn't announced again at every check.",
      "In Notify mode you decide: approve the new value into your snapshot, or reject it and your approved value is " +
        "written back to Google. Lockdown does that on its own after each check. Either way, only the changed field is " +
        "sent, and Profile Guard then confirms that Google's answer matches your value; if Google doesn't confirm it, " +
        "the change keeps an error instead of being marked restored. Lockdown can't stop an edit from happening, and a " +
        "restored value can take a while to show on Google Maps.",
      `Checks run on your plan's schedule, as often as every ${FASTEST} minutes, and only while the plan is active. ` +
        "If a plan lapses, your Guard settings stay and checks start again when a plan is back.",
    ],
  },
  related: ["gbp", "reinstatement", "reviews"],
  app: { href: "/locations", surface: "app", label: "Open Locations" },
  headings: {
    steps: { title: "Guarded in ", em: "Four\u00a0Steps" },
    cards: { title: "What Profile Guard ", em: "Watches" },
    faq: { title: "Before You ", em: "Turn It On" },
  },
  seo: {
    title: "Google Business Profile Edit Alerts | ConstructHUB",
    description:
      "Get an alert when your Google Business Profile's name, phone, website, hours or address changes, and restore your approved values with Lockdown.",
  },
  sources: [
    "client/src/components/profile-guard.tsx",
    "client/src/pages/gmb-monitor.tsx",
    "server/gbp/guard.ts",
    "server/gbp/guard-routes.ts",
    "server/notification-kinds.ts",
    "server/account-events.ts",
    "server/routes.ts",
    "shared/plans.ts",
  ],
};

export default page;
