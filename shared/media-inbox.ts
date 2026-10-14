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
};
