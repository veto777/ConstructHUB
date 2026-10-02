import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS } from "../plans";
import { joinNames } from "../plan-copy";

/**
 * Google Business Profile (the Locations page) — every claim is backed by the code in `sources`:
 *   - connect one or more Google accounts (business.manage), import listings, "Managed by <email>":
 *     server/gbp/routes.ts (/api/gbp/connect, /api/gbp/locations, /api/gbp/import), client/src/pages/locations.tsx
 *   - add a location by searching Google instead: POST /api/locations/search-google + POST /api/locations (server/routes.ts)
 *   - the location count is the plan's `locations` allowance (+ Extra location add-ons): server/routes.ts
 *     registerPlanGates (/api/gbp/import) and POST /api/locations (requirePlan + sendLocationLimit)
 *   - automatic sync every six hours while connected, only on an active plan: server/agency/jobs.ts (syncDue, scheduleSyncs)
 *   - what a sync reads (profile fields, business + customer photos, reviews, daily performance; 90 days first,
 *     then a one-time back-fill of PERFORMANCE_HISTORY_DAYS; "verified listings only" message): server/gbp/service.ts syncLocation
 *   - the tabs (Insights, Profile Guard, Location Info, Services, Photos & Videos, Social Profiles, Settings,
 *     Citations), the performance metrics and "not final yet" days: client/src/pages/locations.tsx
 *   - the citation checklist (Google row filled from the linked listing, the rest marked by the owner):
 *     server/routes.ts /api/citations/campaigns/:id/run and PATCH /api/citations/:id
 *   - removing a location never touches the Google listing: locations.tsx SettingsTab copy, DELETE /api/locations/:id
 *   - Agency bulk actions (sync, link, Guard mode…): client/src/components/agency-workspace.tsx
 */

const LOCATIONS: FeatureAllowance = { limit: "locations", unit: "Google Business Profile locations", period: "count" };
const EXTRA_LOCATION_PLANS = joinNames(ADDONS.extra_location.availableOn.map((k) => PLANS[k].name));

