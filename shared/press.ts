/**
 * Press Releases — the ConstructHUB Press Wire (owner, 2026-10-15): a customer picks one of three packages, tells us
 * the news, the AI writes the release to the wire's content guidelines, we send it to the wire, read the wire's
 * answers from the pressrelease@ mailbox and email the customer the live link and the distribution report.
 *
 * The three packages are the wire's three distribution tiers (its 2026-10-16 answer): Budget $475, National $865 and
 * Premium $1,205 a release at list, less the bundle discount (40 releases 25%, 80 35%, 120 45%, 200 55%); tiers can be
 * mixed inside one bundle. Pricing (owner): double what the wire charges per release at the 40-release rate; buy 12 and
 * get 2 free; one release a month for the best results. A bigger bundle lowers OUR cost, never the customer's price.
 *
 * The distributor is never named as our supplier: on the page it is one outlet among the rest (owner). Customers see
 * the tiers as Standard / National / Premium; the wire's own names (Budget / National / Premium) are used only in
 * the submission email (PRESS_WIRE_TIER_NAME).
 */

export type PressTier = "budget" | "national" | "premium";
export const PRESS_TIERS: readonly PressTier[] = ["budget", "national", "premium"];

/** The wire's list price per release (2026-10-16), in cents. */
export const PRESS_LIST_RATE_CENTS: Record<PressTier, number> = { budget: 47_500, national: 86_500, premium: 120_500 };
/** The wire's bundle discounts by bundle size (2026-10-15/16). */
export const PRESS_BUNDLE_DISCOUNTS: readonly { releases: number; percentOff: number }[] = [
  { releases: 40, percentOff: 25 }, { releases: 80, percentOff: 35 }, { releases: 120, percentOff: 45 }, { releases: 200, percentOff: 55 },
];
/** What the wire charges per release at a bundle size, in cents (rounded to the cent). */
export const pressWireRateCents = (tier: PressTier, bundle = 40): number => {
  const d = PRESS_BUNDLE_DISCOUNTS.find((b) => b.releases === bundle)?.percentOff ?? 0;
  return Math.round((PRESS_LIST_RATE_CENTS[tier] * (100 - d)) / 100);
};
/** What the wire charges us per release at the 40-release rate: $356.25 / $648.75 / $903.75. */
export const PRESS_WIRE_RATE_CENTS: Record<PressTier, number> = {
  budget: pressWireRateCents("budget"), national: pressWireRateCents("national"), premium: pressWireRateCents("premium"),
};
/** What a customer pays per release: double the wire's rate (owner). */
export const PRESS_RELEASE_PRICE_CENTS: Record<PressTier, number> = {
  budget: PRESS_WIRE_RATE_CENTS.budget * 2, national: PRESS_WIRE_RATE_CENTS.national * 2, premium: PRESS_WIRE_RATE_CENTS.premium * 2,
};

export const PRESS_PROGRAM_PAID = 12;
export const PRESS_PROGRAM_FREE = 2;
export const PRESS_PROGRAM_CREDITS = PRESS_PROGRAM_PAID + PRESS_PROGRAM_FREE;
/** The wire's bundle credits last 12 months; ours match. */
export const PRESS_CREDIT_MONTHS = 12;
/** One release a month gets the best results (owner): the program schedules one per calendar month. */
export const PRESS_RECOMMENDED_GAP_DAYS = 28;

/** The tier as the customer sees it. */
export const PRESS_TIER_LABEL: Record<PressTier, string> = { budget: "Standard", national: "National", premium: "Premium" };
/** The tier as the wire names it (the submission email only). */
export const PRESS_WIRE_TIER_NAME: Record<PressTier, string> = { budget: "Budget", national: "National", premium: "Premium" };

