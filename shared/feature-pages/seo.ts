import type { FeatureAllowance, FeatureCompare, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS, PLAN_KEYS } from "../plans";
import { joinNames, planNamesWhere } from "../plan-copy";

/**
 * SEO Suite (the /seo tool) — every claim is backed by the code in `sources`:
 *   - the gate: the SEO tools belong to any account whose tracked-keyword allowance is not 0 (a plan that includes
 *     them, or the seo_basic / seo_pro add-on that grants them): server/seo/plan.ts seoAllowanceTest, shared/plans.ts
 *     SEO_PLAN_LIMITS + ADDONS.seo_basic / seo_pro (exclusiveGroup "seo_addon"), shared/alacarte.ts (sold on its own)
 *   - adding a site (country + language, desktop / mobile / both, how deep the results are read), up to 50 sites and
 *     1,000 keywords per site: server/seo/routes.ts MAX_SITES / MAX_KEYWORDS_PER_SITE, siteSchema; server/seo/site-cap.ts
 *   - rank checks every keyword × device from a chosen US place, weekly by default (twice a week / every day are
 *     settings), at most one automatic check a day per site, spending the month's included data only:
 *     server/seo/jobs.ts RANK_FREQUENCIES, scheduleWeeklyRuns, WEEKLY_SKIPPED_MESSAGE; server/seo/locations.ts
 *   - what a check records (position, the page shown, the map-pack position, the results-page features, the rivals):
 *     server/seo/retention.ts (the columns), client/src/pages/seo/serp-features.tsx, rank-history.tsx, rank-tags.tsx,
 *     rank-competitors.tsx (server/seo/voice.ts), serp-groups.tsx, competing.tsx, gsc-breakdown.tsx (server/seo/gsc-breakdown.ts)
 *   - Site explorer (authority, backlinks, referring domains, organic + paid footprint, monthly history, top keywords
 *     and pages, competitors, anchors; a saved report reopens free): server/seo/explorer.ts, reports.ts,
 *     client/src/pages/seo/explorer.tsx; content gap / link intersect up to three competitors: server/seo/gap.ts;
 *     directories, mentions, opportunities: server/seo/directories.ts, mentions.ts, opportunities.ts; the monthly
 *     backlink snapshot of a tracked site: server/seo/jobs.ts snapshotBacklinks, client/src/pages/seo/backlinks.tsx;
 *     batch analysis of up to 100 sites: server/seo/batch.ts
 *   - Keywords explorer (volume + trend, difficulty, cost per click, intent, who ranks; matching / related / questions;
 *     lists; bulk analysis of up to 200; service × town planner; a US place): server/seo/reports.ts, lists.ts,
 *     planner.ts, place.ts, free-keywords.ts, client/src/pages/seo/keywords.tsx
 *   - Content explorer: server/seo/content.ts, page-metrics.ts, client/src/pages/seo/content.tsx
 *   - Site audit reads the crawls Site Scan runs (a new crawl is one of the plan's Site Scans): server/seo/audit.ts,
 *     audit-pages.ts, link-opportunities.ts, outgoing-links.ts, render-check.ts, client/src/pages/seo/audit.tsx
 *   - Local grid 3×3 / 5×5 / 7×7, scans kept and compared; repeating watches need the gridWatches module:
 *     server/seo/grid.ts GRID_SIZES, grid-monitor.ts, routes.ts (sendModuleRequired "gridWatches")
 *   - AI visibility (ChatGPT, Google Gemini, Perplexity; monthly re-asking; where Google's AI answers already use a
 *     site): server/seo/ai-visibility.ts, ai-summary.ts, ai-monthly.ts, client/src/pages/seo/ai.tsx
 *   - Action plan (kinds, statuses, due date, owner, link back to the finding): server/seo/tasks.ts, client/src/pages/seo/plan.tsx
 *   - Alerts (rank drop / gain, map pack, linking sites lost / gained, grid moves, new mentions, keyword watch), bell
 *     + email: server/seo/alerts.ts alertMessage, keyword-watch.ts, mention-watch.ts, client/src/pages/seo/alerts.tsx
 *   - Reports on screen / PDF / emailed weekly or monthly (scheduledReports module), confirmed recipients, the brand
 *     on whiteLabel: server/seo/site-report.ts, site-report-send.ts, report-recipients.ts, routes.ts
 *   - the data allowance: every lookup priced first (retail = a markup on the source's cost), the month's allowance
 *     resets on the 1st and does not roll over, prepaid packs never expire and are spent only after the allowance,
 *     automatic work never spends purchased credit: shared/seo-credits.ts, server/seo/credits.ts, budget.ts, usage.ts
 *   - white-label: the data provider is never named to a customer: server/seo/public-errors.ts, README-white-label.md
 * Not built, so not claimed: writing or publishing content, building links, an API for the SEO data, CSV export
 * (shared/plans.ts COMING_MODULES).
 */

