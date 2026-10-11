/**
 * The Guides library (/guides): every guide destination the marketing lists (shared/feature-pages/guides.ts)
 * and the setup walkthroughs, as data. The page (client/src/pages/guides.tsx) renders, filters and searches it.
 *
 * Access labels are derived, never typed: the Google Ads guide and the state guides follow /api/course-access,
 * the connection module follows shared/plans.ts through planNamesWhere.
 */
import { planNamesWhere } from "@shared/plan-copy";

export type Topic = "playbooks" | "licensing" | "connections" | "google" | "social" | "site" | "account";

export const TOPICS: { key: Topic; label: string }[] = [
  { key: "playbooks", label: "Ads playbooks" },
  { key: "licensing", label: "State licensing" },
  { key: "connections", label: "Connect your website" },
  { key: "google", label: "Google Business" },
  { key: "social", label: "Social media" },
  { key: "site", label: "Site Scan" },
  { key: "account", label: "Account & security" },
];

/** The plans whose modules include Cloudflare + Search Console (shared/plans.ts) — read, never typed. */
export const CONNECTIONS_PLAN = planNamesWhere((p) => p.modules.cloudflareSearchConsole);

export type Access =
  | { kind: "free" }
  | { kind: "account" }
  /** Each destination follows its own course gate. */
  | { kind: "master-class"; scope: "any" | "licensing" | "all" }
  /** The walkthrough is free to read; doing it inside ConstructHUB needs the plan named. */
  | { kind: "plan"; plan: string };

export type LibraryEntry = {
  id: string;
  topic: Topic;
  title: string;
  body: string;
  href: string;
  open: string;
  access: Access;
  /** Where the number comes from, so the card never claims a count the code doesn't hold. */
  count?: string;
};

export const LIBRARY: LibraryEntry[] = [
  {
    id: "google-ads-guide", topic: "playbooks", title: "Google Ads guide",
    body: "The campaign setup playbook for contractors: setup, settings to switch off, assets, keywords, location targeting, bidding, ad copy, landing pages, IP exclusions, tracking, click fraud and a launch checklist.",
    href: "/google-ads-guide", open: "Open the Google Ads guide", access: { kind: "master-class", scope: "any" }, count: "12 sections",
  },
  {
    id: "lsa-guide", topic: "playbooks", title: "LSA guide",
    body: "Local Services Ads: verification, answering calls, reviews, choosing services, message leads, service areas and hours, photos and your bio.",
    href: "/lsa-guide", open: "Open the LSA guide", access: { kind: "free" }, count: "8 sections",
  },
  {
    id: "ad-fraud", topic: "playbooks", title: "Ad Fraud",
    body: "ConstructHUB's view on invalid clicks in contractor ads, and the steps to act on it with Click Guard and your own Google Ads account.",
    href: "/google-ad-fraud", open: "Open Ad Fraud", access: { kind: "free" },
  },
  {
    id: "state-guides", topic: "licensing", title: "State licensing guides",
    body: "Every state's formation, licensing, workers' comp and tax agencies with checked links, plus the ordered steps to start a construction business there. The comparison table is free; each state's full guide is Module 1 of the Master Class.",
    href: "/master-class?tab=state-guide", open: "Open the state guides", access: { kind: "master-class", scope: "licensing" }, count: "50 states",
  },
  {
    id: "master-class", topic: "licensing", title: "Master Class",
    body: "The contractor business course: Business Formation & Licensing, GMB Setup & Optimization, Website & Online Presence, and SEO & Directory Domination, each with ordered lessons.",
    href: "/master-class", open: "Open the Master Class", access: { kind: "master-class", scope: "all" }, count: "4 modules",
  },
  {
    id: "connection", topic: "connections", title: "Site connection guide",
    body: "Put a site behind Cloudflare and connect it with a limited key, then connect Search Console and sync its history. The walkthrough is free to read.",
    href: "#guide-connection", open: "Read the walkthrough", access: { kind: "plan", plan: CONNECTIONS_PLAN },
  },
];

