/**
 * THE help registry: one entry per feature (and per major section of Cloudflare and Search Console).
 * It drives the "i" buttons (<HelpButton k="…" />, client/src/components/help-button.tsx), the
 * walkthrough-video slot beside them and the /tutorials page. server/help-registry.test.ts keeps it
 * complete (every mounted key exists, every entry has its four parts, every route is a real path).
 *
 * Every sentence was written from the code or from text the product already ships and tests
 * (server/data/hub-knowledge.md, shared/feature-pages, client/src/lib/info-content.ts). Plan names
 * come from the price book (shared/plans.ts), never typed here. `video` is never typed here either:
 * it is built from the manifest of recorded walkthroughs (./videos/<key>.json, written by
 * scripts/tutorials/upload.ts — docs/tutorials/VIDEO-PIPELINE.md), and is null for every entry that
 * has no recording.
 */
import { YOUTUBE_HOLDS } from "./holds";
import { MODULE_NAMES, PLANS, PLAN_KEYS, planForModule, type ModuleKey } from "../plans";
import { CALL_ASSISTANT_SEPARATE_LINE, COMPETITOR_INTEL_PLANS, PROTECTED_SITE_PLANS, callAssistantAvailabilityLine } from "../plan-copy";
import type { HelpDraft, HelpEntry, HelpGroup } from "./types";
import * as moreEntries from "./entries/index";
import { helpVideoFor } from "./videos";
import { EXTERNAL_FEATURE_PAGES, FEATURE_PAGES } from "../feature-pages";
import { INTRO_VIDEO_PREFIX, introVideoKey } from "../feature-pages/intro-video";

export { HELP_GROUPS } from "./types";
export type { HelpEntry, HelpGroup, HelpVideo, HelpVideoSource } from "./types";

const planOf = (module: ModuleKey) => PLANS[planForModule(module)].name;
/** "The <plan> plan, which includes the “<module>” module." — both names read from the plan model. */
const moduleNeed = (module: ModuleKey) => `The ${planOf(module)} plan, which includes the “${MODULE_NAMES[module]}” module.`;
const EDGE = moduleNeed("cloudflareSearchConsole");
const IDENTITY = "Sensitive buttons ask you to confirm it’s you first (password, authenticator code or an emailed code).";
const PROTECTED = `Included with the ${PROTECTED_SITE_PLANS} plans; the number of protected websites depends on the plan.`;
/**
 * The SEO tools: the cheapest plan whose allowances include them (shared/plans.ts
 * SEO_PLAN_LIMITS — a keyword allowance of 0 means none), named from the plan
 * model. Accounts that had the tools before the change keep them (server/billing/pricing-terms.ts).
 */
const SEO_TOOLS_PLAN = PLANS[PLAN_KEYS.find((k) => PLANS[k].limits.seoKeywords !== 0) ?? PLAN_KEYS[PLAN_KEYS.length - 1]].name;
const SEO_NEED = `The ${SEO_TOOLS_PLAN} plan. Accounts that already have the SEO tools keep them.`;

/** The CRM is a separate product (shared/crm-plans.ts): its pages need a CRM plan, not a platform plan. */
export const CRM_NEED = "A ConstructHub CRM plan — the CRM is a separate product with its own plans.";

