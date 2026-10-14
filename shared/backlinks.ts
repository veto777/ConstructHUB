/**
 * Backlinks (prototype, 2026-10-12): the database of places a contractor's site can earn a link from —
 * journalists' requests, guest-post blogs, press-release sites, directories, local citation sites and
 * resource pages — built automatically (server/backlinks) before anything is sold. Owner plan: build the
 * database first; once it holds 5,000–10,000 QUALITY sources, sell link packages as an add-on.
 *
 * Shared by the server (server/backlinks/*) and the admin page (/admin/backlinks).
 * HARD RULE (CLAUDE.md): nothing here is invented. A source exists because a search result or an admin's
 * import named it; its signals are what our crawler read on it; a contact email is one published on the
 * site itself — never a guessed info@ address.
 */

/**
 * pbn: private blog network. It is a KIND so a site the vetter recognises as one is labelled and kept out of
 * the quality count — discovery never looks for them, and they are never sold (see PBN_POLICY).
 */
export const BACKLINK_KINDS = ["editorial", "guest_post", "press_release", "directory", "citation", "resource_page", "pbn"] as const;
export type BacklinkKind = (typeof BACKLINK_KINDS)[number];

export const BACKLINK_KIND_LABELS: Record<BacklinkKind, string> = {
  editorial: "Journalists & PR",
  guest_post: "Guest posts",
  press_release: "Press releases",
  directory: "Directories",
  citation: "Local citations",
  resource_page: "Resource pages",
  pbn: "PBN (blocked)",
};

/**
 * Anchor text (2026-10-14): links that all use the same money keyword ("roofing contractor Dallas") are a classic
 * penalty trigger. We ask for the company name or web address; a keyword anchor is the exception, never the plan.
 */
export const ANCHOR_POLICY =
  "Links we ask for use the company's name or web address (\"ConstructHUB\", \"constructhub.us\"), not a keyword phrase. " +
  "A link profile built on repeated keyword anchors is a classic trigger for a Google penalty.";

/** Estimated monthly Google visits under which a site counts as having no real audience (link-network footprint). */
export const LOW_TRAFFIC = 10;

export const PBN_POLICY =
  "Links from private blog networks break Google's spam policies and can get a customer's site demoted or removed. " +
  "Sites that look like one are labelled and blocked; they never count toward the quality goal and are never sold.";

/**
 * The pipeline: discovered (a search or import named it) → vetting (the crawler holds it) → qualified | rejected
 * → contacted → replied → agreed (terms known: price, link type, turnaround) → active (sellable). An owner can
 * park any source as do_not_contact.
 */
export const BACKLINK_STATUSES = ["discovered", "vetting", "qualified", "rejected", "contacted", "replied", "agreed", "active", "do_not_contact"] as const;
export type BacklinkStatus = (typeof BACKLINK_STATUSES)[number];

export const BACKLINK_STATUS_LABELS: Record<BacklinkStatus, string> = {
  discovered: "Discovered", vetting: "Vetting", qualified: "Qualified", rejected: "Rejected", contacted: "Contacted",
  replied: "Replied", agreed: "Terms agreed", active: "Active", do_not_contact: "Do not contact",
};

/** Statuses an admin may set by hand from the detail panel. */
export const BACKLINK_ADMIN_STATUSES = ["qualified", "rejected", "contacted", "replied", "agreed", "active", "do_not_contact", "discovered"] as const;

/** A = strong, B = good, C = usable but weak, X = rejected. Quality = A or B (the count the goal is measured in). */
export const BACKLINK_TIERS = ["A", "B", "C", "X"] as const;
export type BacklinkTier = (typeof BACKLINK_TIERS)[number];
export const QUALITY_TIERS: readonly BacklinkTier[] = ["A", "B"];

/** The owner's threshold to start selling packages, and the stretch goal. */
export const BACKLINK_GOAL = { sell: 5000, target: 10000 } as const;

