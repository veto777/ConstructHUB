/**
 * THE help registry: one entry per feature (and per major section of Cloudflare and Search Console).
 * It drives the "i" buttons (<HelpButton k="…" />, client/src/components/help-button.tsx), the
 * walkthrough-video slot beside them and the /tutorials page. server/help-registry.test.ts keeps it
 * complete (every mounted key exists, every entry has its four parts, every route is a real path).
 *
 * Every sentence was written from the code or from text the product already ships and tests
 * (server/data/hub-knowledge.md, shared/feature-pages, client/src/lib/info-content.ts). Plan names
 * come from the price book (shared/plans.ts), never typed here. `video` is never typed here either:
 * it is built from the manifest of recorded walkthroughs (./videos.json, written by
 * scripts/tutorials/mux.ts — docs/tutorials/VIDEO-PIPELINE.md), and is null for every entry that
 * has no recording.
 */
import { MODULE_NAMES, PLANS, planForModule, type ModuleKey } from "../plans";
import { CALL_ASSISTANT_PLANS, COMPETITOR_INTEL_PLANS, PROTECTED_SITE_PLANS, callAssistantAvailabilityLine } from "../plan-copy";
import type { HelpEntry, HelpGroup } from "./types";
import { helpVideoFor } from "./videos";

export { HELP_GROUPS } from "./types";
export type { HelpEntry, HelpGroup, HelpVideo } from "./types";

const planOf = (module: ModuleKey) => PLANS[planForModule(module)].name;
/** "The <plan> plan, which includes the “<module>” module." — both names read from the plan model. */
const moduleNeed = (module: ModuleKey) => `The ${planOf(module)} plan, which includes the “${MODULE_NAMES[module]}” module.`;
const EDGE = moduleNeed("cloudflareSearchConsole");
const IDENTITY = "Sensitive buttons ask you to confirm it’s you first (password, authenticator code or an emailed code).";
const PROTECTED = `Included with the ${PROTECTED_SITE_PLANS} plans; the number of protected websites depends on the plan.`;