type Draft = HelpDraft;
const entries: Draft[] = [
  /* ══ Tools → Cloudflare ═══════════════════════════════════════════════════════════════════════ */
  {
    key: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare protection",
    whatItIs: "A control panel for the websites you or your clients keep behind Cloudflare — the service that sits in front of a website and filters its traffic.",
    whatItDoes: "It connects Cloudflare accounts, lists their websites (Cloudflare calls each one a zone), pulls the last day of traffic and security numbers, and lets you preview and apply blocking rules. Nothing is blocked until you read a preview and confirm it, and every applied change has an undo.",
    howToUse: [
      "Open Connections and connect a Cloudflare account.",
      "Wait for its websites to appear under Sites. The first import is queued for you; Work queue shows it finishing.",
      "Tick sites and choose Sync selected to pull traffic and security data, then click a site’s name to read it.",
      "To block bad traffic, tick sites, fill in “Preview edge protection”, choose Preview rules, read the exact rules, then Confirm and queue edge changes.",
      "Check Work queue until the job is done. Edge audit keeps the record and the Undo button.",
    ],
    howItWorks: "Every button that talks to Cloudflare adds a job to a queue; a background worker runs the jobs one at a time and saves the result. ConstructHUB keeps a limited Cloudflare key, stored encrypted — never your Global API Key. If the worker is switched off, the page shows a warning and jobs wait.",
    needs: [EDGE, "A Cloudflare account with the website added to it. The Guide tab explains how to put a site behind Cloudflare.", IDENTITY],
  },
  {
    key: "cloudflare.sites", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Sites",
    whatItIs: "The websites (zones) found in your connected Cloudflare accounts, one card each.",
    whatItDoes: "A summary strip counts the sites that match your search and filter, how many are synced, how many are not, and how many of your Locations are linked to them. Under it, one card per site shows its status at Cloudflare (active or pending), its zone ID, when it was last synced, how many of your Locations use that website, and whether the last job failed, with its message. Open, or the site’s name, shows its daily traffic, firewall events, top paths, countries, bot share and flagged IP addresses. Until a site exists, two made-up sample cards show what the list will look like.",
    howToUse: [
      "Search by name or filter by status to find a site; the summary strip follows the search.",
      "Tick sites and choose “Sync selected”, or “Sync all matching sites” for everything the search and filter match. Each card also has its own Sync button.",
      "Open Work queue to watch the sync finish.",
      "Choose Open, or the site’s name, to read what came back.",
    ],
    howItWorks: "Sync adds one job per site; a site that already has a sync waiting is not queued twice. The worker asks Cloudflare’s analytics for the last 24 hours: daily requests, page views, unique visitors and threats (counted in UTC days), the latest 100 firewall events, the top 20 paths, and bot scores when the Cloudflare plan provides them. Anything Cloudflare doesn’t return is shown as unavailable. A site is linked to a Location when its domain matches the Location’s website exactly. The summary counts come from the server over every site that matches, not only the page shown. The sample cards are fixed text, shown only while the list is empty and never saved. The list refreshes itself every 15 seconds.",
    needs: [EDGE, "At least one connection under Connections."],
  },
  {
    key: "cloudflare.protection", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Preview edge protection",
    whatItIs: "Where you build blocking rules for the sites you ticked and see them before they exist. “Edge” means Cloudflare’s servers in front of the website.",
    whatItDoes: "Builds one of three rule packs and shows the exact rules. Ads door protects one exact page path your ads point to (such as /ads): it blocks visits with no browser signature, visits without a Google Ads click ID and requests that are not a normal page load, blocks verified bots other than Google’s, and limits each visitor address to 10 requests in 10 seconds on that path. Site-wide bad user agents blocks visitors with no browser signature or the signature of two known attack tools, and limits each address to 120 requests in 10 seconds. Flagged IPs blocks the 1 to 100 addresses you list. Office IP addresses you enter are exempt from every rule in the pack.",
    howToUse: [
      "On Sites, tick the zones the rules are for.",
      "Pick the rule pack. For Ads door enter the exact ads path; for Flagged IPs enter the addresses, or open a site and use “Add to preview” next to a flagged IP.",
      "Enter your office IP addresses as exemptions so you don’t block yourself.",
      "Choose Preview rules and read every rule under “Review before applying”.",
      "Choose “Confirm and queue edge changes” (you’ll be asked to confirm it’s you), or Cancel preview to drop it.",
    ],
    howItWorks: "Preview only saves a draft in ConstructHUB, together with the site’s last synced numbers as a “before” snapshot. Nothing is sent to Cloudflare. A preview can be confirmed for one hour. Confirming queues a job; the worker then adds the rules to the zone’s firewall and rate-limit rules, each tagged so ConstructHUB can later find and remove exactly those rules. The pack does not change Cloudflare’s security level. The flagged IPs listed for a site come from Click Guard’s blocked IPs and VPN Shield’s logged visits for that domain.",
    needs: [EDGE, "Rate-limit rules depend on your Cloudflare plan — the preview says so.", "Rules affect real visitors; only traffic that passes through Cloudflare is covered.", IDENTITY],
  },
  {
    key: "cloudflare.connections", parent: "cloudflare", group: "Tools", route: "/cloudflare/connections", title: "Cloudflare → Connections",
    whatItIs: "Where you give ConstructHUB access to a Cloudflare account, see the accounts already connected, and remove them.",
    whatItDoes: "There are three ways in. Recommended: “Connect with Cloudflare” — you sign in at Cloudflare, tick the account with your websites, and choose Authorize; ConstructHUB gets full access to that account (zones, DNS, analytics, firewall, cache, SSL, hosting) that you can revoke in Cloudflare under Manage OAuth authorizations. Fallback: enter your Cloudflare login email and Global API Key (Cloudflare’s master key). ConstructHUB checks them with Cloudflare, lists your accounts and zones, and you tick the zones to share; “Create limited key” then has Cloudflare make a new key named “ConstructHUB (date)” that can do only three things on the zones you ticked: Zone Read, Analytics Read and Zone WAF Edit (WAF is Cloudflare’s firewall rules). Fallback: paste a limited token you created yourself in Cloudflare. Agency membership: a path for ConstructHUB’s own agency account only — on any other account the button answers that it is not configured.",
    howToUse: [
      "Choose “Connect with Cloudflare”, sign in at Cloudflare, tick the account to share and choose Authorize. You are brought back here and the sites import on their own.",
      "Fallback with a key: in Cloudflare open My Profile → API Tokens → Global API Key → View, copy the key, then under “Other ways to connect” enter your Cloudflare login email and the key and choose “Verify and choose zones”. Confirm it’s you when asked.",
      "Tick the zones to share and choose “Create limited key”.",
      "The connection appears in the list and its sites are imported for you. “Discover sites” imports them again later.",
      "“Disconnect” removes a connection.",
    ],
    howItWorks: "The Global API Key travels with the verify request and the create request and is used only for them: to confirm the email matches the Cloudflare user, to list zones, and to create the limited key. It is never saved; the server wipes it from each request and the form clears it once the limited key exists. The limited key is stored encrypted. A pasted token is checked with Cloudflare (it must be active and able to list zones) before it is saved; ConstructHUB cannot read what it is allowed to do, so the list says to verify its permissions in Cloudflare. Disconnect deletes the saved key and cached data here and, for a key ConstructHUB created, asks Cloudflare to delete it. Rules already applied stay in Cloudflare until you undo them or remove them there. Connecting and disconnecting are written to your account activity and send a notification.",
    needs: [EDGE, "A Cloudflare login (the sign-in button), or the Cloudflare login email and Global API Key, or a token with Zone Read, Analytics Read and Zone WAF Edit on the chosen zones.", IDENTITY],
  },
  {
    key: "cloudflare.onboarding", parent: "cloudflare", group: "Tools", route: "/cloudflare/onboarding", title: "Cloudflare → Onboarding",
    whatItIs: "A way to email a client the steps for giving the agency’s Cloudflare login access to their account as a member.",
    whatItDoes: "You pick a connection, list clients one per line (email, location ID, Cloudflare account ID) and send. Each client is emailed the steps: in Cloudflare open Manage Account → Members and invite the agency email with the Domain Administrator role for their site. The email says plainly that this role gives full access to that domain, including DNS. The Invitations list shows each one as pending or accepted.",
    howToUse: [
      "Under Connections, select the connection to use (the round button beside it).",
      "In Onboarding, find the client’s location ID in the Locations list. The location needs a website.",
      "Enter one client per line: email, location ID, Cloudflare account ID.",
      "Choose “Send onboarding emails”.",
      "Watch the Invitations list change from pending to accepted.",
    ],
    howItWorks: "Sending queues one email job per client, up to 100 clients at a time. Cloudflare onboarding works only on the account ConstructHUB’s operator has set up as the agency owner, with an agency email; on any other account the request is refused with a message saying so, and the Global Key or pasted-token route under Connections is the way to connect. When the agency connection is on, the worker looks for pending membership invitations at Cloudflare, accepts only those whose account ID matches an invitation you sent, imports that account’s zones, and emails the client that access was accepted.",
    needs: [EDGE, "The agency membership connection, which only ConstructHUB’s operator can configure.", "A Location with a website for each client."],
  },
  {
    key: "cloudflare.work-queue", parent: "cloudflare", group: "Tools", route: "/cloudflare/work-queue", title: "Cloudflare → Work queue",
    whatItIs: "The list of background jobs for your Cloudflare connections — the “is it done yet?” screen.",
    whatItDoes: "Shows every job with its number, kind (discover, sync, apply, undo, memberships, invite), state (queued, running, done, failed or uncertain) and its error message, if any. You can search and filter by state.",
    howToUse: [
      "After any Sync, Discover, Confirm or Undo, open Work queue.",
      "Filter by state to find what is still queued or what failed.",
      "For a failed job, read the message, fix the cause (for example reconnect the account) and run the action again.",
      "For an uncertain job, look in Cloudflare before repeating it: the change may or may not have gone through.",
    ],
    howItWorks: "A worker on the server picks up one job at a time, about once a second, oldest first. Jobs that only read (discover, sync) are retried up to five times with growing waits unless Cloudflare refused access; if Cloudflare says its quota is used up, the retry waits an hour. Jobs that change something (apply, undo, emails) are never replayed automatically: if they fail, or the worker is interrupted for 15 minutes, they are marked uncertain. Each account can start up to 500 of each kind of action per hour, and requests to Cloudflare are spaced out across the platform. If your plan stops including this module, waiting jobs are closed with a note instead of run. The list refreshes itself every 15 seconds.",
    needs: [EDGE],
  },
  {
    key: "cloudflare.edge-audit", parent: "cloudflare", group: "Tools", route: "/cloudflare/edge-audit", title: "Cloudflare → Edge audit",
    whatItIs: "The record of every protection change: each preview you made and what happened to it.",
    whatItDoes: "For each change it shows the zone, the rule pack, the state (preview, queued, applied, reverted or uncertain), the time, when the “before” and the latest snapshots were taken, and how many blocked requests were in the sampled recent firewall events before and now. Applied and uncertain changes have an “Undo ConstructHUB rules” button.",
    howToUse: [
      "Open Edge audit after confirming a preview.",
      "Filter by state to find what is applied.",
      "Sync the site again after applying, so the latest numbers are fresh.",
      "To take rules off, choose “Undo ConstructHUB rules”, confirm it’s you, and watch Work queue until the state reads reverted.",
    ],
    howItWorks: "Undo queues a job that deletes only the rules ConstructHUB created for that change — it finds them by the tag it put on them — and then marks the change reverted. Other rules in Cloudflare are not touched. The block counts come from a sample of the most recent 100 events, so they show a direction, not proof that the rules caused it. Applied and reverted changes are written to your account activity and send a notification.",
    needs: [EDGE, IDENTITY],
  },
  {
    key: "cloudflare.guide", parent: "cloudflare", group: "Tools", route: "/cloudflare/guide", title: "Cloudflare → Guide",
    whatItIs: "Written step-by-step instructions, inside the page.",
    whatItDoes: "Covers putting a client site behind Cloudflare (adding the domain, checking DNS records, changing nameservers at GoDaddy, Namecheap, Squarespace and Bluehost), the three ways to connect Cloudflare to ConstructHUB, what Disconnect does, the cautions about blocking rules, and connecting Google Search Console.",
    howToUse: [
      "Open the Guide tab.",
      "If the site is not on Cloudflare yet, follow “Put a client site behind Cloudflare” first.",
      "Then follow “Connect Cloudflare to ConstructHUB”.",
      "The links at the bottom of each card open Cloudflare’s and Google’s own instructions.",
    ],
    howItWorks: "The guide is fixed text. It does not read or change anything in your account. The same guide is under Social Media → Guides.",
  },

  /* ══ Tools → Search Console ═══════════════════════════════════════════════════════════════════ */
  {
    key: "search-console", group: "Tools", route: "/search-console", title: "Google Search Console",
    whatItIs: "Search Console is Google’s own report of how a website shows up in Google Search. This page brings the websites (Google calls them properties) your Google account can see into ConstructHUB.",
    whatItDoes: "It connects a Google account, finds its properties automatically, downloads search results data (clicks, impressions, click rate and average position) for a date range up to 16 months back, lists each property’s sitemaps, and checks whether specific pages are in Google’s index. It never asks Google to index a page.",
    howToUse: [
      "Open Connections, choose “Connect Google Search Console”, sign in to Google and allow access.",
      "Wait for the properties to appear under Sites. The first import is queued for you.",
      "Optionally set “Sync from” and “Sync through”, tick properties and choose Sync selected.",
      "Click a property’s name to read its search analytics, sitemaps and index checks.",
      "To check pages or submit sitemaps, use the bulk box at the bottom of Sites.",
    ],
    howItWorks: "Buttons add jobs to a queue and a background worker runs them one at a time, so results arrive a little later — Work queue shows progress. What you read on this page is ConstructHUB’s saved copy of Google’s data. The Google access for Search Console is stored encrypted and kept separate from your Google Business Profile and Calendar connections.",
    needs: [EDGE, "A Google account that can see the property in Search Console.", IDENTITY],
  },
  {
    key: "search-console.sites", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Sites",
    whatItIs: "The websites (Google calls them properties) found in your connected Google accounts, one card each.",
    whatItDoes: "A summary strip counts the properties that match your search and filter, how many are synced, how many are not, and how many of your Locations are linked to them. Under it, one card per property shows your access level at Google (Owner, Full, Restricted, Unverified, or “Access removed” when Google no longer lists it), the property ID the bulk box asks for, when it was last synced, how many of your Locations use that website, and whether the last job failed, with its message. Open, or the property’s name, shows its search analytics, sitemaps and index checks. Until a property exists, two made-up sample cards show what the list will look like.",
    howToUse: [
      "Search by name or filter by access level; the summary strip follows the search.",
      "Tick properties and choose “Sync selected”, or “Sync all matching sites”. Each card also has its own Sync button.",
      "Open Work queue to watch the downloads finish.",
      "Choose Open, or the property’s name, to read the data.",
    ],
    howItWorks: "Properties are found automatically: once when you connect, then about every hour. One that disappears from Google’s list is marked “Access removed” instead of deleted. A property is linked to a Location when its domain matches the Location’s website. Sync adds one job per property, and a property that already has a sync waiting is not queued twice. The summary counts come from the server over every property that matches, not only the page shown. The sample cards are fixed text, shown only while the list is empty and never saved. The list refreshes itself every 15 seconds.",
    needs: [EDGE, "At least one Google account under Connections."],
  },
  {
    key: "search-console.sync-range", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Sync date range",
    whatItIs: "The folded “Import date range” line above the list: how far back the next Sync downloads search data.",
    whatItDoes: "The folded line says what the next Sync will download. Opened, it offers quick picks — the last 31 days (the default), 3, 6, 12 or 16 months — and two date boxes for any other range. The first day can be up to 16 months ago; the last day cannot be in the future. Leave both empty and Sync downloads the last 31 days up to three days ago.",
    howToUse: [
      "Open “Import date range” above the list.",
      "Choose a quick pick, or type “Sync from” (any day within the last 16 months) and, if you want, “Sync through”. A quick pick sets the first day only; the last day stays three days ago.",
      "Choose Sync selected, Sync all matching sites, or a card’s own Sync.",
      "Watch Work queue: a long range becomes many small jobs.",
    ],
    howItWorks: "The server refuses a first day older than 16 months or later than the last day, and a last day in the future. The worker cuts the range into 28-day pieces and, for each piece, queues one download per breakdown (date, query, page, device, country). Each download asks Google for finalised web-search data, 25,000 rows at a time, and replaces what was stored for those days.",
    needs: [EDGE],
  },
  {
    key: "search-console.analytics", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Search analytics",
    whatItIs: "The search results table for one property: how often it was shown and clicked in Google Search.",
    whatItDoes: "Shows clicks, impressions (times shown), CTR (clicks divided by impressions) and average position, broken down by date, query (the words searched), page, device or country, grouped by day, week or month, for the dates you pick. It opens on the last 31 days.",
    howToUse: [
      "On Sites, click a property’s name.",
      "Choose the Breakdown, the Group and the From and To dates.",
      "Use the search box to filter rows; results come 25 to a page.",
      "If the table is empty, run a Sync that covers those dates and check Work queue.",
    ],
    howItWorks: "The table reads the copy saved by Sync; opening it sends nothing to Google. When rows are grouped, CTR and position are weighted by impressions. Google returns only its top rows, leaves out some rare searches for privacy, and reports with a delay, so totals can be lower than the real ones. Jobs still running or failed leave gaps.",
    needs: [EDGE, "A finished Sync for the property."],
  },
  {
    key: "search-console.sitemaps-indexing", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Sitemaps and index checks",
    whatItIs: "Sitemaps (the file that lists a site’s pages for Google) and index checks (asking Google whether one page is in its index).",
    whatItDoes: "Lists the sitemaps Google knows for a property, with the last submitted date and error count. Submits sitemap addresses to Google after you confirm. Queues index checks for the pages you list and shows each result — Google’s coverage state, its verdict (PASS, FAIL or NEUTRAL) and when it was checked — plus a count of checked pages by verdict.",
    howToUse: [
      "On Sites, note the property’s ID (each row shows “ID” and a number).",
      "In “Bulk sitemap submission or inspection”, enter one line per address: property ID, a comma, then the full URL.",
      "Choose “Queue inspections” to check pages, or “Review and submit sitemaps” and confirm.",
      "Watch Work queue, then click the property’s name to see the Sitemaps and Inspections lists. The sitemap list is refreshed by Sync.",
    ],
    howItWorks: "Each address must belong to its property or the whole request is refused; one submission takes up to 100 lines. Submitting a sitemap needs Owner or Full access to the property. Index checks are limited to 1,900 a day and 500 a minute per property, shared by everyone connected to it. A check only reads Google’s status — it does not request indexing — and the coverage count covers only the pages you checked, not Google’s full report.",
    needs: [EDGE, "Owner or Full access in Search Console to submit sitemaps."],
  },
  {
    key: "search-console.connections", parent: "search-console", group: "Tools", route: "/search-console/connections", title: "Search Console → Connections",
    whatItIs: "Where you connect a Google account for Search Console, see the connected accounts, and remove them.",
    whatItDoes: "“Connect Google Search Console” sends you to Google’s sign-in. Google asks for your email identity and the Search Console permission only — not Business Profile, Ads or Calendar. After you allow it the account appears in the list and its properties are imported for you.",
    howToUse: [
      "Choose “Connect Google Search Console” and confirm it’s you when asked.",
      "Pick the Google account and allow Search Console access.",
      "You come back to this page with the account in the Connections list.",
      "“Discover sites” imports its properties again; “Disconnect” removes the account.",
    ],
    howItWorks: "The sign-in must be finished within 10 minutes. If consent is refused, or the Search Console permission is not granted, you come back to a “Google consent failed” notice and nothing is saved. Google’s access is stored encrypted and renewed automatically; if Google stops accepting it, jobs fail with “Reconnect Search Console”. Disconnect deletes ConstructHUB’s saved access and cached Search Console data only. Removing ConstructHUB in your Google Account can also remove its other Google permissions. Connecting and disconnecting are written to your account activity and send a notification.",
    needs: [EDGE, "A Google account with a verified email.", IDENTITY],
  },
  {
    key: "search-console.onboarding", parent: "search-console", group: "Tools", route: "/search-console/onboarding", title: "Search Console → Onboarding",
    whatItIs: "A way to email a client the steps for adding your Google account as a user on their Search Console property.",
    whatItDoes: "You pick a connection, list clients one per line (email, location ID) and send. Each client is emailed the steps: in Search Console open Settings → Users and permissions → Add user, enter the connected Google email and choose Full. The Invitations list shows each one as pending or accepted.",
    howToUse: [
      "Under Connections, select the Google account to use (the round button beside it).",
      "In Onboarding, find the client’s location ID in the Locations list. The location needs a website.",
      "Enter one client per line: email, location ID.",
      "Choose “Send onboarding emails”.",
      "Watch the Invitations list change from pending to accepted.",
    ],
    howItWorks: "Sending queues one email job per client, up to 100 clients at a time. The client’s domain is taken from the Location’s website. Each time properties are re-checked (about hourly), an invitation is marked accepted once the property for that domain shows up with Owner or Full access, and the client is emailed a confirmation.",
    needs: [EDGE, "A connected Google account, and a Location with a website for each client."],
  },
  {
    key: "search-console.work-queue", parent: "search-console", group: "Tools", route: "/search-console/work-queue", title: "Search Console → Work queue",
    whatItIs: "The list of background jobs for your Search Console connections.",
    whatItDoes: "Shows every job with its number, kind (discover, sync, analytics, inspect, sitemap, invite), state (queued, running, done, failed or uncertain) and its error message, if any. You can search and filter by state.",
    howToUse: [
      "After any Sync, Discover, inspection or sitemap submission, open Work queue.",
      "Filter by state to find what is still queued or what failed.",
      "For a failed job, read the message, fix the cause (for example reconnect Google) and run the action again.",
      "For an uncertain sitemap job, check Search Console before submitting again.",
    ],
    howItWorks: "A worker on the server picks up one job at a time, about once a second, oldest first. Jobs that only read (discover, sync, analytics, inspect) are retried up to five times with growing waits unless Google refused access; when Google says a quota is used up, the retry waits an hour. Sitemap submissions and emails are never replayed automatically: if they fail they are marked uncertain. Each account can start up to 500 of each kind of action per hour, and requests to Google are spaced out across the platform. If your plan stops including this module, waiting jobs are closed with a note instead of run.",
    needs: [EDGE],
  },
  {
    key: "search-console.guide", parent: "search-console", group: "Tools", route: "/search-console/guide", title: "Search Console → Guide",
    whatItIs: "Written step-by-step instructions, inside the page.",
    whatItDoes: "The “Connect Google Search Console” card walks through connecting the agency’s Google account, onboarding a client, syncing up to 16 months of history, and sitemaps and index checks. The cards above it cover Cloudflare.",
    howToUse: [
      "Open the Guide tab.",
      "Scroll to “Connect Google Search Console” and follow the numbered steps.",
      "The link at the bottom opens Google’s page about Search Console limits.",
    ],
    howItWorks: "The guide is fixed text. It does not read or change anything in your account. The same guide is under Social Media → Guides.",
  },

  /* ══ Permits & Databases ══════════════════════════════════════════════════════════════════════ */
  {
    key: "search-permits", group: "Permits & Databases", route: "/search", title: "Search Permits",
    whatItIs: "Find building permits by typing an address, a name, a company, a license number or a permit number: ConstructHUB searches the real city and county permit portals in the area you pick.",
    whatItDoes: "You choose what you are searching by, type the value, pick a state and (if you want) one county or city, and press Search. Any matches already saved from earlier searches in that area show at once; then every searchable portal in the area is searched live and the page shows each portal’s progress and adds what it finds. Each result is one permit as the portal lists it: the address, permit number, type, status, issue date and which portal it came from, plus contacts and details when the portal gives them. You can narrow results by status, date, county and jurisdiction, open a result’s details, and jump to the county’s property office with Property lookup. The search is saved to Search history.",
    howToUse: [
      "Open Search permits. The map and the count show the portals the live search can query; a dot on the map fills in that place as your search area.",
      "Pick what you are searching by: Address, Keyword, Name, Company name, License # or Permit #.",
      "Type the value, choose a state and optionally a county or city, and press Search.",
      "Watch the portal list fill in: a tick means the portal was searched, a red mark means it could not be, and you can open the reason.",
      "Narrow the results with the status, date and jurisdiction filters, open View details on a permit, or load older stored matches.",
    ],
    howItWorks: "A portal can be searched live only when its official link has been checked and ConstructHUB has a search adapter for its platform; the counts and the map show exactly those. Each portal is searched for up to 75 seconds and a failure is named, so an empty list never means no permit exists. Only a live search counts toward your plan’s monthly permit searches; showing saved results is free, and when nothing in the area can be searched live and nothing is saved, nothing runs and nothing is counted. Every permit shown came from a portal; ConstructHUB never invents permit data.",
    needs: ["Any plan; live searches count toward the plan’s monthly permit searches."],
  },
  {
    key: "database-directory", group: "Permits & Databases", route: "/databases", title: "Database Directory",
    whatItIs: "The list of every county and city in the US, with the official permit portal for each one where ConstructHUB has a checked link.",
    whatItDoes: "Shows the number of jurisdictions, counties and cities on file and how many have a permit portal on record. Each row names the place, its county, and what is known about its portal: “Verified portal” (the link was opened and checked), “Official site · unconfirmed” (a source-listed link the automatic check could not confirm, with the date it was last tried), “Permits issued by <county>” (an official page says the county issues that town’s permits, with a link to that page) or “No portal on record”. Rows with a portal get Open portal and Search portal pills and list the fields the portal can search; rows without one get a “Find permit portal” web search instead of a guessed link. An “Alerts supported” badge marks portals that Permit alerts can watch, and Scrape runs a one-off live search of a portal that supports it.",
    howToUse: [
      "Open Database directory and choose All, Counties or Cities.",
      "Type a city, county or state in the search box, or pick a state and then a county.",
      "Open the row’s portal link, or use “Find permit portal” when there is none.",
      "Use Property records on a row to open the county’s property office, or Scrape to run one live search on a supported portal.",
    ],
    howItWorks: "Portal links come from the permit-portal pipeline: a candidate link is stored only after it answered live and its page is about permits; the link checker marks links that die, and a link it cannot confirm stays listed as unconfirmed with its last check date. Where a town has no portal of its own, the county routing comes from an official page that says so. Nothing in the directory is generated or guessed; an unknown portal is shown as unknown.",
    needs: ["Free to browse."],
  },
  {
    key: "property-records", group: "Permits & Databases", route: "/property", title: "Property Records",
    whatItIs: "A finder for the county assessor or property appraiser office that holds a property’s ownership, value and tax records.",
    whatItDoes: "Shows a county map shaded by what is on record for each county, and a list of offices you can filter by state and county or search by name. Each office row shows its name, county and address when one is on record, and pills for what ConstructHUB can honestly offer: Open portal and Search records when the office’s official site is on record, “Open unconfirmed site” when the link is listed but could not be auto-checked, a “Find property records” web search when no usable link is on record, and Call when a phone number is. Clicking a county on the map shows that county’s office and can filter the list to it.",
    howToUse: [
      "Open Property records (a county link from Search permits or the Database directory lands here already filtered).",
      "Pick a state and a county, or type an office, county or state in the search box; or click a county on the map.",
      "Open the office’s site from its row and look the property up there.",
    ],
    howItWorks: "The office list comes from NETR Online’s directory of assessor and appraiser offices, kept in ConstructHUB’s reference data. Each office link is checked; a link that could not be confirmed is marked and the row offers a web search instead of pretending. A link that leads to a bot-check page is treated as unconfirmed. ConstructHUB links to the county’s own site; it does not copy or store the county’s property data.",
    needs: [moduleNeed("propertyRecords")],
  },
  {
    key: "search-history", group: "Permits & Databases", route: "/history", title: "Search History",
    whatItIs: "The list of permit searches you have run, so you can run one again without retyping it.",
    whatItDoes: "Lists your latest 50 searches, newest first: what you searched for, the search type (address, name, company, license or permit number) and when you ran it. “Search again” opens Search permits with the same type, value and county filled in. The X on a row deletes that search; “Clear all” deletes your whole history after you confirm.",
    howToUse: [
      "Open Search history.",
      "Choose “Search again” on a row to reopen that search on Search permits, then press Search there.",
      "Delete a search with the X on its row, or use “Clear all” to delete every one.",
    ],
    howItWorks: "A search is saved the moment Search permits runs it live. “Search again” only fills the form in; running it is a new live search and counts toward your plan’s monthly permit searches. Deleting a search also removes the results that were saved with it.",
  },
  {
    key: "scrape-schedules", group: "Permits & Databases", route: "/schedules", title: "Scrape Schedules",
    whatItIs: "Repeating permit searches that keep the shared permit cache fresh on portals that support live search. For administrators only.",
    whatItDoes: "Lists every schedule: the portal, whether it is active or paused, how often it runs (daily, weekly or monthly), what it searches for (an address, a name, a company, a license number or a permit number) and when it last ran. “Add schedule” creates one; the switch on a row pauses or resumes it; the bin deletes it after you confirm.",
    howToUse: [
      "Open Scrape schedules (administrators only).",
      "Choose “Add schedule”, pick one of the live-searchable portals, the search type, the frequency, and type the value to search for.",
      "Pause or resume a schedule with its switch, or delete it with the bin.",
    ],
    howItWorks: "Every 15 minutes the server runs each active schedule that is due, searching its portal once and saving what it finds into the shared permit cache (the same stored matches Search permits shows first); “Last run” is written only after a search really ran. A schedule can only target a portal with a checked link and a search adapter for its platform, which is why the portal list is short. Accounts without administrator access see a message instead of the list.",
    needs: ["Administrator access."],
  },
  {
    key: "permit-alerts", group: "Permits & Databases", route: "/permit-alerts", title: "Permit Alerts",
    whatItIs: "Watches that tell you when a new permit you care about is filed: at an address, on a parcel, by a contractor, or for your trades in an area.",
    whatItDoes: "A watch names what to look for and which cities or counties to check. “Trades in an area” takes the trades you pick (roofing, HVAC, electrical, plumbing, solar and more), extra keywords of your own, and an optional centre address with a radius in miles. Each watch row shows its jurisdictions, how many of them can be checked today, how you are notified, when it was last checked, the last match and how many permits have matched. Matches opens the list of permits that matched, each with its permit number, type, status, address, contractor, date and the portal link. Check now asks for an extra check, Pause stops a watch without losing its history, and Delete removes the watch and its matches.",
    howToUse: [
      "Open Permit alerts and choose New watch.",
      "Pick what to watch: an address, a parcel, a contractor (name and optional license number), or trades in an area.",
      "Search the directory for the cities or counties to check and add them; each one says whether alerts are supported there yet.",
      "Tick how you want to hear about matches (email, text or Telegram) and save the watch.",
      "Open Matches on a watch to see what it found, or Check now to ask for a check on the next run.",
    ],
    howItWorks: "Alerts work on portals whose platform can list permits by date; the directory marks those “Alerts supported”, and a jurisdiction that is not supported yet stays on your watch and starts working the day it is. Every hour the server reads the new permits from each watched portal (only portals with an active watch are read) and matches them against your watches; a portal that cannot be reached is backed off and the row says so. Each match is kept and sent once by the channels you chose. Text alerts use your CRM texting allowance; Telegram needs the account linked on LSA Leads. Distance matching needs a geocoder on the server; without one an area watch covers its whole jurisdictions.",
    needs: [moduleNeed("permitAlerts")],
  },

  /* ══ Google Business ══════════════════════════════════════════════════════════════════════════ */
  {
    key: "google-profile", group: "Google Business", route: "/google-profile", title: "Google Profile",
    whatItIs: "A shortcut to your business’s Google profile page inside ConstructHUB.",
    whatItDoes: "With one location it opens that location. With several it opens the Locations list to pick from. With none it opens the import from your connected Google account.",
    howToUse: [
      "Sidebar → Google Business → Google Profile.",
      "If you land on the list, click the location you want.",
      "If you have no location yet, follow the import that opens.",
    ],
    howItWorks: "The button only redirects; everything it opens lives under Locations.",
  },
  {
    key: "directories", group: "Google Business", route: "/directories", title: "Directory Sync",
    whatItIs: "Keeps your business name, address and phone the same on every directory that lists you, and shows which ones got it wrong.",
    whatItDoes: "For each location it holds one business profile (started from the linked Google listing, with your own edits kept), a card per directory page about your business with its check status, a stat row counting the profiles that are live, differ or are verified, and an activity list of every change and check. The directory catalogue below lists the directories a contractor can be listed on, with filters by category, state, trade and more.",
    howToUse: [
      "Sidebar → Google Business → Directories. Your only location is chosen for you; with several, pick one.",
      "Check the business profile and save it — every directory page is compared against it.",
      "Add the address of an existing directory page about your business, then Re-check it and open the comparison to see what differs.",
      "Fix the details on the directory itself, re-check, and watch the Verified count rise.",
      "Browse the directory catalogue to find more directories for your trade and state.",
    ],
    howItWorks: "A check loads the directory page and reads the business details it publishes. A card is Live when the page is confirmed to be your business and the required details match, Details differ when a detail does not, and Verified counts live cards with matching details. ConstructHUB does not create or edit directory listings.",
    needs: ["A business location in ConstructHUB."],
  },
  {
    key: "locations", group: "Google Business", route: "/locations", title: "Locations",
    whatItIs: "Where each business lives — yours, or your clients’ if you are an agency.",
    whatItDoes: "Linking a location to its Google Business Profile listing syncs its reviews, photos, services and Google performance numbers, and unlocks Profile Watch, AI replies and Posts & Photos. A location’s page has Insights, Profile Watch, Location Info, Services, Photos & Videos, Social Profiles, Settings and Citations.",
    howToUse: [
      "Sidebar → Google Business → Locations → Connect Google Business Profile, and sign in with the Google account that is an Owner or Manager of the listing.",
      "Choose Add Location(s): “Import from GBP” lists the listings in your connected Google accounts; “Search Google” finds one by name, address or Maps link.",
      "Open a location to see its tabs. “Sync now” refreshes it immediately.",
      "Unlink stops syncing; Delete Location removes ConstructHUB’s copy. Neither changes the listing on Google.",
    ],
    howItWorks: "Linked locations sync about every six hours while connected. If a Google login’s access expires, the location shows “Reconnect Google account”. ConstructHUB does not create or verify Google listings.",
    needs: ["Any plan; how many locations you can add depends on the plan.", "A Google account that owns or manages the listing."],
  },
  {
    key: "profile-guard", group: "Google Business", route: "/locations", title: "Profile Watch",
    whatItIs: "A watch on a linked Google listing for changes to the fields you choose.",
    whatItDoes: "Compares Google’s live values with a snapshot you approved and alerts you to differences. Modes: Off, Notify (alert only) and Lockdown (puts your approved values back after a change is detected).",
    howToUse: [
      "Locations → open a linked location → Profile Watch.",
      "Choose the watched fields, click “Preview current Google values” and check the proposed snapshot carefully.",
      "Pick a mode, confirm it’s you, and click “Approve snapshot and save settings”.",
      "Later, use “Check now”, and Approve or Reject under “Pending changes and history”.",
    ],
    howItWorks: "Nobody can block edits at Google. Lockdown corrects a change after it is detected, and Google may take time to publish the correction. Approve accepts Google’s new value into your snapshot; Reject restores your approved value at Google.",
    needs: ["Any paid plan.", "A location linked to its Google Business Profile."],
  },
  {
    key: "agency", group: "Google Business", route: "/agency", title: "Agency workspace",
    whatItIs: "The workspace for an agency that looks after many businesses’ Google listings: every client, location, team member and queued job in one place.",
    whatItDoes: "Six tabs. Locations lists every location in the workspace with its client and Google state, with tick boxes for bulk actions (sync, link, unlink, assign to a client, Watch mode, AI replies, post batches, Site Scans) and a CSV export. Clients keeps one record per business. Team sets who may do what and which clients each person sees. Onboarding emails a client the steps to add your agency as a Google manager and follows the request until the listing is linked. Jobs shows every queued action and how it went. Settings (owner) holds the agency name, the agency Google account and the invitation rule. Each tab has its own “i”.",
    howToUse: [
      "Sidebar → Google Business → Agency. The switcher at the top opens any workspace you belong to; your role there is shown beside it.",
      "Under Clients, add a client with its contact email; under Team, add the people who already have a ConstructHUB login and choose their role and client access.",
      "Under Onboarding, choose the client and “Email manager instructions”; the client adds your agency’s Google account as a Manager on their Business Profile and the listing links itself.",
      "On Locations, tick locations and run a bulk action; follow it under Jobs, where a failed row says why.",
    ],
    howItWorks: "Everything belongs to the workspace owner’s account and plan: members need no plan of their own, and a member given specific clients sees only those clients’ locations. The client keeps ownership of the listing and never signs in to ConstructHUB; a background worker spots the manager invitation, accepts the one that matches a request, links the listing to the client and queues the first sync. Requests expire after 30 days. Bulk actions become one job per location, run by a worker within seconds. A role that tries something it may not do gets a plain refusal. Until a tab has real data it shows a clearly marked sample of what it will look like.",
    needs: [moduleNeed("agencyWorkspace")],
  },
  {
    key: "domains", group: "Google Business", route: "/domains", title: "Domains",
    whatItIs: "One list of every client domain with its expiry date, DNS and website health, and a safe way to change DNS.",
    whatItDoes: "Connects a Porkbun or Name.com registrar account and imports its domains, or tracks domains you type in. Each domain card shows its registrar, the client it belongs to, when it expires, whether auto-renew is on, its nameservers and whether the website answers. The stat row counts the domains watched and the ones that need attention; a daily check flags a domain expiring within 60 days, auto-renew off, a website that is down or an SSL certificate expiring within 30 days. DNS and nameserver changes go through a preview you confirm before anything reaches the registrar, and an applied change can be rolled back the same way.",
    howToUse: [
      "Sidebar → Google Business → Domains. While the list is empty, “How this works” and a sample show what you will get.",
      "Connect a registrar (a Porkbun or Name.com API key) to import its domains, or type domains under “Add domains”, up to 100 at a time.",
      "Map each domain to its client: select it, pick the client location and choose “Map selected to client” — mail alerts about that domain then name the client.",
      "To change DNS, select domains, fill in the nameservers or the record, choose Preview, review the before and after under “Previews and change history”, confirm it’s you and apply.",
      "Use the “Needs attention” filter to see only domains expiring soon, with auto-renew off, a website down or an SSL certificate about to expire.",
    ],
    howItWorks: "Imports, daily checks, previews and confirmed changes are jobs for a background worker on the server. When an administrator has not turned it on, the page says so and the jobs wait in the queue, while adding, mapping and reviewing keep working. A change counts as verified once public DNS shows it. There are no transfers, purchases, renewals or deletions here, and Cloudflare-hosted zones are changed in Cloudflare. Copy website and email records before switching nameservers — a mistake can interrupt email.",
    needs: [moduleNeed("domainsMailAlerts")],
  },
  {
    key: "mail-alerts", group: "Google Business", route: "/mail-alerts", title: "Mail alerts",
    whatItIs: "One inbox for the important provider emails about your clients’ accounts, matched to the client.",
    whatItDoes: "Collects the emails you forward from Google Business Profile, Search Console, Google Ads, Cloudflare and the registrars to a private address, keeps only the recognised alerts (verification, suspension, ownership, billing, expiry, transfer and the like), grades each one critical, warning or info, and matches it to the client whose domain or business name it mentions. The stat row counts the alerts kept, unread, critical and unmapped; chips and filters narrow the inbox, and a filter list also takes a value you type.",
    howToUse: [
      "Sidebar → Google Business → Mail alerts, and copy your private forwarding address.",
      "In Gmail: Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address; finish Google’s confirmation with the code or link shown here.",
      "Create Gmail filters for the listed provider senders with “Forward it to” that address. Don’t forward your whole inbox.",
      "Open an alert to read it (that marks it read); select alerts to mark them read or map them to a client.",
    ],
    howItWorks: "Mail from a sender or with a subject the matcher does not know is ignored; a kept alert expires after 30 days. Matching a sender is not proof an email is genuine, so open the provider’s own dashboard before acting on a security or billing alert. The private address needs an inbound mail domain on the server; without it the page says what the administrator must set, and alerts already stored still show.",
    needs: [moduleNeed("domainsMailAlerts")],
  },
  {
    key: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts",
    whatItIs: "A publisher for Google Business Profile updates (posts).",
    whatItDoes: "Writes, schedules and publishes updates, events and offers to a linked location, with optional AI drafts in your style, and keeps a calendar, queue and history. A post can carry up to ten photos from your library.",
    howToUse: [
      "Sidebar → Google Business → Posts, and choose a linked location (or open the location's Posts & Updates tab).",
      "Compose the update, or generate a post draft and edit it; attach photos if you want them.",
      "Set the schedule under “Schedule and approve”: a first-publish date and time you type (blank means now), and under Advanced a cadence, your own list of times, or business hours only.",
      "Click “Approve & queue post”. Approving is what authorises publishing.",
      "Follow each item under “Calendar, queue & history”.",
    ],
    howItWorks: "Google can reject content, and strips EXIF data from uploaded photos. If a result is “uncertain”, check Google before retrying, because a retry can post twice. Unsaved drafts are lost if you reload the page.",
    needs: ["Any plan.", "A location linked to its Google Business Profile."],
  },
  {
    key: "photos", group: "Google Business", route: "/gbp-photos", title: "Photos",
    whatItIs: "A publisher for Google Business Profile photos.",
    whatItDoes: "Uploads photos into your library, captions them (by hand or with an AI draft), sets their Google category, schedules them onto a linked location and keeps the photos queue and history. Posts have their own page.",
    howToUse: [
      "Sidebar → Google Business → Photos, and choose a linked location (or open the location's Photos & Videos tab).",
      "Upload up to 100 photos, or tick ones already in your library; generate caption drafts if you like and edit them.",
      "Pick the photo category and the schedule under “Schedule and approve”.",
      "Click “Approve & queue photos”. Approving is what authorises publishing.",
      "Follow each photo under “Calendar, queue & history”; Photo optimizer and Media library sit beside this page.",
    ],
    howItWorks: "Google strips EXIF data from uploaded photos, so the filename pattern and title carry your business name. Google can reject a photo; an “uncertain” result means check Google before retrying, because a retry can post twice.",
    needs: ["Any plan.", "A location linked to its Google Business Profile."],
  },
  {
    key: "gmb-edit-monitor", group: "Google Business", route: "/gmb-monitor", title: "GMB Edit Monitor",
    whatItIs: "A manual change-checker for any Google listing, plus an AI review response generator.",
    whatItDoes: "Captures a baseline of a listing’s public data and, on later checks, compares it and keeps a history of every change found. The review response generator on the same page drafts a reply to a review you paste in.",
    howToUse: [
      "Sidebar → Google Business → GMB Edit Monitor.",
      "Add a listing by name, address or Maps link and click “Check Now” to capture the baseline.",
      "Click “Check Now” again later, or “Check All”, to compare.",
      "For a reply draft, paste a review, enter your business name, pick a tone and generate; edit it and paste it on Google yourself.",
    ],
    howItWorks: "Checks run only when you click; there are no automatic checks or alerts here. For automatic watching of your own linked listings, use Profile Watch.",
  },
  {
    key: "ranking-grid", group: "Google Business", route: "/ranking-grid", title: "GMB Ranking Grid",
    whatItIs: "A heatmap of where a business ranks in Google Maps results for one keyword, at many points around its area.",
    whatItDoes: "Each point shows the rank (1 to 20, or not found in the top 20). The report shows average and best rank, ranked versus unranked points, a rank distribution and the top competitors found. Scans are saved in Scan History and can be printed or saved as a PDF.",
    howToUse: [
      "Sidebar → Google Business → GMB Ranking Grid → New Scan.",
      "Search your business by name, address or Google Maps link.",
      "Enter a keyword, for example “roofing contractor”.",
      "Under Advanced, pick the grid size and the distance between points from the lists, or type your own (an odd size from 3 to 15, a spacing up to 20 miles); the page shows the width covered and the credits the scan uses.",
      "Start the scan, then choose “View Full Report”.",
    ],
    howItWorks: "A scan is a snapshot at that moment; rankings move and none is guaranteed. Scans use the plan’s monthly ranking-grid credits, which reset monthly. Until your first scan, the history shows a clearly labelled sample of what a finished scan looks like.",
    needs: ["Any plan; each scan uses ranking-grid credits."],
  },
  {
    key: "photo-optimizer", group: "Google Business", route: "/photos", title: "Photo Optimizer",
    whatItIs: "A batch tool that prepares job photos.",
    whatItDoes: "In one batch it adds a text or logo watermark, gives photos clear filenames, writes EXIF details and a GPS geotag from an address, adds descriptions and adjusts filters. You download the results or save them to the Media Library.",
    howToUse: [
      "Sidebar → Google Business → Photo Optimizer.",
      "Add your photos (JPG or PNG).",
      "Fill in Business Info and the options you want.",
      "Download the optimised photos or choose “Save to Media Library”.",
    ],
    howItWorks: "Google strips EXIF data when photos are uploaded to a Business Profile, so metadata and geotags are for your own files and other websites, not a Google ranking boost. If a batch fails, try fewer or smaller photos.",
    needs: ["Any plan."],
  },
  {
    key: "media-library", group: "Google Business", route: "/media-library", title: "Media Library",
    whatItIs: "Your project photos, organised into folders.",
    whatItDoes: "Lets you upload, rename, select and delete photos by folder — for example one folder per job. The library feeds review requests, Posts & Photos and Social Media.",
    howToUse: [
      "Sidebar → Google Business → Photos → Media library.",
      "Create a folder for the job and upload its photos.",
      "Give the folder the client’s address if you want GPS coordinates embedded in its photos.",
      "Pick photos from the library when you send a review request or build a post.",
    ],
    howItWorks: "When a folder has an address, its GPS coordinates are embedded into that folder’s photos. Google strips that data from photos uploaded to a Business Profile. The numbers above the list count your folders and how many have an address and coordinates; while the library is empty, a labelled sample shows what folders look like.",
  },
  {
    key: "reinstatement", group: "Google Business", route: "/reinstatement", title: "Reinstatement",
    whatItIs: "A done-for-you service for a suspended Google Business Profile.",
    whatItDoes: "You send the details of your situation; the team reviews the case, tells you whether they think they can help, guides the fixes and documents, and writes and submits the appeal.",
    howToUse: [
      "Sidebar → Google Business → Reinstatement.",
      "Fill in the request form.",
      "Answer the team’s questions; they review a case within 1 to 2 business days.",
    ],
    howItWorks: "This is a service run by people, not an automatic tool. Google alone decides whether a profile is reinstated, so no outcome is guaranteed. The price is shown on the Reinstatement page.",
  },

  /* ══ Google Ads ═══════════════════════════════════════════════════════════════════════════════ */
  {
    key: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA",
    whatItIs: "A manager for agencies that run clients’ Google Ads from a Google Ads manager (MCC) account.",
    whatItDoes: "Six sections, each its own address: Recommendations (tick client accounts, choose the playbook steps to preview), Client accounts (every account under the MCC, with Link account, the health-audit button and, under Advanced, the bulk protections and Click Guard mapping), Access invitations, Protection previews, Queue and Health audit. It discovers your client accounts and marks which run Local Services Ads, sends client access requests, runs read-only health audits, and applies bulk protections such as presence-only location targeting, Click Guard IP exclusions, shared negative keywords, placement exclusions and ad schedules.",
    howToUse: [
      "Sidebar → Google Ads → Agency Ads & LSA → Connect MCC with Google, then Discover clients.",
      "Under Access invitations, paste one “customer ID,email” pair per line, preview, and confirm.",
      "Under Client accounts, tick accounts and choose Queue health audit; read the findings under Health audit.",
      "Under Recommendations, tick accounts and the steps you want, choose Preview, then confirm each preview under Protection previews; use “Preview reversal” to undo one.",
    ],
    howItWorks: "Nothing changes in Google until you confirm a preview, and previews expire after 24 hours. Every button adds a job that a background worker runs; Queue shows each one. Results depend on Google accepting each change. If the page says setup is required, the connection is not available yet.",
    needs: [moduleNeed("adsManager"), "A Google Ads manager (MCC) account."],
  },
  {
    key: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard",
    whatItIs: "Click-fraud protection for Google Ads: it watches who lands on your pages and builds the list of addresses to keep out.",
    whatItDoes: "A small tracking script on the pages your ads send people to records each visit and flags unusual traffic with fixed rules: bot-like browsers, too many visits from one IP address (more than 5 in an hour or 15 in a day), and the same device showing up from different addresses. An address flagged past 10 visits in an hour is blocked automatically; you can block one yourself. A script in your own Google Ads account then adds the blocked addresses as IP exclusions. The Dashboard shows visits, blocked IPs, unique visitors, the threat level and a trend for the dates you pick; Traffic sources and Traffic signals break the same visits down.",
    howToUse: [
      "Sidebar → Google Ads → Click Guard, and add your website domain.",
      "Copy the tracking code from Tools and paste it on every page your ads point to.",
      "Open the “Google Ads script” section and copy the IP exclusion script.",
      "In Google Ads go to Tools → Bulk actions → Scripts, paste it, authorise it, run it once and check the logs.",
      "Schedule the script to run hourly.",
    ],
    howItWorks: "ConstructHUB serves your exclusion list from a private address and the Google Ads script reads it on each run. The script only adds exclusions, never removes them, and Google allows 500 per campaign. The signals do not prove fraud and can flag real visitors; no savings are guaranteed. Until a domain has a visit, each section shows a clearly marked sample — nothing in it is real or stored.",
    needs: [PROTECTED, "Access to your website’s code and your Google Ads account."],
  },
  {
    key: "ad-fraud", group: "Google Ads", route: "/google-ad-fraud", title: "Ad Fraud",
    whatItIs: "A free reading page about click quality in Google Ads: what ConstructHUB saw in contractor accounts, and its opinion of it.",
    whatItDoes: "Nine sections you open one at a time — invalid clicks, bot traffic, VPN and proxy clicks, the 500-IP exclusion limit, click counts, disputes, who clicks contractor ads, Google’s own report and call-only ads — then a list of Google’s explanations against what the tracking showed, and six links to what you can do: Click Guard, the Google Ads script, device fingerprints, the data sections, a CSV export and the Ads guide.",
    howToUse: [
      "Sidebar → Google Ads → Ad Fraud.",
      "Choose a section title to open it; choose it again to close it.",
      "Under “What can you do about it?”, pick a link to set up Click Guard on your own ads.",
    ],
    howItWorks: "Nothing on the page is measured from your account: the figures are ConstructHUB’s observations in accounts it has worked on plus published research, and the page says so. It is not an independent audit and your traffic may differ.",
  },
  {
    key: "ads-guide", group: "Google Ads", route: "/google-ads-guide", title: "Ads Guide",
    whatItIs: "A 12-section playbook for contractor Google Ads campaigns.",
    whatItDoes: "Covers campaign setup, Google features to avoid, ad assets, keywords, location targeting, bidding and budget, ad copy, landing pages, IP exclusions, tracking, click fraud and costly mistakes with a launch checklist.",
    howToUse: [
      "Sidebar → Google Ads → Ads Guide.",
      "Read the overview, which is free.",
      "Open a section to read it in full.",
    ],
    howItWorks: "The full sections unlock with any Master Class purchase. The guide is ConstructHUB’s recommendations, not a guarantee of results.",
    needs: ["The full sections need a Master Class purchase; the overview is free."],
  },
  {
    key: "lsa-guide", group: "Google Ads", route: "/lsa-guide", title: "LSA Guide",
    whatItIs: "A free guide to Google Local Services Ads (LSA).",
    whatItDoes: "Eight sections: verification, answering calls, reviews, choosing services, message leads, service areas and hours, photos, and your business bio.",
    howToUse: [
      "Sidebar → Google Ads → LSA Guide.",
      "Read the sections in order, or jump to the one you need.",
      "Apply the changes in your own Local Services Ads account.",
    ],
    howItWorks: "The guide is reading material; it does not connect to or change your Local Services Ads account.",
  },
  {
    key: "lsa-leads", group: "Google Ads", route: "/lsa-leads", title: "LSA Leads",
    whatItIs: "Your Local Services Ads leads in one list, account by account, with a Good or Bad rating on each.",
    whatItDoes: "After you connect your Google account it lists every Google Ads account you can reach, with its lead count and how many were charged. Open an account to read its leads (phone call, message or booking), filter them to All, Charged or Disputed, and rate each one: Good tells Google the lead was fine; Bad reports it with a reason (service I don’t offer, sales call, duplicate, outside my service area, customer wasn’t ready to book). Tick several and Report now, or Schedule for later to spread the reports across a date range. Sync now pulls the latest leads; Telegram notifications can send you a message when a new lead arrives.",
    howToUse: [
      "Sidebar → Google Ads → LSA Leads → Connect Google Ads, and allow access.",
      "Choose Sync now, then open an account in the list.",
      "Filter to Charged, open a lead’s details, and choose Good or Bad; for a bad lead pick the reason that fits.",
      "To report several at once, tick them, check each reason, and choose Report now or Schedule for later.",
      "Under Connection → Telegram notifications, choose Link Telegram if you want a message for each new lead.",
    ],
    howItWorks: "Reports go to Google one at a time, 30 to 60 seconds apart per account, and a lead can be reported once; a scheduled report runs at a random business-hour moment inside the range you chose. Google decides whether to credit a reported lead. Leads keep syncing in the background after the first sync. If the page says Google Ads setup is required, the connection is not available yet.",
    needs: ["A Google account with access to the Google Ads account that runs your Local Services Ads."],
  },

  /* ══ Reviews ══════════════════════════════════════════════════════════════════════════════════ */
  {
    key: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews",
    whatItIs: "Four views in one tool: ask clients for reviews, work with the reviews already on your Google profiles, keep your review links, and set how feedback and reminders behave.",
    whatItDoes: "Review requests emails a client a request with a button to leave a Google review, now or on a day and time you pick, with reminders and tracking of what they did. Google reviews lists your synced reviews so you can publish replies, save drafts and keep private notes, with AI drafts for approval if you want them. Profiles & links holds one profile per Google listing with its review link and your pages on other review sites. Settings decides which scores come to you privately and when reminders go out.",
    howToUse: [
      "Profiles & links → Add profile: paste the listing’s Google review link (or pick a linked location) and add your Yelp, BBB, Houzz, Angi or HomeAdvisor pages if you want clients to see them after Google.",
      "Review requests → New review request: pick the profile, enter the client’s name and email, and send now or schedule a date and time.",
      "Settings → Feedback routing: set the score below which feedback comes to you privately (any number from 1 to 10; 10 means only a perfect score goes straight to Google). Follow-up reminders: how many, how far apart, in which hours.",
      "Watch each request’s tracking in the list: opened, Google link clicked, feedback, caught privately.",
      "Google reviews: connect Google, sync a linked location, then filter the reviews and publish replies.",
    ],
    howItWorks: "Every client is asked to rate the job from 1 to 10 and every answer reaches you. A score below your routing threshold shows the private “What could we have done better?” form and alerts you at once (bell, email and Telegram when linked) with the name, score, job and their words; a score at or above it goes straight to the Google review step. Reminders stop when the client responds, unsubscribes or reaches the maximum you set. Nothing offers a reward for a review. AI can get facts wrong, so check every reply before publishing it.",
    needs: ["Any plan.", "The Google reviews view needs a connected Google account and a linked location."],
  },

  {
    key: "yelp", group: "Reviews", route: "/yelp", title: "Yelp",
    whatItIs: "Your Yelp rating and newest reviews next to the competitors nearby, with AI-drafted replies you post on Yelp.",
    whatItDoes: "Shows each connected Yelp business as a card with its rating, review count, 30-day change, categories, open status and the reviews Yelp returns; a stat row adds them up across your businesses. AI drafts a reply to a review for you to copy and post on Yelp. The competitors panel lists nearby businesses in your category and marks the ones rated ahead of you. Up to 50 businesses can be connected.",
    howToUse: [
      "Sidebar → Yelp → “Connect a Yelp business”: search by business name and city, address or ZIP, and choose Connect on yours.",
      "Use Refresh on a card to pull the latest rating and reviews now; otherwise they refresh when older than 12 hours.",
      "On a review, choose “Draft reply with AI”, edit the draft, copy it and post it on Yelp from the review’s link.",
      "Open “Competitors on Yelp” on the card to see who is ahead of you.",
    ],
    howItWorks: "Yelp’s own API is read-only and returns only a few recent reviews per business; it has no way to post a reply, so replies are drafted here and posted on Yelp by you. A rising review count sends you a notification. The page needs a Yelp API key on the server; until an administrator sets one it shows a sample instead. AI can get facts wrong, so check every draft.",
    needs: ["A ConstructHUB account.", "A business page on Yelp."],
  },

  /* ══ Tools ════════════════════════════════════════════════════════════════════════════════════ */
  {
    key: "call-assistant", group: "Tools", route: "/call-assistant", title: "AI Call Assistant",
    whatItIs: "An AI receptionist that answers your business line around the clock, screens out spam, and files real callers as leads in your CRM.",
    whatItDoes: "It answers every call forwarded to it, asks what the call is about, collects the details you chose (the address, a name, a good email, the best time to call) and files a real caller as a lead in the CRM. Emergencies, existing customers and callers who insist on a person are texted or emailed to the teammate you picked. Telemarketers and robocalls are flagged and never reach you. Every call is logged with its outcome, a summary, the transcript and the recording. Five pages: Overview, Calls, Numbers, Agent studio and Simulator, each with its own \u201ci\u201d.",
    howToUse: [
      "Agent studio: tell the assistant about your business (services, service area, policies), choose its voice and the questions it asks, and who gets urgent calls. Publish when the review looks right.",
      "Simulator: type a test conversation against the published version or the draft and read each decision beside the reply.",
      "Numbers: get a local number (pick a state, optionally an area code or city) and forward your existing line to it with the steps shown for your carrier.",
      "Calls: read every call with its outcome, summary, transcript and recording; unblock a number under Spam blocked if the assistant got one wrong.",
      "Overview: watch the status, minutes and results, and follow the Next step line. Pause in Agent studio stops the assistant answering until you resume.",
    ],
    howItWorks: "It says it is a virtual assistant if asked, and can play a notice that calls may be recorded. It never invents a rating, a license or a price: it quotes prices only when you choose to read typed ranges, does not book appointments, and never gives out a teammate\u2019s number. A number caught twice as near-certain spam is blocked before its next call is answered, and a weekly email reports how many spam calls were stopped. Publishing creates a numbered version you can restore later.",
    needs: [CALL_ASSISTANT_SEPARATE_LINE, callAssistantAvailabilityLine()],
  },
  {
    key: "social-media", group: "Tools", route: "/social-media", title: "Social Media",
    whatItIs: "One place to write, schedule and follow posts for your business's social accounts and its Google Business Profile.",
    whatItDoes: "Each business gets its own workspace: Overview (this week and what is coming up), Calendar, New post, Posts (drafts, scheduled, published, failed), Analytics, Inbox for comments, Accounts, and Auto mode, where ConstructHUB writes posts on a schedule as drafts or straight to your accounts. A post is written once and sent to every account you tick, with its own tweak per network, and to your Google listing when the business is linked to one. Agencies can open all clients at once for the calendar and the posts.",
    howToUse: [
      "Pick the business in the Business menu, then open Accounts and choose Connect on each network; for Facebook and LinkedIn tick the pages you manage.",
      "Open Map accounts and pages to this business and save where new posts go by default.",
      "Under New post, tick the accounts and Google Business Profile, write the text, add media, type a schedule date and time or leave it blank, then choose Post now, Schedule post or Save draft.",
      "Follow each post under Posts or on the Calendar; read comments under Inbox and numbers under Analytics.",
      "Turn on Auto mode when you want posts written for you, as drafts to approve or published automatically.",
    ],
    howItWorks: "ConstructHUB connects your social accounts through its own apps on each network; the sign-ins are stored encrypted and never shown again. Published means the network confirmed it; queued means the post is still in ConstructHUB; if a status is uncertain, check the account on the network before posting again. The Google Business Profile copy goes through the Google posts queue the Posts page uses, so its status is shown there. Disconnecting stops ConstructHUB's queue but cannot recall posts a network already published.",
    needs: ["A social account you can sign in to for each network you post to, or a business linked to its Google Business Profile.", "At least one business under Locations to post for."],
  },
  {
    key: "social-youtube", group: "Tools", route: "/social-media", title: "Social Media → YouTube",
    whatItIs: "Your own YouTube channel, connected to ConstructHUB so you can publish videos to it from the Social Media → Accounts page.",
    whatItDoes: "Connects one YouTube channel for your whole account, shows which channel is connected, and uploads the video files you choose with the title, description, tags and privacy you enter. It cannot edit or delete videos, read comments or statistics, or reach anything else in your Google account.",
    howToUse: [
      "Open Social Media, find the YouTube section and choose “Connect YouTube”. Pick the Google account and channel, and allow the two permissions Google lists.",
      "Check the channel name shown is the one you meant. If it is not, choose “Connect a different channel”.",
      "Choose “Publish a video”, pick the file and wait for it to finish arriving.",
      "Enter the title, description and tags, choose who can see it, answer whether it is made for kids, and tick the box confirming YouTube’s Community Guidelines and your rights to the video.",
      "Choose “Publish to YouTube” and follow the video in the list: Queued, Uploading, On YouTube — processing, then Published with a link, or Failed with the reason. To stop using it, choose Disconnect.",
    ],
    howItWorks: "ConstructHUB asks Google for two permissions only: upload videos, and see the channel. The sign-in Google returns is stored encrypted and is never shown. Your file is held by ConstructHUB until YouTube has it, and for at most 24 hours; a background worker then sends it to YouTube in pieces. YouTube decides the final privacy setting — the list shows what YouTube actually set. Each account can send a limited number of videos a day, and all ConstructHUB customers share one daily allowance from Google; when either is used up the page says so and you can try again the next day (the day resets at midnight Pacific time). Disconnect cancels the sign-in at Google and deletes the channel details, the sign-in and the list of videos you sent; videos already on YouTube stay on your channel.",
    needs: ["A YouTube channel on the Google account you connect.", "Videos longer than 15 minutes need a channel verified with YouTube (youtube.com/verify)."],
  },
  {
    key: "site-scan", group: "Tools", route: "/site-scan", title: "Site Scan",
    whatItIs: "A check-up of a website that tells you what to fix, in priority order.",
    whatItDoes: "Reads the site’s pages and checks technical and content issues (broken links, redirects, HTTPS, titles, headings, image text), runs Google PageSpeed on the pages you choose, compares the site’s details with a Google Business Profile if you pick one, and checks readiness for AI search. Each finding explains why it matters and the fix steps. You can mark fixes done, export a PDF, download a sitemap built from the crawl, email the checklist to your web person, share a read-only link, and rescan to see what changed.",
    howToUse: [
      "Sidebar → Site Scan. Enter the website’s address in “Website URL” — the home page is enough.",
      "Set “Pages to check” (150 covers most sites; any number up to 500) and “Pages to speed-test” (0 to 5) with the quick picks or your own number. Optionally pick a Google Business Profile to compare with — it fills in the address for you.",
      "Choose “Start scan”. You can run 5 scans, 20 PageSpeed tests and 3 AI fix plans a day; bigger scans take a few minutes.",
      "Read the findings. “Generate AI fix plan” writes a draft only — check it before using it. Mark items done, then rescan to see what is fixed, still present or new.",
      "Turn on “Rescan this site every month” to keep it checked. Agencies queue many client sites at once under “Bulk scan client sites”; every scan lands in Scan history.",
    ],
    howItWorks: "The scanner reads the pages’ HTML and does not run JavaScript. It never changes your website or Google listing. Each page you speed-test is measured on mobile and on desktop by Google PageSpeed. Scores are diagnostic indicators, not ranking predictions. Share links expire after 30 days and can be revoked.",
    needs: ["Any plan; scans are counted against the plan’s monthly Site Scans."],
  },
  {
    key: "seo", group: "Tools", route: "/seo", title: "SEO Suite",
    whatItIs: "Your websites' standing on Google in one place: a card per site with its link strength, backlinks, estimated search traffic and where its tracked keywords rank — and the door to every other SEO tool.",
    whatItDoes: "The box at the top looks any website up — yours or a competitor's — in Site explorer, or adds it to your sites for free. Each card shows the site's authority, referring domains, estimated organic traffic and keywords with their trend, how many tracked keywords are in the top 3 and top 10, the health score from its last crawl and its open tasks; every figure is a link to the page that holds it. Cards can be starred, put in groups (a client, a region) and ordered or narrowed with the pickers. Opening the dashboard never spends SEO data: Analyse or Refresh on a card buys a new Site explorer report at the price shown, and Run first crawl uses one of your plan's monthly Site Scans.",
    howToUse: [
      "Type a website in “Look up any website”. Look it up opens it in Site explorer; Add to my sites puts it on this dashboard and in the rank tracker, free.",
      "Open a card's figures: rankings go to the rank tracker, the health score to Site audit, traffic and keywords to Site explorer.",
      "Choose Analyse on a card for its first Site explorer report, or Run first crawl for its health score — each says its cost before it runs.",
      "Star the sites you watch most, put sites in groups, and use Order and Group to arrange the list; the arrangement is in the address, so a link lands on the same list.",
      "Use the rail for the other tools: Site explorer, Keywords, Content, Rank tracker, Local grid, Site audit, AI visibility, Action plan, Alerts, Reports and Usage — each has its own “i”.",
    ],
    howItWorks: "The cards are built from numbers already saved — the last Site explorer report, each keyword's newest check on one device, the newest finished crawl and the plan's open tasks — so the page is free to open. Lookups and checks are paid from the SEO data your plan includes each month, then from credit you buy; the bar at the top shows what is left, and every button that spends says its price first. Up to 50 sites can be tracked, and a site with no keywords is never checked. If the page says lookups are being switched on, saved results open as usual and new lookups wait.",
    needs: [SEO_NEED],
  },
  {
    key: "ip-tracker", group: "Tools", route: "/ip-tracker", title: "IP Tracker",
    whatItIs: "A live list of who visits your website — which address, from where, on what device, and which pages — using the same tracking code and site list as Click Guard.",
    whatItDoes: "The Dashboard shows who is on the site right now (distinct IP addresses in the last 20 minutes), visits today, yesterday, the last 7 days, this month and all time, a 14-day chart, and one panel per site with its visits, unique visitors, flagged visits and blocked IPs. Visitors lists each address with its visits, pages, city, device and browser and opens to its full record; Traffic shows the sites that sent each visit, Pages the pages people landed on, Geo the countries and cities, Platforms the browsers, systems, devices and screen sizes.",
    howToUse: [
      "Sidebar → Tools → IP Tracker, and add your website’s domain (step 1 on the page).",
      "Copy the tracking code and paste it in the head section, or before the closing body tag, of every page you want to track.",
      "Open your site once: the first visit replaces the sample within about 30 seconds, and the other sections fill in from the same visits.",
      "Narrow a section with a date range — a preset or two typed dates; on Visitors, “Seen within” shows who was there in the last 20 minutes or any number of minutes you type.",
    ],
    howItWorks: "Each page load with the code on it sends one visit: IP address, browser, system, device, screen size, language, time zone, referrer and landing page; country and city come from Cloudflare on visits recorded since Sep 30, 2026. Until a site has a visit, each section shows a clearly marked sample so you can see what it will look like — nothing in it is real or stored. A section loads the newest 1,000 visits at most, so a busy site’s all-time counts carry a plus sign. One website counts once across Click Guard, IP Tracker and VPN Shield.",
    needs: [PROTECTED],
  },
  {
    key: "vpn-shield", group: "Tools", route: "/vpn-shield", title: "VPN Shield",
    whatItIs: "A detector for visitors who arrive through a VPN or proxy, with a choice of what to do about them: log, block or redirect.",
    whatItDoes: "Flags a visit when the address matches a known VPN provider or datacenter range, the browser leaks a different address over WebRTC, or a VPN extension shows itself, and records it with the provider, the method and the action taken. The Overview counts detections (all time, today, blocked, unique addresses), charts the last 30 days, lists the top providers and countries and shows every site with its mode. Flagged visits lists each detection; Install script gives the one tag per site; Settings sets the mode, a redirect link and a whitelist of up to 500 of your own addresses.",
    howToUse: [
      "Add your site here or in IP Tracker — it is the same site list — and it starts in Log only.",
      "Open Install script, copy the tag and paste it on every page.",
      "Visit your site through a VPN once: the detection replaces the sample on the Overview within a minute.",
      "Read a few flagged visits, then in Settings choose Block (an overlay) or Redirect (your link), whitelist your office and test addresses, and save.",
    ],
    howItWorks: "Detection is a set of signals, not proof: VPN use is often legitimate and nothing here identifies a person. Search-engine crawlers are skipped by user agent, which can be spoofed. The overlay and redirect run after the page loads, only in browsers that run the script, and can be bypassed. A site that never saved a mode logs and blocks nobody. Until a site has a detection, the Overview and Flagged visits show a clearly marked sample — nothing in it is real or stored.",
    needs: [PROTECTED, "A site added here, in IP Tracker or in Click Guard."],
  },
  {
    key: "competitor-intel", group: "Tools", route: "/competitors", title: "Competitor Intel",
    whatItIs: "A market scan of the businesses competing in your trade around your town, built from Google’s public business listings.",
    whatItDoes: "Each scan lists every competitor Google shows for a trade within a radius of a place — name, rating, review count, category, address, phone and website — and reads it back as a market report: the leaders, how ratings and review counts spread across the market, and every listing best-rated first with its review signals explained in one line. A strip at the top adds up every saved scan. Scans stay on your account until you delete them.",
    howToUse: [
      "Sidebar → Competitor Intel. Pick your trade from the list or type your own, enter a city, ZIP or address, and set the radius: a preset or any number of miles from 1 to 100.",
      "Choose Scan market and wait for the card to say Completed (a scan uses one of the month’s allowance; cancelling gives it back).",
      "Open the report: read the leaders and the two distribution bars, then the list — Call, Directions and Website on each business.",
      "Choose Review analysis on a business to see what its sampled reviews show; Re-run repeats a scan, Delete removes it.",
    ],
    howItWorks: "The scanner reads public business listings only — no ads, ad spend or private data. The listings arrive from the server already ordered best-rated first, most-reviewed among equals. Review signals are counted from the few reviews Google returns per listing: a score from 0 to 100 with its reasons, shown as Few, Some or More signals. They are not proof that a review is fake and the scores are not probabilities; a high-rated listing in the More band is not named a leader.",
    needs: [`Included with the ${COMPETITOR_INTEL_PLANS} plans, with a monthly number of scans.`],
  },
  {
    key: "master-class", group: "Tools", route: "/master-class", title: "Master Class",
    whatItIs: "A step-by-step course on starting and growing a construction business, with a free guide for every state.",
    whatItDoes: "Four modules — Business Formation & Licensing, Google Business, Website, and SEO & ads — plus bonus lessons on vetting contractors. The Overview is free and compares all 50 states: who issues licenses, whether a license, a bond, workers’ comp or sales tax on labor applies, and the filing office. Each module tab holds its lessons; the Enroll tab sells the modules and the bundle.",
    howToUse: [
      "Sidebar → Master Class. Read the Overview and choose your state to open its guide.",
      "Open a module tab you own to read its lessons in order; a lock on a tab means it is not unlocked on this account.",
      "Choose Enroll to add a module or the complete bundle to the cart.",
    ],
    howItWorks: "The state guides are public. Lesson text is fetched only for an account that owns the module, the bundle or a plan that includes the course; the page checks that first and says when the check is loading or failed instead of calling it “not bought”. Prices come from the catalog the server serves. Any Master Class purchase also opens the vetting lessons and the full Google Ads guide. The open tab, state and lesson stay in the page address.",
    needs: ["A Master Class purchase, or a plan that includes the course, for the lessons. The Overview and state guides are free."],
  },

  {
    key: "compliance", group: "Tools", route: "/compliance", title: "Compliance Dept",
    whatItIs: "A state-by-state directory of who licenses contractors and trades and who issues electrical permits, with each agency’s official lookup links, plus paid Permit & License Research Reports.",
    whatItDoes: "For every state it shows a short summary of how licensing is split, who issues electrical permits (the state, cities and counties, or both), and a card for each licensing board or permit agency with the roles it covers and its official links: look up a license, look up a permit, open data, the agency website and a phone number where one is on record. A link the agency’s site would not let us check automatically is marked “unconfirmed”. The search box narrows the page to a state or an agency, and the state pills jump to a state. The report card leads to the paid research reports.",
    howToUse: [
      "Open Compliance Dept.",
      "Type a state or agency name in the search box, or click a state pill to jump to it.",
      "Open the agency’s “Look up a license” or “Look up a permit” link to check a contractor on the agency’s own site.",
      "To have the research bot do the searching for you, choose Order a report.",
    ],
    howItWorks: "The directory is a fixed list kept in ConstructHUB’s reference data: every agency was researched state by state and every link was opened and checked on the date shown beside the state name; a link that failed its check is left out rather than guessed. The page reads nothing from your account. It is information, not legal advice; confirm requirements with the agency before you bid or hire.",
  },
  {
    key: "press-releases", group: "Tools", route: "/press-releases", title: "Press Releases",
    whatItIs: "Press releases on the national newswire, written for you from a few sentences about your news.",
    whatItDoes: "You pick a package (one Wire release, one Premium release, or the 12-month program: pay for 12, get 14), tell the writer what happened and add photos. It drafts the release to the wire's editorial guidelines and checks it against them; you read it, change anything, and approve. The release goes to the wire's editors; when it is live you get the link by email, and the distribution report (where it ran, views, clicks) follows the same way.",
    howToUse: [
      "Sidebar → Press Releases → pick a package and pay (credits are good for 12 months).",
      "Write a release: choose the kind of news, fill in the company, the facts, who is quoted and the media contact, and add photos.",
      "Press Write it. Read the draft; use Rewrite with a note, or edit the text yourself.",
      "Fix anything the guideline check flags in red, then Approve & send. One credit is used.",
      "Watch the status under Your releases: In editorial review → Live → Report delivered. Each step is also emailed to the media contact.",
    ],
    howItWorks: "The writer uses only the facts you give; it never adds numbers, awards or claims. Before you can send, the text is checked against the wire's published content rules (no hype words, no exclamation marks, no direct address outside quotes, a named source and a contact email, restricted topics flagged) because the wire does not refund a release its editors refuse. If the editors ask for changes, the draft is revised for their notes and you approve it again at no extra credit. One release a month is the pace that works best; the 12-month program is built for it.",
    needs: ["A paid package (no plan needed)."],
  },

  /* ══ CRM (served by the CRM host) ═════════════════════════════════════════════════════════════ */
  {
    key: "crm-home", group: "CRM", route: "/crm", title: "CRM Home",
    whatItIs: "The CRM’s first screen: what needs your attention today.",
    whatItDoes: "Shows headline numbers (new leads, pipeline value, unscheduled jobs, open invoices), a “Needs attention” list, team activity and, for a new workspace, a setup checklist.",
    howToUse: [
      "Open the CRM from the top of the ConstructHUB sidebar.",
      "Click a number to jump to that list.",
      "Work through the setup checklist: your profile, company details and inviting your crew.",
    ],
    howItWorks: "The numbers are read live from your workspace. The checklist goes away once it is done or you dismiss it.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-clients", group: "CRM", route: "/crm/clients", title: "Clients",
    whatItIs: "Every person you do business with, each on one page.",
    whatItDoes: "A client’s page holds their estimates, invoices, projects, payments, visits, private notes, measurements, uploads and an activity timeline. Every client automatically gets a private portal page.",
    howToUse: [
      "CRM → Clients → add a client with name, email, phone and address.",
      "Use the search box to find anyone by name, email, phone or address.",
      "Open a client to create an estimate, record a payment or schedule a visit.",
      "“See what the client sees” opens their portal the way they see it.",
    ],
    howItWorks: "Notes are private to your team and never appear in the portal. The timeline is kept for you from what happens: estimates sent, emails opened, payments made.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-messages", group: "CRM", route: "/crm/inbox", title: "Messages",
    whatItIs: "Two-way conversations with your clients, one thread per client.",
    whatItDoes: "A client writes from their portal or asks a question on an estimate; your reply shows in their portal and is emailed to them. The Client activity tab shows opens, approvals and payments.",
    howToUse: [
      "CRM → Messages.",
      "Open a thread with an unread count and reply.",
      "Check the Client activity tab to see what clients are doing.",
    ],
    howItWorks: "A reply is emailed when the client has an email address on file. Unread threads are counted on the Messages tab.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-pipeline", group: "CRM", route: "/crm/pipeline", title: "Pipeline",
    whatItIs: "Every job as a card on a board, from first contact to done and paid.",
    whatItDoes: "Shows jobs in columns — lead, bid sent, approved, scheduled, in progress, complete — and lets you move them along. A project’s page has costing, change orders, a punch list, daily logs, selections and permits.",
    howToUse: [
      "CRM → Pipeline.",
      "Add a lead with an estimated value.",
      "Drag a card to the next column as the job moves, or use the menu on the card.",
      "Open a card to work on the project.",
    ],
    howItWorks: "When a client approves an estimate, its project moves to Approved by itself. A change order the client approves on its link adjusts the contract value.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-schedule", group: "CRM", route: "/crm/schedule", title: "Schedule",
    whatItIs: "Every visit, install date and appointment on one calendar.",
    whatItDoes: "Month, week and agenda views for your own calendar, everyone’s, or one team member’s, with a warning when visits overlap. It can also feed the calendar app you already use.",
    howToUse: [
      "CRM → Schedule.",
      "Add a visit, choose who is going and link it to the client or project.",
      "Switch between My calendar, Everyone’s calendar or one person.",
      "From Settings, subscribe from Apple Calendar, Outlook or Google Calendar with the private feed link.",
    ],
    howItWorks: "Nothing lands on the schedule by itself — you add each visit. Anyone with the private feed link can read it, so regenerate the link to cut off old copies.",
    needs: [CRM_NEED],
  },
  {
    key: "jobcam", group: "CRM", route: "/crm/jobcam", title: "JobCam",
    whatItIs: "Job-site photos and video, filed to their project with the time and location they were shot.",
    whatItDoes: "The Recent feed shows every job’s shots, newest first, searchable by project, address, tag and person, with filters for tags, starred, photos, videos and dates, as a grid or a timeline. You can select several shots to star, tag, show to or hide from the client, share or delete.",
    howToUse: [
      "CRM → JobCam → Open camera. The camera picks the nearest project, or you choose one.",
      "Take photos or video and add tags; they stay set for the session.",
      "Back in the feed, search or filter to find shots.",
      "On a project’s JobCam page choose Select, tick shots and “Share these”, or share the live timeline, then “Make the link”.",
      "Copy the link or send it by email or text. Revoke it under “Existing links”.",
    ],
    howItWorks: "Each capture is saved on the phone first and uploaded from a queue, so a lost connection does not lose a shot. A share link can be a fixed gallery of the shots you picked or a live timeline that keeps updating, and can have a password. A revoked or expired link shows the client an honest “turned off” or “expired” page.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-estimates", group: "CRM", route: "/crm/estimates", title: "Estimates",
    whatItIs: "Your bids: build one, send it, and see when the client reads and approves it.",
    whatItDoes: "The list is searchable and filterable by status: Draft, Sent, Viewed, Approved, Declined or Expired. The client gets an email with a private link where they can read the bid, ask a question, approve and e-sign. Quick Bid prices a job from a measurement report and your per-square-foot prices.",
    howToUse: [
      "CRM → Estimates → New estimate, and pick or create the client.",
      "Add items from your price book with the scope of work.",
      "Review and send.",
      "Watch the status; a client who re-opens the bid is your cue to call.",
      "“Extend” adds seven days on top of the time left (or seven days from today once it has expired) when a client needs more time.",
    ],
    howItWorks: "The first time a client opens the link they confirm their email with a one-time code. An estimate expires 7 days after it is sent. A signed estimate is locked, and permanent delete is for owners only.",
    needs: [CRM_NEED, "Price book items to pick from."],
  },
  {
    key: "crm-invoices", group: "CRM", route: "/crm/invoices", title: "Invoices",
    whatItIs: "Every bill you have sent, with what is paid, due and overdue.",
    whatItDoes: "Converts an approved estimate into an invoice, sends it with a secure payment link, records payments, and gives receipts marked PAID IN FULL when settled.",
    howToUse: [
      "Convert an approved estimate to an invoice from the client’s page.",
      "Send it; the client gets a secure payment link.",
      "Record a check or cash payment by hand when you receive one.",
      "Filter the Invoices list by status to chase what is overdue.",
    ],
    howItWorks: "Online payments go to your own Stripe account. A receipt builds itself from the invoice once a payment is recorded. Voiding keeps the paper trail.",
    needs: [CRM_NEED, "A connected Stripe account for online payment."],
  },
  {
    key: "crm-pricebook", group: "CRM", route: "/crm/pricebook", title: "Price book",
    whatItIs: "Your master price list, so estimates pick from a menu instead of retyping numbers.",
    whatItDoes: "Holds items (SKUs) with a unit — each, square, square foot, linear foot, hour or job — a price and a waste factor, plus materials, labor rates and assemblies.",
    howToUse: [
      "CRM → Price book.",
      "Add an item with its name, unit, price and waste factor.",
      "Price items per square foot when you want Quick Bid to use measurements.",
      "Change a price once and every new estimate uses it.",
    ],
    howItWorks: "Per-square-foot items multiply by the measured square footage, plus waste, in Quick Bid. The Price floor lock in Settings stops reps pricing below the price book.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-payments", group: "CRM", route: "/crm/payments", title: "Payments",
    whatItIs: "Where you connect your own Stripe account so clients can pay online.",
    whatItDoes: "After connecting, invoices and the client portal get a Pay button for card or bank transfer. You can also record a check, cash or wire, and add up to 10 financing links.",
    howToUse: [
      "CRM → Payments → connect your Stripe account.",
      "In Settings choose card, bank transfer (ACH) or both, and whether card fees are passed to the client.",
      "From a client’s page choose “Take a payment”: send a secure link, or record a payment you already have.",
    ],
    howItWorks: "Money goes straight to your own Stripe account; ConstructHUB never holds it. The page shows Stripe’s standard processing rates.",
    needs: [CRM_NEED, "A Stripe account."],
  },
  {
    key: "crm-team", group: "CRM", route: "/crm/team", title: "Team & Company",
    whatItIs: "Your people, what each may do, and the company details that print on your documents.",
    whatItDoes: "Invites people by email with a role — Owner, Admin, Sales, Project manager, Office, Field or Subcontractor — and lets you adjust individual permissions. Divisions give one company separate operating arms with their own name, address and license.",
    howToUse: [
      "CRM → Team & Company.",
      "Type an email, pick a role and send the invite.",
      "Resend or cancel a pending invite; change a member’s role or remove them.",
      "Add a division if you run a second branch.",
    ],
    howItWorks: "The role decides what a person can see and change, and the server enforces it. Removing someone cuts their access immediately; what they created stays.",
    needs: [CRM_NEED, "Owner or admin access to manage the team."],
  },
  {
    key: "crm-integrations", group: "CRM", route: "/crm/integrations", title: "Integrations",
    whatItIs: "Where the CRM connects to your other tools.",
    whatItDoes: "HOVER for measurements, Stripe, Google Calendar, a lead-capture form for your website, read-only API keys, and webhooks that notify your own systems.",
    howToUse: [
      "CRM → Integrations.",
      "Open a card and connect it; each is set up once.",
      "For the lead form, copy the embed code into your website or share the link.",
      "Create an API key only if a tool or developer asks for one.",
    ],
    howItWorks: "A HOVER report lands on the client whose address matches. Lead-form submissions become clients tagged as website leads. An API key is shown in full only once, when it is created.",
    needs: [CRM_NEED],
  },
  /* ══ Tools → Report an issue ══════════════════════════════════════════════════════════════════ */
  {
    key: "report-issue", group: "Tools", route: "/report-issue", title: "Report an issue",
    whatItIs: "The page for telling us something on ConstructHUB is broken, confusing or missing. “Report an issue” at the bottom of every page opens it, signed in or out.",
    whatItDoes: "Sends your description to our issue desk as its own numbered report, together with a short list of technical details the page shows you before you send. Under “Your reports” you can follow each report: Received, Being looked at, Fix ready, then Fixed or Not a bug, with our reply when there is one.",
    howToUse: [
      "Choose “Report an issue” at the bottom of the page where the problem happened.",
      "Say what you were trying to do and what happened instead. Check “Which page?” — it is filled in from where you came from.",
      "Choose how bad it is, and add a screenshot if a picture helps (one image, 5 MB at most).",
      "Open “What we send with your report” to see the details that go with it, then choose Send report.",
      "Keep the report number, and come back to “Your reports” for its status and our reply.",
    ],
    howItWorks: "Each report is stored separately and is never merged with someone else’s. The issue desk takes reports from people before the errors the site records by itself, and “I can’t use the site” before everything else; that choice also alerts our team straight away. Before a report is stored, email addresses and phone numbers in the text are masked and anything that looks like a password, key or card number is removed; the server keeps the browser and OS rather than the whole user agent, and the page path without its query string. Signed out, the page asks for an email address so we can write back, and the report waits for a person to read it before it goes to the desk; the list of your reports needs an account.",
    needs: ["Nothing: it works on every plan, and signed out too."],
  },
];

