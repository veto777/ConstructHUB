/**
 * Proposals (/admin/proposals): an admin builds a proposal — a template it can reuse, or an offer made for one
 * recipient — with its own branding, written sections, an attached PDF and packages of priced services. The
 * recipient opens the emailed link (/proposal/<token>), picks what they want, signs and pays: ACH with no fee,
 * or card with the proposal's card fee (3% unless changed) added on top — in one payment or several, of any amount
 * up to what's left, each on any card or bank account; auto-pay (autoPaySchedule) starts once it's all paid.
 *
 * Shared by the server (server/proposals/*, which recomputes every total from the stored content — a price
 * never comes from the browser) and both pages (live totals while choosing).
 */
import { z } from "zod";

export const PROPOSAL_KINDS = ["template", "offer"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ["draft", "sent", "viewed", "signed", "partial", "processing", "paid", "payment_failed", "declined", "void", "archived"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft", sent: "Sent", viewed: "Opened", signed: "Signed — not paid", partial: "Partly paid", processing: "Paid — ACH clearing",
  paid: "Paid", payment_failed: "Payment failed", declined: "Declined", void: "Voided", archived: "Archived",
};

/** The smallest payment the client can make toward what is due today (Stripe's own minimum charge). */
export const MIN_PAYMENT_CENTS = 50;
/** A hint shown with the amount: most cards cap a single charge around here (owner, 2026-10-25). Not a limit. */
export const TYPICAL_CARD_LIMIT_CENTS = 1_000_000;

export const BILLING_TYPES = ["one_time", "monthly"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

/** monthly: the one-time items plus the first month today, then the monthly total each month (a subscription).
 *  full: everything for the whole term in one payment. choice: the recipient picks. */
export const PAYMENT_PLANS = ["monthly", "full", "choice"] as const;
export type PaymentPlanSetting = (typeof PAYMENT_PLANS)[number];
export type PaymentPlan = Exclude<PaymentPlanSetting, "choice">;

export const DEFAULT_CARD_FEE_BPS = 300;
export const MAX_CARD_FEE_BPS = 400;
/** Off the whole contract when the client pays the full term today (owner, 2026-10-24: 5%, changeable per proposal). */
export const DEFAULT_FULL_PAY_DISCOUNT_BPS = 500;
export const MAX_FULL_PAY_DISCOUNT_BPS = 5000;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text = (max: number) => z.string().max(max);
const id = z.string().min(1).max(40);

export const proposalItemSchema = z.object({
  id,
  name: text(200).min(1),
  description: text(2000).default(""),
  /** One deliverable per line on the page. */
  bullets: z.array(text(300)).max(40).default([]),
  priceCents: z.number().int().min(0).max(100_000_000),
  billing: z.enum(BILLING_TYPES).default("one_time"),
  /** Monthly items: the minimum number of months (the term total is price × months). */
  termMonths: z.number().int().min(1).max(60).default(1),
  /** Ticked when the recipient opens the page. */
  defaultSelected: z.boolean().default(false),
  /** Always part of the offer; the recipient cannot remove it. */
  included: z.boolean().default(false),
  /** A short tag shown on the card ("Recommended"). */
  badge: text(40).default(""),
  /** The little "i" on the card: why this option is worth it / better than the one before (owner, 2026-10-24). */
  info: text(2000).default(""),
});
export type ProposalItem = z.infer<typeof proposalItemSchema>;

export const proposalGroupSchema = z.object({
  id,
  name: text(200).min(1),
  description: text(2000).default(""),
  /** one: pick at most one (tiers). many: any number. */
  select: z.enum(["one", "many"]).default("many"),
  /** At least one item in this group must be chosen. */
  required: z.boolean().default(false),
  /** The little "i" beside the group's heading: what this choice is and how the options compare. */
  info: text(2000).default(""),
  items: z.array(proposalItemSchema).max(40),
});
export type ProposalGroup = z.infer<typeof proposalGroupSchema>;

export const proposalSectionSchema = z.object({
  id,
  /** Small label above the heading ("01 / Executive overview"). */
  eyebrow: text(120).default(""),
  heading: text(300).default(""),
  /** Plain text; blank lines start paragraphs, lines starting "- " are bullets. */
  body: text(20_000).default(""),
});
export type ProposalSection = z.infer<typeof proposalSectionSchema>;

/**
 * A contract clause the client initials one by one before signing, like DocuSign's "Initial here" (owner,
 * 2026-10-24: "check the boxes or sign the dotted areas"). initials false shows the clause without a box.
 */
export const proposalClauseSchema = z.object({
  id,
  heading: text(300).default(""),
  body: text(5000).default(""),
  initials: z.boolean().default(true),
});
export type ProposalClause = z.infer<typeof proposalClauseSchema>;

/** Proposals sell services: no sales tax is ever added (owner, 2026-10-24). Shown in the totals and the signed copy. */
export const TAX_NOTE = "Professional services — no sales tax is added.";

export const proposalContentSchema = z.object({
  brand: z.object({
    name: text(120).default("ConstructHUB"),
    logoUrl: text(1000).default(""),
    accent: hex.default("#F97316"),
    contactName: text(120).default(""),
    contactEmail: text(200).default(""),
    phone: text(60).default(""),
    website: text(200).default(""),
  }).default({}),
  title: text(300).default(""),
  subtitle: text(1000).default(""),
  /** The note at the top of the page and in the email. */
  intro: text(5000).default(""),
  sections: z.array(proposalSectionSchema).max(40).default([]),
  groups: z.array(proposalGroupSchema).max(20).default([]),
  /** The contract clauses initialed one by one (shown in the signing step, printed with the initials). */
  clauses: z.array(proposalClauseSchema).max(40).default([]),
  /** once: one initial for all the terms, which sit collapsed (owner, 2026-10-24: "one initial for all terms … we
   *  don't want the client scrutinizing the terms"); each: an initial per clause. */
  clauseInitials: z.enum(["once", "each"]).default("once"),
  terms: text(30_000).default(""),
  /** The company's signature on the agreement: the admin's typed name, drawn by the system in script with the date
   *  it was sent (owner, 2026-10-24). An offer can't be sent until it has a name. */
  countersign: z.object({
    name: text(120).default(""),
    title: text(120).default("Authorized representative"),
  }).default({}),
  payment: z.object({
    plan: z.enum(PAYMENT_PLANS).default("monthly"),
    achEnabled: z.boolean().default(true),
    cardEnabled: z.boolean().default(true),
    /** Basis points added on top of a card payment (300 = 3%). ACH never pays it. */
    cardFeeBps: z.number().int().min(0).max(MAX_CARD_FEE_BPS).default(DEFAULT_CARD_FEE_BPS),
    /** Monthly plan: stop auto-pay after this many months (null = keeps billing until cancelled); see autoPayMonths. */
    endAfterMonths: z.number().int().min(1).max(60).nullable().default(null),
    /** Basis points off the contract when a term with monthly services is paid in full today (500 = 5%, 0 = none). */
    fullPayDiscountBps: z.number().int().min(0).max(MAX_FULL_PAY_DISCOUNT_BPS).default(DEFAULT_FULL_PAY_DISCOUNT_BPS),
  }).default({}),
});
export type ProposalContent = z.infer<typeof proposalContentSchema>;

export const emptyContent = (): ProposalContent => proposalContentSchema.parse({});

/** What the recipient chose (the server stores it with the signature). */
export type ProposalSelection = { itemIds: string[]; plan: PaymentPlan };

export type PricedLine = {
  itemId: string; groupName: string; name: string; billing: BillingType; priceCents: number; termMonths: number;
  /** One-time: the price. Monthly: price × term months. */
  termTotalCents: number;
};
export type ProposalTotals = {
  lines: PricedLine[];
  oneTimeCents: number;
  monthlyCents: number;
  /** One-time + every monthly item for its full term, less the pay-in-full discount. */
  contractTotalCents: number;
  /** The pay-in-full discount taken off (0 on the monthly plan; absent on totals stored before it existed). */
  discountCents?: number;
  discountBps?: number;
  plan: PaymentPlan;
  /** What is charged now (before any card fee). */
  dueTodayCents: number;
  /** Charged every month after today (monthly plan only). */
  recurringCents: number;
};

/** The plans this proposal lets the recipient use. */
export function allowedPlans(content: ProposalContent, totalsMonthlyCents: number): PaymentPlan[] {
  if (totalsMonthlyCents <= 0) return ["full"];
  const p = content.payment.plan;
  return p === "choice" ? ["monthly", "full"] : [p];
}

/** The items selected when the page opens: only the included ones — the client makes every choice (owner,
 *  2026-10-24: "dont preselect anything when sending"). An item's defaultSelected is no longer used. */
export function defaultSelection(content: ProposalContent): string[] {
  return content.groups.flatMap((g) => g.items.filter((i) => i.included).map((i) => i.id));
}

/** Problems with a selection, in the recipient's words; empty when it can be signed. */
export function selectionProblems(content: ProposalContent, itemIds: readonly string[]): string[] {
  const chosen = new Set(itemIds);
  const known = new Set(content.groups.flatMap((g) => g.items.map((i) => i.id)));
  const problems: string[] = [];
  for (const x of chosen) if (!known.has(x)) problems.push("One of the selected services is no longer offered — reload the page.");
  for (const g of content.groups) {
    const picked = g.items.filter((i) => chosen.has(i.id));
    for (const i of g.items) if (i.included && !chosen.has(i.id)) problems.push(`${i.name} is included and can't be removed.`);
    if (g.select === "one" && picked.length > 1) problems.push(`Choose only one option in “${g.name}”.`);
    if (g.required && picked.length === 0) problems.push(`Choose an option in “${g.name}”.`);
  }
  if (!problems.length && chosen.size === 0) problems.push("Choose at least one service.");
  return [...new Set(problems)];
}

export function priceSelection(content: ProposalContent, itemIds: readonly string[], plan?: PaymentPlan): ProposalTotals {
  const chosen = new Set(itemIds);
  const lines: PricedLine[] = [];
  for (const g of content.groups) {
    for (const i of g.items) {
      if (!chosen.has(i.id)) continue;
      const months = i.billing === "monthly" ? i.termMonths : 1;
      lines.push({ itemId: i.id, groupName: g.name, name: i.name, billing: i.billing, priceCents: i.priceCents, termMonths: months, termTotalCents: i.priceCents * months });
    }
  }
  const oneTimeCents = lines.filter((l) => l.billing === "one_time").reduce((s, l) => s + l.priceCents, 0);
  const monthlyCents = lines.filter((l) => l.billing === "monthly").reduce((s, l) => s + l.priceCents, 0);
  const grossCents = lines.reduce((s, l) => s + l.termTotalCents, 0);
  const plans = allowedPlans(content, monthlyCents);
  const usePlan: PaymentPlan = plan && plans.includes(plan) ? plan : plans[0];
  const monthlyPlan = usePlan === "monthly" && monthlyCents > 0;
  // Paying a monthly term up front earns the discount; a one-time-only order has nothing to pay ahead.
  const discountBps = !monthlyPlan && monthlyCents > 0 ? content.payment.fullPayDiscountBps : 0;
  const discountCents = fullPayDiscountCents(grossCents, discountBps);
  const contractTotalCents = grossCents - discountCents;
  return {
    lines, oneTimeCents, monthlyCents, contractTotalCents, discountCents, discountBps, plan: monthlyPlan ? "monthly" : "full",
    dueTodayCents: monthlyPlan ? oneTimeCents + monthlyCents : contractTotalCents,
    recurringCents: monthlyPlan ? monthlyCents : 0,
  };
}

/** How many months auto-pay charges on the monthly plan (null = every month until cancelled). Never fewer than
 *  the longest selected package term: a 6-month commitment is always billed for 6 months. */
export function autoPayMonths(content: ProposalContent, totals: Pick<ProposalTotals, "lines">): number | null {
  const end = content.payment.endAfterMonths;
  if (!end) return null;
  return Math.max(end, ...totals.lines.filter((l) => l.billing === "monthly").map((l) => l.termMonths));
}

/** A stretch of auto-pay months that each charge the same services (month 1 is part of what's due today). */
export type AutoPayPhase = {
  fromMonth: number;
  /** null: every month until cancelled. */
  toMonth: number | null;
  lines: { itemId: string; name: string; priceCents: number }[];
  cents: number;
};

/**
 * What auto-pay charges after today on the monthly plan, month by month, as the contract reads: each monthly
 * service for its own term (a 1-month add-on is paid today and never again). The longest-term services then keep
 * going — until cancelled (endAfterMonths null), or to endAfterMonths. Empty when nothing recurs.
 */
export function autoPaySchedule(content: ProposalContent, totals: Pick<ProposalTotals, "lines" | "plan">): AutoPayPhase[] {
  if (totals.plan !== "monthly") return [];
  const monthly = totals.lines.filter((l) => l.billing === "monthly");
  if (!monthly.length) return [];
  const longest = Math.max(...monthly.map((l) => l.termMonths));
  const end = content.payment.endAfterMonths;
  const last = end == null ? null : Math.max(end, longest);
  // Only a multi-month package carries on past its term; a plan of 1-month services is done once today is paid.
  const active = (m: number) => monthly.filter((l) => l.termMonths >= m || (l.termMonths === longest && longest > 1 && (last === null || m <= last)));
  const phases: AutoPayPhase[] = [];
  const upTo = last ?? longest + 1;
  for (let m = 2; m <= upTo; m++) {
    const lines = active(m).map((l) => ({ itemId: l.itemId, name: l.name, priceCents: l.priceCents }));
    if (!lines.length) continue;
    const prev = phases[phases.length - 1];
    if (prev && prev.toMonth === m - 1 && prev.lines.map((l) => l.itemId).join() === lines.map((l) => l.itemId).join()) prev.toMonth = m;
    else phases.push({ fromMonth: m, toMonth: m, lines, cents: lines.reduce((s, l) => s + l.priceCents, 0) });
  }
  if (last === null && phases.length) phases[phases.length - 1].toMonth = null;
  return phases;
}

/** d plus n calendar months, the day clamped to the month's last (Jan 31 + 1 → Feb 28, never Mar 3). */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

/** "Months 2–6: $2,500/mo" style lines for the page, the emails and the signed PDF. */
export function autoPayLines(phases: readonly AutoPayPhase[], feeBps = 0): string[] {
  return phases.map((p) => {
    const when = p.toMonth === null ? `Month ${p.fromMonth} on, until cancelled` : p.fromMonth === p.toMonth ? `Month ${p.fromMonth}` : `Months ${p.fromMonth}–${p.toMonth}`;
    return `${when}: ${formatMoney(p.cents + cardFeeCents(p.cents, feeBps), { cents: true })}/mo`;
  });
}

/** One payment toward what is due today. The client picks the amount (owner, 2026-10-25: any amount up to what's
 *  left), and each one can use a different card or bank account. amountCents is before the card fee. */
export type ProposalPaymentStatus = "open" | "processing" | "paid" | "failed" | "expired";
export type ProposalPayment = {
  id: number; method: "ach" | "card"; amountCents: number; feeCents: number; status: ProposalPaymentStatus;
  cardLast4: string | null; createdAt: string; paidAt: string | null;
};
export type PaymentBalance = { dueTodayCents: number; paidCents: number; pendingCents: number; remainingCents: number };

/** Paid = settled; pending = ACH still clearing (counts toward the balance, like a paid one, until it fails). */
export function paymentBalance(dueTodayCents: number, payments: readonly Pick<ProposalPayment, "amountCents" | "status">[]): PaymentBalance {
  const sum = (s: ProposalPaymentStatus) => payments.filter((p) => p.status === s).reduce((a, p) => a + p.amountCents, 0);
  const paidCents = sum("paid"), pendingCents = sum("processing");
  return { dueTodayCents, paidCents, pendingCents, remainingCents: Math.max(0, dueTodayCents - paidCents - pendingCents) };
}

/** The pay-in-full discount on an amount, rounded to the cent. */
export function fullPayDiscountCents(amountCents: number, bps: number): number {
  return bps > 0 ? Math.round((amountCents * bps) / 10_000) : 0;
}

/** The card fee on an amount: rounded to the cent, 0 when the proposal charges none. */
export function cardFeeCents(amountCents: number, bps: number): number {
  return bps > 0 ? Math.round((amountCents * bps) / 10_000) : 0;
}

export const formatBps = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
export const formatMoney = (cents: number, opts: { cents?: boolean } = {}) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: opts.cents || cents % 100 !== 0 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** The paragraphs and bullet lists of a section body (blank line = new paragraph, "- " or "• " = bullet). */
export type BodyBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] };
export function bodyBlocks(body: string): BodyBlock[] {
  const out: BodyBlock[] = [];
  for (const chunk of body.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let para: string[] = [];
    let list: string[] = [];
    const flushPara = () => { if (para.length) out.push({ kind: "p", text: para.join(" ") }); para = []; };
    const flushList = () => { if (list.length) out.push({ kind: "ul", items: list }); list = []; };
    for (const l of lines) {
      const m = /^[-•*]\s+(.*)$/.exec(l);
      if (m) { flushPara(); list.push(m[1]); } else { flushList(); para.push(l); }
    }
    flushPara(); flushList();
  }
  return out;
}