/** Each tier's card: only what the wire's sheets and its 2026-10-16 email say. */
export type PressTierInfo = { tier: PressTier; tagline: string; flashy: string; pickups: string | null; perks: string[] };
export const PRESS_TIER_INFO: Record<PressTier, PressTierInfo> = {
  budget: {
    tier: "budget", tagline: "Your news on the wire, online and regional", flashy: "START HERE", pickups: "350–500",
    perks: ["330+ named outlets: Yahoo Finance, Yahoo News, Digital Journal, StreetInsider, regional papers and radio", "Typically 350–500 sites run it"],
  },
  national: {
    tier: "national", tagline: "The nation's newsrooms, wire services and business press", flashy: "MOST POPULAR", pickups: "450–700",
    perks: ["5,000+ newsrooms: the Associated Press, Reuters, Dow Jones, Bloomberg Radio, CNBC, Fox News Channel, USA Today", "Major newspapers: The New York Times, The Wall Street Journal, The Washington Post, Los Angeles Times", "Finance sites and terminals: Yahoo Finance, MarketWatch, Morningstar, FactSet, Refinitiv", "Typically 450–700 sites run it"],
  },
  premium: {
    tier: "premium", tagline: "Everything in National, plus the biggest business and TV desks", flashy: "MOST REACH", pickups: null,
    perks: ["Everything in National", "Adds Business Insider, Markets Insider, CNN.com and CNN Money, Benzinga Pro", "Adds the ABC, CBS and NBC television network desks and Bloomberg Television", "Adds more local daily papers, and media targeting"],
  },
};

/** How many releases a purchase is: one, or the 12-month program (pay for 12, get 14). */
export type PressPackageKey = "single" | "program_12";
export type PressPackage = { key: PressPackageKey; name: string; credits: number; paidReleases: number };
export const PRESS_PACKAGES: readonly PressPackage[] = [
  { key: "single", name: "One release", credits: 1, paidReleases: 1 },
  { key: "program_12", name: "12-Month Program", credits: PRESS_PROGRAM_CREDITS, paidReleases: PRESS_PROGRAM_PAID },
];

export const pressPackage = (key: string): PressPackage | undefined => PRESS_PACKAGES.find((p) => p.key === key);
export const pressPackagePrice = (p: PressPackage, tier: PressTier): number => PRESS_RELEASE_PRICE_CENTS[tier] * p.paidReleases;
/** "National · 12-Month Program" — an order's name on the receipt and in the app. */
export const pressOrderName = (p: PressPackage | undefined, tier: PressTier): string =>
  `${PRESS_TIER_LABEL[tier]} · ${p?.key === "program_12" ? `12-Month Program (${PRESS_PROGRAM_CREDITS} releases)` : "1 release"}`;

export const PRESS_CHECKOUT_TYPE = "press_package";

/** A release's life: written → sent to the wire → reviewed there → live → reported. */
export const PRESS_RELEASE_STATUSES = ["draft", "ready", "queued", "submitted", "changes_requested", "live", "reported", "cancelled"] as const;
export type PressReleaseStatus = (typeof PRESS_RELEASE_STATUSES)[number];
export const PRESS_STATUS_LABELS: Record<PressReleaseStatus, string> = {
  draft: "Draft",
  ready: "Ready to send",
  queued: "Sending to the wire",
  submitted: "In editorial review",
  changes_requested: "Changes requested",
  live: "Live on the wire",
  reported: "Report delivered",
  cancelled: "Cancelled",
};
export const PRESS_STATUS_HELP: Record<PressReleaseStatus, string> = {
  draft: "Your details and the AI's draft. Nothing has been sent.",
  ready: "You approved the text. It goes to the wire on the next pass (within the hour) and uses one credit.",
  queued: "Being handed to the wire's editorial desk.",
  submitted: "The wire's editors are reading it. Most releases are reviewed within one business day.",
  changes_requested: "The editors asked for changes. Fix the points they raised and send it again (no extra credit).",
  live: "Published. The live link is below; the distribution report follows when the wire sends it.",
  reported: "Published and reported. The report and the live link were emailed to you.",
  cancelled: "Cancelled before it was sent. The credit was returned.",
};