/**
 * Entries added after this file was written live ONE PER FILE under ./entries/<group>/<key>.ts and are
 * collected through the generated ./entries/index.ts — so several people can add help entries (one
 * per walkthrough video, say) without ever editing the same file. They follow the entries above, in
 * key order (the "Start here" films first, in their own order).
 */
/** The overview films play in this order, not in key order: what it is, then a tour of each app, then why. */
const START_HERE_ORDER = ["brand-what-is-constructhub", "brand-tour-crm", "brand-tour-business-tools", "brand-why-constructhub", "brand-vs-housecall-pro", "brand-vs-jobber", "brand-vs-leap"];
const lead = (key: string) => { const i = START_HERE_ORDER.indexOf(key); return i === -1 ? START_HERE_ORDER.length : i; };
const collected = (Object.values(moreEntries) as unknown as Draft[]).slice().sort((a, b) => lead(a.key) - lead(b.key) || a.key.localeCompare(b.key));

/**
 * The feature whose intro film an entry's "i" plays while the entry has no walkthrough of its own (owner 2026-10-15:
 * the "i" is where the tutorial is). Help key → feature page key (shared/feature-pages, whose film is
 * `intro-<slug>`, ./videos/intro-<slug>.json). Explicit and reviewed: each pair names a page whose film is about
 * the tool the entry describes — never a neighbour's. Sections inherit their feature's pair. The film is labelled
 * "Overview film" in the panel; the Tutorials page still reads `video` alone, so "Video coming soon" keeps meaning
 * that no walkthrough was recorded. server/help-registry.test.ts holds every key and value to the registry and the
 * catalogue, and asks for a pair (or a NO_INTRO_FALLBACK reason) for each main-app feature at a feature page's route.
 */
