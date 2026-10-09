import type { FeaturePage } from "./types";
import { ADDONS, PLANS, planForModule } from "../plans";

/**
 * Agency workspace (/agency) — the Agency plan's multi-client workspace.
 *
 * Every claim below is backed by the code in `sources`:
 *   - the gate: requireModule-style workspaceEntitled / agencyPlanRequired on every /api/agency route
 *     (server/agency/routes.ts), PLANS.agency.modules.agencyWorkspace (shared/plans.ts)
 *   - client workspaces with contact email, folder, tags and notes: server/agency/routes.ts clientInput
 *   - roles owner / admin / manager / viewer, all clients or chosen clients, viewers read-only, only the owner
 *     grants access, members need a ConstructHUB login: server/agency/routes.ts PUT /team, server/agency/access.ts,
 *     client/src/pages/agency.tsx (Team tab copy)
 *   - seats on the agency workspace team (agencySeats + the Extra team seat add-on):
 *     PLANS.growth.limits.agencySeats, ADDONS.extra_seat
 *   - bulk actions (sync, link & sync, unlink, assign client, Guard mode, AI reply settings, post/photo batch,
 *     Site Scans), select a page or all matching, queued with a Jobs log: server/agency/jobs.ts bulkInput,
 *     client/src/components/agency-workspace.tsx
 *   - Guard needs an approved snapshot per location; unlink doesn't remove the listing from Google:
 *     client/src/components/agency-workspace.tsx (bulk form copy)
 *   - status counts and filters (synced, needs reconnect, not linked, Guard alerts, unanswered reviews, failed
 *     posts): client/src/components/agency-workspace.tsx, server/agency/access.ts dashboard()
 *   - CSV export of selected / matching locations: server/agency/routes.ts GET /export
 *   - email onboarding: client adds the agency email as Manager, keeps ownership, no client OAuth; invitation
 *     detected and accepted, location linked; reminders after 3 and 6 days, expiry after 30 days; optional
 *     auto-accept with unmatched invitations left unassigned: server/agency/onboarding.ts, server/agency/schema.ts,
 *     client/src/pages/agency.tsx
 *   - workspace switcher for members of several agencies: client/src/pages/agency.tsx
 *   - flat location limits: each plan includes a location count (shared/plans.ts limits.locations), and outgrowing
 *     it is a move up the ladder — since 2026-10-09 there is no per-location pricing and no location bands.
 * Numbers that live in the price book are read from it (PLANS, ADDONS), never typed.
 */

// The cheapest plan that unlocks the workspace — the Agency plan ($199, key "growth") today.
const AGENCY = PLANS[planForModule("agencyWorkspace")];