export type Walkthrough = {
  id: string;
  topic: Topic;
  title: string;
  href: string;
  /** The label of the "Open …" link (kept exactly: e2e/social-media.spec.ts asserts them). */
  open: string;
  steps: string[];
};

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: "blotato", topic: "social", title: "Connect Blotato", href: "/social-media", open: "Open Social Media",
    steps: [
      "Visit Blotato and create your own account. Blotato is a separate subscription you buy from Blotato; creating an API key activates its paid subscription.",
      "Connect your social accounts inside Blotato. For Facebook, grant access to the Pages you manage.",
      "In Blotato Settings, open API and create/copy an API key. Never send the key to anyone else.",
      "Open Social Media, search for a business / Google profile, and select it. Choose Agency shared key or This business only, paste the Blotato API key, and choose Connect Blotato. A business without its own key falls back to the agency key.",
      "Open Map accounts and pages to this business. Search accounts, discover pages or boards, choose the verified destinations, and Save business mapping. These become composer defaults and bulk destinations. Disconnect stops local queued posts and auto mode; manage already-submitted posts and billing in Blotato.",
    ],
  },
  {
    id: "manual-posting", topic: "social", title: "Manual posting", href: "/social-media", open: "Open Social Media",
    steps: [
      "Open Social Media → Compose. Select accounts/pages and enter Post text.",
      "Use each platform’s text tweak and character counter. Add public media URLs, attach a synced business photo, or Upload through Blotato.",
      "For YouTube, supply a title, video and privacy choice. TikTok defaults to private; choose public explicitly and set any business/paid partnership disclosures.",
      "Choose Post now, or enter Schedule time in your browser’s local timezone and choose Schedule post. Save draft keeps the post for approval.",
      "Open Calendar & queue. Each destination has its own status. Approve & queue a draft, or cancel before submission. Follow View published post or Open Blotato status.",
      "If status is uncertain, check the submission in Blotato before creating another post. A queued or accepted submission is not a confirmed publication.",
    ],
  },
  {
    id: "auto-mode", topic: "social", title: "Auto mode", href: "/social-media", open: "Open Social Media",
    steps: [
      "Add your business details in Locations. Sync that location’s Google business photos and reviews if you want those content sources.",
      "In Social Media → Compose, select the accounts/pages to use. Open Auto mode and choose Use accounts selected in Compose.",
      "Choose cadence, content mix, timezone, blackout hours, business instructions, writing examples, and daily AI budget. Add factual offers under Content sources. Use Sync recent GBP updates to import live standard updates from linked Google locations; refresh is queued in the background and only imports the selected business. Check the refresh status; generation uses recent stored sources.",
      "Start with Approval queue, enable auto mode and Save auto settings. Generate draft from saved settings queues a preview without publishing; results appear in the calendar after the worker runs.",
      "Review AI-generated drafts in Calendar & queue; edit the text and choose Approve & queue.",
      "Only choose Fully automatic if you authorize generated posts to publish without review. Disabling auto mode returns pending automatic posts to drafts. Missing source material is reported instead of invented. Remove expired offers promptly.",
    ],
  },
  {
    id: "agency-social", topic: "social", title: "Agency social workflows", href: "/social-media", open: "Open Social Media",
    steps: [
      "The business selector searches saved Locations and remembers the selected business in the URL. Switching businesses resets the composer and settings editor.",
      "Open Bulk actions, select businesses across search pages, and write one update using {business}, {city}, and {phone}. Create bulk drafts for review or explicitly Queue bulk posts. Missing facts or invalid destinations produce per-business failures in Bulk results.",
      "Expand Per-business cadence to set each selected business’s frequency. Approval drafts is the default; choosing automatic publishing explicitly authorizes all selected businesses. You can also disable auto modes, refresh GBP sources, or generate drafts in bulk.",
      "Open All-clients calendar to search business names/post text and filter dates, status, and platform. Select drafts for bulk approval or cancel unsent posts. A single bulk action handles up to 100 posts.",
      "Mapping edits pause auto mode. After changing a key, review and save each affected business mapping before enabling auto mode again. Legacy global automation is paused; unassigned history remains in the all-clients calendar.",
    ],
  },
  {
    id: "profile-guard", topic: "google", title: "Profile Guard", href: "/locations", open: "Open Locations",
    steps: [
      "Open Locations, open a linked business location, then Profile Guard. Choose Watched fields and Preview current Google values. Inspect the proposed snapshot before approving it.",
      "Choose Off, Notify or Lockdown. Use Verify identity with the requested credentials, then Approve snapshot and save settings. For an existing snapshot, use Save guard settings. Lockdown restores detected changes; it cannot block edits at Google.",
      "Use Check now to inspect changes. Approve accepts a detected value into your snapshot; Reject attempts to restore the approved value at Google. Check pending changes and failure messages afterward.",
      "Report opens evidence, not a submitted complaint. Choose Copy report and Open Google's official form, complete the form at Google, then I submitted the form — mark reported. The receipt is local to ConstructHUB.",
    ],
  },
  {
    id: "ai-review-replies", topic: "google", title: "AI review replies", href: "/google-reviews", open: "Open Google Reviews",
    steps: [
      "Open Google Reviews → Google Profile Reviews and sync your linked business's reviews. In AI reply settings and drafts queue, select a linked location.",
      "Choose Off, Draft for approval or Auto-publish. Set tone, sign-off, character limit and star-rating rules, then Save AI reply settings. Auto-publish authorizes publication; one- and two-star reviews remain drafts unless you explicitly permit their auto-publication.",
      "Future-only applies to reviews created after enabling AI. For existing unanswered reviews, select that scope, save settings, choose Preview existing reviews, inspect the actions, then Confirm backfill. Each preview covers up to 50 reviews and expires after ten minutes.",
      "Review and edit generated drafts in the queue before publishing. Check facts, tone and private information. A draft is not a posted reply; inspect the final status and any error before trying again.",
    ],
  },
  {
    id: "posts-photos", topic: "google", title: "Posts & Photos scheduling and AI captions", href: "/gbp-content", open: "Open Posts & Photos",
    steps: [
      "Open Google Business → Posts & Photos and select a linked location. Select library photos or Upload photos (up to 100, 15 MB each). Filename and EXIF changes make library copies; Google strips EXIF and geotags do not promise ranking benefits.",
      "Under AI drafts and style, enter Instructions and Example descriptions, then Generate caption drafts or Generate post draft. Review and edit the result. Learn from past updates creates guidance that must be reviewed and saved with Save style guidance before use.",
      "Under Compose Google update — draft, choose Post type and supply required event or offer fields. Event and offer times use the Google location's local time. Add post to draft batch collects distinct updates; unsaved drafts are lost on reload.",
      "Under Schedule and approval, set First publish (blank = now), Items per period and Cadence. For Custom times supply one timestamp with timezone per item. Business hours only uses the timezone, weekdays and hours you enter, not inferred Google hours.",
      "Choose Approve & queue photos or Approve & queue post to authorize publishing. Cadence spaces that approved set; it does not generate an ongoing series. A disabled publishing worker leaves items queued.",
      "Inspect Calendar, queue & history and Refresh Google status. Cancel queued work to replace it. Resolve failures before Retry; for uncertain results, check Google first because retrying can duplicate a successful publication.",
    ],
  },
  {
    id: "security", topic: "account", title: "Security", href: "/settings?tab=security", open: "Open Security & activity",
    steps: [
      "Open Settings → Security & activity. Under Two-Factor Authentication, choose Enable 2FA, scan the QR code in your authenticator, enter its code and choose Verify & Enable. Save the recovery codes privately, then I saved my codes. Each recovery code works once.",
      "Remember a device only on a private device you control. In Remembered devices, choose Revoke device for old devices. Revocation requires 2FA at the next sign-in; it does not terminate an existing session.",
      "Complete identity verification when prompted before sensitive changes. Recovery codes restore sign-in but do not replace the configured verification method for protected settings.",
      "Open Settings → Notifications to save delivery preferences. Security email is always on. The header bell shows recent notices and lets you mark them read.",
      "Review Account activity using Activity type and Since. For an unfamiliar Google connection, follow the security notice, explicitly disconnect the account and follow the password-reset guidance. Opening a notice alone does not disconnect anything.",
    ],
  },
  {
    id: "site-scan", topic: "site", title: "Site Scan", href: "/site-scan", open: "Open Site Scan",
    steps: [
      "Open Site Scan. Choose a Linked GBP location or No GBP comparison, then check Website URL. GBP comparisons use the last synced profile; scan findings do not change your website or Google listing.",
      "Set Page cap and PageSpeed pages (mobile + desktop), then Start scan. Follow progress and coverage notices. Missing measurements remain unavailable; scores are diagnostic heuristics, not ranking guarantees.",
      "Inspect findings and affected URLs. Generate AI fix plan creates drafts only; review their accuracy before using Copy draft or applying changes yourself.",
      "On a completed report, use Export PDF or Create share link. Anyone with the link can read the report, including drafts and GBP facts. Creating another link replaces the old one; Revoke share link stops future access. Share links expire after 30 days.",
      "Use Enable monthly rescan for the chosen URL and Disable monthly rescan to stop it. History compares completed scans. Scheduled scans share your daily budgets, and larger scans can take several minutes.",
      "The public Free 60-second website scan at /free-site-scan shows a limited summary. Open the verification email to unlock the full quick-scan report of up to 11 pages; the seven-day email link does not unlock a full account scan. Sixty seconds is an estimate.",
    ],
  },
];

/** Older anchors (#guide-0 … #guide-8, the array order) still land on the same walkthrough. */
export const LEGACY_ANCHORS: Record<string, string> = Object.fromEntries(WALKTHROUGHS.map((w, i) => [`guide-${i}`, `guide-${w.id}`]));

const hay = (parts: string[]) => parts.join(" ").toLowerCase();
export const matchesQuery = (q: string, parts: string[]) => !q.trim() || hay(parts).includes(q.trim().toLowerCase());