export const INTRO_FALLBACKS: Readonly<Record<string, string>> = {
  // Google Ads
  "ads-manager": "adsManager", "click-guard": "clickGuard", "lsa-leads": "lsaLeads",
  // Google Business
  "google-business": "gbp", locations: "gbp", "profile-guard": "profileGuard", "posts-photos": "gbpContent", photos: "gbpContent",
  "photo-optimizer": "media", "media-library": "media", "ranking-grid": "rankingGrid", agency: "agency",
  reinstatement: "reinstatement", domains: "domains", "mail-alerts": "mailAlerts",
  // Reviews
  "google-reviews": "reviews",
  // Permits & Databases
  "search-permits": "permits", "database-directory": "permits", "search-history": "permits", "permit-alerts": "permits",
  "property-records": "property",
  // Tools
  cloudflare: "cloudflare", "search-console": "searchConsole", seo: "seo", "site-scan": "siteScan", "ip-tracker": "ipTracker",
  "vpn-shield": "vpnShield", "competitor-intel": "competitors", "master-class": "masterClass", "call-assistant": "callAssistant",
  "social-media": "social", "social-youtube": "social", developers: "customerApi",
  // CRM (its pages have their own walkthroughs; the pair is the fallback should one be re-recorded)
  "crm-home": "crm", "crm-pipeline": "crmLeads", "crm-lead-new": "crmLeads", "crm-schedule": "crmSchedule", "crm-schedule-views": "crmSchedule",
  "crm-sms-setup": "texting", jobcam: "jobcam", "crm-jobcam-share-link": "jobcam", "crm-jobcam-share": "jobcam", "crm-jobcam-tags": "jobcam",
  "crm-jobcam-upload": "jobcam", "crm-jobcam-timeline": "jobcam", "crm-jobcam-project": "jobcam",
};
/**
 * Main-app features that sit at a feature page's route on purpose without that page's film: the page is about a
 * different tool. Key → why (the test prints it).
 */
