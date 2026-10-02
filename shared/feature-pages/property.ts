import type { FeaturePage } from "./types";

/**
 * Property Records — a directory of county assessor / property appraiser offices.
 *
 * Every claim below is backed by the code in `sources`:
 *   - the office list comes from NETR Online's public records directory; unknown values stay null:
 *     scripts/scrape-netronline.ts → server/data/appraisers.json, seeded by server/seed-all-appraisers.ts
 *   - link checks (verified / unconfirmed with "Last checked" / dead → hidden and replaced by a web search):
 *     scripts/verify-links.ts, shared/government-links.ts, client/src/pages/property.tsx
 *   - Visit + a separate Search button, tap-to-call phone, state / county / text filters kept in the address bar:
 *     client/src/pages/property.tsx
 *   - the Property lookup link on every permit result (/property?countyId=…): client/src/pages/search.tsx
 *   - no plan check, public without signing in: server/routes.ts GET /api/property-appraisers,
 *     client/src/App.tsx PublicRouter, shared/dashboard.ts (gate "none")
 */

const page: FeaturePage = {
  key: "property",
  slug: "property",
  group: "win",
  status: "ready",
  title: "Property Records",
  kicker: "County records",
  headline: { lead: "Find the County's ", swipe: "Property\u00a0Records" },
  lede:
    "Property Records is a directory of US county assessor and property appraiser offices, sourced from NETR Online, " +
    "with a checked link to each office's official records site where one is on record.",
  hero: { mascot: "standing", bubble: "Let's find the office that keeps the records." },
  steps: [
    {
      title: "Pick a state and county",
      body: "Filter by state and county, or type the name of an office, county or state.",
    },
    {
      title: "Open the official site",
      body: "Visit opens the office's own records site, and Search goes straight to its search page when it has a separate one.",
    },
    {
      title: "Look the property up there",
      body: "You search the property on the county's site, which decides what it publishes: owners, values, sales or more.",
    },
    {
      title: "Or start from a permit",
      body: "The Property lookup link on a permit search result opens this directory already filtered to that county.",
    },
  ],
  cards: [
    {
      icon: "building",
      title: "Assessor and appraiser offices",
      body: "County assessor and property appraiser offices across the US, taken from NETR Online's public records directory.",
    },
    {
      icon: "link",
      title: "Links to the official site",
      body: "A Visit button to each office's records site, plus a direct Search button when the office has a separate search page.",
    },
    {
      icon: "check",
      title: "Checked, never guessed",
      body: "Links are checked. One we couldn't confirm shows its last check date, and an office with no working link gets a web search instead of a made-up address.",
    },
    {
      icon: "phone",
      title: "Office phone numbers",
      body: "The office's phone number where the source lists one, ready to tap on your phone.",
    },
    {
      icon: "filter",
      title: "Filters that stay put",
      body: "State, county and search filters live in the page address, so a reload or a shared link keeps them.",
    },
    {
      icon: "search",
      title: "Linked from permit search",
      body: "Every permit search result links to the records office for its county, so you go from permit to property in one click.",
    },
  ],
  audience: [
    {
      title: "Contractors pricing a job",
      body: "Check the county's record of a property before you bid on the work.",
    },
    {
      title: "Teams following up on permits",
      body: "Go from a permit result to the right county office without searching for it.",
    },
    {
      title: "Anyone working in a new county",
      body: "Find which office keeps property records there and how to reach it.",
    },
  ],
  pricing: {
    kind: "account",
    note: "The directory also opens without signing in.",
  },
  faqs: [
    {
      q: "Does ConstructHUB show the owner and the value itself?",
      a: "No. Property Records sends you to the county's own records site, where you look up the owner, value or sales history if that county publishes them. The directory itself lists offices, links and phone numbers.",
    },
    {
      q: "Do I need a plan to use it?",
      a: "No. Property Records is free: any ConstructHUB account can use it, the directory opens without signing in, and it isn't counted against a plan.",
    },
    {
      q: "Where does the office list come from?",
      a: "From NETR Online's public records directory. Anything the source doesn't list, like a phone number or a website, is left blank rather than filled in.",
    },
    {
      q: "What if a county's link is missing or broken?",
      a: "A link that failed our check is hidden and replaced by a web search for that county's property records. A link we couldn't confirm stays visible with its last check date, so you know to double-check it.",
    },
  ],
  related: ["permits", "crm", "crmLeads"],
  app: { href: "/property", surface: "app" },
  tryIt: { label: "Browse the directory now", href: "/property" },
  headings: {
    steps: { title: "From County to Records in ", em: "Four\u00a0Steps" },
    cards: { title: "What the Directory ", em: "Gives You" },
  },
  seo: {
    title: "Property Records — County Assessor Directory | ConstructHUB",
    description:
      "Find the county assessor or property appraiser office for US counties, with checked links to its official records site and its phone number. Free.",
  },
  sources: [
    "client/src/pages/property.tsx",
    "client/src/pages/search.tsx",
    "client/src/App.tsx",
    "server/routes.ts",
    "server/seed-all-appraisers.ts",
    "server/data/appraisers.json",
    "scripts/scrape-netronline.ts",
    "scripts/verify-links.ts",
    "shared/government-links.ts",
    "shared/dashboard.ts",
  ],
};

export default page;
