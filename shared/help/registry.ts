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
import { helpKeyForRouteIn } from "./route-match";
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
const SEO_NEED = `The ${SEO_TOOLS_PLAN} plan or above, or the SEO suite add-on on a smaller plan. Accounts that already have the SEO tools keep them.`;

/** The CRM is a separate product (shared/crm-plans.ts): its pages need a CRM plan, not a platform plan. */
export const CRM_NEED = "A ConstructHub CRM plan — the CRM is a separate product with its own plans.";

type Draft = HelpDraft;
const entries: Draft[] = [
  /* ══ Tools → Cloudflare ═══════════════════════════════════════════════════════════════════════ */
  {
    key: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare protection",
    whatItIs: "The control panel for websites that sit behind Cloudflare, yours or your clients’. Cloudflare is a service that stands in front of a website and filters its traffic.",
    whatItDoes: "It connects your Cloudflare accounts and lists their websites. It pulls the last day of traffic and security numbers for each one. It lets you preview blocking rules and then apply them. Nothing is blocked until you read the preview and confirm, and every applied change has an Undo.",
    howToUse: [
      "Open Connections and connect a Cloudflare account.",
      "Wait for its websites to appear under Sites; the first import runs for you.",
      "Tick sites and choose “Sync selected” to pull their traffic and security numbers.",
      "Tick sites, fill in “Preview edge protection”, choose Preview rules and read every rule.",
      "Choose “Confirm and queue edge changes”, then watch Work queue until the job is done.",
    ],
    howItWorks: "Sync, Discover, Confirm and Undo add a job to a list. ConstructHUB runs those jobs in the background, one at a time, and saves the result. Connecting talks to Cloudflare right away. ConstructHUB stores what you connected with, encrypted: the Cloudflare sign-in (full access to the account you ticked), the limited key it made, or your pasted token. It never keeps your Global API Key. If the job runner is switched off, the page shows a warning and jobs wait.",
    needs: [EDGE, "A Cloudflare account with the website added to it. The Guide tab explains how to put a site behind Cloudflare.", IDENTITY],
  },
  {
    key: "cloudflare.sites", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Sites",
    whatItIs: "The websites found in your connected Cloudflare accounts, one card each. Cloudflare calls each website a zone.",
    whatItDoes: "Each card shows the site’s status at Cloudflare (active or pending), its zone ID, when its data was last pulled, how many of your Locations use it, and any error from the last job. The strip above counts the matching sites, how many are synced and how many are linked to a Location. Open a site to read its daily traffic, firewall events, top pages, countries, bot share and flagged IP addresses. Until you have a site, two cards of sample data show what the list will look like.",
    howToUse: [
      "Search by name or filter by status to find a site.",
      "Tick sites and choose “Sync selected”, or “Sync all matching sites”; each card also has its own Sync button.",
      "Open Work queue to watch the sync finish.",
      "Choose Open, or the site’s name, to read what came back.",
    ],
    howItWorks: "A sync adds one job per site, never two for the same site. It pulls the last 24 hours from Cloudflare: daily requests, page views, visitors and threats (by UTC day), the latest 100 firewall events, the top 20 pages, and bot scores when the Cloudflare plan includes them. Anything Cloudflare does not return shows as unavailable, and a site links to a Location when its domain matches the Location’s website exactly. The sample cards are never saved, and the list refreshes every 15 seconds.",
    needs: [EDGE, "At least one connection under Connections."],
  },
  {
    key: "cloudflare.protection", parent: "cloudflare", group: "Tools", route: "/cloudflare", title: "Cloudflare → Preview edge protection",
    whatItIs: "Where you build blocking rules for the sites you ticked and read them before they go live. “Edge” means Cloudflare’s servers in front of the website.",
    whatItDoes: "Pick one of three rule packs and the page shows the exact rules. Ads door guards the one page your ads point to (such as /ads): it blocks visits with no browser signature, no Google Ads click ID or no normal page load, and bots other than Google’s, and it limits each address to 10 requests in 10 seconds there. Site-wide bad user agents blocks visitors with no browser signature or the signature of two known attack tools, and limits each address to 120 requests in 10 seconds. Flagged IPs blocks the 1 to 100 addresses you list, and your office addresses are left out of every pack.",
    howToUse: [
      "Tick the websites the rules are for on Sites.",
      "Pick the rule pack: for Ads door type the exact ads path; for Flagged IPs type the addresses, or use “Add to preview” beside a flagged IP on a site.",
      "Type your office IP addresses as exemptions so you do not block yourself.",
      "Choose Preview rules and read every rule under “Review before applying”.",
      "Choose “Confirm and queue edge changes” and confirm it’s you, or Cancel preview to drop it.",
    ],
    howItWorks: "A preview only saves a draft in ConstructHUB, with the site’s last synced numbers as a “before” copy; nothing is sent to Cloudflare. A preview can be confirmed for one hour. Confirming adds a job: ConstructHUB then adds the rules to the website’s firewall and rate-limit rules, each marked so ConstructHUB can later find and remove exactly those rules. The pack does not change Cloudflare’s security level, and the flagged IPs listed for a site come from Click Guard’s active blocked addresses and the visits VPN Shield blocked for that domain.",
    needs: [EDGE, "Rate-limit rules depend on your Cloudflare plan — the preview says so.", "Rules affect real visitors; only traffic that passes through Cloudflare is covered.", IDENTITY],
  },
  {
    key: "cloudflare.connections", parent: "cloudflare", group: "Tools", route: "/cloudflare/connections", title: "Cloudflare → Connections",
    whatItIs: "Where you give ConstructHUB access to a Cloudflare account, see the accounts already connected, and remove them.",
    whatItDoes: "There are three ways in. “Connect with Cloudflare” (recommended) gives ConstructHUB full access to the account you tick, which you can take back in Cloudflare under Manage OAuth authorizations. With your Global API Key (Cloudflare’s master key), “Create limited key” has Cloudflare make a key named “ConstructHUB (date)” that can do only three things on the websites you tick: Zone Read, Analytics Read and Zone WAF Edit (WAF is Cloudflare’s firewall). Or paste a limited token you made yourself.",
    howToUse: [
      "Choose “Connect with Cloudflare”, sign in at Cloudflare, tick the account to share and choose Authorize; you come back here and the sites import on their own.",
      "Copy your Global API Key instead, if you prefer: in Cloudflare open My Profile → API Tokens → Global API Key → View.",
      "Type your Cloudflare login email and the key under “Other ways to connect”, choose “Verify and choose zones” and confirm it’s you.",
      "Tick the websites to share and choose “Create limited key”.",
      "Use “Discover sites” to import a connection’s sites again, or “Disconnect” to remove it.",
    ],
    howItWorks: "The Global API Key is used only to confirm your email, list websites and make the limited key; it is never saved, and the form clears it once the limited key exists. The limited key is stored encrypted. A pasted token is checked with Cloudflare before it is saved, but ConstructHUB cannot see what it may do, so check its permissions in Cloudflare yourself. Disconnect deletes the saved key and stored data here and asks Cloudflare to delete any key ConstructHUB made; rules already applied stay until you undo them.",
    needs: [EDGE, "A Cloudflare login (the sign-in button), or the Cloudflare login email and Global API Key, or a token with Zone Read, Analytics Read and Zone WAF Edit on the chosen zones.", IDENTITY],
  },
  {
    key: "cloudflare.onboarding", parent: "cloudflare", group: "Tools", route: "/cloudflare/onboarding", title: "Cloudflare → Onboarding",
    whatItIs: "A way to email a client the steps for adding your agency’s Cloudflare login to their account as a member.",
    whatItDoes: "You pick a connection, list clients one per line (email, location ID, Cloudflare account ID) and send. Each client gets an email with the steps: in Cloudflare open Manage Account → Members and invite the agency email with the Domain Administrator role for their site. The email says plainly that this role gives full access to that domain, including DNS (the settings that point a domain at its website and email). The Invitations list shows each one as pending or accepted.",
    howToUse: [
      "Select the connection to use under Connections (the round button beside it).",
      "Find the client’s location ID in the Locations list; the location needs a website.",
      "Type one client per line: email, location ID, Cloudflare account ID.",
      "Choose “Send onboarding emails”.",
      "Watch the Invitations list change from pending to accepted.",
    ],
    howItWorks: "Sending adds one email per client, up to 100 clients at a time. It works only on the account ConstructHUB set up as the agency owner, with an agency email; any other account is told to connect with a key or token under Connections instead. While the agency connection is on, ConstructHUB accepts only the Cloudflare invitations that match one you sent. It then imports that account’s websites and emails the client that access was accepted.",
    needs: [EDGE, "The agency membership connection, which only ConstructHUB’s operator can set up.", "A Location with a website for each client."],
  },
  {
    key: "cloudflare.work-queue", parent: "cloudflare", group: "Tools", route: "/cloudflare/work-queue", title: "Cloudflare → Work queue",
    whatItIs: "The list of background jobs for your Cloudflare connections: the “is it done yet?” screen.",
    whatItDoes: "It shows every job by what it does (Find sites, Import data, Apply or Undo edge protection, Check account access, Send invitation), its state (Queued, Running, Done, Failed or Outcome unknown), when it started or finished, and its error message, if any. You can search, and filter by state.",
    howToUse: [
      "Open Work queue after any Sync, Discover, Confirm or Undo.",
      "Filter by state to find what is still waiting or what failed.",
      "Read a failed job’s message, fix the cause (for example, reconnect the account) and run the action again.",
      "Check in Cloudflare before repeating an uncertain job: the change may or may not have gone through.",
    ],
    howItWorks: "Jobs run one at a time in the background, oldest first. Jobs that only read (Find sites, Import data) are tried up to five times in all, with longer waits, unless Cloudflare refused or rejected the request; if Cloudflare says a usage limit is reached, the retry waits an hour. Jobs that change something (apply, undo, emails) are never re-run on their own: if they fail, or stall for 15 minutes, they are marked uncertain. Each account can start up to 500 of each kind of action per hour, and if your plan drops this module, waiting jobs are closed with a note.",
    needs: [EDGE],
  },
  {
    key: "cloudflare.edge-audit", parent: "cloudflare", group: "Tools", route: "/cloudflare/edge-audit", title: "Cloudflare → Edge audit",
    whatItIs: "The record of every protection change: each preview you made and what happened to it.",
    whatItDoes: "Each change shows its website, rule pack, state (preview, queued, applied, reverted or uncertain) and when it was previewed. It compares blocked requests in a sample of recent firewall events before the change and now, and shows when the latest numbers were taken. Applied and uncertain changes have an “Undo ConstructHUB rules” button.",
    howToUse: [
      "Open Edge audit after confirming a preview.",
      "Filter by state to find what is applied.",
      "Sync the site again after applying, so the latest numbers are fresh.",
      "Choose “Undo ConstructHUB rules” to take rules off, confirm it’s you, and watch Work queue until the state reads reverted.",
    ],
    howItWorks: "Undo adds a job that deletes only the rules ConstructHUB created for that change (it finds them by the mark it put on them) and then marks the change reverted. Other rules in Cloudflare are not touched. The block counts come from a sample of the most recent 100 events, so they show a direction, not proof that the rules caused it. Applied and reverted changes are written to your account activity and send a notification.",
    needs: [EDGE, IDENTITY],
  },
  {
    key: "cloudflare.guide", parent: "cloudflare", group: "Tools", route: "/cloudflare/guide", title: "Cloudflare → Guide",
    whatItIs: "Written step-by-step instructions, inside the page.",
    whatItDoes: "It covers putting a client site behind Cloudflare: adding the domain, checking its records and changing nameservers at GoDaddy, Namecheap, Squarespace and Bluehost. It also covers the three ways to connect, what Disconnect does, cautions about blocking rules, and connecting Google Search Console.",
    howToUse: [
      "Open the Guide tab.",
      "Follow “Put a client site behind Cloudflare” first if the site is not on Cloudflare yet.",
      "Follow “Connect Cloudflare to ConstructHUB” next.",
      "Use the links at the bottom of each card for Cloudflare’s and Google’s own instructions.",
    ],
    howItWorks: "The guide is fixed text. It does not read or change anything in your account. The same guide is under Social Media → Guides.",
  },

  /* ══ Tools → Search Console ═══════════════════════════════════════════════════════════════════ */
  {
    key: "search-console", group: "Tools", route: "/search-console", title: "Google Search Console",
    whatItIs: "Search Console is Google’s own report of how a website shows up in Google Search. This page brings the websites your Google account can see into ConstructHUB (Google calls each one a property).",
    whatItDoes: "It connects a Google account and finds its websites on its own. It downloads search data (clicks, times shown, click rate and average position) for any date range up to 16 months back. It lists each website’s sitemaps and checks whether specific pages are in Google’s index. It never asks Google to index a page.",
    howToUse: [
      "Open Connections, choose “Connect Google Search Console”, sign in to Google and allow access.",
      "Wait for the websites to appear under Sites; the first import runs for you.",
      "Set “Sync from” and “Sync through” if you want, tick websites and choose Sync selected.",
      "Click a website’s name to read its search data, sitemaps and index checks.",
      "Use the bulk box at the bottom of Sites to check pages or submit sitemaps.",
    ],
    howItWorks: "Buttons add jobs to a list and ConstructHUB runs them in the background, one at a time, so results arrive a little later; Work queue shows progress. What you read here is ConstructHUB’s saved copy of Google’s data. The Google access for Search Console is stored encrypted and kept separate from your Google Business Profile and Calendar connections.",
    needs: [EDGE, "A Google account that can see the property in Search Console.", IDENTITY],
  },
  {
    key: "search-console.sites", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Sites",
    whatItIs: "The websites found in your connected Google accounts, one card each (Google calls each one a property).",
    whatItDoes: "Each card shows your access level at Google (Owner, Full, Restricted, or “Access removed” when Google no longer lists it), its property ID, when it was last synced, how many of your Locations use it, and any error from the last job. The strip above counts the matching websites, how many are synced and how many are linked to a Location. Open a website to read its search data, sitemaps and index checks. Until you have a website, two cards of sample data show what the list will look like.",
    howToUse: [
      "Search by name or filter by access level to find a website.",
      "Tick websites and choose “Sync selected”, or “Sync all matching sites”; each card also has its own Sync button.",
      "Open Work queue to watch the downloads finish.",
      "Choose Open, or the website’s name, to read the data.",
    ],
    howItWorks: "Websites are found on their own: once when you connect, then about every hour. One that disappears from Google’s list is marked “Access removed” instead of deleted, and a website is linked to a Location when its domain matches the Location’s website. A sync adds one job per website, and one already waiting is not added twice. The sample cards are fixed text, never saved, and the list refreshes itself every 15 seconds.",
    needs: [EDGE, "At least one Google account under Connections."],
  },
  {
    key: "search-console.sync-range", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Sync date range",
    whatItIs: "The folded “Import date range” line above the list. It sets how far back the next Sync downloads search data.",
    whatItDoes: "Folded, the line says what the next Sync will download. Opened, it offers quick picks (the last 31 days, which is the default, or 3, 6, 12 or 16 months) and two date boxes for any other range. The first day can be up to 16 months ago; the last day cannot be in the future. Leave both empty and Sync downloads from 31 days ago through three days ago.",
    howToUse: [
      "Open “Import date range” above the list.",
      "Choose a quick pick, or type “Sync from” and, if you want, “Sync through”; a quick pick sets the first day only, and the last day stays three days ago.",
      "Choose Sync selected, Sync all matching sites, or a card’s own Sync.",
      "Watch Work queue: a long range becomes many small jobs.",
    ],
    howItWorks: "The server refuses a first day older than 16 months or later than the last day, and a last day in the future. It cuts the range into 28-day pieces and, for each piece, adds one download per breakdown (date, query, page, device, country). Each download asks Google for finalized web-search data, 25,000 rows at a time, and replaces what was stored for those days.",
    needs: [EDGE],
  },
  {
    key: "search-console.analytics", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Search analytics",
    whatItIs: "The search results table for one website: how often it was shown and clicked in Google Search.",
    whatItDoes: "It shows clicks, times shown (Google calls them impressions), CTR (clicks divided by times shown) and average position. You can break them down by date, query (the words searched), page, device or country, group by day, week or month, and pick the dates. It opens on the last 31 days.",
    howToUse: [
      "Click a website’s name on Sites.",
      "Choose the Breakdown, the Group and the From and To dates.",
      "Type in the search box to filter rows; results come 25 to a page.",
      "Run a Sync that covers those dates, and check Work queue, if the table is empty.",
    ],
    howItWorks: "The table reads the copy saved by Sync; opening it sends nothing to Google. When rows are grouped, CTR and position are weighted by times shown. Google returns only its top rows, leaves out some rare searches for privacy, and reports with a delay, so totals can be lower than the real ones. Jobs still running or failed leave gaps.",
    needs: [EDGE, "A finished Sync for the website."],
  },
  {
    key: "search-console.sitemaps-indexing", parent: "search-console", group: "Tools", route: "/search-console", title: "Search Console → Sitemaps and index checks",
    whatItIs: "Sitemaps and index checks for one website. A sitemap is the file that lists a site’s pages for Google; an index check asks Google whether one page is in its index.",
    whatItDoes: "It lists the sitemaps Google knows for a website, with the last submitted date and error count. It submits the sitemap addresses you list after you confirm. A Sync also submits the site’s own /sitemap.xml by itself when Google lists no sitemap and you have Owner or Full access. It asks Google whether the pages you list are in its index and shows each answer: Google’s status, a verdict of PASS, FAIL or NEUTRAL, and when it was checked. A count adds up the checked pages by verdict.",
    howToUse: [
      "Scroll to “Sitemaps and URL inspections” at the bottom of Sites.",
      "For each address, choose the Property and type the full URL; use “Add URL” for more rows and tick the rows to send.",
      "Choose “Review inspections” or “Review sitemaps”, check the list, then choose “Confirm and queue”.",
      "Watch Work queue, then click the website’s name to see the Sitemaps and Inspections lists; the sitemap list is refreshed by Sync.",
    ],
    howItWorks: "Each address must belong to its website or the whole request is refused, and one submission takes up to 100 rows. Submitting a sitemap needs Owner or Full access to the website. Index checks are limited to 1,900 a day and 500 a minute per website, shared by everyone connected to it. A check only reads Google’s status, it does not request indexing, and the coverage count covers only the pages you checked, not Google’s full report.",
    needs: [EDGE, "Owner or Full access in Search Console to submit sitemaps."],
  },
  {
    key: "search-console.connections", parent: "search-console", group: "Tools", route: "/search-console/connections", title: "Search Console → Connections",
    whatItIs: "Where you connect a Google account for Search Console, see the connected accounts, and remove them.",
    whatItDoes: "“Connect Google Search Console” sends you to Google’s sign-in. Google asks for your email identity and the Search Console permission only, not Google Business Profile, Ads or Calendar. After you allow it, the account appears in the list and its websites are imported for you.",
    howToUse: [
      "Choose “Connect Google Search Console”; Google’s sign-in opens.",
      "Pick the Google account and allow Search Console access.",
      "Check the account is in the Connections list when you come back.",
      "Use “Discover sites” to import its websites again, or “Disconnect” to remove the account.",
    ],
    howItWorks: "Finish the sign-in within 10 minutes; if you refuse or skip the Search Console permission, you see a “Google consent failed” notice and nothing is saved. Google’s access is stored encrypted and renewed on its own, and if Google stops accepting it, jobs fail with “Reconnect Search Console”. Disconnect deletes only ConstructHUB’s saved access and stored Search Console data; removing ConstructHUB in your Google Account can also remove its other Google permissions. Connecting and disconnecting are logged in your account activity and send a notification.",
    needs: [EDGE, "A Google account with a verified email.", IDENTITY],
  },
  {
    key: "search-console.onboarding", parent: "search-console", group: "Tools", route: "/search-console/onboarding", title: "Search Console → Onboarding",
    whatItIs: "A way to email a client the steps for adding your Google account as a user on their Search Console website.",
    whatItDoes: "You pick a connection, list clients one per line (email, location ID) and send. Each client gets an email with the steps: in Search Console open Settings → Users and permissions → Add user, enter the connected Google email and choose Full. The Invitations list shows each one as pending or accepted.",
    howToUse: [
      "Select the Google account to use under Connections (the round button beside it).",
      "Find the client’s location ID in the Locations list; the location needs a website.",
      "Type one client per line: email, location ID.",
      "Choose “Send onboarding emails”.",
      "Watch the Invitations list change from pending to accepted.",
    ],
    howItWorks: "Sending adds one email job per client, up to 100 clients at a time. The client’s domain is taken from the Location’s website. Websites are re-checked about every hour. An invitation is marked accepted once that website shows up with Owner or Full access, and the client gets a confirmation email.",
    needs: [EDGE, "A connected Google account, and a Location with a website for each client."],
  },
  {
    key: "search-console.work-queue", parent: "search-console", group: "Tools", route: "/search-console/work-queue", title: "Search Console → Work queue",
    whatItIs: "The list of background jobs for your Search Console connections.",
    whatItDoes: "It shows every job by what it does (Find sites, Import data, Import search analytics, Inspect URL, Submit sitemap, Send invitation), its state (Queued, Running, Done, Failed or Outcome unknown), when it started or finished, and its error message, if any. You can search, and filter by state.",
    howToUse: [
      "Open Work queue after any Sync, Discover, inspection or sitemap submission.",
      "Filter by state to find what is still waiting or what failed.",
      "Read a failed job’s message, fix the cause (for example, reconnect Google) and run the action again.",
      "Check Search Console before submitting again after an uncertain sitemap job.",
    ],
    howItWorks: "Jobs run one at a time in the background, oldest first. Jobs that only read (Find sites, Import data, Import search analytics, Inspect URL) are tried up to five times in all, with longer waits, unless Google refused or rejected the request; when Google says a usage limit is reached, the retry waits an hour. Sitemap submissions and emails are never re-run on their own: if they fail they are marked uncertain. Each account can start up to 500 of each kind of action per hour, and if your plan drops this module, waiting jobs are closed with a note.",
    needs: [EDGE],
  },
  {
    key: "search-console.guide", parent: "search-console", group: "Tools", route: "/search-console/guide", title: "Search Console → Guide",
    whatItIs: "Written step-by-step instructions, inside the page.",
    whatItDoes: "Plain steps for Search Console only: connecting your Google account, bringing in up to 16 months of search numbers, how a site links to your Locations, sitemaps and page checks, adding a client's website, and disconnecting.",
    howToUse: [
      "Open the Guide tab.",
      "Follow “Connect your Google Search Console” first, then “Bring in your search numbers”.",
      "Use “A client’s website you can’t see yet” when the site belongs to someone else.",
    ],
    howItWorks: "The guide is fixed text. It does not read or change anything in your account.",
  },

  /* ══ Permits & Databases ══════════════════════════════════════════════════════════════════════ */
  {
    key: "search-permits", group: "Permits & Databases", route: "/search", title: "Search Permits",
    whatItIs: "Find building permits by address, name, company, license number or permit number. ConstructHUB searches the real city and county permit portals in the area you pick.",
    whatItDoes: "Pick what to search by, type the value, choose a state (and, if you want, one county or city) and press Search. Matches saved from earlier searches in that area show at once, then every searchable portal in the area is searched live and new finds are added as each one answers. Each result is one permit as the portal lists it: address, permit number, type, status, issue date and source, plus contacts when given. Narrow by status, date, county or jurisdiction (the town or county that issues permits), open Property lookup for the county’s property office, or find the search again in Search history.",
    howToUse: [
      "Open Search permits; the map and the count show the portals a live search can reach.",
      "Pick what you are searching by: Address, Keyword, Name, Company name, License # or Permit #.",
      "Type the value, choose a state and, if you want, a county or city, then press Search.",
      "Watch the portal list fill in: a tick means the portal was searched, a red mark means it could not be, and you can open the reason.",
      "Narrow the results with the status, date and jurisdiction filters, or open View details on a permit.",
    ],
    howItWorks: "A portal can be searched live only when its official link has been checked and ConstructHUB can work its search system; the counts and the map show exactly those portals. Each portal is searched for up to 75 seconds and a failure is named, so an empty list never means no permit exists. Only a live search counts toward your monthly permit searches; saved results are free, and if nothing can be searched, nothing is counted. Every permit shown came from a portal; ConstructHUB never invents permit data.",
    needs: ["Any plan; live searches count toward the plan’s monthly permit searches."],
  },
  {
    key: "database-directory", group: "Permits & Databases", route: "/databases", title: "Database Directory",
    whatItIs: "The list of every county and city in the US, with the official permit portal for each one where ConstructHUB has a checked link.",
    whatItDoes: "Each row names the place and its county and labels its portal: “Verified portal” (opened and checked), “Official site · unconfirmed” (listed, but our check could not confirm it; last try dated), “Permits issued by <county>” (an official page, linked, says the county issues that town’s permits) or “No portal on record”. Rows with a portal get Open portal and Search portal buttons and list what it can search by; rows without one get a “Find permit portal” web search, never a guessed link. An “Alerts supported” badge marks portals Permit alerts can watch, and Scrape runs a one-off live search of a portal that supports it. The counts at the top show how many jurisdictions (places that issue permits), counties and cities are on file and how many have a portal on record.",
    howToUse: [
      "Open Database directory and choose All, Counties or Cities.",
      "Type a city, county or state in the search box, or pick a state and then a county.",
      "Open the row’s portal link, or use “Find permit portal” when there is none.",
      "Use Property records on a row to open the county’s property office, or Scrape to run one live search on a supported portal.",
    ],
    howItWorks: "Portal links come from a checking process. A link shown as verified answered live and its page is about permits. A link listed by an official source whose check was blocked or unclear stays listed as unconfirmed, with its last check date. The link checker removes links that die. Where a town has no portal of its own, the county routing comes from an official page that says so. Nothing in the directory is generated or guessed; an unknown portal is shown as unknown.",
    needs: ["Free to browse."],
  },
  {
    key: "property-records", group: "Permits & Databases", route: "/property", title: "Property Records",
    whatItIs: "A finder for the county assessor or property appraiser office that holds a property’s ownership, value and tax records.",
    whatItDoes: "A county map is shaded by what is on record for each county, and a list of offices can be filtered by state and county or searched by name. Each office row shows its name and county (NETR’s directory lists no street addresses). Its buttons offer only what is real: Open portal and Search records when the official site is on record, “Open unconfirmed site” when our check could not confirm the link, a “Find property records” web search when there is no usable link, and Call when a phone number is on record. Clicking a county on the map shows that county’s office and can filter the list to it.",
    howToUse: [
      "Open Property records; a county link from Search permits or the Database directory lands here already filtered.",
      "Pick a state and a county, type an office, county or state in the search box, or click a county on the map.",
      "Open the office’s site from its row and look the property up there.",
    ],
    howItWorks: "The office list comes from NETR Online’s directory of assessor and appraiser offices, kept in ConstructHUB’s reference data. Each office link is checked; a link that could not be confirmed is marked, and the row offers a web search instead of pretending. A link that leads to a bot-check page is not offered; the row says so and offers the web search instead. ConstructHUB links to the county’s own site; it does not copy or store the county’s property data.",
    needs: [moduleNeed("propertyRecords")],
  },
  {
    key: "search-history", group: "Permits & Databases", route: "/history", title: "Search History",
    whatItIs: "The list of permit searches you have run, so you can run one again without retyping it.",
    whatItDoes: "It lists your latest 50 searches, newest first: what you searched for, the search type (address, name, company, license or permit number) and when you ran it. “Search again” opens Search permits with the same type, value and county filled in. The X on a row deletes that search; “Clear all” deletes your whole history after you confirm.",
    howToUse: [
      "Open Search history.",
      "Choose “Search again” on a row to reopen that search on Search permits, then press Search there.",
      "Delete a search with the X on its row, or use “Clear all” to delete every one.",
    ],
    howItWorks: "A search is saved whenever Search permits runs it, even when it only shows saved matches. Scrape in the Database directory saves one too. “Search again” only fills the form in. Running it is a new search, and it counts toward your plan’s monthly permit searches when a portal is searched live. Deleting a search also removes the results that were saved with it.",
  },
  {
    key: "scrape-schedules", group: "Permits & Databases", route: "/schedules", title: "Scrape Schedules",
    whatItIs: "Repeating permit searches that keep the shared permit cache fresh on portals that support live search. For administrators only.",
    whatItDoes: "Lists every schedule: the portal, whether it is active or paused, how often it runs (daily, weekly, monthly, or a custom interval such as every 6 hours or every 3 days), what it searches for (an address, a name, a company, a license number or a permit number) and when it last ran. “Add schedule” creates one; the switch on a row pauses or resumes it; the bin deletes it after you confirm.",
    howToUse: [
      "Open Scrape schedules (administrators only).",
      "Choose “Add schedule”, pick one of the live-searchable portals, the search type, the frequency (daily, weekly, monthly, or Custom with your own number of hours or days, from 1 hour to 30 days), and type the value to search for.",
      "Pause or resume a schedule with its switch, or delete it with the bin.",
    ],
    howItWorks: "Every 15 minutes the server runs up to five active schedules that are due, searching its portal once and saving what it finds into the shared permit cache (the same stored matches Search permits shows first); “Last run” is written only after a search really ran. A custom interval counts from the time a run starts. A run usually begins within 15 minutes of being due, and later when many are due at once. A schedule can only target a portal with a checked link and a search adapter for its platform, which is why the portal list is short. Accounts without administrator access see a message instead of the list.",
    needs: ["Administrator access."],
  },
  {
    key: "permit-alerts", group: "Permits & Databases", route: "/permit-alerts", title: "Permit Alerts",
    whatItIs: "Watches that tell you when a new permit you care about is filed: at an address, on a parcel, by a contractor, or for your trades in an area.",
    whatItDoes: "A watch names what to look for and which cities or counties to check; “Trades in an area” takes the trades you pick (roofing, HVAC, electrical, plumbing, solar and more), your own keywords, and an optional center address with a radius in miles. Each watch row shows its towns and counties, how many can be checked today, how you are notified, the last check, the last match and how many permits have matched. Matches opens the permits that matched, with number, type, status, address, contractor, date and portal link. Check now asks for an extra check, Pause stops a watch but keeps its history, and Delete removes the watch and its matches.",
    howToUse: [
      "Open Permit alerts and choose New watch.",
      "Pick what to watch: an address, a parcel, a contractor (name and optional license number), or trades in an area.",
      "Search the directory for the cities or counties to check and add them; each one says whether alerts are supported there yet.",
      "Tick how you want to hear about matches (email, text or Telegram) and save the watch.",
      "Open Matches on a watch to see what it found, or Check now to ask for a check on the next run.",
    ],
    howItWorks: "Alerts work only on portals that can list permits by date, marked “Alerts supported” in the directory; a town or county not supported yet stays on your watch and starts working the day it is. Every hour ConstructHUB reads the new permits from each watched portal and matches them to your watches, and a portal that cannot be reached is tried less often for a while (the row says so). Each match is sent once by the channels you chose; text alerts use your CRM texting allowance, and Telegram needs the account linked on LSA Leads. Distance matching needs an address-to-map service set up on the server; without one an area watch covers its whole towns and counties.",
    needs: [moduleNeed("permitAlerts")],
  },

  /* ══ Google Business ══════════════════════════════════════════════════════════════════════════ */
  {
    key: "google-profile", group: "Google Business", route: "/google-profile", title: "Google Profile",
    whatItIs: "A shortcut to your business’s Google listing inside ConstructHUB.",
    whatItDoes: "With one location it opens that location. With several it opens the Locations list to pick from. With none it opens the import from your connected Google account.",
    howToUse: [
      "Open Google Profile under Google Business in the sidebar.",
      "Click the location you want if you land on the list.",
      "Follow the import that opens if you have no location yet.",
    ],
    howItWorks: "The button only sends you on; everything it opens lives under Locations.",
  },
  {
    key: "directories", group: "Google Business", route: "/directories", title: "Directory Sync",
    whatItIs: "Keeps your business name, address and phone the same on every directory that lists you, and shows which ones got it wrong.",
    whatItDoes: "For each location it holds one business profile, started from the linked Google listing with your own edits kept. It keeps a card per directory page about your business with its check status, counts the profiles that are live, differ or are verified, and logs every change and check. The directory catalogue below lists the directories a contractor can be listed on, with filters by category, state, trade and more.",
    howToUse: [
      "Open Directories under Google Business in the sidebar; your only location is chosen for you, or pick one.",
      "Check the business profile and save it; every directory page is compared against it.",
      "Add the address of an existing directory page about your business, Re-check it, and open the comparison to see what differs.",
      "Fix the details on the directory itself, re-check, and watch the Verified count rise.",
      "Browse the directory catalogue to find more directories for your trade and state.",
    ],
    howItWorks: "A check loads the directory page and reads the business details it publishes. A card is Live when the page is confirmed to be your business and the required details match, and Details differ when one does not. Verified counts live cards with matching details. ConstructHUB does not create or edit directory listings.",
    needs: ["A business location in ConstructHUB."],
  },
  {
    key: "locations", group: "Google Business", route: "/locations", title: "Locations",
    whatItIs: "Where each business lives: yours, or your clients’ if you are an agency.",
    whatItDoes: "Linking a location to its Google Business Profile pulls in its reviews, photos, services and Google performance numbers, and unlocks Profile Watch, AI replies, Posts and Photos. A location’s page has Insights, Reviews, Profile Watch, Location Info, Services, Photos & Videos, Posts & Updates, Social Profiles, Settings and Citations.",
    howToUse: [
      "Open Locations under Google Business in the sidebar and choose Connect Google Business Profile, signing in with the Google account that owns or manages the listing.",
      "Choose Add location: “Import from GBP” lists the listings in your connected Google accounts; “Search Google” finds one by name, address or Maps link.",
      "Open a location to see its tabs; “Sync now” refreshes it right away.",
      "Use Unlink to stop syncing, or Delete Location to remove ConstructHUB’s copy; neither changes the listing on Google.",
    ],
    howItWorks: "Linked locations pull fresh data from Google about every six hours while connected. If a Google login’s access expires, the location shows “Reconnect Google account”. ConstructHUB does not create or verify Google listings.",
    needs: ["Any plan; how many locations you can add depends on the plan.", "A Google account that owns or manages the listing."],
  },
  {
    key: "profile-guard", group: "Google Business", route: "/locations", title: "Profile Watch",
    whatItIs: "A watch on a linked Google listing for changes to the fields you choose.",
    whatItDoes: "It compares Google’s live values with a saved copy you approved and alerts you to differences. Modes: Off, Notify (alert only) and Lockdown (puts your approved values back after a change is detected).",
    howToUse: [
      "Open a linked location under Locations and choose Profile Watch.",
      "Choose the watched fields, click “Preview current Google values” and check the proposed copy carefully.",
      "Pick a mode, confirm it’s you, and click “Approve snapshot and save settings”.",
      "Use “Check now” later, and Approve or Reject under “Pending changes and history”.",
    ],
    howItWorks: "Nobody can block edits at Google. Lockdown corrects a change after it is detected, and Google may take time to publish the correction. Approve accepts Google’s new value into your saved copy; Reject restores your approved value at Google.",
    needs: ["Any paid plan.", "A location linked to its Google Business Profile."],
  },
  {
    key: "agency", group: "Google Business", route: "/agency", title: "Agency workspace",
    whatItIs: "The workspace for an agency that looks after many businesses’ Google listings. Every client, location, team member and background job in one place.",
    whatItDoes: "Six tabs, each with its own “i”. Locations lists every location with its client and Google state, a CSV export, and tick boxes to run one action on many at once (sync, link, unlink, assign to a client, Watch mode, AI replies, post batches or Site Scans). Clients keeps one record per business, Team sets who may do what and which clients each person sees, and Onboarding emails a client the steps to add your agency as a manager on Google and follows the request until the listing is linked. Jobs shows every background action and how it went, and Settings (owner only) holds the agency name, the agency Google account and the invitation rule.",
    howToUse: [
      "Open Agency under Google Business in the sidebar; the switcher at the top opens any workspace you belong to, with your role beside it.",
      "Add a client with its contact email under Clients.",
      "Add the people who already have a ConstructHUB login under Team, and choose their role and client access.",
      "Choose the client under Onboarding and “Email manager instructions”; once the client adds your agency’s Google account as a Manager, the listing links itself.",
      "Tick locations on Locations and run a bulk action, then follow it under Jobs, where a failed row says why.",
    ],
    howItWorks: "Everything belongs to the workspace owner’s account and plan: members need no plan of their own, and a member given specific clients sees only those clients’ locations. The client keeps ownership of the listing and never signs in to ConstructHUB; ConstructHUB spots the manager invitation, accepts the one that matches a request, links the listing and pulls its data. Requests expire after 30 days, bulk actions become one job per location run within seconds, and a role that tries something it may not do gets a plain refusal. Until a tab has real data it shows clearly marked sample data.",
    needs: [moduleNeed("agencyWorkspace")],
  },
  {
    key: "domains", group: "Google Business", route: "/domains", title: "Domains",
    whatItIs: "One list of every client domain with its expiry date, DNS and website health, and a safe way to change DNS. DNS is the settings that point a domain at its website and email.",
    whatItDoes: "It connects a Porkbun or Name.com registrar account (the company you bought the domain from) and imports its domains, or tracks domains you type in. Each domain card shows its registrar, client, expiry date, auto-renew setting, nameservers and whether the website answers. A daily check flags a domain expiring within 60 days, auto-renew off, a website that is down or a security certificate (SSL) expiring within 30 days. DNS and nameserver changes go through a preview you confirm before anything reaches the registrar, and an applied change can be rolled back the same way.",
    howToUse: [
      "Open Domains under Google Business in the sidebar; while the list is empty, “How this works” and a sample show what you will get.",
      "Connect a registrar (a Porkbun or Name.com API key) to import its domains, or type domains under “Add domains”, up to 100 at a time.",
      "Select a domain, pick the client location and choose “Map selected to client”; mail alerts about that domain then name the client.",
      "Select domains, fill in the nameservers or the record, choose Preview, review the before and after under “Previews and change history”, confirm it’s you and apply.",
      "Use the “Needs attention” filter to see only domains expiring soon, with auto-renew off, a website down or a certificate about to expire.",
    ],
    howItWorks: "Imports, daily checks, previews and confirmed changes run in the background; when an administrator has not turned that on, the page says so and they wait, while adding, mapping and reviewing keep working. A change counts as verified once public DNS (the internet’s address book) shows it. There are no transfers, purchases, renewals or deletions here, and domains hosted on Cloudflare are changed in Cloudflare. Copy your website and email records before switching nameservers, because a mistake can cut off email.",
    needs: [moduleNeed("domainsMailAlerts")],
  },
  {
    key: "mail-alerts", group: "Google Business", route: "/mail-alerts", title: "Mail alerts",
    whatItIs: "One inbox for the important emails Google, Cloudflare and the registrars send about your clients’ accounts, matched to the client.",
    whatItDoes: "It collects the emails you forward from Google Business Profile, Search Console, Google Ads, Cloudflare and the registrars to a private address. It keeps only the alerts it recognizes, such as verification, suspension, ownership, billing, expiry and transfer. It grades each one critical, warning or info, and matches it to the client whose domain or business name it mentions. The counts at the top show alerts kept, unread, critical and unmapped; chips and filters narrow the inbox, and a filter list also takes a value you type.",
    howToUse: [
      "Open Mail alerts under Google Business in the sidebar and copy your private forwarding address.",
      "Add that address in Gmail under Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address, then confirm with the code or link shown here.",
      "Create Gmail filters for the listed senders with “Forward it to” that address; do not forward your whole inbox.",
      "Open an alert to read it (that marks it read); select alerts to mark them read or map them to a client.",
    ],
    howItWorks: "Mail from a sender or with a subject the matcher does not know is ignored, and a kept alert expires after 30 days. Matching a sender is not proof an email is genuine, so open the sender’s own site before acting on a security or billing alert. The private address needs an inbound mail domain on the server; without it the page says what the administrator must set, and alerts already stored still show.",
    needs: [moduleNeed("domainsMailAlerts")],
  },
  {
    key: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts",
    whatItIs: "A publisher for updates (posts) on your Google Business Profile.",
    whatItDoes: "It writes, schedules and publishes updates, events and offers to a linked location, with optional AI drafts in your style, and keeps a calendar, queue and history. A post can carry up to ten photos from your library.",
    howToUse: [
      "Open Posts under Google Business in the sidebar and choose a linked location, or open the location’s Posts & Updates tab.",
      "Write the update, or generate a draft and edit it; attach photos if you want them.",
      "Set the schedule under “Schedule and approve”: a first-publish date and time (blank means now), and under Advanced how often, your own list of times, or business hours only.",
      "Click “Approve & queue post”; approving is what allows publishing.",
      "Follow each item under “Calendar, queue & history”.",
    ],
    howItWorks: "Google can reject content, and strips the hidden details inside a photo file (EXIF) from uploaded photos. If a result is “uncertain”, check Google before retrying, because a retry can post twice. Unsaved drafts are lost if you reload the page.",
    needs: [moduleNeed("autoPosts"), "A location linked to its Google Business Profile."],
  },
  {
    key: "photos", group: "Google Business", route: "/gbp-photos", title: "Photos",
    whatItIs: "A publisher for photos on your Google Business Profile.",
    whatItDoes: "It uploads photos into your library and captions them, by hand or with an AI draft. It sets their Google category, schedules them onto a linked location, and keeps the queue and history. Posts have their own page.",
    howToUse: [
      "Open Photos under Google Business in the sidebar and choose a linked location, or open the location’s Photos & Videos tab.",
      "Upload up to 100 photos, or tick ones already in your library; generate caption drafts if you like and edit them.",
      "Pick the photo category and the schedule under “Schedule and approve”.",
      "Click “Approve & queue photos”; approving is what allows publishing.",
      "Follow each photo under “Calendar, queue & history”; Photo optimizer and Media library sit beside this page.",
    ],
    howItWorks: "Google strips the hidden details inside a photo file (EXIF) from uploaded photos, so the filename pattern and title carry your business name. Google can reject a photo; an “uncertain” result means check Google before retrying, because a retry can post twice.",
    needs: [moduleNeed("autoPosts"), "A location linked to its Google Business Profile."],
  },
  {
    key: "gmb-edit-monitor", group: "Google Business", route: "/gmb-monitor", title: "GMB Edit Monitor",
    whatItIs: "A manual change-checker for any Google listing, plus an AI review response generator.",
    whatItDoes: "Captures a baseline of a listing’s public data and, on later checks, compares it and keeps a history of every change found. The review response generator on the same page drafts a reply to a review you paste in, in one of three set tones (Professional, Empathetic, Grateful) or in a tone you describe yourself in up to 120 characters.",
    howToUse: [
      "Sidebar → Google Business → GMB Edit Monitor.",
      "Add a listing by name, address or Maps link and click “Check Now” to capture the baseline.",
      "Click “Check Now” again later, or “Check All”, to compare.",
      "For a reply draft, paste a review, enter your business name, pick a tone (or choose Custom and describe the tone in a few words) and generate; edit it and paste it on Google yourself.",
    ],
    howItWorks: "Checks run only when you click; there are no automatic checks or alerts here. For automatic watching of your own linked listings, use Profile Watch. A custom tone is a style note only. The draft is told to ignore any part of it that asks for offers, codes, contact details or claims. A reply that contains a discount or coupon code is refused.",
  },
  {
    key: "ranking-grid", group: "Google Business", route: "/ranking-grid", title: "GMB Ranking Grid",
    whatItIs: "A map of where a business ranks in Google Maps results for one keyword, checked at many points around its area.",
    whatItDoes: "Each point shows the rank (1 to 20, or not found in the top 20). The report shows average and best rank, ranked versus unranked points, how the ranks spread, and the top competitors found. Scans are saved in Scan History and can be printed or saved as a PDF.",
    howToUse: [
      "Open GMB Ranking Grid under Google Business in the sidebar; the scan form is at the top.",
      "Search your business by name, address or Google Maps link.",
      "Type a keyword, for example “roofing contractor”.",
      "Pick the grid size and spacing under Advanced (an odd size from 3 to 15, up to 20 miles apart); the page shows the area and credits.",
      "Start the scan, then choose “View Full Report”.",
    ],
    howItWorks: "A scan is a picture of that moment; rankings move and none is guaranteed. Scans use the plan’s monthly ranking-grid credits, which reset monthly. Until your first scan, the history shows clearly labeled sample data of what a finished scan looks like.",
    needs: ["Any plan; each scan uses ranking-grid credits."],
  },
  {
    key: "photo-optimizer", group: "Google Business", route: "/photos", title: "Photo Optimizer",
    whatItIs: "A batch tool that prepares job photos before you post them.",
    whatItDoes: "In one batch it adds a text or logo watermark, gives photos clear file names and adds descriptions. It also writes the hidden photo details (EXIF) and a GPS location from an address, and adjusts filters. You download the results or save them to the Media Library.",
    howToUse: [
      "Open Photo Optimizer under Google Business in the sidebar.",
      "Add your photos (JPG or PNG).",
      "Fill in Business Info and the options you want.",
      "Download the finished photos or choose “Save to Media Library”.",
    ],
    howItWorks: "Google removes the hidden photo details when photos are uploaded to a Google Business Profile. So those details and GPS locations help on your own files and other websites, not your Google ranking. If a batch fails, try fewer or smaller photos.",
    needs: ["Any plan."],
  },
  {
    key: "media-library", group: "Google Business", route: "/media-library", title: "Media Library",
    whatItIs: "Your project photos, organized into folders.",
    whatItDoes: "You can upload, rename, select and delete photos by folder, for example one folder per job. The library feeds review requests, Posts & Photos and Social Media.",
    howToUse: [
      "Open Photos → Media library under Google Business in the sidebar.",
      "Create a folder for the job and upload its photos.",
      "Give the folder the client’s address to keep the job’s location on file. To write GPS into photos, run them through Photo Optimizer.",
      "Pick photos from the library when you send a review request or build a post.",
    ],
    howItWorks: "A folder’s address is kept on file. Photos uploaded straight to a folder are stored as they are; only Photo Optimizer writes GPS into photos. Google removes that data from photos uploaded to a Google Business Profile. The numbers above the list count your folders and how many have an address and a location. While the library is empty, labeled sample data shows what folders look like.",
  },
  {
    key: "reinstatement", group: "Google Business", route: "/reinstatement", title: "Reinstatement",
    whatItIs: "A done-for-you service for a suspended Google Business Profile.",
    whatItDoes: "You send the details of your situation. The team reviews the case, tells you whether they think they can help, guides the fixes and documents, and writes and submits the appeal.",
    howToUse: [
      "Open Reinstatement under Google Business in the sidebar.",
      "Fill in the request form.",
      "Answer the team’s questions; they review a case within 1 to 2 business days.",
    ],
    howItWorks: "This is a service run by people, not an automatic tool. Google alone decides whether a profile is reinstated, so no outcome is guaranteed. The price is shown on the Reinstatement page.",
  },

  /* ══ Google Ads ═══════════════════════════════════════════════════════════════════════════════ */
  {
    key: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA",
    whatItIs: "A manager for agencies that run clients’ Google Ads from a Google Ads manager account (an MCC).",
    whatItDoes: "It finds your client accounts, marks which run Local Services Ads, sends access requests and runs look-only health checks. It also applies protections to many accounts at once: showing ads only to people in your area, Click Guard IP blocks, shared negative keywords, blocked placements and ad schedules. There are six sections: Recommendations, Client accounts, Access invitations, Protection previews, Queue and Health audit. Client accounts lists every account under the manager account, with Link account, the health audit and (under Advanced) the bulk protections.",
    howToUse: [
      "Open Agency Ads & LSA under Google Ads in the sidebar, choose Connect MCC with Google, then Discover clients.",
      "Paste one “customer ID,email” pair per line under Access invitations, preview, and confirm.",
      "Tick accounts under Client accounts and choose Queue health audit; read the findings under Health audit.",
      "Tick accounts and the steps you want under Recommendations, choose Preview, then confirm each preview under Protection previews; use “Preview reversal” to undo one.",
    ],
    howItWorks: "Nothing changes in Google until you confirm a preview, and previews expire after 24 hours. Every button adds a job ConstructHUB runs in the background; Queue shows each one. Results depend on Google accepting each change. If the page says setup is required, the connection is not available yet.",
    needs: [moduleNeed("adsManager"), "A Google Ads manager account (an MCC)."],
  },
  {
    key: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard",
    whatItIs: "Click-fraud protection for Google Ads. It watches who lands on your pages and builds the list of addresses to keep out.",
    whatItDoes: "A small tracking code on the pages your ads send people to records each visit and flags bot-like browsers, too many visits from one IP address (more than 5 in an hour or 15 in a day), and the same device showing up from different addresses. An address flagged past 10 visits in an hour is blocked on its own, and you can block one yourself. A script in your own Google Ads account then adds the blocked addresses as IP exclusions. The Dashboard shows visits, blocked addresses, unique visitors, the threat level and a trend for the dates you pick; Traffic sources and Traffic signals break the same visits down.",
    howToUse: [
      "Open Click Guard under Google Ads in the sidebar and add your website domain.",
      "Copy the tracking code from Tools and paste it on every page your ads point to.",
      "Open the “Google Ads script” section and copy the IP exclusion script.",
      "Paste it in Google Ads under Tools → Bulk actions → Scripts, allow it, run it once and check the logs.",
      "Schedule the script to run hourly.",
    ],
    howItWorks: "ConstructHUB serves your exclusion list from a private address and the Google Ads script reads it on each run. The script only adds exclusions, never removes them, and Google allows 500 per campaign. The signals do not prove fraud and can flag real visitors; no savings are guaranteed. Until you add a domain, the sections show sample data: clearly marked, not real and never saved.",
    needs: [PROTECTED, "Access to your website’s code and your Google Ads account."],
  },
  {
    key: "ad-fraud", group: "Google Ads", route: "/google-ad-fraud", title: "Ad Fraud",
    whatItIs: "A free reading page about click quality in Google Ads: what ConstructHUB saw in contractor accounts, and its opinion of it.",
    whatItDoes: "Ten sections open one at a time: invalid clicks, bot traffic, VPN and proxy clicks, the 500-IP block limit, click counts, disputes, who clicks contractor ads, Google’s own report, call-only ads and Google’s control of the market. Below them, Google’s explanations sit next to what the tracking showed. Six links lead to what you can do: Click Guard, the Google Ads script, device fingerprints, the data sections, a CSV export and the Ads guide.",
    howToUse: [
      "Open Ad Fraud under Google Ads in the sidebar.",
      "Choose a section title to open it; choose it again to close it.",
      "Pick a link under “What can you do about it?” to set up Click Guard on your own ads.",
    ],
    howItWorks: "Nothing on the page is measured from your account. The figures are ConstructHUB’s observations in accounts it has worked on plus published research, and the page says so. It is not an independent audit, and your traffic may differ.",
  },
  {
    key: "ads-guide", group: "Google Ads", route: "/google-ads-guide", title: "Ads Guide",
    whatItIs: "A 12-section playbook for contractor Google Ads campaigns.",
    whatItDoes: "It covers campaign setup, Google features to avoid, ad extras, keywords, location targeting, bidding and budget, and ad copy. It also covers landing pages, IP blocks, tracking, click fraud and costly mistakes, and ends with a launch checklist.",
    howToUse: [
      "Open Ads Guide under Google Ads in the sidebar.",
      "Read the overview, which is free.",
      "Open a section to read it in full.",
    ],
    howItWorks: "The full sections unlock with any Master Class purchase or a plan that includes the Master Class. The guide is ConstructHUB’s recommendations, not a guarantee of results.",
    needs: ["The full sections need a Master Class purchase or a plan that includes the Master Class; the overview is free."],
  },
  {
    key: "lsa-guide", group: "Google Ads", route: "/lsa-guide", title: "LSA Guide",
    whatItIs: "A free guide to Google Local Services Ads (LSA).",
    whatItDoes: "Eight sections: verification, answering calls, reviews, choosing services, message leads, service areas and hours, photos, and your business bio.",
    howToUse: [
      "Open LSA Guide under Google Ads in the sidebar.",
      "Read the sections in order, or jump to the one you need.",
      "Apply the changes in your own Local Services Ads account.",
    ],
    howItWorks: "The guide is reading material; it does not connect to or change your Local Services Ads account.",
  },
  {
    key: "lsa-leads", group: "Google Ads", route: "/lsa-leads", title: "LSA Leads",
    whatItIs: "Your Local Services Ads leads in one list, account by account, with a Good or Bad rating on each.",
    whatItDoes: "After you connect your Google account it lists every Google Ads account you can reach, with its lead count and how many were charged. Open an account to read its leads (call, message or booking), filter them to All, Charged or Disputed, and rate each one: Good tells Google the lead was fine, Bad reports it with a reason (a service you don’t offer, a sales call, a duplicate, outside your area, or not ready to book). Tick several and Report now, or Schedule to spread the reports across a date range. Sync now pulls the latest leads, and Telegram can message you when a new lead arrives.",
    howToUse: [
      "Open LSA Leads under Google Ads in the sidebar, choose Connect Google Ads and allow access.",
      "Choose Sync now, then open an account in the list.",
      "Filter to Charged, open a lead’s details, and choose Good or Bad; for a bad lead pick the reason that fits.",
      "Tick several leads, check each reason, and choose Report now or Schedule for later to report them at once.",
      "Choose Link Telegram under Connection → Telegram notifications if you want a message for each new lead.",
    ],
    howItWorks: "Reports go to Google one at a time, 30 to 60 seconds apart per account, and a lead can be reported only once; a scheduled report goes at a random moment in business hours inside your range. Google decides whether to credit a reported lead. Leads keep syncing in the background after the first sync. If the page says Google Ads setup is required, the connection is not available yet.",
    needs: ["A Google account with access to the Google Ads account that runs your Local Services Ads."],
  },

  /* ══ Reviews ══════════════════════════════════════════════════════════════════════════════════ */
  {
    key: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews",
    whatItIs: "Four views in one tool: ask clients for reviews, work with the reviews already on your Google listings, keep your review links, and set how feedback and reminders behave.",
    whatItDoes: "Review requests emails a client a button to leave a Google review, now or at a day and time you pick, with reminders and a record of what each client did. Google reviews lists your synced reviews so you can publish replies, save drafts and keep private notes, with AI drafts for approval if you want them. Profiles & links holds one profile per Google listing with its review link and your pages on other review sites. Settings decides which scores come to you privately and when reminders go out.",
    howToUse: [
      "Add a profile under Profiles & links: paste the Google review link (or pick a linked location) and, if you like, your Yelp, BBB, Houzz, Angi or HomeAdvisor pages.",
      "Choose New review request under Review requests: pick the profile, type the client’s name and email, and send now or schedule a date and time.",
      "Set the cutoff score (5 to 10, default 8) under Settings → Feedback routing, and how many reminders go out, how far apart and at what hours.",
      "Watch each request’s tracking in the list: opened, Google link clicked, feedback, caught privately.",
      "Connect Google under Google reviews, sync a linked location, then filter the reviews and publish replies.",
    ],
    howItWorks: "Every client is asked to rate the job from 1 to 10, and every answer reaches you. A score below your cutoff shows the private “What could we have done better?” form; when the client saves it, you are alerted at once (bell, email, and Telegram when linked); a score at or above it goes straight to the Google review step. Reminders stop when the client responds, unsubscribes or reaches the maximum you set, and nothing offers a reward for a review. AI can get facts wrong, so check every reply before publishing it.",
    needs: ["Any plan.", "The Google reviews view needs a connected Google account and a linked location."],
  },

  {
    key: "yelp", group: "Reviews", route: "/yelp", title: "Yelp",
    whatItIs: "Your Yelp rating and newest reviews next to the competitors nearby, with AI-drafted replies you post on Yelp.",
    whatItDoes: "Each connected Yelp business is a card with its rating, review count, 30-day change, categories, open status and the reviews Yelp returns, and the counts at the top total your businesses’ reviews and average their rating. AI drafts a reply to a review for you to copy and post on Yelp. The competitors panel lists nearby businesses in your category and marks the ones rated ahead of you. Up to 50 businesses can be connected.",
    howToUse: [
      "Open Yelp in the sidebar and choose “Connect a Yelp business”: search by business name and city, address or ZIP, and choose Connect on yours.",
      "Use Refresh on a card to pull the latest rating and reviews now; otherwise they refresh when older than 12 hours.",
      "Choose “Draft reply with AI” on a review, edit the draft, copy it and post it on Yelp from the review’s link.",
      "Open “Competitors on Yelp” on the card to see who is ahead of you.",
    ],
    howItWorks: "Yelp only lets us read, and only a few recent reviews per business; it has no way to post a reply, so you post replies on Yelp yourself. A rising review count sends you a notification. The page needs a Yelp API key (a password for software) on the server, and until an administrator sets one it shows sample data instead. AI can get facts wrong, so check every draft.",
    needs: ["A ConstructHUB account.", "A business page on Yelp."],
  },

  /* ══ Tools ════════════════════════════════════════════════════════════════════════════════════ */
  {
    key: "call-assistant", group: "Tools", route: "/call-assistant", title: "AI Call Assistant",
    whatItIs: "An AI receptionist that answers your business line around the clock, screens out spam, and files real callers as leads in your CRM.",
    whatItDoes: "It answers every call forwarded to it, asks what the call is about, collects the details you chose (address, name, a good email, best time to call) and files a real caller as a lead in the CRM. Emergencies, existing customers and callers who insist on a person are texted or emailed to the teammate you picked, and telemarketers and robocalls are flagged and never reach you. Every call is logged with its outcome, a summary, the transcript and the recording. It has five pages (Overview, Calls, Numbers, Agent studio and Simulator), each with its own “i”.",
    howToUse: [
      "Tell the assistant about your business in Agent studio (services, service area, policies), choose its voice, the questions it asks and who gets urgent calls, then publish.",
      "Type a test conversation in Simulator against the published version or the draft and read each decision beside the reply.",
      "Get a local number under Numbers (pick a state, optionally an area code or city) and forward your existing line to it with the steps shown for your carrier.",
      "Read every call under Calls with its outcome, summary, transcript and recording; unblock a number under Spam blocked if the assistant got one wrong.",
      "Watch the status, minutes and results on Overview and follow the Next step line; Pause in Agent studio stops the assistant answering until you resume.",
    ],
    howItWorks: "It says it is a virtual assistant if asked, and can play a notice that calls may be recorded. It never makes up a rating, a license or a price, quotes prices only from ranges you typed and chose to share, does not book appointments and never gives out a teammate’s number. A number caught twice as near-certain spam is blocked before its next call, and a weekly email reports how many spam calls were stopped. Publishing creates a numbered version you can restore later.",
    needs: [CALL_ASSISTANT_SEPARATE_LINE, callAssistantAvailabilityLine()],
  },
  {
    key: "social-media", group: "Tools", route: "/social-media", title: "Social Media",
    whatItIs: "One place to write, schedule and follow posts for your business’s social accounts and its Google Business Profile.",
    whatItDoes: "Each business gets its own workspace: Overview, Calendar, New post, Posts, Analytics, Inbox for comments, Accounts and Auto mode. In Auto mode ConstructHUB writes posts on a schedule, as drafts or straight to your accounts. A post is written once and sent to every account you tick, with its own tweak per network, and to your Google listing when the business is linked to one. With more than one business you can open them all at once for the calendar and the posts.",
    howToUse: [
      "Pick the business in the Business menu, open Accounts and choose Connect on each network; for Facebook and LinkedIn tick the pages you manage.",
      "Open Map accounts and pages to this business and save where new posts go by default.",
      "Write a post under New post, tick where it goes, and choose Post now, Schedule post or Save draft.",
      "Follow each post under Posts or on the Calendar; read comments under Inbox and numbers under Analytics.",
      "Turn on Auto mode when you want posts written for you, as drafts to approve or published on their own.",
    ],
    howItWorks: "ConstructHUB connects your social accounts through a posting partner’s apps on each network, or on some networks through its own apps. You sign in on the network’s own page, and ConstructHUB keeps only an encrypted reference to the connection. Published means the network confirmed it; queued means the post is still in ConstructHUB; if a status is uncertain, check the account on the network before posting again. The Google Business Profile copy goes through the same Google posts list the Posts page uses, so its status is shown there. Disconnecting stops ConstructHUB’s sending but cannot recall posts a network already published.",
    needs: [moduleNeed("socialPublishing"), "A social account you can sign in to for each network you post to, or a business linked to its Google Business Profile.", "At least one business under Locations to post for."],
  },
  {
    key: "social-youtube", group: "Tools", route: "/social-media", title: "Social Media → YouTube",
    whatItIs: "Your own YouTube channel, connected to ConstructHUB so you can publish videos to it from Social Media → Accounts.",
    whatItDoes: "It connects one YouTube channel for your whole account, shows which channel is connected, and uploads the video files you choose with the title, description, tags and privacy you enter. It cannot edit or delete videos, read comments or statistics, or reach anything else in your Google account.",
    howToUse: [
      "Open Social Media, find the YouTube section and choose “Connect YouTube”; pick the Google account and channel and allow the two permissions Google lists.",
      "Check the channel name shown is the one you meant; if not, choose “Connect a different channel”.",
      "Choose “Publish a video”, pick the file and wait for it to finish arriving.",
      "Fill in the title, description, tags, who can see it and whether it is made for kids, then tick the box confirming YouTube’s rules and your rights to the video.",
      "Choose “Publish to YouTube” and follow the video in the list: Queued, Uploading, On YouTube — processing, then Published with a link, or Failed with the reason.",
    ],
    howItWorks: "ConstructHUB asks Google for two permissions only (upload videos, and see the channel), and keeps the sign-in encrypted. It holds your file for at most 24 hours, until YouTube has it, and YouTube decides the final privacy setting the list shows. Each account can send a limited number of videos a day and all customers share one daily allowance from Google; when either runs out the page says so, and it resets at midnight Pacific time. Disconnect cancels the sign-in and deletes the channel details and your sent-video list here, but videos already on YouTube stay on your channel.",
    needs: [moduleNeed("socialPublishing"), "A YouTube channel on the Google account you connect.", "Videos longer than 15 minutes need a channel verified with YouTube (youtube.com/verify)."],
  },
  {
    key: "site-scan", group: "Tools", route: "/site-scan", title: "Site Scan",
    whatItIs: "A check-up of a website that tells you what to fix, in priority order.",
    whatItDoes: "It reads the site’s pages and checks for problems like broken links, redirects, HTTPS, titles, headings and image text. It speed-tests the pages you choose with Google PageSpeed, compares the site with a Google Business Profile if you pick one, and checks readiness for AI search. Each finding explains why it matters and how to fix it. You can mark fixes done, export a PDF, download a sitemap (the list of your pages for Google), email the checklist to your web person, share a look-only link, and rescan to see what changed.",
    howToUse: [
      "Open Site Scan in the sidebar and type the website’s address in “Website URL”; the home page is enough.",
      "Set “Pages to check” (150 covers most sites; up to 500) and “Pages to speed-test” (0 to 5); pick a Google Business Profile to compare with, if you want.",
      "Choose “Start scan”; you can run 5 scans, 20 PageSpeed tests and 3 AI fix plans a day, and bigger scans take a few minutes.",
      "Read the findings, mark items done, then rescan to see what is fixed, still there or new.",
      "Turn on “Rescan this site every month” to keep it checked; agencies queue many client sites at once under “Bulk scan client sites”, and every scan lands in Scan history.",
    ],
    howItWorks: "The scanner reads the pages’ HTML (the page code) and does not run JavaScript. It never changes your website or Google listing. Each page you speed-test is measured on mobile and on desktop by Google PageSpeed, and scores are diagnostic indicators, not ranking predictions. Share links expire after 30 days and can be turned off, and an AI fix plan is only a draft to check before you use it.",
    needs: ["Any plan; scans are counted against the plan’s monthly Site Scans."],
  },
  {
    key: "seo", group: "Tools", route: "/seo", title: "SEO Suite",
    whatItIs: "Your websites’ standing on Google in one place, and the door to every other SEO tool. One card per site shows its link strength, backlinks (links from other websites), estimated search traffic and where its tracked keywords rank.",
    whatItDoes: "The box at the top looks up any website, yours or a competitor’s, in Site explorer, or adds it to your sites for free. Each card shows the site’s authority (a link-strength score), how many websites link to it, its estimated free Google traffic and keywords, tracked keywords in the top 3 and top 10, its health score and its open tasks; each figure links to its page. Cards can be starred, grouped (by client or region) and ordered. Opening the dashboard never spends SEO data: Analyse or Refresh on a card buys a new Site explorer report at the price shown, and Run first crawl uses one of your monthly Site Scans.",
    howToUse: [
      "Type a website in “Look up any website” and choose Add to my sites (free, adds it here and to the rank tracker) or Look it up.",
      "Open a card’s figures: rankings go to the rank tracker, the health score to Site audit, traffic and keywords to Site explorer.",
      "Choose Analyse on a card for its first Site explorer report, or Run first crawl for its health score; each says its cost before it runs.",
      "Star the sites you watch most and use Order and Group to arrange the list.",
      "Use the rail for the other tools (Site explorer, Keywords, Content, Rank tracker, Local grid, Site audit, AI visibility, Action plan, Alerts, Reports and Usage), each with its own “i”.",
    ],
    howItWorks: "The cards use numbers already saved (the last Site explorer report, each keyword’s newest check on one device, the newest scan and the open tasks), so the page is free to open. Lookups and checks come out of your plan’s monthly SEO data, then from credit you buy, and each button that spends shows its price first. Up to 50 sites can be tracked, and a site with no keywords is never checked. If the page says lookups are being switched on, saved results open as usual and new lookups wait.",
    needs: [SEO_NEED],
  },
  {
    key: "ip-tracker", group: "Tools", route: "/ip-tracker", title: "IP Tracker",
    whatItIs: "A live list of who visits your website: which address, from where, on what device, and which pages. It uses the same tracking code and site list as Click Guard.",
    whatItDoes: "The Dashboard shows who is on the site right now (different IP addresses in the last 20 minutes) and visits for today, yesterday, 7 days, this month and all time. It adds a 14-day chart and a panel per site with visits, unique visitors, flagged visits and blocked addresses. Visitors lists each address with its visits, pages, city, device and browser and opens to its full record. Traffic shows the sites that sent each visit, Pages the pages people landed on, Geo the countries and cities, and Platforms the browsers, systems, devices and screen sizes.",
    howToUse: [
      "Open IP Tracker under Tools in the sidebar and add your website’s domain (step 1 on the page).",
      "Copy the tracking code and paste it in the head section, or before the closing body tag, of every page you want to track.",
      "Open your site once: the first visit replaces the sample data within about 30 seconds, and the other sections fill in from the same visits.",
      "Narrow a section with a date range, a preset or two typed dates.",
      "Use “Seen within” on Visitors to see who was there in the last 20 minutes, or any number of minutes you type.",
    ],
    howItWorks: "Each page load with the code on it records one visit: address, the browser’s own description of itself (shown as browser, system and device), a browser fingerprint, screen, language, time zone, where they came from and the page they landed on. Country and city come from Cloudflare on visits since Sep 30, 2026. Until a site has a visit, each section shows clearly marked sample data that is never saved, and a section loads at most the newest 1,000 visits, so a busy site’s all-time counts carry a plus sign. One website counts once across Click Guard, IP Tracker and VPN Shield.",
    needs: [PROTECTED],
  },
  {
    key: "vpn-shield", group: "Tools", route: "/vpn-shield", title: "VPN Shield",
    whatItIs: "Spots visitors who come through a VPN or proxy (services that hide where someone connects from). You choose what happens to them: log, block or redirect.",
    whatItDoes: "It flags a visit when the address belongs to a known VPN service or data center, the browser leaks a second address, or a VPN add-on shows itself, and records the service, how it was caught and what was done. The Overview counts detections (all time, today, blocked, unique addresses), charts the last 30 days, lists the top services and countries and shows every site with its mode. Flagged visits lists each catch, and Install script gives the one tag per site. Settings sets the mode, a redirect link and a whitelist of up to 500 of your own addresses that are never flagged.",
    howToUse: [
      "Add your site here or in IP Tracker (it is the same site list) and it starts in Log only.",
      "Open Install script, copy the tag and paste it on every page.",
      "Visit your site through a VPN once: the detection replaces the sample data on the Overview within a minute.",
      "Read a few flagged visits, then choose Block (an overlay) or Redirect (your link) in Settings, whitelist your office and test addresses, and save.",
    ],
    howItWorks: "Detection is a set of signals, not proof: VPN use is often legitimate, and nothing here identifies a person. Search-engine robots are skipped by their browser name tag (user agent), which can be faked. The overlay and redirect run after the page loads, only in browsers that run the script, and can be got around; a site that never saved a mode logs and blocks nobody. Until a site has a detection, the Overview and Flagged visits show clearly marked sample data that is never saved.",
    needs: [PROTECTED, "A site added here, in IP Tracker or in Click Guard."],
  },
  {
    key: "competitor-intel", group: "Tools", route: "/competitors", title: "Competitor Intel",
    whatItIs: "A market scan of the businesses competing in your trade around your town, built from Google’s public business listings.",
    whatItDoes: "Each scan lists the businesses Google’s search returns for a trade around a place (up to 60), keeping those within the distance you set, with name, rating, reviews, category, address, phone and website. It turns that into a market report: the leaders, how ratings and review counts spread, and every listing best-rated first with a one-line read of its reviews. The strip at the top adds up every saved scan. Scans stay on your account until you delete them.",
    howToUse: [
      "Open Competitor Intel in the sidebar and pick your trade, or type your own.",
      "Type a city, ZIP or address and set the radius, from 1 to 100 miles.",
      "Choose Scan market and wait for the card to say Completed; a scan uses one of the month’s allowance, and canceling gives it back.",
      "Open the report: read the leaders and the two distribution bars, then the list, with Call, Directions and Website on each business.",
      "Choose Review analysis on a business to see what its sampled reviews show; Re-run repeats a scan, Delete removes it.",
    ],
    howItWorks: "The scanner reads public business listings only: no ads, ad spend or private data. The listings arrive already ordered best-rated first, most-reviewed among equals. Review signals are counted from the few reviews Google returns per listing: a score from 0 to 100 with its reasons, shown as Few, Some or More signals. They are not proof that a review is fake and the scores are not probabilities; a high-rated listing in the More band is not named a leader.",
    needs: [`Included with the ${COMPETITOR_INTEL_PLANS} plans, with a monthly number of scans.`],
  },
  {
    key: "master-class", group: "Tools", route: "/master-class", title: "Master Class",
    whatItIs: "A step-by-step course on starting and growing a construction business, with a free comparison of all 50 states and a full guide for each state.",
    whatItDoes: "Four modules (Business Formation & Licensing, Google Business, Website, and SEO & ads) plus bonus lessons on vetting contractors. The Overview is free and compares all 50 states: whether a license, a bond or sales tax on labor applies, the kind of workers’ comp, B&O tax, and the filing office. Each module tab holds its lessons; the Enroll tab lists the modules and the bundle, each quoted by a sales rep.",
    howToUse: [
      "Open Master Class in the sidebar, read the Overview and choose your state to see its summary; the full guide opens with the Business Formation & Licensing module or the bundle.",
      "Open a module tab you own to read its lessons in order; a lock on a tab means it is not unlocked on this account.",
      "Choose Enroll, then Talk to a sales rep on a module or the complete bundle.",
    ],
    howItWorks: "The Overview and each state’s summary are free. The full state guides come with the Business Formation & Licensing module, the bundle or a plan that includes the course. Lesson text loads only for an account that owns the module, the bundle or a plan that includes the course; if that check is loading or failed, the page says so instead of calling it “not bought”. Prices come from the course catalog, and any Master Class purchase also opens the vetting lessons and the full Google Ads guide. The open tab, state and lesson stay in the page address, so a link opens the same place.",
    needs: ["A Master Class purchase, or a plan that includes the course, for the lessons and full state guides. The Overview and each state’s summary are free."],
  },

  {
    key: "compliance", group: "Tools", route: "/compliance", title: "Compliance Dept",
    whatItIs: "A state-by-state directory of who licenses contractors and trades and who issues electrical permits, with each agency’s official lookup links. Paid Permit & License Research Reports are ordered from here too.",
    whatItDoes: "For every state it sums up how licensing is split and who issues electrical permits (the state, cities and counties, or both). Each licensing board or permit agency gets a card with the roles it covers and its official links (license lookup, permit lookup, open data, website), plus a phone number where one is on record. A link the agency’s site would not let us check automatically is marked “unconfirmed”. The search box and state pills jump to a state or agency, and the report card leads to the paid research reports.",
    howToUse: [
      "Open Compliance Dept.",
      "Type a state or agency name in the search box, or click a state pill to jump to it.",
      "Open the agency’s “Look up a license” or “Look up a permit” link to check a contractor on the agency’s own site.",
      "Choose Order a report to have the research bot do the searching for you.",
    ],
    howItWorks: "The directory is a fixed list, researched state by state. Every link was opened and checked on the date shown beside the state name, and a link that failed is left out rather than guessed. The page reads nothing from your account. It is information, not legal advice; confirm requirements with the agency before you bid or hire.",
  },
  {
    key: "press-releases", group: "Tools", route: "/press-releases", title: "Press Releases",
    whatItIs: "Press releases on the national newswire, written for you from a few sentences about your news.",
    whatItDoes: "You pick a package: Standard, National or Premium distribution, as one release or the 12-month program (pay for 12, get 14), tell the writer what happened and add photos. It drafts the release to the wire's editorial guidelines and checks it against them; you read it, change anything, and approve. The release goes to the wire's editors; when it is live you get the link by email, and the distribution report (where it ran, views, clicks) follows the same way.",
    howToUse: [
      "Sidebar → Press Releases → pick Standard, National or Premium, choose one release or the 12-month program, and pay (credits are good for 12 months).",
      "Write a release, or press Draft it on a story idea (news found in your own account). Check the filled-in company and contact, add the facts, who is quoted and photos, then press Write it.",
      "Read the draft; use Rewrite with a note, or edit the text yourself. Fix anything flagged in red, then Approve and send. One credit is used.",
      "Watch the status under Your releases: In editorial review → Live → Report delivered. Each step is also emailed to the media contact.",
      "With credits, turn on \"Draft one release a month for me\" and pick a day. On that day the writer drafts your top story idea and you get a notification to review it.",
    ],
    howItWorks: "A new release starts with your company and contact details filled from your account (your last release, your CRM company, your business profile, then your profile); check them before you write. Monthly drafts never send anything or use a credit: only your Approve does, and a month is skipped when there is no story idea, no credit, or a release went out in the last four weeks. The writer uses only the facts you give; it never adds numbers, awards or claims. Before you can send, the text is checked against the wire's published content rules (no hype words, no exclamation marks, no direct address outside quotes, a named source and a contact email, restricted topics flagged) because the wire does not refund a release its editors refuse. If the editors ask for changes, the draft is revised for their notes and you approve it again at no extra credit. One release a month is the pace that works best; the 12-month program is built for it.",
    needs: ["A paid package (no plan needed)."],
  },

  /* ══ CRM (served by the CRM host) ═════════════════════════════════════════════════════════════ */
  {
    key: "crm-home", group: "CRM", route: "/crm", title: "CRM Home",
    whatItIs: "The CRM’s first screen: what needs your attention today.",
    whatItDoes: "It shows headline numbers (open estimates, jobs won, unscheduled jobs, open invoices, plus clients, pipeline value, open projects and leads to follow up), a “Needs attention” list, team activity and, for a new workspace, a setup checklist.",
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
    whatItDoes: "A client’s page holds their estimates, invoices, projects, payments, visits, private notes, measurements, uploads and an activity timeline. Every client gets a private portal page on their own.",
    howToUse: [
      "Open Clients in the CRM and add a client with name, email, phone and address.",
      "Type in the search box to find anyone by name, email, phone or address.",
      "Open a client to create an estimate, record a payment or schedule a visit.",
      "Choose “See what the client sees” to open their portal the way they see it.",
    ],
    howItWorks: "Notes are private to your team and never appear in the portal. The timeline is kept for you from what happens: estimates sent, emails opened, payments made.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-messages", group: "CRM", route: "/crm/inbox", title: "Messages",
    whatItIs: "Two-way conversations with your clients, one thread per client.",
    whatItDoes: "A client writes from their portal or asks a question on an estimate; your reply shows in their portal and is emailed to them. The Client activity tab shows opens, approvals and payments.",
    howToUse: [
      "Open Messages in the CRM.",
      "Open a thread with an unread count and reply.",
      "Check the Client activity tab to see what clients are doing.",
    ],
    howItWorks: "A reply is emailed when the client has an email address on file. Unread threads are counted on the Messages tab.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-pipeline", group: "CRM", route: "/crm/pipeline", title: "Pipeline",
    whatItIs: "Every job as a card on a board, from first contact to done and paid.",
    whatItDoes: "Jobs sit in columns from Lead through Estimating, Proposal Sent, Approved, Scheduled, In progress, Waiting on trades, Punch list, Complete, Invoiced and Paid (plus Cancelled), and you move them along. A project’s page has costing, change orders, a punch list, daily logs, selections and permits.",
    howToUse: [
      "Open Pipeline in the CRM.",
      "Add a lead with an estimated value.",
      "Drag a card to the next column as the job moves, or use the menu on the card.",
      "Open a card to work on the project.",
    ],
    howItWorks: "When a client approves an estimate, its project moves to Approved on its own. A change order the client approves on its link is added to the project’s revised contract value and moves its target end date by the days it adds.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-schedule", group: "CRM", route: "/crm/schedule", title: "Schedule",
    whatItIs: "Every visit, install date and appointment on one calendar.",
    whatItDoes: "Month, week and agenda views for your own calendar, everyone’s, or one team member’s, with a warning when visits overlap. It can also feed the calendar app you already use.",
    howToUse: [
      "Open Schedule in the CRM.",
      "Add a visit, choose who is going and link it to the client or project.",
      "Switch between My calendar, Everyone’s calendar or one person.",
      "Subscribe from Apple Calendar, Outlook or Google Calendar with the private feed link in Settings.",
    ],
    howItWorks: "Nothing lands on the schedule by itself; you add each visit. Anyone with the private feed link can read it, so regenerate the link to cut off old copies.",
    needs: [CRM_NEED],
  },
  {
    key: "jobcam", group: "CRM", route: "/crm/jobcam", title: "JobCam",
    whatItIs: "Job-site photos and video, filed to their project with the time and place they were shot.",
    whatItDoes: "The Recent feed shows every job’s shots, newest first, as a grid or a timeline. You can search by project, address, tag and person, and filter by tags, starred, photos, videos and dates. Select several shots to star, tag, show to or hide from the client, share or delete.",
    howToUse: [
      "Open JobCam in the CRM and choose Open camera; the camera picks the nearest project, or you choose one.",
      "Take photos or video and add tags; they stay set for the session.",
      "Search or filter the feed to find shots.",
      "Choose Select on a project’s JobCam page, tick shots and “Share these”, or share the live timeline, then “Make the link”.",
      "Copy the link or send it by email or text; revoke it under “Existing links”.",
    ],
    howItWorks: "Each shot is saved on the phone first and uploaded from a waiting list, so a lost connection does not lose a shot. A share link can be a fixed gallery of the shots you picked or a live timeline that keeps updating, and can have a password. A revoked or expired link shows the client an honest “turned off” or “expired” page.",
    needs: [CRM_NEED],
  },
  {
    key: "crm-estimates", group: "CRM", route: "/crm/estimates", title: "Estimates",
    whatItIs: "Your bids: build one, send it, and see when the client reads and approves it.",
    whatItDoes: "The list is searchable and filterable by status: Draft, Sent, Viewed, Approved, Declined or Expired. The client gets an email with a private link where they can read the bid, ask a question, approve and e-sign. Quick Bid prices a job from a measurement report and your per-square-foot prices.",
    howToUse: [
      "Open Estimates in the CRM, choose New estimate, and pick or create the client.",
      "Add items from your price book with the scope of work.",
      "Review and send.",
      "Watch the status; a client who re-opens the bid is your cue to call.",
      "Choose “Extend” when a client needs more time: it adds seven days on top of the time left, or seven days from today once it has expired.",
    ],
    howItWorks: "The first time a client opens the link they confirm their email with a one-time code. An estimate expires 7 days after it is sent. A signed estimate is locked, and permanent delete is for owners only.",
    needs: [CRM_NEED, "Price book items to pick from."],
  },
  {
    key: "crm-invoices", group: "CRM", route: "/crm/invoices", title: "Invoices",
    whatItIs: "Every bill you have sent, with what is paid, due and overdue.",
    whatItDoes: "It turns an approved estimate into an invoice, sends it with a secure payment link, records payments, and gives receipts marked PAID IN FULL when settled.",
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
    whatItDoes: "It holds items with a unit (each, square, square foot, linear foot, hour, job and more) and a price, plus materials (each with a cost, a price and a waste factor), labor rates and assemblies.",
    howToUse: [
      "Open Price book in the CRM.",
      "Add an item with its name, unit and price; give materials their waste factor on the Materials tab.",
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
      "Open Payments in the CRM and connect your Stripe account.",
      "Choose card, bank transfer (ACH) or both in Settings, and whether card fees are passed to the client.",
      "Choose “Take a payment” from a client’s page: send a secure link, or record a payment you already have.",
    ],
    howItWorks: "Money goes straight to your own Stripe account; ConstructHUB never holds it. The page shows Stripe’s standard processing rates.",
    needs: [CRM_NEED, "A Stripe account."],
  },
  {
    key: "crm-team", group: "CRM", route: "/crm/team", title: "Team & Company",
    whatItIs: "Your people, what each may do, and the company details that print on your documents.",
    whatItDoes: "It invites people by email with a role (Owner, Admin, Sales, Project manager, Office, Field or Subcontractor) and lets you adjust what each person may do. Divisions, set up in CRM Settings, give one company separate operating arms with their own name, address and license.",
    howToUse: [
      "Open Team & Company in the CRM.",
      "Type an email, pick a role and send the invite.",
      "Resend or cancel a pending invite; change a member’s role or remove them.",
      "Add a division in CRM Settings if you run a second branch.",
    ],
    howItWorks: "The role decides what a person can see and change, and the server enforces it. Removing someone cuts their access at once; what they created stays.",
    needs: [CRM_NEED, "Owner or admin access to manage the team."],
  },
  {
    key: "crm-integrations", group: "CRM", route: "/crm/integrations", title: "Integrations",
    whatItIs: "Where the CRM connects to your other tools.",
    whatItDoes: "HOVER for measurements, Stripe, Google Calendar, a lead-capture form for your website, read-only API keys (passwords for software), and webhooks (automatic messages sent to your own software).",
    howToUse: [
      "Open Integrations in the CRM.",
      "Open a card and connect it; each is set up once.",
      "Copy the lead form’s embed code into your website, or share its link.",
      "Create an API key only if a tool or developer asks for one.",
    ],
    howItWorks: "A HOVER report lands on the client whose address matches. Lead-form submissions become clients tagged as website leads. An API key is shown in full only once, when it is created.",
    needs: [CRM_NEED],
  },
  /* ══ Tools → Report an issue ══════════════════════════════════════════════════════════════════ */
  {
    key: "report-issue", group: "Tools", route: "/report-issue", title: "Report an issue",
    whatItIs: "The page for telling us something on ConstructHUB is broken, confusing or missing. “Report an issue” at the bottom of every page opens it, signed in or out.",
    whatItDoes: "It sends your description to our issue desk as its own numbered report, together with a short list of technical details the page shows you before you send. Under “Your reports” you can follow each report (Received, Being looked at, Fix ready, then Fixed or Not a bug) with our reply when there is one.",
    howToUse: [
      "Choose “Report an issue” at the bottom of the page where the problem happened.",
      "Say what you were trying to do and what happened instead, and check “Which page?”, which is filled in from where you came from.",
      "Choose how bad it is, and add a screenshot if a picture helps (one image, 5 MB at most).",
      "Open “What we send with your report” to see the details that go with it, then choose Send report.",
      "Keep the report number, and come back to “Your reports” for its status and our reply.",
    ],
    howItWorks: "Each report is kept on its own, never merged with someone else’s. Reports from people come before errors the site logs by itself, and “I can’t use the site” comes first and alerts our team straight away. Email addresses and phone numbers in a report are hidden and anything that looks like a password, key or card number is removed; only the browser and system name and the page address (without the part after “?”) are kept. Signed out, the page asks for an email so we can write back, a person reads the report first, and seeing your list of reports needs an account.",
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

/** The entry for a page path (./route-match.ts helpKeyForRouteIn, the one matcher the client's route table uses too). */
export const helpKeyForRoute = (pathname: string): string | undefined => helpKeyForRouteIn(HELP_ENTRIES, pathname);

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