export const NO_INTRO_FALLBACK: Readonly<Record<string, string>> = {
  home: "the Gabe film is about the assistant, not the dashboard the home page shows",
};

/** The intro film's help key for an entry (its feature's pair in INTRO_FALLBACKS), or undefined when there is none. */
export const introFallbackKey = (e: Pick<HelpDraft, "key" | "parent">): string | undefined => {
  const page = INTRO_FALLBACKS[e.parent ?? e.key];
  return page ? introVideoKey(page) : undefined;
};

/** `video` is the walkthrough of the entry's own manifest (./videos/<key>.json); `film` adds the intro fallback. */
function withFilms(e: Draft): HelpEntry {
  const video = helpVideoFor(e.key);
  const fallback = introFallbackKey(e);
  const intro = video || !fallback ? null : helpVideoFor(fallback);
  return { ...e, video, film: video ?? intro, videoSource: video ? "walkthrough" : intro ? "intro" : null };
}

/** Every entry. `video` is the recorded walkthrough of its manifest file (./videos/<key>.json), else null. */
export const HELP_ENTRIES: readonly HelpEntry[] = [...entries, ...collected].map(withFilms);

const BY_KEY = new Map(HELP_ENTRIES.map((e) => [e.key, e]));
/**
 * A feature page's intro film (`intro-<key>`, shared/feature-pages/intro-video.ts) has no written entry: the page
 * itself is the entry. Synthesized from the page's own copy so the recorder, the YouTube description and the
 * social cuts have title, route and text to work from; `unlisted`, so it gets no Tutorials card and no "i" panel.
 */
