/**
 * Press Releases — the ConstructHUB Press Wire (owner, 2026-10-15): a customer picks one of three packages, tells us
 * the news, the AI writes the release to the wire's content guidelines, we send it to the wire, read the wire's
 * answers from the pressrelease@ mailbox and email the customer the live link and the distribution report.
 *
 * Pricing (owner): double what the wire charges per release; buy 12 and get 2 free; one release a month for the best
 * results. The wire's 2026-10-15 quote: Budget $365.25 a release (the 40-release bundle, 25% off), Premium $903.75
 * (its $1,205 rate less the same 25%). A bigger bundle (35–55% off) lowers OUR cost, never the customer's price.
 *
 * The distributor is never named as our supplier: on the page it is one outlet among the rest (owner).
 */

export type PressTier = "budget" | "premium";
export const PRESS_TIERS: readonly PressTier[] = ["budget", "premium"];

/** What the wire charges us per release (its 40-release bundle rate, 25% off), in cents. */
export const PRESS_WIRE_RATE_CENTS: Record<PressTier, number> = { budget: 36_525, premium: 90_375 };
/** What a customer pays per release: double the wire's rate (owner). */
export const PRESS_RELEASE_PRICE_CENTS: Record<PressTier, number> = { budget: PRESS_WIRE_RATE_CENTS.budget * 2, premium: PRESS_WIRE_RATE_CENTS.premium * 2 };

export const PRESS_PROGRAM_PAID = 12;
export const PRESS_PROGRAM_FREE = 2;
export const PRESS_PROGRAM_CREDITS = PRESS_PROGRAM_PAID + PRESS_PROGRAM_FREE;
/** The wire's bundle credits last 12 months; ours match. */
export const PRESS_CREDIT_MONTHS = 12;
/** One release a month gets the best results (owner): the program schedules one per calendar month. */
export const PRESS_RECOMMENDED_GAP_DAYS = 28;

export type PressPackageKey = "wire_release" | "premium_release" | "program_12";
export type PressPackage = {
  key: PressPackageKey;
  name: string;
  tagline: string;
  /** Fixed tier, or the buyer chooses one at checkout. */
  tier: PressTier | "choose";
  credits: number;
  /** Price in cents for a fixed tier, or per tier when the buyer chooses. */
  priceCents: Record<PressTier, number>;
  perks: string[];
  flashy: string;
};

export const PRESS_PACKAGES: readonly PressPackage[] = [
  {
    key: "wire_release",
    name: "Wire Release",
    tagline: "One release on the national wire",
    tier: "budget",
    credits: 1,
    priceCents: { budget: PRESS_RELEASE_PRICE_CENTS.budget, premium: PRESS_RELEASE_PRICE_CENTS.budget },
    perks: ["Written for you by the AI to the wire's editorial rules", "Yahoo Finance, Yahoo News, Digital Journal and 300+ outlets", "Editorial review before it goes out", "Live link and distribution report emailed to you"],
    flashy: "START HERE",
  },
  {
    key: "premium_release",
    name: "Premium Release",
    tagline: "One release on the premium wire",
    tier: "premium",
    credits: 1,
    priceCents: { budget: PRESS_RELEASE_PRICE_CENTS.premium, premium: PRESS_RELEASE_PRICE_CENTS.premium },
    perks: ["Everything in Wire Release", "5,000+ outlets: AP, Bloomberg, Reuters, MarketWatch, USA Today, Business Insider, Google News", "Major newspapers: The New York Times, The Wall Street Journal, The Washington Post, Los Angeles Times", "Financial data providers: Dow Jones, FactSet, Refinitiv, Benzinga"],
    flashy: "MOST REACH",
  },
  {
    key: "program_12",
    name: "12-Month Program",
    tagline: `One release a month for a year, ${PRESS_PROGRAM_FREE} on us`,
    tier: "choose",
    credits: PRESS_PROGRAM_CREDITS,
    priceCents: { budget: PRESS_RELEASE_PRICE_CENTS.budget * PRESS_PROGRAM_PAID, premium: PRESS_RELEASE_PRICE_CENTS.premium * PRESS_PROGRAM_PAID },
    perks: [`Pay for ${PRESS_PROGRAM_PAID} releases, get ${PRESS_PROGRAM_CREDITS}`, "One a month keeps your company in the news all year (the cadence that works best)", "Pick Wire or Premium for the whole program", `Credits are good for ${PRESS_CREDIT_MONTHS} months`],
    flashy: "BEST VALUE",
  },
];

export const pressPackage = (key: string): PressPackage | undefined => PRESS_PACKAGES.find((p) => p.key === key);
export const pressPackagePrice = (p: PressPackage, tier: PressTier): number => p.priceCents[p.tier === "choose" ? tier : p.tier];
export const pressPackageTier = (p: PressPackage, chosen: PressTier): PressTier => (p.tier === "choose" ? chosen : p.tier);

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

/** The wire's outlet lists, as its 2026 U.S. Budget and U.S. Premium sheets name them (server/data/press-outlets.json). */
export type PressOutlets = { budget: string[]; premium: string[] };

/**
 * The headline outlets per tier, exactly as the wire's sheets show them (logos on the Premium sheet's first pages;
 * named in the Budget sheet). The wire itself is listed as one distributor among the rest (owner, 2026-10-15).
 */
export const PRESS_HEADLINE_OUTLETS: Record<PressTier, string[]> = {
  budget: ["Yahoo Finance", "Yahoo News", "Digital Journal", "International Business Times", "AZ Central", "Boston Herald", "Star Tribune", "Pittsburgh Post-Gazette", "The Buffalo News", "StreetInsider", "Daily Herald", "RFD TV", "ACCESS Newswire"],
  premium: ["Associated Press", "Bloomberg", "Reuters", "MarketWatch", "USA Today", "Business Insider", "Markets Insider", "CNN Business", "Google News", "Yahoo Finance", "The New York Times", "The Wall Street Journal", "The Washington Post", "Los Angeles Times", "Chicago Tribune", "The Boston Globe", "Houston Chronicle", "The Denver Post", "Dow Jones", "FactSet", "Refinitiv", "Benzinga", "Morningstar", "Seeking Alpha", "ACCESS Newswire"],
};

export const PRESS_PATH = "/press-releases";
export const PRESS_MAILBOX = "pressrelease@constructhub.us";
