/**
 * The media@ relationships inbox (owner, 2026-10-14): media@constructhub.us is used only to build relationships with
 * directories, PBNs, article sites and news media. The server reads it every 30 minutes and answers every email; nothing
 * that costs us money is agreed until a customer's purchase is made, just like on the platform. Companies we land
 * are tracked here, and an agreed directory joins our directory catalogue.
 */

export const MEDIA_PARTNER_KINDS = ["directory", "article", "news", "pbn", "other"] as const;
export type MediaPartnerKind = (typeof MEDIA_PARTNER_KINDS)[number];
export const MEDIA_PARTNER_KIND_LABELS: Record<MediaPartnerKind, string> = {
  directory: "Directory", article: "Article site", news: "News media", pbn: "PBN", other: "Other",
};

/** talking → agreed (terms set, something left to finalize) → finalized (done); declined ends it. */
export const MEDIA_PARTNER_STATUSES = ["talking", "agreed", "finalized", "declined"] as const;
export type MediaPartnerStatus = (typeof MEDIA_PARTNER_STATUSES)[number];
export const MEDIA_PARTNER_STATUS_LABELS: Record<MediaPartnerStatus, string> = {
  talking: "Talking", agreed: "Agreed — to finalize", finalized: "Finalized", declined: "Declined",
};

/**
 * new: waiting for the next pass · replied: answered · needs_owner: answered with a holding reply, an owner decision is
 * waiting (money, a meeting time, a contract) · automated: a machine sender (no-reply, bounce, newsletter, out-of-office),
 * logged and shown, never answered · failed: could not be answered after retries (a holding reply was sent).
 */
export const MEDIA_MESSAGE_STATUSES = ["new", "replied", "needs_owner", "automated", "failed"] as const;
export type MediaMessageStatus = (typeof MEDIA_MESSAGE_STATUSES)[number];
export const MEDIA_MESSAGE_STATUS_LABELS: Record<MediaMessageStatus, string> = {
  new: "Waiting", replied: "Replied", needs_owner: "Needs owner", automated: "Automated (no reply)", failed: "Failed",
};

export const MEDIA_SIGNATURE_TEAM = "Construct HUB Media Team";

export type MediaPartner = {
  id: number;
  company: string;
  domain: string | null;
  kind: MediaPartnerKind;
  status: MediaPartnerStatus;
  contactName: string | null;
  contactEmail: string | null;
  summary: string | null;
  agreement: string | null;
  toFinalize: string | null;
  costTerms: string | null;
  ownerQuestion: string | null;
  agreedAt: string | null;
  addedTo: string | null;
  lastMessageAt: string | null;
  messages: number;
};

export type MediaMessage = {
  id: number;
  direction: "in" | "out";
  fromEmail: string;
  fromName: string | null;
  toEmail: string | null;
  subject: string;
  body: string;
  receivedAt: string;
  status: MediaMessageStatus;
  reason: string | null;
  partnerId: number | null;
  company: string | null;
};

export type MediaInboxSummary = {
  configured: boolean;
  enabled: boolean;
  intervalMin: number;
  lastPassAt: string | null;
  lastPassError: string | null;
  counts: Record<MediaMessageStatus, number>;
  partners: Record<MediaPartnerStatus, number>;
  queue: { queued: number; sent: number; sentToday: number; perDay: number };
};

/**
 * The inbox's laws (owner, 2026-10-14: "give them laws and parameters"). The AI is instructed with exactly this list
 * (server/media-inbox/ai.ts), the Partnerships page shows it, and every law marked `code` is also checked by
 * server/media-inbox/guard.ts on each reply before it is sent, whichever model wrote it.
 */
export const MEDIA_INBOX_LAWS: { law: string; enforced: "code" | "instructions" }[] = [
  { law: "Answer every email a person sends. Machine mail (no-reply, bounces, newsletters, out-of-office) is logged and shown, never answered.", enforced: "code" },
  { law: "Read every auto-reply from a company we contacted: its next step (a form, a portal, another address) goes on that company's record and on the owner's list. Every email is marked read in Gmail once it is handled.", enforced: "code" },
  { law: "Carry out that next step automatically, never wait to be told: write to the partnerships or editorial address it gives (never advertising, billing or support), submit its form with the approved facts, and record any price the page lists (we never buy). Only a CAPTCHA, an account sign-up or a payment form waits for a person.", enforced: "code" },
  { law: "Never agree to pay, buy, prepay, subscribe, sign or commit to anything that costs money.", enforced: "code" },
  { law: "Never write an amount of money, and never repeat a price they quoted.", enforced: "code" },
  { law: "How we pay, the only answer to any fee: per listing or placement, and only after one of our customers has purchased it on our platform. No upfront fees, minimums, setup fees or prepayment.", enforced: "instructions" },
  { law: "Never fix a meeting date or time. Say the team will reply with times; the owner books every meeting.", enforced: "code" },
  { law: "Never sign, accept terms or say a contract is signed. Say the team will review it.", enforced: "code" },
  { law: "Never share passwords, API keys, logins, payment details, customer data, internal numbers or another partner's terms.", enforced: "code" },
  { law: "Never invent facts. Use only the approved facts about ConstructHUB; anything else is \"the team will follow up\".", enforced: "instructions" },
  { law: "Stay on purpose: directories, article and guest-post sites, news media and link publishers. Spam, scams and unrelated email get one or two polite sentences.", enforced: "instructions" },
  { law: "Always ask for the free next step: API or bulk-upload docs, partner or free listing programs, editorial guidelines, whether service-area businesses without a street address are accepted.", enforced: "instructions" },
  { law: "Warm, professional, plain English. Never mention AI, never claim to be a specific person and never claim a person wrote the email. Someone asking whether we are an AI or a person gets \"a member of our team will get back to you personally\" and waits for the owner. Sign as the Construct HUB Media Team.", enforced: "code" },
  { law: "Money, meetings, contracts, legal questions and data access go to the owner (\"Waiting for you\"); they get a polite reply that the team will review and follow up.", enforced: "code" },
  { law: "Never let a company go quiet: no answer 5 days after our last email → one polite follow-up in the same thread; still nothing 5 days later → find another contact address on their website and write to them (at most 3 addresses per company, never one that is already tried).", enforced: "code" },
  { law: "Anyone who says stop, unsubscribe, remove me or not interested is never emailed again (no reply, no follow-up); every first-contact email says so.", enforced: "code" },
  { law: "Record every company: what kind it is, where the relationship stands, any cost terms quoted, what was agreed and what is left to finalize.", enforced: "code" },
];

/** The inbox's parameters (the numbers the code runs on; MEDIA_INBOX_INTERVAL_MIN can change the first). */
export const MEDIA_INBOX_PARAMETERS = {
  checkEveryMin: 30,
  maxReplyWords: 180,
  hardReplyWordLimit: 250,
  maxRepliesPerSenderPerDay: 4,
  aiAttemptsBeforeHolding: 3,
  followUpAfterDays: 5,
  maxContactsPerCompany: 3,
  newContactsPerDay: 50,
  aiOrder: ["TruthCoder", "TruthCoder 2.0", "OpenAI", "Anthropic"],
} as const;