const INTRO_GROUPS: Record<string, HelpGroup> = {
  reviews: "Reviews", adsManager: "Google Ads", clickGuard: "Google Ads", lsaLeads: "Google Ads",
  permits: "Permits & Databases", property: "Permits & Databases",
  crm: "CRM", crmLeads: "CRM", crmSchedule: "CRM", jobcam: "CRM", texting: "CRM", callAssistant: "CRM",
  gbp: "Google Business", profileGuard: "Google Business", gbpContent: "Google Business", media: "Google Business",
  rankingGrid: "Google Business", agency: "Google Business", reinstatement: "Google Business", domains: "Google Business",
  mailAlerts: "Google Business", competitors: "Google Business",
};
export const introHelpEntry = (key: string): HelpEntry | undefined => {
  if (!key.startsWith(INTRO_VIDEO_PREFIX)) return undefined;
  const page = FEATURE_PAGES.find((p) => introVideoKey(p.key) === key);
  if (!page) {
    // A feature with its own hand-built page (the AI Call Assistant): title and lede are all it declares.
    const ext = EXTERNAL_FEATURE_PAGES.find((p) => introVideoKey(p.key) === key);
    if (!ext) return undefined;
    return { key, title: ext.title, route: ext.app.href, group: INTRO_GROUPS[ext.key] ?? "Tools", unlisted: true,
      whatItIs: ext.lede, whatItDoes: ext.lede, howToUse: [], howItWorks: ext.lede, ...introFilm(key) };
  }
  return {
    key, title: page.title, route: page.app.href, group: INTRO_GROUPS[page.key] ?? "Tools", unlisted: true,
    whatItIs: page.lede,
    whatItDoes: page.cards.map((c) => `${c.title}: ${c.body}`).join(" "),
    howToUse: page.steps.map((st) => `${st.title}: ${st.body}`),
    howItWorks: page.inDepth?.paragraphs[0] ?? page.lede,
    ...introFilm(key),
  };
};
/** An intro entry's own recording is an intro film, and it is labelled as one. */
const introFilm = (key: string): Pick<HelpEntry, "video" | "film" | "videoSource"> => {
  const video = helpVideoFor(key);
  return { video, film: video, videoSource: video ? "intro" : null };
};
export const helpEntry = (key: string): HelpEntry | undefined => BY_KEY.get(key) ?? introHelpEntry(key);