/** The consent the recipient ticks before signing; stored word for word with the signature. */
/**
 * The general service agreement every proposal made from a PDF carries (owner, 2026-10-24: "nothing is guaranteed
 * and there are no refunds, but the results will show and the work will always be proven that it's done"). The
 * admin edits it per proposal; "Use the standard terms" in the editor puts it back.
 */
export function standardTerms(brand: string): string {
  const we = brand.trim() || "the provider";
  return [
    "SERVICE AGREEMENT — GENERAL TERMS",
    `1. The agreement. By signing, you (the client) engage ${we} ("we") for the services you selected in this proposal, at the prices and terms shown. This proposal, your selections and these terms are the whole agreement between us.`,
    "2. No guarantees. Search engines, platforms, publishers, reviewers and the public decide rankings, placements, removals and outcomes, and we do not control them. We do not guarantee any particular ranking, position, removal, review, traffic, lead, sale or other result, or any timeframe. Timelines and targets in this proposal are estimates.",
    "3. Results you can see. We track your search results, rankings and visibility throughout the engagement and report them to you, so progress is always visible.",
    "4. Proof of work. Every deliverable is documented. Each month you receive a report of the work completed — links to the live pages, articles, profiles and listings; distribution and placement reports; copies of requests submitted; change logs; and ranking snapshots — so every item can be verified as done.",
    "5. No refunds. All payments are final and non-refundable, including one-time, setup and monthly fees, once work for that period has begun, whether or not you use the services and regardless of results.",
    "6. Term and billing. One-time services are billed when you sign. Monthly services run for the minimum term shown and are billed automatically each month. After the minimum term, monthly services continue until either side cancels with 30 days' written notice.",
    "7. Payment. Bank transfer (ACH) carries no fee; card payments add the card fee shown at checkout. If a payment fails or is late, work may pause until it is made. You agree to contact us first about any billing question; disputing a charge for work that was delivered as described is a breach of this agreement.",
    "8. Your part. You provide accurate information, the access we need, and timely approvals. Delays caused by missing information, access or approvals do not pause billing or create a right to a refund. You confirm that everything you give us to publish is true and that you have the right to use it.",
    "9. Content and approvals. We publish statements about you or your business only after you approve them, and we label sponsored or client-owned content where the law or a platform's rules require it.",
    "10. Third-party costs. Advertising spend and any third-party fees not listed in this proposal are separate and are charged only with your approval.",
    "11. Ownership. Once paid in full, the websites, articles and other content we create for you are yours, and accounts created in your name belong to you.",
    `12. Confidentiality (both ways). All work under this agreement, including reputation restoration, is confidential between you and ${we}. You agree not to disclose, publish or share with anyone the details of what was done on your behalf (strategies, methods, platforms, outlets, content, removals, results, reports, pricing and communications), except to your own attorneys or accountants who are bound to keep them confidential. ${we} holds all of your information, including your identity, the matters addressed and everything shared during the work, in strict confidence as privileged client information and will not disclose it except where the law requires. These obligations continue after this agreement ends.`,
    `13. Limitation of liability. ${we}'s total liability under this agreement is limited to the fees you paid in the three months before the claim, and neither side is liable for indirect or consequential losses.`,
    "14. Electronic signature. Your electronic signature on this proposal has the same effect as a handwritten signature.",
  ].join("\n\n");
}