const page: FeaturePage = {
  key: "gbp",
  slug: "gbp",
  group: "grow",
  status: "ready",
  title: "Google Business Profile",
  kicker: "Business Profile",
  headline: { lead: "All Your Google Profiles in ", swipe: "One Place" },
  lede:
    "Connect the Google account that manages your listings, bring your locations in, and see each one's details, " +
    "services, photos and Google performance figures in one place, synced every six\u00a0hours.",
  hero: { mascot: "standing", bubble: "Let's bring your Google listings in." },
  steps: [
    {
      title: "Connect Google",
      body: "Sign in with the Google account that owns or manages your Business Profile. You can connect more than one account.",
    },
    {
      title: "Bring your locations in",
      body: "Pick the listings to import from your connected accounts, or add a business by searching Google. Each one counts toward your plan's locations.",
    },
    {
      title: "It stays in sync",
      body: "While the account stays connected, details, services, photos, reviews and performance figures sync from Google every six hours.",
    },
    {
      title: "Work from one page",
      body: "Open a location to read its insights, turn on Profile Guard, keep its social links and work through its citation checklist.",
    },
  ],
  cards: [
    {
      icon: "chart",
      title: "Google performance, kept",
      body: "Search and Maps views on mobile and desktop, website clicks, call clicks and direction requests, by day, week or month. Your stored history keeps growing past Google's own window.",
    },
    {
      icon: "building",
      title: "Profile details at a glance",
      body: "Business name, address, phone, website, categories, hours, service areas and open status, as Google has them.",
    },
    {
      icon: "list",
      title: "Services and categories",
      body: "Every service and category on the listing, with your primary category marked and a search when the list is long.",
    },
    {
      icon: "image",
      title: "Photos and videos",
      body: "The photos you posted and the ones customers added, counted separately and synced from the listing.",
    },
    {
      icon: "clipboard",
      title: "Citation checklist",
      body: "A checklist of the main business directories, Google first. The Google row fills in from your linked listing; you mark each of the others listed, wrong or missing.",
    },
    {
      icon: "shield",
      title: "Profile Guard built in",
      body: "Each linked location has its own Profile Guard tab, so edit alerts sit right next to the listing they watch.",
    },
    {
      icon: "users",
      title: "Several Google accounts",
      body: "Connect every Google account your listings live under. Each imported listing shows which account manages it.",
    },
    {
      icon: "layers",
      title: "Bulk tools on Agency",
      body: `On the ${PLANS.agency.name} plan, sync, link, set Profile Guard and schedule posts across many client locations at once.`,
    },
  ],
  spotlight: {
    kicker: "The Sync",
    heading: { title: "What Comes Over ", em: "From\u00a0Google" },
    points: [
      "Each linked location syncs every six hours while its Google account stays connected, and you can sync one sooner.",
      "The first sync brings in about 90 days of performance figures, then back-fills older days Google still holds. From then on, every day synced stays in ConstructHUB.",
      "Google shares performance figures only for verified listings, and the newest few days are marked not final yet.",
      "If a part of the sync fails, the last good data stays and the location says what went wrong.",
    ],
    panel: {
      label: "Synced fields",
      title: "What a sync reads",
      items: [
        "Business name", "Address", "Phone", "Website", "Categories", "Services", "Hours", "Service areas",
        "Open status", "Business photos", "Customer photos", "Reviews", "Daily performance",
      ],
      note: "Reading only: a sync never edits your Google listing.",
    },
  },
  audience: [
    {
      title: "Single-location contractors",
      body: "One listing, one login: see how people find you on Google and what your profile says, without digging through Google's menus.",
    },
    {
      title: "Companies with several locations",
      body: "Every branch's listing on one page, each with its own figures, photos and Profile Guard.",
    },
    {
      title: "Agencies managing client profiles",
      body: "Connect each client's Google account, see who manages which listing, and act on many locations at once.",
    },
  ],
  pricing: {
    kind: "plan",
    allowance: LOCATIONS,
    note: `Need more locations? The ${ADDONS.extra_location.name} add-on adds one at a time on the ${EXTRA_LOCATION_PLANS} plans; the ${PLANS.agency.name} plan prices locations above its included ones.`,
  },
  faqs: [
    {
      q: "What do I need to connect?",
      a: "A Google account that owns or manages your Business Profile listing. You sign in with Google once and approve access to manage the listing. You can also add a business by searching Google, but syncing, insights and Profile Guard need the listing linked through a connected account.",
    },
    {
      q: "Which plans include it, and how many locations?",
      a: `Every plan includes it. ${allowanceLine(LOCATIONS)}. Extra locations come as an add-on on the ${EXTRA_LOCATION_PLANS} plans.`,
    },
    {
      q: "Will it change my Google listing?",
      a: "Importing and syncing only read from Google. The Locations page shows your details; you change them in Google Business Profile. Removing a location from ConstructHUB doesn't affect your Google listing.",
    },
    {
      q: "Why don't I see performance figures?",
      a: "Google shares them only for verified listings, so verify the listing in Google Business Profile first. Google also reports with a delay of a few days, so the newest days show as not final yet.",
    },
    {
      q: "Will it get me more calls or a higher ranking?",
      a: "We don't promise that. It shows the figures Google reports and keeps your listing data in one place; it doesn't change how Google ranks your business.",
    },
  ],
  related: ["profileGuard", "reviews", "gbpContent"],
  app: { href: "/locations", surface: "app", label: "Open Locations" },
  headings: {
    steps: { title: "Connected and Synced in ", em: "Four\u00a0Steps" },
    cards: { title: "What Every Location ", em: "Gives You" },
    faq: { title: "Before You ", em: "Connect" },
  },
  seo: {
    title: "Google Business Profile Management for Contractors | ConstructHUB",
    description:
      "Connect your Google Business Profile, import your locations and see details, services, photos and Google performance figures in one place, synced every six hours.",
  },
  sources: [
    "client/src/pages/locations.tsx",
    "client/src/components/agency-workspace.tsx",
    "server/gbp/routes.ts",
    "server/gbp/service.ts",
    "server/agency/jobs.ts",
    "server/routes.ts",
    "shared/plans.ts",
  ],
};

export default page;