type Draft = Omit<HelpEntry, "video">;
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
    whatItIs: "The list of websites (zones) found in your connected Cloudflare accounts.",
    whatItDoes: "Shows each site’s status at Cloudflare (active or pending), how many of your Locations use that website, when it was last synced, and the last error if a job failed. Clicking a site’s name opens its daily traffic, firewall events, top paths, countries, bot share and flagged IP addresses.",
    howToUse: [
      "Search by name or filter by status to find a site.",
      "Tick sites and choose “Sync selected”, or “Sync all matching sites” for everything the search and filter match. Each row also has its own Sync button.",
      "Open Work queue to watch the sync finish.",
      "Click a site’s name to read what came back.",
    ],
    howItWorks: "Sync adds one job per site; a site that already has a sync waiting is not queued twice. The worker asks Cloudflare’s analytics for the last 24 hours: daily requests, page views, unique visitors and threats (counted in UTC days), the latest 100 firewall events, the top 20 paths, and bot scores when the Cloudflare plan provides them. Anything Cloudflare doesn’t return is shown as unavailable. A site is linked to a Location when its domain matches the Location’s website exactly. The list refreshes itself every 15 seconds.",
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
    key: "cloudflare.connections", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Connections",
    whatItIs: "Where you give ConstructHUB access to a Cloudflare account, see the accounts already connected, and remove them.",
    whatItDoes: "There are three ways in. Recommended: enter your Cloudflare login email and Global API Key (Cloudflare’s master key). ConstructHUB checks them with Cloudflare, lists your accounts and zones, and you tick the zones to share; “Create limited key” then has Cloudflare make a new key named “ConstructHUB (date)” that can do only three things on the zones you ticked: Zone Read, Analytics Read and Zone WAF Edit (WAF is Cloudflare’s firewall rules). Fallback: paste a limited token you created yourself in Cloudflare. Agency membership: a path for ConstructHUB’s own agency account only — on any other account the button answers that it is not configured.",
    howToUse: [
      "In Cloudflare open My Profile → API Tokens → Global API Key → View, and copy the key.",
      "Here, enter your Cloudflare login email and the key (optionally a domain to find), then choose “Verify and choose zones”. Confirm it’s you when asked.",
      "Tick the zones to share and choose “Create limited key”.",
      "The connection appears in the list and its sites are imported for you. “Discover sites” imports them again later.",
      "“Disconnect” removes a connection.",
    ],
    howItWorks: "The Global API Key travels with the verify request and the create request and is used only for them: to confirm the email matches the Cloudflare user, to list zones, and to create the limited key. It is never saved; the server wipes it from each request and the form clears it once the limited key exists. The limited key is stored encrypted. A pasted token is checked with Cloudflare (it must be active and able to list zones) before it is saved; ConstructHUB cannot read what it is allowed to do, so the list says to verify its permissions in Cloudflare. Disconnect deletes the saved key and cached data here and, for a key ConstructHUB created, asks Cloudflare to delete it. Rules already applied stay in Cloudflare until you undo them or remove them there. Connecting and disconnecting are written to your account activity and send a notification.",
    needs: [EDGE, "The Cloudflare login email and Global API Key, or a token with Zone Read, Analytics Read and Zone WAF Edit on the chosen zones.", IDENTITY],
  },
  {
    key: "cloudflare.onboarding", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Onboarding",
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
    key: "cloudflare.work-queue", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Work queue",
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
    key: "cloudflare.edge-audit", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Edge audit",
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
    key: "cloudflare.guide", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Guide",
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
    whatItIs: "The list of Search Console properties found in your connected Google accounts.",
    whatItDoes: "Shows each property with your access level at Google (siteOwner, siteFullUser or siteRestrictedUser, or access_removed when Google no longer lists it), how many of your Locations use that website, when it was last synced and the last error if a job failed. Clicking a property’s name opens its search analytics, sitemaps and index checks.",
    howToUse: [
      "Search by name or filter by access level.",
      "Tick properties and choose “Sync selected”, or “Sync all matching sites”. Each row also has its own Sync button.",
      "Open Work queue to watch the downloads finish.",
      "Click a property’s name to read the data.",
    ],
    howItWorks: "Properties are found automatically: once when you connect, then about every hour. One that disappears from Google’s list is marked access_removed instead of deleted. A property is linked to a Location when its domain matches the Location’s website. Sync adds one job per property, and a property that already has a sync waiting is not queued twice. The list refreshes itself every 15 seconds.",
    needs: [EDGE, "At least one Google account under Connections."],
  },
  {
    key: "search-console.sync-range", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Sync date range",
    whatItIs: "The two date boxes above the Sync buttons: how far back to download search data.",
    whatItDoes: "Sets the first and last day for the next Sync. The first day can be up to 16 months ago; the last day cannot be in the future. Leave both empty and Sync downloads the last 31 days up to three days ago.",
    howToUse: [
      "Pick “Sync from” — any day within the last 16 months.",
      "Optionally pick “Sync through”. It is only used when “Sync from” is set; empty means up to three days ago.",
      "Choose Sync selected or Sync all matching sites.",
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
    key: "search-console.connections", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Connections",
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
    key: "search-console.onboarding", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Onboarding",
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
    key: "search-console.work-queue", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Work queue",
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
    key: "search-console.guide", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Guide",
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
    whatItIs: "A live search of building-permit records on the government portals that support it.",
    whatItDoes: "Runs your search on each searchable portal in the area you pick, shows each portal’s progress, and lists the permits found. Results can be filtered by status, and each has a Property Lookup link.",
    howToUse: [
      "Sidebar → Permits & Databases → Search Permits.",
      "Pick a state, then a county or city (or all of them). The page shows how many searchable portals are in that area.",
      "Choose a search type — Address, Keyword, Name, Company Name, License # or Permit # — and optionally a date range.",
      "Click Search, then filter by status and click a result for details.",
    ],
    howItWorks: "Coverage varies by portal: some cannot be searched live or need their own login. When a portal fails, the results say so and may be incomplete. ConstructHUB never invents permit data. Each search counts toward your plan’s monthly permit searches.",
    needs: ["Any plan; searches are counted against the plan’s monthly allowance."],
  },
  {
    key: "database-directory", group: "Permits & Databases", route: "/databases", title: "Database Directory",
    whatItIs: "A directory of county and city permit offices in all 50 states and DC.",
    whatItDoes: "Lists each jurisdiction with its official permit portal link when one is on record and has been checked. Links that could not be confirmed are labelled, and where no portal is known you get a “Find permit portal” web search instead of a guessed link.",
    howToUse: [
      "Sidebar → Permits & Databases → Database Directory.",
      "Find the county or city you need.",
      "Open its official portal link, or use “Find permit portal” when there is none.",
    ],
    howItWorks: "Portal links are stored only after a liveness check, and dead ones are marked. Nothing in the directory is generated or guessed.",
    needs: ["Free to browse."],
  },
  {
    key: "property-records", group: "Permits & Databases", route: "/property", title: "Property Records",
    whatItIs: "A finder for the official county property appraiser or assessor office.",
    whatItDoes: "Lists county offices, filtered by state and county, with a link to each office’s official site when one is on record and a web search when none is. Ownership, assessed values and tax records are looked up on the county’s own site.",
    howToUse: [
      "Sidebar → Permits & Databases → Property Records.",
      "Filter by state and county, or search.",
      "Open the county office’s site from its row and search there.",
    ],
    howItWorks: "The office list is sourced from NETR Online. ConstructHUB links to the county; it does not copy or store the county’s property data.",
    needs: ["Free to browse."],
  },
  {
    key: "search-history", group: "Permits & Databases", route: "/history", title: "Search History",
    whatItIs: "The list of permit searches you have run.",
    whatItDoes: "Lists your recent searches so you can run one again with one tap, and delete one or all of them.",
    howToUse: [
      "Sidebar → Permits & Databases → Search History.",
      "Choose “Search again” on a row to open that search on the Search page.",
      "Delete a search from its row, or delete them all.",
    ],
    howItWorks: "“Search again” opens the Search page with the same values filled in; running it is a new search and counts toward your plan’s monthly permit searches.",
  },
  {
    key: "scrape-schedules", group: "Permits & Databases", route: "/schedules", title: "Scrape Schedules",
    whatItIs: "Automatic permit refreshes for portals that support live search. This page is for administrators only.",
    whatItDoes: "Lists the shared schedules, and lets an administrator add one, pause or resume it, and delete it.",
    howToUse: [
      "Open Scrape Schedules (administrators only).",
      "Choose “Add schedule”, pick one of the live-searchable portals and enter the value to search for.",
      "Pause, resume or delete a schedule from its row.",
    ],
    howItWorks: "A schedule can only be made for a portal that has a verified link and supports live search. Other accounts see a message that administrator access is required.",
    needs: ["Administrator access."],
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
    key: "locations", group: "Google Business", route: "/locations", title: "Locations",
    whatItIs: "Where each business lives — yours, or your clients’ if you are an agency.",
    whatItDoes: "Linking a location to its Google Business Profile listing syncs its reviews, photos, services and Google performance numbers, and unlocks Profile Guard, AI replies and Posts & Photos. A location’s page has Insights, Profile Guard, Location Info, Services, Photos & Videos, Social Profiles, Settings and Citations.",
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
    key: "profile-guard", group: "Google Business", route: "/locations", title: "Profile Guard",
    whatItIs: "A watch on a linked Google listing for changes to the fields you choose.",
    whatItDoes: "Compares Google’s live values with a snapshot you approved and alerts you to differences. Modes: Off, Notify (alert only) and Lockdown (puts your approved values back after a change is detected).",
    howToUse: [
      "Locations → open a linked location → Profile Guard.",
      "Choose the watched fields, click “Preview current Google values” and check the proposed snapshot carefully.",
      "Pick a mode, confirm it’s you, and click “Approve snapshot and save settings”.",
      "Later, use “Check now”, and Approve or Reject under “Pending changes and history”.",
    ],
    howItWorks: "Nobody can block edits at Google. Lockdown corrects a change after it is detected, and Google may take time to publish the correction. Approve accepts Google’s new value into your snapshot; Reject restores your approved value at Google.",
    needs: ["Any paid plan.", "A location linked to its Google Business Profile."],
  },
  {
    key: "agency", group: "Google Business", route: "/agency", title: "Agency workspace",
    whatItIs: "The workspace for agencies that manage many clients’ locations.",
    whatItDoes: "Keeps client records, team members and roles, onboarding requests for Google manager access, bulk actions across locations, and a Jobs list with progress and failures.",
    howToUse: [
      "Sidebar → Google Business → Agency.",
      "Under Clients, add client records and assign locations to them.",
      "Under Team, add members who already have a ConstructHUB login and choose their role and client access.",
      "Under Onboarding, choose the client and “Email manager instructions”; the client adds your agency email as a Manager on their Business Profile.",
      "On Locations, select locations and run a bulk action; follow it under Jobs.",
    ],
    howItWorks: "The client keeps ownership of the listing and never signs in to ConstructHUB. ConstructHUB spots the manager invitation, accepts clear matches, links the listing to the client and starts the first sync. Requests expire after 30 days.",
    needs: [moduleNeed("agencyWorkspace")],
  },
  {
    key: "domains", group: "Google Business", route: "/domains", title: "Domains",
    whatItIs: "A place to manage client domains’ DNS and nameservers while the registration stays with the registrar.",
    whatItDoes: "Connects a registrar for automation (Porkbun or Name-dot-com) or tracks domains you add by hand, maps domains to the client location whose website matches, applies DNS changes through a preview-and-confirm flow, and alerts on expiry, auto-renew off, nameserver or DNS changes, the website failing over HTTPS and certificates about to expire.",
    howToUse: [
      "Sidebar → Google Business → Domains.",
      "Connect a registrar, or add domains by hand for monitoring.",
      "Check each domain is mapped to the right location.",
      "For a change, preview it, review before and after, confirm it’s you and apply. The same flow rolls a change back.",
    ],
    howItWorks: "A change is marked verified once public DNS agrees. There are no transfers, purchases, renewals or deletions here. Copy website and email records before switching nameservers — a mistake can interrupt email.",
    needs: [moduleNeed("domainsMailAlerts")],
  },
  {
    key: "mail-alerts", group: "Google Business", route: "/mail-alerts", title: "Mail alerts",
    whatItIs: "One inbox for the important provider emails about client accounts.",
    whatItDoes: "Collects emails from providers such as Google Business Profile, Search Console, Google Ads, Cloudflare, registrars and Blotato that you forward to a private address, and matches them to clients.",
    howToUse: [
      "Sidebar → Google Business → Mail alerts, and copy your private forwarding address.",
      "In Gmail: Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address, and finish Google’s confirmation with the code shown in ConstructHUB.",
      "Create Gmail filters for the listed provider senders with “Forward it to” that address. Don’t forward your whole inbox.",
    ],
    howItWorks: "Unmatched mail is dropped and matched messages expire within 30 days. Matching a sender is not proof an email is genuine, so open the provider’s dashboard directly before acting on a security or billing alert.",
    needs: [moduleNeed("domainsMailAlerts")],
  },
  {
    key: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos",
    whatItIs: "A publisher for Google Business Profile updates and photos.",
    whatItDoes: "Writes, schedules and publishes updates, events, offers and photos to a linked location, with optional AI drafts, and keeps a calendar, queue and history.",
    howToUse: [
      "Sidebar → Google Business → Posts & Photos, and choose a linked location.",
      "Select photos from your library or upload them; optionally generate caption or post drafts and edit them.",
      "Compose the update, then set the schedule under “Schedule and approval”.",
      "Click “Approve & queue photos” or “Approve & queue post”. Approving is what authorises publishing.",
      "Follow each item under “Calendar, queue & history”.",
    ],
    howItWorks: "Google can reject content, and strips EXIF data from uploaded photos. If a result is “uncertain”, check Google before retrying, because a retry can post twice. Unsaved drafts are lost if you reload the page.",
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
    howItWorks: "Checks run only when you click; there are no automatic checks or alerts here. For automatic watching of your own linked listings, use Profile Guard.",
  },
  {
    key: "ranking-grid", group: "Google Business", route: "/ranking-grid", title: "GMB Ranking Grid",
    whatItIs: "A heatmap of where a business ranks in Google Maps results for one keyword, at many points around its area.",
    whatItDoes: "Each point shows the rank (1 to 20, or not found in the top 20). The report shows average and best rank, ranked versus unranked points, a rank distribution and the top competitors found. Scans are saved in Scan History and can be printed or saved as a PDF.",
    howToUse: [
      "Sidebar → Google Business → GMB Ranking Grid → New Scan.",
      "Search your business by name, address or Google Maps link.",
      "Enter a keyword, for example “roofing contractor”.",
      "Choose the grid size and the distance between points; the page shows the width covered and the credits the scan uses.",
      "Start the scan, then choose “View Full Report”.",
    ],
    howItWorks: "A scan is a snapshot at that moment; rankings move and none is guaranteed. Scans use the plan’s monthly ranking-grid credits, which reset monthly.",
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
      "Sidebar → Google Business → Photo Optimizer → Media Library.",
      "Create a folder for the job and upload its photos.",
      "Give the folder the client’s address if you want GPS coordinates embedded in its photos.",
      "Pick photos from the library when you send a review request or build a post.",
    ],
    howItWorks: "When a folder has an address, its GPS coordinates are embedded into that folder’s photos. Google strips that data from photos uploaded to a Business Profile.",
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
    whatItDoes: "Discovers your client accounts and marks which run Local Services Ads, sends client access requests, runs read-only health audits, and applies bulk protections such as presence-only location targeting, Click Guard IP exclusions, shared negative keywords, placement exclusions and ad schedules.",
    howToUse: [
      "Sidebar → Google Ads → Agency Ads & LSA → Connect MCC with Google.",
      "Under “Request client account access”, paste one “customer ID,email” pair per line, review, and confirm.",
      "Run the health audits and read the findings.",
      "For a bulk protection, preview it per account and confirm; use “Preview reversal” to undo one.",
    ],
    howItWorks: "Nothing changes in Google until you confirm a preview, and previews expire after 24 hours. Results depend on Google accepting each change. If the page says setup is required, the connection is not available yet.",
    needs: [moduleNeed("adsManager"), "A Google Ads manager (MCC) account."],
  },
  {
    key: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard",
    whatItIs: "Click-fraud protection for Google Ads.",
    whatItDoes: "A small tracking script on the pages your ads send people to records each visit and flags unusual traffic with fixed rules: bot-like browsers, too many visits from one IP address, and the same device showing up from different addresses. Repeat offenders are added to Blocked IPs, and a script in your own Google Ads account adds them as IP exclusions.",
    howToUse: [
      "Sidebar → Google Ads → Click Guard, and add your website domain.",
      "Copy the tracking code and paste it on every page your ads point to.",
      "Open the “Google Ads Script” tab and copy the IP exclusion script.",
      "In Google Ads go to Tools → Bulk actions → Scripts, paste it, authorise it, run it once and check the logs.",
      "Schedule the script to run hourly.",
    ],
    howItWorks: "ConstructHUB serves your exclusion list from a private address and the Google Ads script reads it on each run. The script only adds exclusions, never removes them, and Google allows 500 per campaign. The signals do not prove fraud and can flag real visitors; no savings are guaranteed.",
    needs: [PROTECTED, "Access to your website’s code and your Google Ads account."],
  },
  {
    key: "ad-fraud", group: "Google Ads", route: "/google-ad-fraud", title: "Ad Fraud",
    whatItIs: "A free reading page about click quality in Google Ads.",
    whatItDoes: "Shares ConstructHUB’s own observations and opinions from accounts it has worked on.",
    howToUse: [
      "Sidebar → Google Ads → Ad Fraud.",
      "Read the page.",
      "For protection on your own ads, set up Click Guard.",
    ],
    howItWorks: "The page itself says it is not an independent audit and that your traffic may differ, so its figures are not industry facts.",
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
    whatItIs: "Your Local Services Ads leads in one list.",
    whatItDoes: "Pulls in your phone-call and message leads for every Google Ads account you can access, can send a Telegram message when a new lead arrives, and lets you report bad leads to Google with a reason.",
    howToUse: [
      "Sidebar → Google Ads → LSA Leads, and connect your Google account.",
      "Optionally connect Telegram for new-lead messages.",
      "Read new leads in the list, and report a bad one with the reason that fits.",
    ],
    howItWorks: "Google decides whether to credit a reported lead. If the page says Google Ads is not configured, the connection is not available yet.",
    needs: ["A Google account with access to the Google Ads account that runs your Local Services Ads."],
  },

  /* ══ Reviews ══════════════════════════════════════════════════════════════════════════════════ */
  {
    key: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews",
    whatItIs: "Two tools on one page: asking clients for reviews, and working with the reviews already on your Google profile.",
    whatItDoes: "Review Requests emails a client a request with a button to leave a Google review, with optional reminders and tracking. Google Profile Reviews lists your synced reviews and lets you publish replies, save drafts, add private notes and prepare a report. AI can draft replies for approval.",
    howToUse: [
      "Google Reviews → “GMB Profiles & Templates” → Add Profile, and paste your Google review link.",
      "Choose “New Review Request”, pick the profile, enter the client’s name and email, and send now or schedule it.",
      "Watch the request’s tracking: opened, link clicked, feedback.",
      "On the Google Profile Reviews tab, filter reviews and publish replies to Google.",
      "For AI drafts, open “AI reply settings and drafts queue”, choose a location and a mode, then approve drafts in the queue.",
    ],
    howItWorks: "Every client gets the same button to leave a Google review whatever score they give — Google prohibits asking only happy clients. Reminders stop when the client responds, unsubscribes or reaches the maximum you set. AI can get facts wrong, so check every reply.",
    needs: ["Any plan.", "Google Profile Reviews needs a connected Google account and a linked location."],
  },

  /* ══ Tools ════════════════════════════════════════════════════════════════════════════════════ */
  {
    key: "call-assistant", group: "Tools", route: "/call-assistant", title: "AI Call Assistant",
    whatItIs: "An AI receptionist for your own phone line.",
    whatItDoes: "It answers calls, asks what the call is about, collects the details you chose, files a real lead as a client in the CRM, and texts or emails urgent calls to the teammate you picked. Every call is listed with its outcome, a summary, the transcript and the recording.",
    howToUse: [
      "Sidebar → Call Assistant → Numbers: pick a state (and optionally an area code or city) and choose a local number.",
      "To keep your existing number, forward it to the new one from your phone carrier.",
      "In Agent Studio, set your services, service area, the questions to ask, the voice and greeting, and who gets urgent calls.",
      "Try it in the Simulator by typing, then publish.",
      "Read the results under Calls. Pause stops it answering.",
    ],
    howItWorks: "It says it is a virtual assistant if asked, and can play a notice that calls may be recorded. It does not quote prices unless you allow price ranges, does not book appointments, and never gives out a teammate’s number. Publishing creates a version you can restore later.",
    needs: [`An add-on to the ${CALL_ASSISTANT_PLANS} plans.`, callAssistantAvailabilityLine()],
  },
  {
    key: "social-media", group: "Tools", route: "/social-media", title: "Social Media",
    whatItIs: "A composer, scheduler and approval queue for social posts, per business, sent through Blotato.",
    whatItDoes: "Writes and schedules posts for the social accounts you connected in Blotato, with a calendar and queue, an optional auto mode that drafts posts from your business details, and bulk tools for agencies.",
    howToUse: [
      "Create your own Blotato account, connect your social accounts there, and create an API key in Blotato’s settings.",
      "In Social Media, select a business, paste the key and choose “Connect Blotato”.",
      "Open “Map accounts and pages to this business” and save the destinations.",
      "Under Compose, write the post, add media, and choose Post now, Schedule post or Save draft.",
      "Follow each destination under “Calendar & queue”.",
    ],
    howItWorks: "The Blotato key is stored encrypted and never shown again. “Queued” or “accepted by Blotato” is not the same as published; if a status is uncertain, check Blotato before posting again. Disconnecting stops ConstructHUB’s queue but cannot recall posts Blotato already accepted.",
    needs: ["A Blotato subscription of your own — bought from Blotato, not billed by ConstructHUB.", "At least one Location to post for."],
  },
  {
    key: "social-youtube", group: "Tools", route: "/social-media", title: "Social Media → YouTube",
    whatItIs: "A direct connection between your ConstructHUB account and your own YouTube channel, so you can publish videos to it from the Social Media page.",
    whatItDoes: "Connects one YouTube channel per account, shows you which channel was connected, and uploads the video files you choose to it with the title, description, tags and privacy setting you enter. It cannot edit or delete videos, read comments or statistics, or reach anything else in your Google account.",
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
    whatItIs: "A check-up of your website that tells you what to fix, in priority order.",
    whatItDoes: "Checks technical and content issues (broken links, redirects, HTTPS, titles, headings, image text), Google PageSpeed measurements on sampled pages, how the site’s details compare with your Google Business Profile, and readiness for AI search. Each finding explains its impact and the fix steps.",
    howToUse: [
      "Sidebar → Site Scan. Choose a linked location (it fills in the website) or “No GBP comparison” and enter the address.",
      "Set the page cap and the number of PageSpeed pages, then “Start scan”.",
      "Read the findings. “Generate AI fix plan” writes drafts only — check them before using them.",
      "Mark items done, then rescan to see what is fixed, still present or new.",
      "Export a PDF, create a read-only share link, or enable a monthly rescan.",
    ],
    howItWorks: "The scanner reads the pages’ HTML and does not run JavaScript. It never changes your website or Google listing. Scores are diagnostic indicators, not ranking predictions. Share links expire after 30 days and can be revoked.",
    needs: ["Any plan; scans are counted against the plan’s monthly Site Scans."],
  },
  {
    key: "seo", group: "Tools", route: "/seo", title: "SEO",
    whatItIs: "A rank tracker and research tools: where your site ranks on Google for the keywords you choose, checked every week.",
    whatItDoes: "Five tabs. Rank tracker shows each keyword’s position on desktop and mobile with movement since the last check. Site explorer looks up any website’s search traffic, keywords, backlinks and competitors. Keywords returns up to 50 related searches with volume, cost per click and difficulty. Backlinks shows who links to your site. Competitors lists keywords a competitor ranks for and you do not.",
    howToUse: [
      "Sidebar → SEO, and add the domain you want to track (choose desktop, mobile or both, and how deep to check).",
      "Choose “Add keywords” and paste them, one per line.",
      "Wait for the weekly check, or choose “Run check now”; results arrive over the next few minutes.",
      "Use the other tabs to research keywords, backlinks and competitors, and track the ones worth going after.",
    ],
    howItWorks: "Checks are queued and run in the background. Keywords, research searches and backlink refreshes are counted against your plan’s allowances, shown on the page. If the page says rank tracking is being switched on, checks cannot run yet. Connecting the property in Search Console adds clicks and impressions to the overview.",
    needs: ["A plan that includes Site Scans."],
  },
  {
    key: "ip-tracker", group: "Tools", route: "/ip-tracker", title: "IP Tracker",
    whatItIs: "Visitor tracking for your websites, using the same tracking code and site list as Click Guard.",
    whatItDoes: "Shows visitors online now, total and daily visits, each IP address’s visits with pages, location and device details, traffic sources, landing pages, countries and cities, and browsers and devices.",
    howToUse: [
      "Sidebar → IP Tracker, and add your website.",
      "Paste the tracking code in the head section or before the closing body tag of every page you want to track.",
      "Open the Dashboard and Visitor List once visits start arriving.",
    ],
    howItWorks: "Visits appear only after the code runs on your site. “Online now” counts distinct IP addresses in the last 20 minutes. One website counts once across Click Guard, IP Tracker and VPN Shield.",
    needs: [PROTECTED],
  },
  {
    key: "vpn-shield", group: "Tools", route: "/vpn-shield", title: "VPN Shield",
    whatItIs: "A detector for visitors who show possible VPN or proxy signals.",
    whatItDoes: "Flags and logs those visits and can optionally react in the browser: show an overlay, record only, or redirect to an address you choose. You can whitelist up to 500 IP addresses that should never be blocked.",
    howToUse: [
      "Add your site in IP Tracker or Click Guard first.",
      "Open VPN Shield, select the site and paste its script tag on your pages.",
      "In Settings choose what flagged browsers get: overlay, record only or redirect.",
      "Whitelist your own addresses, such as an office VPN.",
    ],
    howItWorks: "Detection is a set of signals, not proof: VPN use is often legitimate and nothing here identifies a person. The overlay and redirect run after the page loads, only in browsers that run the script, and can be bypassed.",
    needs: [PROTECTED, "A site already added in IP Tracker or Click Guard."],
  },
  {
    key: "competitor-intel", group: "Tools", route: "/competitors", title: "Competitor Intel",
    whatItIs: "A market scan of the businesses competing in your trade and area, from public Google business listings.",
    whatItDoes: "Lists each competitor’s name, address, star rating, review count, phone and website, flags businesses that are new since earlier scans, and gives each a “BS Meter” — a rough score of review signals worth a closer look.",
    howToUse: [
      "Sidebar → Competitor Intel → New Market Scan.",
      "Choose the industry, enter a location such as “Tampa, FL” and pick a radius.",
      "Choose “Scan Market”.",
      "Open the scan to see every competitor and the review analysis.",
    ],
    howItWorks: "It uses public business listings only. BS Meter signals are not proof that a review is fake, and the scores are not probabilities. It does not show competitors’ ads, ad spend or private data.",
    needs: [`Included with the ${COMPETITOR_INTEL_PLANS} plans, with a monthly number of scans.`],
  },
  {
    key: "master-class", group: "Tools", route: "/master-class", title: "Master Class",
    whatItIs: "A step-by-step course on starting and growing a construction business.",
    whatItDoes: "Four modules — Business Formation & Licensing, GMB Setup & Optimization, Website & Online Presence, and SEO & Directory Domination — with state-by-state guides and checklists.",
    howToUse: [
      "Sidebar → Master Class.",
      "Read the overview, which is free.",
      "Open a module you have purchased to read its full content.",
    ],
    howItWorks: "Modules are sold separately or as a bundle and are not included in any plan. Any Master Class purchase also unlocks the full Google Ads Guide.",
    needs: ["A Master Class purchase for the full modules."],
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
    needs: ["A CRM workspace."],
  },
  {
    key: "crm-clients", group: "CRM", route: "/crm/clients", title: "Clients",
    whatItIs: "Every person you do business with, each on one page.",
    whatItDoes: "A client’s page holds their estimates, invoices, projects, payments, visits, private notes, measurements, uploads and an activity timeline. Every client automatically gets a private portal page.",
    howToUse: [
      "CRM → Clients → add a client with name, email, phone and address.",
      "Use the search box to find anyone by name, email, phone or address.",
      "Open a client to create an estimate, record a payment or schedule a visit.",
      "“View as client” shows exactly what they see in their portal.",
    ],
    howItWorks: "Notes are private to your team and never appear in the portal. The timeline is kept for you from what happens: estimates sent, emails opened, payments made.",
    needs: ["A CRM workspace."],
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
    needs: ["A CRM workspace."],
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
    needs: ["A CRM workspace."],
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
    needs: ["A CRM workspace."],
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
    needs: ["A CRM workspace."],
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
      "“Extend” adds seven days when a client needs more time.",
    ],
    howItWorks: "The first time a client opens the link they confirm their email with a one-time code. An estimate expires 7 days after it is sent. A signed estimate is locked, and permanent delete is for owners only.",
    needs: ["A CRM workspace.", "Price book items to pick from."],
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
    needs: ["A CRM workspace.", "A connected Stripe account for online payment."],
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
    needs: ["A CRM workspace."],
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
    needs: ["A CRM workspace.", "A Stripe account."],
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
    needs: ["A CRM workspace.", "Owner or admin access to manage the team."],
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
    needs: ["A CRM workspace."],
  },
  /* ══ Tools → Report an issue ══════════════════════════════════════════════════════════════════ */
  {
    key: "report-issue", group: "Tools", route: "/report-issue", title: "Report an issue",
    whatItIs: "The page for telling us something on ConstructHUB is broken, confusing or missing. “Report an issue” at the bottom of every page opens it.",
    whatItDoes: "Sends your description to our issue desk as its own numbered report, together with a short list of technical details the page shows you before you send. Under “Your reports” you can follow each report: Received, Being looked at, Fix ready, then Fixed or Not a bug, with our reply when there is one.",
    howToUse: [
      "Choose “Report an issue” at the bottom of the page where the problem happened.",
      "Say what you were trying to do and what happened instead. Check “Which page?” — it is filled in from where you came from.",
      "Choose how bad it is, and add a screenshot if a picture helps (one image, 5 MB at most).",
      "Open “What we send with your report” to see the details that go with it, then choose Send report.",
      "Keep the report number, and come back to “Your reports” for its status and our reply.",
    ],
    howItWorks: "Each report is stored separately and is never merged with someone else’s. The issue desk takes reports from people before the errors the site records by itself, and “I can’t use the site” before everything else; that choice also alerts our team straight away. Before a report is stored, email addresses and phone numbers in the text are masked and anything that looks like a password, key or card number is removed. Signed out, the page asks for an email address so we can write back; the list of your reports needs an account.",
    needs: ["Nothing: it works on every plan, and signed out too."],
  },
];