/** The clauses the client must initial before the signature unlocks. */
export const clausesToInitial = (content: ProposalContent) => content.clauses.filter((c) => c.initials);

/** The id of the single initial that covers every clause (clauseInitials "once"). */
export const ALL_TERMS_ID = "all";

/** The "Initial here" boxes the client must fill: one for all the terms, or one per clause. */
export function initialTargets(content: ProposalContent): { id: string; heading: string }[] {
  const each = clausesToInitial(content);
  if (!each.length) return [];
  return content.clauseInitials === "each" ? each.map((c) => ({ id: c.id, heading: c.heading })) : [{ id: ALL_TERMS_ID, heading: "Program terms" }];
}

/** Initials from a name: "Steve Tutty, MA, PhD" → "ST" (credentials after a comma are dropped). */
export function initialsOf(name: string): string {
  const words = name.split(",")[0].trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(dr|mr|mrs|ms|mx)\.?$/i.test(w));
  return words.map((w) => w[0].toUpperCase()).join("").slice(0, 4);
}

export const ESIGN_CONSENT =
  "I agree to sign electronically. My electronic signature has the same effect as a handwritten signature, and I accept the selected services, prices and terms of this proposal.";

/** A proposal row as the admin list shows it. */
export type ProposalRow = {
  id: number; kind: ProposalKind; name: string; status: ProposalStatus;
  recipientName: string | null; recipientEmail: string | null; recipientCompany: string | null;
  /** Copied on the offer email, the signed agreement and the payment receipt. */
  recipientCc: string[];
  /** A test copy the admin sent to themselves: signing and emails are real, payment is off. */
  isTest: boolean;
  /** Opens by the client (after sending; one per IP per 30 minutes) and the latest one. */
  viewCount: number; lastViewedAt: string | null;
  title: string; templateId: number | null; hasFile: boolean;
  contractTotalCents: number | null; dueTodayCents: number | null; paidCents: number | null;
  sentAt: string | null; viewedAt: string | null; signedAt: string | null; paidAt: string | null;
  createdAt: string; updatedAt: string;
};