const KEYWORDS: FeatureAllowance = { limit: "seoKeywords", unit: "tracked keywords", period: "count" };
const INCLUDED_PLAN = PLANS[PLAN_KEYS.find((k) => PLANS[k].limits.seoKeywords !== 0) ?? "agency"].name;
const ADDON_PLANS = joinNames(ADDONS.seo_basic.availableOn.map((k) => PLANS[k].name));
const REPORT_PLANS = planNamesWhere((plan) => plan.modules.scheduledReports);
const GRID_WATCH_PLANS = planNamesWhere((plan) => plan.modules.gridWatches);
const WHITE_LABEL_PLANS = planNamesWhere((plan) => plan.modules.whiteLabel);
const ENTRY_KEYWORDS = ADDONS.seo_basic.grants.seoKeywords!.toLocaleString("en-US");

export const SEO_COMPARE: FeatureCompare = {
  // Prices read on 2026-10-10 from: semrush.com/prices, ahrefs.com/pricing, seranking.com/subscription.html
  // (~/codex-audits/a-la-carte-competitors.md → seo_basic / seo_pro). Third-party-reported prices (Mangools, Moz) are not quoted.
  alacarte: ["seo_basic", "seo_pro"],
  checkedOn: "2026-10-10",
  competitors: [
    { name: "Semrush", plan: "SEO", price: { kind: "monthly", cents: 13900 }, note: "500 keywords checked daily, 5 sites", source: "https://www.semrush.com/prices/" },
    { name: "Ahrefs", plan: "Lite", price: { kind: "monthly", cents: 12900 }, note: "750 keywords", source: "https://ahrefs.com/pricing" },
    { name: "SE Ranking", plan: "Core", price: { kind: "monthly", cents: 12900 }, note: "2,000 keywords checked daily", source: "https://seranking.com/subscription.html" },
  ],
  onlyUs: [
    `${ENTRY_KEYWORDS} tracked keywords at the entry tier, as an add-on to any plan or on its own.`,
    "Your Search Console clicks and impressions broken down beside the rankings you track.",
    "Every lookup shows its price first and spends from a monthly data allowance; automatic checks never spend credit you bought.",
    "The site audit reads the crawls Site Scan already runs, on the same account.",
  ],
  theyNotUs:
    "Daily rank checks (ours are weekly by default; every day is a per-site setting that spends more of the month's data), " +
    "far larger keyword databases, content writing tools and an API for the SEO data.",
};