export const LINK_TYPES = ["dofollow", "nofollow", "sponsored", "unknown"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** What the vetter read on the site (stored as jsonb; every field is an observation, null = not observed). */
export type BacklinkSignals = {
  fetchedUrl: string;
  httpStatus: number;
  https: boolean;
  title: string | null;
  lang: string | null;
  words: number;
  outboundLinks: number;
  /** Words from the contractor/home-service vocabulary found on the page (topical fit). */
  nicheHits: number;
  /** Pages/phrases that show the site takes submissions of this kind. */
  acceptsSubmissions: boolean;
  submissionHints: string[];
  /** Spam/PBN footprints seen, by name (e.g. "casino", "sells links", "all niches"). */
  spamHints: string[];
  pbnHints: string[];
  parked: boolean;
  /** Emails published on the site's own pages (mailto: or text) — never guessed. */
  emails: string[];
  contactUrl: string | null;
  /** Link attribute on the site's own outbound links, by count. */
  rel: { dofollow: number; nofollow: number; sponsored: number };
  /** The site's OWN invitation: a submission page ("write for us" in its title/heading/address) or a link to one on the site.
   *  A phrase inside an article or on a user profile is not an invitation. Absent on sources vetted before 2026-10-13. */
  submissionUrl?: string | null;
  /** The found page is a public business/member directory (directories and citations are joined by being listed). */
  directoryUrl?: string | null;
  /** The found page is a user profile on a platform (it speaks for its author, not for the site). */
  profilePage?: boolean;
  /** Why the found page is a list/seller of guest-post sites or a job board, not a publisher. */
  listPage?: string | null;
  /** The home page: what the SITE is about (topic is judged here, not on the page a search happened to hit). */
  homeTitle?: string | null;
  homeNicheHits?: number;
  homeWords?: number;
};

/** Third-party authority numbers, when the data source is connected (the SEO data provider's bulk backlinks endpoints). */
export type BacklinkMetrics = {
  /** Provider domain rank, 0–1000 scale. */
  rank: number | null;
  referringDomains: number | null;
  /** 0–100, higher = spammier. */
  spamScore: number | null;
  /** Estimated monthly US Google visits (the provider's traffic estimate). Absent on sources measured before 2026-10-14. */
  organicTraffic?: number | null;
  checkedAt: string;
};

export type BacklinkSourceRow = {
  id: number;
  domain: string;
  kind: BacklinkKind;
  status: BacklinkStatus;
  tier: BacklinkTier | null;
  score: number | null;
  niches: string[];
  submitUrl: string | null;
  contactEmails: string[];
  linkType: LinkType;
  priceUsd: number | null;
  discoveredVia: string | null;
  vettedAt: string | null;
  updatedAt: string;
  rank: number | null;
};

export type BacklinkSource = BacklinkSourceRow & {
  discoveredUrl: string | null;
  contactUrl: string | null;
  signals: BacklinkSignals | null;
  metrics: BacklinkMetrics | null;
  turnaroundDays: number | null;
  notes: string | null;
  createdAt: string;
  reasons: string[];
  events: { at: string; type: string; detail: Record<string, unknown> | null }[];
  outreach: BacklinkOutreach[];
};

export const OUTREACH_STATUSES = ["draft", "approved", "sent", "replied", "bounced", "opted_out"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];
export type BacklinkOutreach = {
  id: number; sourceId: number; status: OutreachStatus; toEmail: string; subject: string; body: string;
  createdAt: string; approvedAt: string | null; sentAt: string | null;
};

export type BacklinkSummary = {
  total: number;
  quality: number;
  goal: typeof BACKLINK_GOAL;
  byKind: Record<BacklinkKind, { total: number; quality: number }>;
  byStatus: Record<BacklinkStatus, number>;
  byTier: Record<BacklinkTier | "none", number>;
  queries: { total: number; run: number; due: number };
  spend: { month: string; usd: number; capUsd: number };
  config: { dataSource: boolean; worker: boolean; outreachSend: boolean };
  lastRunAt: string | null;
};