const page: FeaturePage = {
  key: "agency",
  slug: "agency",
  group: "run",
  status: "ready",
  title: "Agency workspace",
  ctaTitle: "Agency Workspace",
  kicker: "For agencies",
  headline: { lead: "All Your Clients in ", swipe: "One\u00a0Workspace" },
  lede:
    "The Agency workspace groups your clients' Google Business Profile locations by client, gives your team roles " +
    "and client-by-client access, and runs one action across many locations at once.",
  hero: { mascot: "standing", bubble: "Pick the locations. I'll queue the work." },
  steps: [
    {
      title: "Connect your agency Google account",
      body: "Connect the Google account your agency uses to manage client profiles.",
    },
    {
      title: "Onboard clients by email",
      body: "Send each client short instructions to add your agency email as a Manager on their profile. ConstructHUB spots the invitation, accepts it and links the location.",
    },
    {
      title: "Organise your clients and team",
      body: "Group locations under clients with folders and tags, and give each team member a role and the clients they work on.",
    },
    {
      title: "Act on many locations at once",
      body: "Filter, select a page or everything that matches, and queue an action. Progress and any failures show in Jobs.",
    },
  ],
  cards: [
    {
      icon: "folder",
      title: "Client workspaces",
      body: "Each client has a contact email, a folder, tags and notes, with their locations assigned to them.",
    },
    {
      icon: "users",
      title: "Roles and client access",
      body: "Owner, admin, manager and viewer. Give a team member every client or only the ones they handle; viewers can look but not change anything.",
    },
    {
      icon: "layers",
      title: "Bulk actions",
      body: "Sync, link or unlink, assign to a client, set Profile Guard's mode, set AI review replies, schedule a post or photo batch, or start Site Scans across your selection.",
    },
    {
      icon: "mail",
      title: "Email onboarding",
      body: "Instructions go to the client's contact email, with reminders after three and six days. Requests expire after 30 days, and the client keeps ownership of the profile.",
    },
    {
      icon: "filter",
      title: "See what needs attention",
      body: "Counts and filters for locations that are synced, need reconnecting or aren't linked, and for Guard alerts, unanswered reviews and failed posts.",
    },
    {
      icon: "history",
      title: "A log of every job",
      body: "Each queued action, location by location, with its status and the error when one fails.",
    },
    {
      icon: "download",
      title: "CSV export",
      body: "Export the locations you selected, or every location matching your filters, as a spreadsheet.",
    },
    {
      icon: "check",
      title: "Optional auto-accept",
      body: "Accept every location invitation sent to your connected agency Google accounts. Invitations that match no request stay unassigned, never guessed onto a client.",
    },
    {
      icon: "refresh",
      title: "Switch between workspaces",
      body: "Someone on more than one agency's team picks the workspace to open, and returns to their own account in one click.",
    },
  ],
  audience: [
    {
      title: "SEO and marketing agencies",
      body: "You manage Google Business Profiles for many contractors and need each client's locations kept apart.",
    },
    {
      title: "Agencies with account managers",
      body: "Each manager sees only their own clients, and a viewer seat can follow along without changing anything.",
    },
    {
      title: "Brands with many locations",
      body: "Group locations by region with folders and tags, and change settings across all of them in one pass.",
    },
  ],
  pricing: {
    kind: "module",
    module: "agencyWorkspace",
    allowance: { limit: "locations", unit: "client locations", period: "count" },
    note: "Outgrow the included locations or seats and you move up a plan — there is no per-location pricing.",
  },
  faqs: [
    {
      q: "What do I need to use it?",
      a: `The ${AGENCY.name} plan and a Google account that manages, or will manage, your clients' Business Profiles. Each team member needs their own ConstructHUB login.`,
    },
    {
      q: "How many locations and team seats are included?",
      a: `The ${AGENCY.name} plan includes ${AGENCY.limits.locations} client locations and ${AGENCY.limits.agencySeats} agency team seats. Outgrow either and you move up a plan — there is no per-location pricing; an extra seat on the way up is the ${ADDONS.extra_seat.name} add-on.`,
    },
    {
      q: "Do my clients have to share a password or connect anything?",
      a: "No. They add your agency email as a Manager in their Business Profile settings and keep ownership. They never sign in to ConstructHUB or connect Google to it.",
    },
    {
      q: "Does a bulk action change Google right away?",
      a: "It is queued and runs in the background; Jobs shows each location's progress and any failure. Profile Guard needs an approved snapshot for each location before it can be switched on, and each location scanned uses one Site Scan from your account's monthly allowance.",
    },
    {
      q: "What doesn't it do?",
      a: "It doesn't create or verify Business Profiles on Google, and unlinking a location only stops syncing in ConstructHUB; the listing stays on Google. The workspace is for your team: clients don't get a login to it.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"):
  // onboarding (contact email, business name + address or Place ID, the Manager instructions, ownership kept, no client
  // sign-in, invitation detected and accepted): server/agency/onboarding.ts onboardingInput, instructions, the worker; strict
  // matching (Place ID, else name AND address): onboarding.ts matchesRequest; reminders after 3 and 6 days: onboarding.ts
  // worker query; 30-day expiry: server/agency/schema.ts; auto-accept + unassigned: onboarding.ts auto_accept_all; bulk
  // actions, page or all matching, retries with growing waits, a rate limit waits an hour: server/agency/jobs.ts bulkInput,
  // the job runner; the owner's plan covers members: server/agency/access.ts workspaceEntitled; roles + client access:
  // server/agency/routes.ts PUT /team; shared seats: server/crm/tenancy.ts getOwnerSeatUsage.
  inDepth: {
    heading: { title: "Managing Client Google Profiles, ", em: "Explained" },
    paragraphs: [
      "The Agency workspace is for agencies that manage Google Business Profiles for many clients. Onboarding works " +
        "through Google's own access settings. You add a client with their contact email and the business name, with its " +
        "address or Google Place ID. ConstructHUB emails the client steps to add your agency's Google account as a " +
        "Manager on their profile; they keep ownership and never sign in to ConstructHUB. It then watches your connected " +
        "agency account for the matching invitation, accepts it and links the location to that client.",
      "Matching is strict on purpose. With a Place ID, only that exact listing matches. Without one, the business name " +
        "and the address must both match, because a name alone isn't enough for a chain with many locations. The client " +
        "gets reminders after three and six days, and the request expires after 30. With auto-accept on, every invitation " +
        "to your agency account is accepted, and one that matches no request stays unassigned rather than guessed onto a " +
        "client.",
      "Bulk actions run in the background. Select locations on a page, or everything that matches your filters, and " +
        "queue a sync, a link or unlink, a client assignment, Profile Guard's mode, AI review reply settings, a batch of " +
        "posts or photos, or Site Scans. Each location is its own job in the Jobs log. A temporary Google error is " +
        "retried a few times with growing waits, a Google rate limit waits an hour, and anything that still fails shows " +
        "its error.",
      "Team access follows the workspace owner's plan, so team members need their own ConstructHUB login but no plan of " +
        "their own. Seats are shared with your CRM team, and each person's role and client list decide what they can see " +
        "and change.",
    ],
  },
  related: ["gbp", "profileGuard", "siteScan"],
  app: { href: "/agency", surface: "app", label: "Open the Agency workspace" },
  headings: {
    steps: { title: "From First Client to Bulk Actions in ", em: "Four Steps" },
    cards: { title: "What the Workspace ", em: "Gives You" },
  },
  seo: {
    title: "Google Business Profile Manager for Agencies | ConstructHUB",
    description:
      "Manage clients' Google Business Profiles from one agency workspace: email onboarding, team roles with client-by-client access, and bulk actions.",
  },
  sources: [
    "client/src/pages/agency.tsx",
    "client/src/components/agency-workspace.tsx",
    "server/agency/routes.ts",
    "server/agency/access.ts",
    "server/agency/jobs.ts",
    "server/agency/onboarding.ts",
    "server/agency/schema.ts",
    "server/crm/tenancy.ts",
    "shared/plans.ts",
  ],
};

export default page;