/**
 * The entry for a page path, so a page title can carry its "i" without naming a key (owner 2026-10-15: every
 * page gets an "i" that says what it is for and how to use it, with the walkthrough inside). Exact route first,
 * then the longest route prefix (an entry's `route`, or one of its `alsoAt` routes); at the same route a feature
 * beats its sections (they share the feature's route unless a section declares a more specific one, e.g.
 * "/cloudflare/connections"), and among features the one named after the route's last segment wins ("/crm/settings"
 * → "crm-settings" rather than any of the dozen entries that live on that page; "/crm/pipeline" → "crm-pipeline",
 * not the shorter "crm-project"), then the shortest key, then alphabetical — deterministic, never file order.
 * Query and hash are ignored.
 */
export function helpKeyForRoute(pathname: string): string | undefined {
  const path = (pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/");
  const clean = (r: string) => r.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  /** How well a feature's key names the route's last segment: exact ("crm-settings" / "settings"), then "-settings", then contains it. */
  const named = (key: string, r: string) => {
    const seg = r.slice(r.lastIndexOf("/") + 1);
    return key === seg || key === `crm-${seg}` ? 3 : key.endsWith(`-${seg}`) ? 2 : key.includes(seg) ? 1 : 0;
  };
  let best: HelpEntry | undefined, bestLen = -1, bestRank = -1;
  for (const e of HELP_ENTRIES) {
    if (e.unlisted) continue;
    for (const r of [e.route, ...(e.alsoAt ?? [])].map(clean)) {
      if (r === "/" || !(path === r || path.startsWith(r + "/"))) continue;
      // Sections lowest, then the "Start here" films (a tour of the CRM is not the home page's "i"), then features by name.
      const rank = e.parent ? 0 : e.group === "Start here" ? 1 : 2 + named(e.key, r);
      // Still tied: the shortest key, then alphabetical — never the order the entries happen to be listed in.
      const wins = r.length > bestLen || (r.length === bestLen && (rank > bestRank ||
        (rank === bestRank && !!best && (e.key.length < best.key.length || (e.key.length === best.key.length && e.key < best.key)))));
      if (wins) { best = e; bestLen = r.length; bestRank = rank; }
    }
  }
  return best?.key;
}

/** The features (one Tutorials card each), in sidebar order within their group. */
export const HELP_FEATURES: readonly HelpEntry[] = HELP_ENTRIES.filter((e) => !e.parent && !e.unlisted);
/** A feature's sections, in page order. */
export const helpSections = (featureKey: string): HelpEntry[] => HELP_ENTRIES.filter((e) => e.parent === featureKey);
/** Features of one group. */
export const helpFeaturesIn = (group: HelpGroup): HelpEntry[] => HELP_FEATURES.filter((e) => e.group === group);
/** The card's one-liner: the first sentence of "what it's for". */
export const helpSummary = (e: HelpEntry): string => /^.*?[.!?](?=\s|$)/.exec(e.whatItIs)?.[0] ?? e.whatItIs;
/** A section's short name ("Cloudflare → Sites" → "Sites"). */
export const helpShortTitle = (e: HelpEntry): string => e.title.split(" → ").pop()!;
/** Keys whose video waits for the owner's approval before it is posted anywhere (`youtube.hold` on the entry). */
export const heldHelpKeys = (): string[] => Array.from(new Set([...HELP_ENTRIES.filter((e) => e.youtube?.hold === true).map((e) => e.key), ...Object.keys(YOUTUBE_HOLDS)])).filter((k) => BY_KEY.has(k));
/** Why a key is held, when the reason is on record (./holds.ts); the overview films' reason is the owner's approval. */
export const holdReason = (key: string): string | null => YOUTUBE_HOLDS[key] ?? (BY_KEY.get(key)?.youtube?.hold ? "an overview film: the owner releases it" : null);
/** CRM routes live on the CRM (portal) host. */
export const isCrmRoute = (route: string): boolean => route === "/crm" || route.startsWith("/crm/");
/** Does a help entry match a search? Every word must appear somewhere in its text (or its sections'). */
export function helpMatches(e: HelpEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [e, ...helpSections(e.key)]
    .map((x) => [x.title, x.whatItIs, x.whatItDoes, x.howItWorks, ...x.howToUse, ...(x.needs ?? [])].join(" "))
    .join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}