export type ProposalEvent = { at: string; event: string; detail?: string };

/** One proposal as the editor reads it. */
export type ProposalDetail = ProposalRow & {
  publicToken: string; content: ProposalContent; expiresAt: string | null;
  file: { name: string; bytes: number } | null;
  selection: ProposalSelection | null; totals: ProposalTotals | null;
  signature: { name: string; title: string; signedAt: string; ip: string | null } | null;
  /** When the company signed (the first send). */
  countersignedAt: string | null;
  payment: { method: "ach" | "card" | null; cardFeeCents: number; status: string | null; subscriptionId: string | null; scheduleId: string | null };
  /** Every payment toward what's due today (one or several, any card or bank) and what is left. */
  payments: ProposalPayment[];
  balance: PaymentBalance | null;
  /** When auto-pay's first monthly charge is (set once what's due today is paid). */
  autoPayStartsAt: string | null;
  events: ProposalEvent[];
};

export type ProposalSummary = {
  templates: number; offers: number; sent: number; opened: number; signed: number; paid: number;
  signedValueCents: number; paidCents: number;
};

/** What the recipient's page receives. */
export type PublicProposal = {
  status: ProposalStatus; content: ProposalContent;
  recipientName: string | null; recipientCompany: string | null;
  hasFile: boolean; fileName: string | null; expiresAt: string | null; expired: boolean;
  selection: ProposalSelection | null; totals: ProposalTotals | null;
  signature: { name: string; signedAt: string } | null;
  payment: { method: "ach" | "card" | null; cardFeeCents: number; status: string | null };
  payments: ProposalPayment[];
  balance: PaymentBalance | null;
  autoPayStartsAt: string | null;
  stripeReady: boolean;
  preview: boolean;
  isTest: boolean;
  countersignedAt: string | null;
};