/** Every entry. `video` is the recorded walkthrough listed for its key in ./videos.json, else null. */
export const HELP_ENTRIES: readonly HelpEntry[] = entries.map((e) => ({ ...e, video: helpVideoFor(e.key) }));

const BY_KEY = new Map(HELP_ENTRIES.map((e) => [e.key, e]));
export const helpEntry = (key: string): HelpEntry | undefined => BY_KEY.get(key);

/** The features (one Tutorials card each), in sidebar order within their group. */
export const HELP_FEATURES: readonly HelpEntry[] = HELP_ENTRIES.filter((e) => !e.parent);
/** A feature's sections, in page order. */
export const helpSections = (featureKey: string): HelpEntry[] => HELP_ENTRIES.filter((e) => e.parent === featureKey);
/** Features of one group. */
export const helpFeaturesIn = (group: HelpGroup): HelpEntry[] => HELP_FEATURES.filter((e) => e.group === group);
/** The card's one-liner: the first sentence of "what it's for". */
export const helpSummary = (e: HelpEntry): string => /^.*?[.!?](?=\s|$)/.exec(e.whatItIs)?.[0] ?? e.whatItIs;
/** A section's short name ("Cloudflare → Sites" → "Sites"). */
export const helpShortTitle = (e: HelpEntry): string => e.title.split(" → ").pop()!;
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