const page: FeaturePage = {
  key: "seo",
  slug: "seo",
  group: "grow",
  status: "ready",
  title: "SEO Suite",
  kicker: "SEO tools",
  headline: { lead: "Your Rankings, Links and Keywords, ", swipe: "In One Place" },
  lede:
    "The SEO Suite tracks where your website ranks for the searches you choose, looks up any site's keywords and links, " +
    "audits your pages and turns what it finds into an action plan. Built for contractors and the agencies that work for them.",
  hero: { mascot: "standing", bubble: "Let's see where your site really ranks." },
  steps: [
    {
      title: "Look up or add a site",
      body: "Type any website into Look up any website: Look it up opens Site explorer for it, and Add to my sites puts it on your dashboard and in the rank tracker for free. Pick the country, desktop, mobile or both, and how deep the results are read, from the top 10 to the top 100.",
    },
    {
      title: "Choose your keywords",
      body: "Type the searches you want to track, or send them over from the Keywords explorer. Tag them by service or town, and pick the city, ZIP code, county or state the check runs from.",
    },
    {
      title: "Analyse the site",
      body: "One Site explorer report brings in your authority, backlinks, organic keywords, top pages and competitors. Your dashboard card fills in.",
    },
    {
      title: "Checks run on their own",
      body: "Rankings are checked every week by default, twice a week or every day if you choose, and your backlinks are snapshotted every month. An alert tells you when something moves.",
    },
    {
      title: "Work the plan",
      body: "Send findings from Opportunities, Content gap, Backlinks and Site audit to the Action plan, mark them done, and read or email the report.",
    },
  ],
  cards: [
    {
      icon: "search",
      title: "Look up any website",
      body: "One box on the dashboard for any address. Look it up opens Site explorer, where a saved report opens free and a new one is bought only when you press Analyse, with its cost shown first. Add to my sites is free: nothing is checked or charged until you add keywords.",
    },
    {
      icon: "trending-up",
      title: "Rank tracker",
      body: "Every tracked keyword on desktop and mobile: its position, the page Google showed, its spot in the map pack, and what else the results page carried. History of visibility, average position and top-10 count, grouped by tag, with Search Console clicks beside it when the property is connected.",
    },
    {
      icon: "grid",
      title: "Local grid",
      body: "Where your business shows in Google's local results for one search, checked from a 3×3, 5×5 or 7×7 square of points over your service area. Scans are kept and compared with the last one.",
    },
    {
      icon: "globe",
      title: "Site explorer",
      body: "Any domain, yours or a competitor's: authority, backlinks and referring domains, organic keywords and top pages, paid search footprint, monthly history and anchors. Content gap and link intersect against up to three competitors, plus a monthly backlink snapshot of your own site.",
    },
    {
      icon: "key",
      title: "Keywords explorer",
      body: "A keyword's monthly searches with their trend, difficulty, cost per click, intent and who ranks for it today, then the matching terms, related terms and questions around it. Keep lists, analyze up to 200 keywords at once, and map your services against the towns you serve.",
    },
    {
      icon: "book",
      title: "Content explorer",
      body: "Search the web for pages about a topic: who writes about what you sell, how strong their site is and when they published. For content ideas, and for sites worth asking for a link or a mention.",
    },
    {
      icon: "clipboard",
      title: "Site audit",
      body: "A health score and every issue by severity with its change since the previous crawl; each page with whether it can be indexed, its clicks from the home page and its internal links; internal links to add, outgoing links that answer errors, and a rendering check of HTML against a browser.",
    },
    {
      icon: "bot",
      title: "AI visibility",
      body: "Ask ChatGPT, Google Gemini and Perplexity what a customer would ask. See whether your business is named, whether your website is one of the sources, and who is named instead. Tracked questions are asked again every month.",
    },
    {
      icon: "list",
      title: "Action plan",
      body: "Findings from Opportunities, Content gap, Link intersect, Backlinks and Site audit land here as tasks, with your own beside them. A status, a due date and an owner on each, and a link back to the finding it came from.",
    },
    {
      icon: "bell",
      title: "Alerts and reports",
      body: "An alert in the app and by email when rankings fall or rise, the map pack is entered or left, linking sites are lost or gained, a grid moves or a new mention appears. A site report to read, save as a PDF, or email to you or a client every week or month.",
    },
  ],
  spotlight: {
    kicker: "The data allowance",
    heading: { title: "Every Lookup Shows Its Price ", em: "First" },
    points: [
      "Each plan and add-on carries a monthly SEO data allowance. It resets on the 1st and does not roll over.",
      "Automatic work, the rank checks, the backlink snapshots and the watches, spends only the month's included data. When it is used up, the checks pause and the page says so.",
      "Beyond the allowance you buy prepaid credit in packs. It never expires, is spent only after the month's allowance, and only when you press the button.",
      "Opening anything already saved is free: the dashboard, history, the audit, alerts, reports and the plan. A saved Site explorer report reopens free for a week, a report page for a day.",
      "The Usage page lists every lookup, what it was and what it cost you.",
    ],
    panel: {
      label: "Usage",
      title: "What the ledger records",
      items: [
        "Lookup", "Site or keyword", "Date", "Price charged", "From the month's allowance", "From purchased credit",
        "Month total", "Credit purchases", "Credit left",
      ],
      note: "The search data comes from a third-party provider. You see plan units and prices, never the provider.",
    },
  },
  audience: [
    {
      title: "Contractors with one website",
      body: "Know where you rank for your services in the towns you work, and what to fix first.",
    },
    {
      title: "Owners who do their own SEO",
      body: "Audit the site, pick the keywords, work the plan, and let the weekly check tell you whether it moved.",
    },
    {
      title: "Agencies with client sites",
      body: "Up to 50 sites on one account, grouped as you like, each with its own report emailed to the client.",
    },
    {
      title: "Businesses in a crowded market",
      body: "See which competitors come up where you don't, what they rank for that you don't, and who links to them and not to you.",
    },
  ],
  pricing: {
    kind: "allowance",
    allowance: KEYWORDS,
    note: `On the ${ADDON_PLANS} plans the suite is an add-on (${ADDONS.seo_basic.name}, or ${ADDONS.seo_pro.name}), one per account, or an à la carte subscription with no plan at all. Each carries a monthly SEO data allowance.`,
  },
  faqs: [
    {
      q: "What do I need to start?",
      a: "Your website's domain and the searches you want to track. No Google connection is needed for rankings, the explorers or the local grid. Search Console clicks appear beside the rankings once the property is connected on the Search Console page, and the Site audit reads a crawl from Site Scan, so a new crawl is one of your plan's monthly Site Scans.",
    },
    {
      q: "Which plans include it?",
      a: `${allowanceLine(KEYWORDS)}. On the ${ADDON_PLANS} plans, add one of the two suite add-ons (${ADDONS.seo_basic.name}, or ${ADDONS.seo_pro.name}), one per account, or subscribe to the suite on its own with no plan. Scheduled client reports and repeating grid watches are part of the ${REPORT_PLANS} plans; your own brand on the report is part of ${WHITE_LABEL_PLANS}.`,
    },
    {
      q: "How often are rankings checked, and what does a check cost?",
      a: "Every week by default, per site. Twice a week or every day is a setting, and the page shows what each choice spends a month before you pick it. Automatic checks spend only the month's included data, never credit you bought, and a site is never checked automatically twice in one day. Run check now spends credit when you want a check sooner.",
    },
    {
      q: "What does it not do?",
      a: "It changes nothing on your website or on Google. It writes no content, posts nothing, builds no links and promises no ranking. It measures, explains and keeps the plan; the work is yours or your agency's. A check is a measurement made at one moment from one place, so a person searching on their own phone may see a different order.",
    },
    {
      q: "Where does the data come from, and can I get a surprise bill?",
      a: "Search rankings, keyword figures and link data come from a third-party search-data provider; the suite never names it, and figures such as search volume and difficulty are that provider's estimates, not Google's own numbers. Every lookup shows its price before you buy, and beyond the month's allowance nothing is charged unless you buy a prepaid credit pack yourself.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the rank check per keyword × device posted
  // to the source's standard queue, weekly by default with twice-weekly / daily settings, at most one automatic check a
  // day per site, spending the included data only, are server/seo/jobs.ts (RANK_FREQUENCIES, scheduleWeeklyRuns,
  // WEEKLY_SKIPPED_MESSAGE); the place a check runs from is server/seo/locations.ts + place.ts; the map-pack position,
  // the page shown and the results-page features are the seo_rank_checks columns (server/seo/retention.ts) read by
  // client/src/pages/seo/serp-features.tsx; authority "estimated from the sites linking to it" is docs/seo-links/
  // explorer.md + server/seo/explorer.ts; the audit's HTML-only crawl and the rendering check are server/seo/
  // link-opportunities.ts, outgoing-links.ts, render-check.ts; the allowance, packs and automatic-work rule are
  // shared/seo-credits.ts, server/seo/credits.ts and jobs.ts; the caps are server/seo/routes.ts MAX_SITES /
  // MAX_KEYWORDS_PER_SITE; "every figure is a link" is client/src/pages/seo/links.ts; the provider is never named:
  // server/seo/public-errors.ts.
  inDepth: {
    heading: { title: "How the SEO Suite Works ", em: "for Contractors" },
    paragraphs: [
      "Contractor SEO starts with one question: when someone in your town searches for the work you do, does your " +
        "website come up? The SEO Suite's rank tracker answers it on a schedule. For every keyword you track, on desktop " +
        "and on mobile, it runs the search from the city, ZIP code, county or state you chose and records your position, " +
        "the page of your site Google showed, your place in the map pack, which is the block of local businesses with a " +
        "map, and what else the results page carried, such as an AI overview or a featured snippet. Checks run every " +
        "week by default; twice a week or every day is a setting. One keyword can be tracked in several places, so a " +
        "roofer can see the same search from each town on the route.",
      "The Site explorer looks at any domain the way a search engine does. Authority is a score from 0 to 100 estimated " +
        "from the sites linking to it, which is why the page that explains it is the backlinks list. Referring domains " +
        "are the distinct websites that link; backlinks are the individual links. Organic keywords are the searches the " +
        "data provider has seen the site rank for, and the traffic figure is an estimate built from those rankings, not " +
        "a count of visitors. Run the same report on a competitor and the content gap shows what they rank for that you " +
        "don't; the link intersect shows who links to them and not to you. Every figure on every screen is a link to " +
        "the rows behind it, so a number is never a dead end.",
      "The Site audit is a website audit for contractors built on the crawls Site Scan already runs: a health score, " +
        "the issues by severity and how each changed since the previous crawl, and every page with whether it can be " +
        "indexed. The crawl reads each page's HTML, so a link added by JavaScript is not seen; the rendering check " +
        "fetches a page twice, once as plain HTML and once in a browser, and puts the two side by side. Neither visit is " +
        "Google's, and the page says so.",
      "The suite is metered, not unlimited. Each plan and add-on carries a monthly SEO data allowance; every lookup " +
        "shows its price first, and a saved result reopens free. The automatic checks and snapshots spend only the " +
        "month's included data and pause when it is gone, so credit you bought is spent only when you press the button. " +
        "An account tracks up to 50 sites and up to 1,000 keywords per site within its keyword allowance. The rankings, " +
        "keyword figures and link data come from a third-party search-data provider that the suite never names, and " +
        "its difficulty and volume figures are estimates. The suite measures and explains; the work on the site, and " +
        "the ranking that follows or doesn't, stays yours.",
    ],
  },
  compare: SEO_COMPARE,
  related: ["siteScan", "rankingGrid", "searchConsole"],
  app: { href: "/seo", surface: "app", label: "Open SEO Suite" },
  headings: {
    steps: { title: "From Domain to First Check in ", em: "Five Steps" },
    cards: { title: "What's in the ", em: "SEO Suite" },
    faq: { title: "Before You ", em: "Add a Site" },
  },
  seo: {
    title: "Contractor SEO Suite: Rankings, Links, Audit | ConstructHUB",
    description:
      "Track your website's rankings weekly, explore any site's keywords and backlinks, audit your pages and plan the work. Every lookup is priced before you buy.",
  },
  sources: [
    "client/src/pages/seo/lookup-box.tsx",
    "client/src/pages/seo/dashboard.tsx",
    "client/src/pages/seo/index.tsx",
    "client/src/pages/seo/rank-history.tsx",
    "client/src/pages/seo/rank-tags.tsx",
    "client/src/pages/seo/rank-competitors.tsx",
    "client/src/pages/seo/serp-features.tsx",
    "client/src/pages/seo/gsc-breakdown.tsx",
    "client/src/pages/seo/grid.tsx",
    "client/src/pages/seo/explorer.tsx",
    "client/src/pages/seo/gap.tsx",
    "client/src/pages/seo/backlinks.tsx",
    "client/src/pages/seo/keywords.tsx",
    "client/src/pages/seo/keyword-lists.tsx",
    "client/src/pages/seo/planner.tsx",
    "client/src/pages/seo/content.tsx",
    "client/src/pages/seo/audit.tsx",
    "client/src/pages/seo/audit-pages.tsx",
    "client/src/pages/seo/render.tsx",
    "client/src/pages/seo/ai.tsx",
    "client/src/pages/seo/plan.tsx",
    "client/src/pages/seo/alerts.tsx",
    "client/src/pages/seo/reports.tsx",
    "client/src/pages/seo/usage.tsx",
    "client/src/pages/seo/links.ts",
    "server/seo/routes.ts",
    "server/seo/plan.ts",
    "server/seo/site-cap.ts",
    "server/seo/jobs.ts",
    "server/seo/locations.ts",
    "server/seo/place.ts",
    "server/seo/retention.ts",
    "server/seo/voice.ts",
    "server/seo/gsc-breakdown.ts",
    "server/seo/grid.ts",
    "server/seo/grid-monitor.ts",
    "server/seo/explorer.ts",
    "server/seo/reports.ts",
    "server/seo/gap.ts",
    "server/seo/lists.ts",
    "server/seo/planner.ts",
    "server/seo/content.ts",
    "server/seo/audit.ts",
    "server/seo/audit-pages.ts",
    "server/seo/link-opportunities.ts",
    "server/seo/outgoing-links.ts",
    "server/seo/render-check.ts",
    "server/seo/ai-visibility.ts",
    "server/seo/ai-monthly.ts",
    "server/seo/tasks.ts",
    "server/seo/alerts.ts",
    "server/seo/keyword-watch.ts",
    "server/seo/mention-watch.ts",
    "server/seo/site-report.ts",
    "server/seo/site-report-send.ts",
    "server/seo/report-recipients.ts",
    "server/seo/credits.ts",
    "server/seo/budget.ts",
    "server/seo/usage.ts",
    "server/seo/public-errors.ts",
    "shared/seo-credits.ts",
    "shared/plans.ts",
    "shared/alacarte.ts",
    "docs/seo-links/explorer.md",
  ],
};

export default page;