/** Newsworthy angles the wire accepts (its content guidelines), the first question the writer asks. */
export const PRESS_NEWS_TYPES = [
  { key: "launch", label: "New service, product or website" },
  { key: "expansion", label: "Expansion: new area, office, crew or equipment" },
  { key: "milestone", label: "Milestone or anniversary" },
  { key: "award", label: "Award, certification or industry recognition" },
  { key: "hire", label: "New hire or promotion" },
  { key: "event", label: "Event, open house, trade show or seminar" },
  { key: "partnership", label: "Partnership or deal with another company" },
  { key: "community", label: "Community project, sponsorship or charity work" },
  { key: "study", label: "Report, study or expert tips on a topic in the news" },
] as const;
export type PressNewsType = (typeof PRESS_NEWS_TYPES)[number]["key"];

/** What the customer fills in. Validated by server/press/routes.ts; stored as given. */
export type PressReleaseInput = {
  newsType: PressNewsType;
  companyName: string;
  website: string;
  city: string;
  state: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** What happened, in the customer's own words. */
  details: string;
  /** Who the quote is from (name and title) and roughly what they want to say. */
  spokesperson: string;
  spokespersonTitle: string;
  quoteNotes: string;
  /** "About <company>" facts: years in business, services, areas served, licences. */
  about: string;
  /** Photo keys in R2 (uploaded through /api/press/releases/:id/photos). */
  photos: { key: string; url: string; caption: string }[];
};

/** The AI's draft, the customer's edits over it, and what the wire was sent. */
export type PressReleaseText = {
  headline: string;
  subheadline: string;
  /** "CITY, STATE / Month D, Year /" */
  dateline: string;
  body: string;
  boilerplate: string;
  mediaContact: string;
};

export type PressGuidelineIssue = { rule: string; detail: string; blocking: boolean };

export type PressOrderView = {
  id: number;
  packageKey: PressPackageKey;
  packageName: string;
  tier: PressTier;
  credits: number;
  creditsUsed: number;
  creditsLeft: number;
  amountCents: number;
  status: "awaiting_payment" | "paid";
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
};

export type PressReleaseView = {
  id: number;
  orderId: number | null;
  tier: PressTier;
  status: PressReleaseStatus;
  code: string;
  input: PressReleaseInput;
  text: PressReleaseText | null;
  issues: PressGuidelineIssue[];
  wireNotes: string | null;
  liveUrl: string | null;
  report: PressReport | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  liveAt: string | null;
  reportedAt: string | null;
  scheduledFor: string | null;
};

export type PressReport = {
  summary: string;
  outlets: number | null;
  views: number | null;
  clicks: number | null;
  pickups: { outlet: string; url: string | null }[];
  attachments: { name: string; url: string }[];
  receivedAt: string;
};

/** The wire's outlet lists, as its 2026 U.S. Budget, National and Premium sheets name them (server/data/press-outlets.json).
 *  and its U.S. National sheet (2026-10-16). */
export type PressOutlets = Record<PressTier, string[]>;

/**
 * The headline outlets per tier, exactly as the wire's sheets show them (logos on the Premium sheet's first pages;
 * named in the Budget sheet). The wire itself is listed as one distributor among the rest (owner, 2026-10-15).
 */
export const PRESS_HEADLINE_OUTLETS: Record<PressTier, string[]> = {
  budget: ["Yahoo Finance", "Yahoo News", "Digital Journal", "StreetInsider", "International Business Times", "AZ Central", "Boston Herald", "Star Tribune", "Pittsburgh Post-Gazette", "The Buffalo News", "Daily Herald", "RFD TV", "ACCESS Newswire"],
  national: ["Associated Press", "Reuters", "Dow Jones", "Bloomberg", "CNBC", "Fox News Channel", "USA Today", "MarketWatch", "Morningstar", "Yahoo Finance", "Google News", "The New York Times", "The Wall Street Journal", "The Washington Post", "Los Angeles Times", "Chicago Tribune", "The Boston Globe", "FactSet", "Refinitiv", "Nasdaq", "NYSE", "ACCESS Newswire"],
  premium: ["Business Insider", "Markets Insider", "CNN.com", "CNN Money", "ABC Television Network", "CBS Television Network", "NBC Television Network", "Bloomberg Television", "Benzinga Pro", "Associated Press", "Reuters", "USA Today", "The New York Times", "The Wall Street Journal", "ACCESS Newswire"],
};

export const PRESS_PATH = "/press-releases";
export const PRESS_MAILBOX = "pressrelease@constructhub.us";
