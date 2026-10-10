import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";

/**
 * Site Scan — the PILOT page: the reference every writer copies.
 *
 * Every claim below is backed by the code in `sources`:
 *   - the checks, categories and scoring: server/sitescan/audit.ts (findings(), scoresFor(), deductionFor())
 *   - builder-specific fix steps and rescan verification: server/sitescan/guidance.ts (detectPlatform, fixesFor, verification)
 *   - PageSpeed (mobile + desktop, up to 5 pages, only when Google returns a measurement): server/sitescan/worker.ts, providers.ts
 *   - share link (30 days), PDF, PDF branding, email checklist, AI draft, monthly schedule (max 10 sites),
 *     bulk location scans, the free 11-page scan with email verification: server/sitescan/routes.ts
 *   - the monthly allowance: shared/plans.ts limits.siteScans / siteScansPerLocation, reserved per scan
 * Numbers that live in the price book are read from it (allowanceLine), never typed.
 */

const SCANS: FeatureAllowance = { limit: "siteScans", perLocation: "siteScansPerLocation", unit: "Site Scans", period: "month" };

const page: FeaturePage = {
  key: "siteScan",
  slug: "site-scan",
  group: "grow",
  status: "ready",
  title: "Site Scan",
  kicker: "Website audit",
  headline: { lead: "A Website Checkup That Ends in a ", swipe: "Fix List" },
  lede:
    "Site Scan reads your website the way a search engine does, scores it on technical health, speed, local signals, " +
    "content and AI readiness, and turns every finding into steps for the site builder you use.",
  hero: { mascot: "standing", bubble: "Let's see what your website is telling Google." },
  steps: [
    {
      title: "Enter your website",
      body: "Type your web address, or pick one of your Google Business Profile locations and Site Scan uses the website on that profile.",
    },
    {
      title: "It reads your pages",
      body: "It follows your robots.txt rules and sitemap, checks your pages, and adds Google PageSpeed's mobile and desktop speed scores when Google returns them.",
    },
    {
      title: "Read the scores and fixes",
      body: "Five scores, each with the findings that lowered it, and a fix list ordered by impact, with steps for your site builder.",
    },
    {
      title: "Fix, rescan, verify",
      body: "Tick fixes off as you go, then rescan: every fix shows as fixed, still present or new. Turn on a monthly rescan to keep watch.",
    },
  ],
  cards: [
    {
      icon: "gauge",
      title: "Five scores, explained",
      body: "Technical, Performance, Local, Content and AI Readiness. Each one shows which findings lowered it, so a score is never a mystery.",
    },
    {
      icon: "wrench",
      title: "Steps for your site builder",
      body: "Fixes come with click paths for WordPress, Elementor, Wix, Squarespace, GoDaddy, Webflow, Shopify and Duda, and draft code to review before you publish.",
    },
    {
      icon: "map-pin",
      title: "Checked against your Google profile",
      body: "Scan from a linked Business Profile location and it looks for your name, address and phone on the site, and for pages about your services and service areas.",
    },
    {
      icon: "bot",
      title: "Ready for AI search",
      body: "Whether AI crawlers like GPTBot and ClaudeBot may read your site, plus structured data, FAQ content, llms.txt and text that loads without JavaScript.",
    },
    {
      icon: "refresh",
      title: "Rescan and verify",
      body: "A rescan compares against the last report and marks each fix fixed, still present or new. Monthly rescans run on their own for up to 10 sites.",
    },
    {
      icon: "share",
      title: "Share it with your web person",
      body: "Send a share link that expires after 30 days, download a PDF with your own company name and logo, or email the fix checklist.",
    },
    {
      icon: "sparkles",
      title: "AI fix plan, as a draft",
      body: "Ask for page-by-page suggestions drafted from what the scan found. It is labelled as a draft for you to review before anything goes live.",
    },
    {
      icon: "layers",
      title: "Many locations at once",
      body: "Scan the websites of several Business Profile locations in one go: one scan per location, each checked against its own profile.",
    },
  ],
  spotlight: {
    kicker: "The Report",
    heading: { title: "Every Finding Comes With ", em: "the Pages and the Fix" },
    points: [
      "Each finding lists the pages it was found on, why it matters and what to change.",
      "The fix list is ordered by impact, and you can tick items off as you go.",
      "Speed comes from Google PageSpeed lab scores; when Google returns no measurement, Performance says N/A instead of guessing.",
      "Your history keeps every scan, so you can see the scores move over time.",
    ],
    panel: {
      label: "The report",
      title: "What every report holds",
      items: [
        "Overall score", "Technical", "Performance", "Local", "Content", "AI Readiness",
        "Findings and their pages", "Fix checklist", "PageSpeed results", "Business Profile comparison",
      ],
      note: "Download it as a PDF, share a link, or email the checklist.",
    },
  },
  audience: [
    {
      title: "Owners who built their own site",
      body: "You set it up on Wix, Squarespace or WordPress and want to know what to fix first, in plain steps for that builder.",
    },
    {
      title: "Contractors with a web person",
      body: "Hand them the share link or the PDF, then rescan to see what actually got fixed.",
    },
    {
      title: "Multi-location companies and agencies",
      body: "Check each location's website against its own Google profile, and send branded PDFs to the people who need them.",
    },
  ],
  pricing: {
    kind: "plan",
    allowance: SCANS,
    note: "A rescan, a monthly scheduled scan and each location in a bulk scan use one scan from the allowance.",
  },
  faqs: [
    {
      q: "What do I need to run a scan?",
      a: "Just your website's public address. Site Scan reads the same pages a search engine can see, so there is no plug-in to install and no website login to share. If you link a Google Business Profile location first, it also checks your site against that profile.",
    },
    {
      q: "Which plans include it, and how many scans do I get?",
      a: `Every plan includes Site Scans. ${allowanceLine(SCANS)}. A rescan, a monthly scheduled scan and each location in a bulk scan use one scan.`,
    },
    {
      q: "Will it change anything on my website?",
      a: "No. Site Scan only reads public pages, and it follows your robots.txt rules. You or your web person make the changes; the fix list says what to change and where.",
    },
    {
      q: "Does a higher score mean I'll rank higher on Google?",
      a: "Not on its own, and we don't promise rankings. The scores are an audit: fixing a confirmed finding raises the score. Some local checks are educated guesses from your pages, and the report says so where they are.",
    },
    {
      q: "Can I try it before I sign up?",
      a: "Yes. The free scan checks up to 11 pages of your site. Verify your email address and the full quick report unlocks.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the checks are audit.ts findings(),
  // the five scores and "starts at 100" are scoresFor()/scoreExplanation(), the builders are guidance.ts
  // detectPlatform(), the impact order is guidance.ts fixesFor(), the GBP comparison is the profile checks in findings().
  inDepth: {
    heading: { title: "A Website Audit for Contractors, ", em: "Explained" },
    paragraphs: [
      "Site Scan is a website audit for contractors. It reads your site the way a search engine does: it starts from " +
        "your robots.txt rules and your sitemap, follows the pages it is allowed to read and checks each one. Nothing " +
        "is installed on your website and nothing on it is changed, because the scan only reads public pages.",
      "The local checks are the part of contractor website SEO that ties your site to your Google Business Profile. " +
        "The scan looks for business structured data, a click-to-call link, a Google Maps embed and review content. " +
        "Run it from a linked Business Profile location and it also checks that your business name, street address and " +
        "phone number appear on the site, and whether each service and service area on your profile has a page whose " +
        "title or main heading names it. These local checks are educated guesses across the pages scanned, and the " +
        "report says so.",
      "AI Readiness covers how AI search tools can read your site: whether your robots.txt blocks crawlers such as " +
        "GPTBot, ClaudeBot, PerplexityBot and Google-Extended, whether your pages carry structured data and FAQ " +
        "content, whether an llms.txt file exists, and whether your text is in the page itself or only appears after " +
        "JavaScript runs. Letting those crawlers in is your business decision; the scan shows the setting, it doesn't " +
        "promise visibility.",
      "Every finding lists the pages it was found on, why it matters and what to change, and the fix list puts the " +
        "high-impact fixes first. When the scan recognizes your site builder (WordPress, Elementor, Wix, Squarespace, " +
        "GoDaddy, Webflow, Shopify or Duda), the steps follow that builder's menus. Each score starts at 100 and loses " +
        "points for the problems found, so fixing a confirmed finding raises it. A higher score is not a ranking " +
        "promise. It is an SEO checklist you or your web person can work through, then rescan to confirm what got fixed.",
    ],
    bulletsIntro: "The technical, content and speed checks look for:",
    bullets: [
      "Pages that return errors, redirect chains, and pages still on HTTP or loading insecure files",
      "Missing or conflicting canonical tags, noindex tags and pages missing from your sitemap",
      "Missing, long or duplicate page titles and meta descriptions, and a missing or doubled H1 heading",
      "Thin pages and images without alt text",
      "Google PageSpeed's mobile and desktop lab scores when Google returns them, a missing mobile viewport and oversized images",
    ],
  },
  // Prices read on 2026-10-10 from: screamingfrog.co.uk/seo-spider/pricing/, seranking.com/subscription.html,
  // brightlocal.com/pricing/ (~/codex-audits/a-la-carte-competitors.md → site_scan).
  compare: {
    alacarte: ["site_scan"],
    checkedOn: "2026-10-10",
    competitors: [
      { name: "Screaming Frog", plan: "SEO Spider", price: { kind: "annual", cents: 27900 }, note: "a desktop crawler", source: "https://www.screamingfrog.co.uk/seo-spider/pricing/" },
      { name: "SE Ranking", plan: "Core", price: { kind: "monthly", cents: 12900 }, note: "less on an annual plan", source: "https://seranking.com/subscription.html" },
      { name: "BrightLocal", plan: "Track", price: { kind: "monthly", cents: 4100 }, source: "https://www.brightlocal.com/pricing/" },
    ],
    onlyUs: [
      "Checks your website against your linked Google profile: name, address, phone, service pages and service areas.",
      "Fix steps written for the site builder you use.",
      "An AI Readiness score: whether GPTBot and ClaudeBot may read your site, structured data, FAQ content and llms.txt.",
      "Rescans mark every fix fixed, still present or new, and the report carries your brand.",
    ],
    theyNotUs: "Much deeper technical crawls of large sites.",
    noContractorAlternative: true,
  },
  related: ["gbp", "rankingGrid", "searchConsole"],
  app: { href: "/site-scan", surface: "app" },
  tryIt: { label: "Free 60-second website scan", href: "/free-site-scan" },
  headings: {
    steps: { title: "From Web Address to Fix List in ", em: "Four Steps" },
    cards: { title: "What Every Scan ", em: "Gives You" },
    faq: { title: "Before You ", em: "Run a Scan" },
  },
  seo: {
    title: "Site Scan — Website SEO Audit for Contractors | ConstructHUB",
    description:
      "Scan your contractor site for technical, speed, local, content and AI-readiness issues, get fix steps for your site builder, and rescan to verify.",
  },
  sources: [
    "server/sitescan/audit.ts",
    "server/sitescan/guidance.ts",
    "server/sitescan/worker.ts",
    "server/sitescan/providers.ts",
    "server/sitescan/routes.ts",
    "server/sitescan/agency.ts",
    "client/src/pages/site-scan.tsx",
    "shared/plans.ts",
  ],
};

export default page;
