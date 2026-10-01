/**
 * Branded transactional email templates (HTML + plain text) for the account
 * lifecycle: welcome, subscription started/changed/cancelled/ended, invoice
 * receipts, failed payments and one-time purchase receipts.
 *
 * Every builder here is a pure function: (facts) -> { subject, html, text }.
 * Nothing in this file reads the database, calls Stripe or sends mail — that
 * is ./billing-emails.ts. Keeping the templates pure is what lets the tests
 * assert on content without any network or secrets.
 *
 * Layout contract (shared with lane 1's helper, same option shape):
 *   emailLayout({ title, intro, rows: [[label, value]], cta: { label, url }, footer })
 * This copy adds optional `sections` (line-item tables), `steps` (numbered
 * list), `note` and `secondary` (a plain link under the button). Every value
 * is HTML-escaped here, so callers pass plain strings.
 */

export type EmailMessage = { subject: string; html: string; text: string };

export type LayoutRow = [label: string, value: string];
export type LayoutLine = { label: string; detail?: string | null; amount?: string | null };
export type LayoutSection = { heading?: string; lines: LayoutLine[]; totals?: LayoutRow[] };
export type LayoutCta = { label: string; url: string };

export type EmailLayoutOptions = {
  title: string;
  /** One or more paragraphs under the title. */
  intro?: string | string[];
  /** Label / value pairs (plan, amount, date…). */
  rows?: LayoutRow[];
  /** Line-item tables (receipts) with optional totals under each. */
  sections?: LayoutSection[];
  /** Numbered "first steps". Each may carry a link. */
  steps?: { text: string; url?: string }[];
  cta?: LayoutCta | null;
  /** A plain link shown under the button ("View invoice", "Download PDF"). */
  secondary?: LayoutCta[];
  /** Small print above the footer. */
  note?: string | null;
  footer?: string | null;
  /** Public origin for the logo. */
  baseUrl: string;
};

const BRAND = "ConstructHUB";
const ACCENT = "#F97316";
const INK = "#1a1a2e";
const MUTED = "#6b7280";

export const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Only http(s) links reach an email; anything else is dropped rather than rendered. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Money in the invoice's currency (cents -> "$1,234.56"); non-USD keeps its ISO code. */
export function money(cents: number | null | undefined, currency = "usd"): string {
  const amount = (Number(cents) || 0) / 100;
  const code = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: code === "USD" ? "symbol" : "code" }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

/** A Stripe epoch (seconds) or Date as "September 30, 2026" (UTC, so a webhook replay renders the same day). */
export function dateWords(value: number | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(Number(value) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export const intervalWord = (interval: "month" | "year" | null | undefined) =>
  interval === "year" ? "yearly" : interval === "month" ? "monthly" : "";

const paragraphs = (intro: string | string[] | undefined) => (Array.isArray(intro) ? intro : intro ? [intro] : []);

function rowsHtml(rows: LayoutRow[]): string {
  if (!rows.length) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">${rows
    .map(([label, value]) => `<tr>
<td style="padding:7px 0;color:${MUTED};font-size:13px;width:44%;vertical-align:top;border-bottom:1px solid #f1f5f9;">${esc(label)}</td>
<td style="padding:7px 0;color:${INK};font-size:14px;font-weight:600;vertical-align:top;border-bottom:1px solid #f1f5f9;">${esc(value)}</td>
</tr>`).join("")}</table>`;
}

function sectionsHtml(sections: LayoutSection[]): string {
  return sections.map((section) => {
    const heading = section.heading ? `<p style="margin:0 0 8px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};font-weight:700;">${esc(section.heading)}</p>` : "";
    const lines = section.lines.map((line) => `<tr>
<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;">
<div style="color:${INK};font-size:14px;font-weight:600;">${esc(line.label)}</div>${line.detail ? `<div style="color:${MUTED};font-size:12px;margin-top:2px;">${esc(line.detail)}</div>` : ""}
</td>
<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;color:${INK};font-size:14px;white-space:nowrap;vertical-align:top;">${esc(line.amount ?? "")}</td>
</tr>`).join("");
    const totals = (section.totals ?? []).map(([label, value], i, all) => `<tr>
<td style="padding:6px 0;color:${i === all.length - 1 ? INK : MUTED};font-size:${i === all.length - 1 ? 15 : 13}px;font-weight:${i === all.length - 1 ? 700 : 400};">${esc(label)}</td>
<td style="padding:6px 0;text-align:right;color:${INK};font-size:${i === all.length - 1 ? 15 : 13}px;font-weight:${i === all.length - 1 ? 700 : 400};white-space:nowrap;">${esc(value)}</td>
</tr>`).join("");
    return `<div style="margin:0 0 20px;">${heading}<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${lines}${totals}</table></div>`;
  }).join("");
}

function stepsHtml(steps: { text: string; url?: string }[]): string {
  if (!steps.length) return "";
  return `<ol style="margin:0 0 20px;padding-left:22px;color:#374151;font-size:14px;line-height:1.9;">${steps.map((step) => {
    const url = safeUrl(step.url);
    return `<li>${url ? `<a href="${esc(url)}" style="color:${ACCENT};font-weight:600;text-decoration:none;">${esc(step.text)}</a>` : esc(step.text)}</li>`;
  }).join("")}</ol>`;
}

/**
 * The branded shell every account email shares. Returns the HTML and a plain
 * text alternative built from the same facts, so no email ships without one.
 */
export function emailLayout(opts: EmailLayoutOptions): { html: string; text: string } {
  const base = safeUrl(opts.baseUrl) ?? "https://constructhub.us";
  const logo = `${base.replace(/\/+$/, "")}/chub-logo-square-text.png`;
  const cta = opts.cta && safeUrl(opts.cta.url) ? { label: opts.cta.label, url: safeUrl(opts.cta.url)! } : null;
  const secondary = (opts.secondary ?? []).filter((link) => safeUrl(link.url)).map((link) => ({ label: link.label, url: safeUrl(link.url)! }));
  const intro = paragraphs(opts.intro);
  const footer = opts.footer ?? `You're receiving this because you have a ${BRAND} account. Questions? Reply to this email or write to support@constructhub.us.`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:28px 16px;">
<div style="text-align:center;margin-bottom:18px;">
<img src="${esc(logo)}" alt="${BRAND}" width="56" height="56" style="width:56px;height:56px;border-radius:12px;" />
<div style="color:${INK};font-size:20px;font-weight:800;letter-spacing:-0.3px;margin-top:8px;">${BRAND}</div>
</div>
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
<div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:22px 28px;">
<h1 style="color:#ffffff;font-size:20px;line-height:1.3;margin:0;">${esc(opts.title)}</h1>
</div>
<div style="padding:24px 28px;">
${intro.map((p) => `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 14px;">${esc(p)}</p>`).join("")}
${rowsHtml(opts.rows ?? [])}
${sectionsHtml(opts.sections ?? [])}
${stepsHtml(opts.steps ?? [])}
${cta ? `<div style="text-align:center;margin:8px 0 12px;"><a href="${esc(cta.url)}" style="background:linear-gradient(135deg,#F97316,#FB923C);color:#ffffff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:15px;box-shadow:0 4px 12px rgba(249,115,22,0.3);">${esc(cta.label)}</a></div>` : ""}
${secondary.length ? `<p style="text-align:center;margin:0 0 12px;font-size:13px;">${secondary.map((link) => `<a href="${esc(link.url)}" style="color:${ACCENT};font-weight:600;text-decoration:none;margin:0 10px;">${esc(link.label)}</a>`).join("")}</p>` : ""}
${opts.note ? `<p style="color:${MUTED};font-size:12px;line-height:1.6;margin:12px 0 0;border-top:1px solid #f1f5f9;padding-top:12px;">${esc(opts.note)}</p>` : ""}
</div>
</div>
<p style="color:#9ca3af;font-size:11px;line-height:1.6;text-align:center;margin:18px 0 0;">${esc(footer)}</p>
</div>
</body></html>`;

  const textParts: string[] = [opts.title, ""];
  for (const p of intro) textParts.push(p, "");
  for (const [label, value] of opts.rows ?? []) textParts.push(`${label}: ${value}`);
  if (opts.rows?.length) textParts.push("");
  for (const section of opts.sections ?? []) {
    if (section.heading) textParts.push(section.heading.toUpperCase());
    for (const line of section.lines) textParts.push(`- ${line.label}${line.detail ? ` (${line.detail})` : ""}${line.amount ? `: ${line.amount}` : ""}`);
    for (const [label, value] of section.totals ?? []) textParts.push(`${label}: ${value}`);
    textParts.push("");
  }
  (opts.steps ?? []).forEach((step, i) => textParts.push(`${i + 1}. ${step.text}${safeUrl(step.url) ? ` — ${safeUrl(step.url)}` : ""}`));
  if (opts.steps?.length) textParts.push("");
  if (cta) textParts.push(`${cta.label}: ${cta.url}`, "");
  for (const link of secondary) textParts.push(`${link.label}: ${link.url}`);
  if (secondary.length) textParts.push("");
  if (opts.note) textParts.push(opts.note, "");
  textParts.push(footer);
  return { html, text: textParts.join("\n") };
}

// ── Facts each template renders ─────────────────────────────────────────────

export type SubscriptionFacts = {
  /** "Pro", "Agency" (or the Stripe price nickname for a legacy plan). */
  planName: string;
  interval: "month" | "year" | null;
  /** Recurring amount per interval, cents, when it can be priced (null for a sales-made subscription). */
  recurringCents: number | null;
  currency: string;
  /** Human lines for add-ons and Agency locations ("Extra seat × 2", "25 locations (10 included + 15)"). */
  extras: string[];
  trialEnd: Date | null;
  /** When the next charge (or the first charge after a trial) is due. */
  nextChargeAt: Date | null;
  cancelAt: Date | null;
  status: string;
};

export type ReceiptLine = { label: string; detail?: string | null; amountCents: number; quantity?: number | null; prorated?: boolean };

export type InvoiceFacts = {
  id: string;
  number: string | null;
  currency: string;
  paidAt: Date | null;
  createdAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  lines: ReceiptLine[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  /** amount_due − total: negative when account credit was applied, positive when a previous balance was owed. */
  balanceCents: number;
  /** "Visa ending in 4242" when the charge is known, else null. */
  card: { brand: string; last4: string } | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  nextPaymentAttempt: Date | null;
  attemptCount: number;
  billingReason: string | null;
  description: string | null;
};

export type PurchaseKind = "course" | "service" | "reinstatement" | "other";
export type PurchaseFacts = {
  id: string;
  kind: PurchaseKind;
  currency: string;
  paidAt: Date | null;
  items: { label: string; detail?: string | null; amountCents: number; quantity?: number | null }[];
  totalCents: number;
  card: { brand: string; last4: string } | null;
  receiptUrl: string | null;
};

export type PlanChangeFacts = {
  before: SubscriptionFacts | null;
  after: SubscriptionFacts;
  /** What changed, in words ("Plan: Pro → Growth"). */
  changes: string[];
  /** Prorated amount charged (positive) or credited (negative) now, when known. */
  prorationCents: number | null;
  invoice: Pick<InvoiceFacts, "number" | "hostedInvoiceUrl" | "invoicePdf"> | null;
};

const cardWords = (card: { brand: string; last4: string } | null) =>
  card ? `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} ending in ${card.last4}` : "Card on file";

const perInterval = (facts: SubscriptionFacts) =>
  facts.recurringCents === null ? "Custom pricing (see your invoice)" : `${money(facts.recurringCents, facts.currency)} / ${facts.interval === "year" ? "year" : "month"}`;

const billingLink = (base: string) => `${base}/settings?tab=billing`;

// ── Templates ───────────────────────────────────────────────────────────────

export function welcomeEmail(input: { displayName: string | null; email: string; baseUrl: string }): EmailMessage {
  const base = input.baseUrl.replace(/\/+$/, "");
  const name = input.displayName?.trim() || null;
  const subject = `Welcome to ${BRAND}${name ? `, ${name}` : ""}`;
  const { html, text } = emailLayout({
    baseUrl: base,
    title: subject,
    intro: [
      `Your account (${input.email}) is verified and ready. ${BRAND} puts your Google Business Profile, permit data, click-fraud protection and a contractor CRM in one place.`,
      "Here's how to get going:",
    ],
    steps: [
      // No trial promise here: the trial is granted (or refused) by the server at checkout.
      { text: "Choose a plan — you can change or cancel it any time.", url: `${base}/pricing` },
      { text: "Connect your Google Business Profile for review alerts, posts and Profile Guard.", url: `${base}/google-business` },
      { text: "Set up the CRM: estimates, invoices and payments for your jobs.", url: `${base}/crm` },
      { text: "Search permits and appraiser records for your area.", url: `${base}/databases` },
      { text: "Turn on two-factor sign-in to keep your account yours.", url: `${base}/settings?tab=security` },
    ],
    cta: { label: "Open ConstructHUB", url: `${base}/` },
    secondary: [
      { label: "Billing & invoices", url: billingLink(base) },
      { label: "Notification settings", url: `${base}/settings?tab=notifications` },
    ],
    note: "Every invoice, receipt and plan change is emailed to this address and kept under Settings → Billing & Plans.",
  });
  return { subject, html, text };
}

export function subscriptionStartedEmail(facts: SubscriptionFacts, baseUrl: string): EmailMessage {
  const base = baseUrl.replace(/\/+$/, "");
  const trialing = facts.status === "trialing" && facts.trialEnd;
  const subject = trialing ? `Your ${BRAND} ${facts.planName} trial has started` : `Your ${BRAND} ${facts.planName} plan is active`;
  const rows: LayoutRow[] = [
    ["Plan", `${facts.planName}${facts.interval ? ` — billed ${intervalWord(facts.interval)}` : ""}`],
    ["Price", perInterval(facts)],
  ];
  for (const extra of facts.extras) rows.push(["Includes", extra]);
  if (trialing) rows.push(["Trial ends", dateWords(facts.trialEnd) ?? "—"]);
  if (facts.nextChargeAt) rows.push([trialing ? "First charge" : "Next charge", `${facts.recurringCents !== null ? `${money(facts.recurringCents, facts.currency)} on ` : ""}${dateWords(facts.nextChargeAt)}`]);
  const { html, text } = emailLayout({
    baseUrl: base,
    title: subject,
    intro: trialing
      ? [`Thanks for trying ${BRAND}. Everything in the ${facts.planName} plan is unlocked now. Your card will not be charged until the trial ends; cancel before then and you pay nothing.`]
      : [`Thanks for subscribing. Everything in the ${facts.planName} plan is unlocked now. A receipt is emailed every time an invoice is paid.`],
    rows,
    cta: { label: "Open your dashboard", url: `${base}/` },
    secondary: [{ label: "Manage billing", url: billingLink(base) }],
    note: "Change your plan, add-ons or card any time under Settings → Billing & Plans. Plan changes update this subscription in place — a second subscription is never started.",
  });
  return { subject, html, text };
}

export function receiptEmail(invoice: InvoiceFacts, baseUrl: string): EmailMessage {
  const base = baseUrl.replace(/\/+$/, "");
  const label = invoice.number ? `Receipt ${invoice.number}` : "Receipt";
  const subject = `${label} — ${money(invoice.amountPaidCents, invoice.currency)} paid to ${BRAND}`;
  const rows: LayoutRow[] = [
    ["Invoice", invoice.number ?? invoice.id],
    ["Paid on", dateWords(invoice.paidAt ?? invoice.createdAt) ?? "—"],
    ["Payment method", cardWords(invoice.card)],
  ];
  if (invoice.periodStart && invoice.periodEnd) rows.push(["Billing period", `${dateWords(invoice.periodStart)} – ${dateWords(invoice.periodEnd)}`]);
  const totals: LayoutRow[] = [["Subtotal", money(invoice.subtotalCents, invoice.currency)]];
  if (invoice.discountCents) totals.push(["Discount", `-${money(invoice.discountCents, invoice.currency)}`]);
  if (invoice.taxCents) totals.push(["Tax", money(invoice.taxCents, invoice.currency)]);
  if (invoice.balanceCents < 0) totals.push(["Account credit applied", `-${money(-invoice.balanceCents, invoice.currency)}`]);
  else if (invoice.balanceCents > 0) totals.push(["Previous balance", money(invoice.balanceCents, invoice.currency)]);
  totals.push(["Total paid", money(invoice.amountPaidCents, invoice.currency)]);
  const secondary: LayoutCta[] = [];
  if (invoice.hostedInvoiceUrl) secondary.push({ label: "View invoice online", url: invoice.hostedInvoiceUrl });
  if (invoice.invoicePdf) secondary.push({ label: "Download PDF", url: invoice.invoicePdf });
  const { html, text } = emailLayout({
    baseUrl: base,
    title: `Thanks — your payment of ${money(invoice.amountPaidCents, invoice.currency)} went through`,
    intro: [`This is your receipt for ${invoice.number ? `invoice ${invoice.number}` : "your invoice"}. Keep it for your records; every invoice also stays available under Settings → Billing & Plans.`],
    rows,
    sections: [{
      heading: "What you paid for",
      lines: invoice.lines.map((line) => ({
        label: line.label,
        detail: [line.quantity && line.quantity > 1 ? `× ${line.quantity}` : null, line.prorated ? "prorated" : null, line.detail].filter(Boolean).join(" · ") || null,
        amount: money(line.amountCents, invoice.currency),
      })),
      totals,
    }],
    cta: { label: "Billing & invoices", url: billingLink(base) },
    secondary,
    note: invoice.description ?? undefined,
  });
  return { subject, html, text };
}

export function paymentFailedEmail(invoice: InvoiceFacts, baseUrl: string): EmailMessage {
  const base = baseUrl.replace(/\/+$/, "");
  const subject = `Action needed: your ${BRAND} payment of ${money(invoice.amountDueCents, invoice.currency)} didn't go through`;
  const rows: LayoutRow[] = [
    ["Amount due", money(invoice.amountDueCents, invoice.currency)],
    ["Invoice", invoice.number ?? invoice.id],
    ["Payment method", cardWords(invoice.card)],
    ["Attempt", String(invoice.attemptCount || 1)],
    ["Next automatic retry", invoice.nextPaymentAttempt ? dateWords(invoice.nextPaymentAttempt)! : "No further automatic retries — please pay the invoice to keep your plan"],
  ];
  const secondary: LayoutCta[] = [];
  if (invoice.hostedInvoiceUrl) secondary.push({ label: "Pay this invoice now", url: invoice.hostedInvoiceUrl });
  const { html, text } = emailLayout({
    baseUrl: base,
    title: "Your payment didn't go through",
    intro: [
      `We tried to charge ${cardWords(invoice.card).replace(/^Card on file$/, "your card on file")} for ${invoice.number ? `invoice ${invoice.number}` : "your latest invoice"} and the bank declined it. Nothing changed on your account yet — your plan stays on while we retry.`,
      "Update your card to fix it in a minute. Manage billing opens Stripe's secure billing portal, where you can replace the card and the invoice is retried right away.",
    ],
    rows,
    cta: { label: "Update payment method", url: billingLink(base) },
    secondary,
    note: "If the retries keep failing, the subscription ends and your account goes back to no plan. Your data is kept; choose a plan again any time to pick up where you left off.",
  });
  return { subject, html, text };
}

export function planChangedEmail(change: PlanChangeFacts, baseUrl: string): EmailMessage {
  const base = baseUrl.replace(/\/+$/, "");
  const after = change.after;
  const subject = `Your ${BRAND} subscription changed — now ${after.planName}${after.interval ? `, ${intervalWord(after.interval)}` : ""}`;
  const rows: LayoutRow[] = [
    ["Plan", `${after.planName}${after.interval ? ` — billed ${intervalWord(after.interval)}` : ""}`],
    ["New price", perInterval(after)],
  ];
  for (const extra of after.extras) rows.push(["Includes", extra]);
  if (change.prorationCents !== null && change.prorationCents !== 0) {
    rows.push([change.prorationCents > 0 ? "Charged today (prorated)" : "Credited (prorated)", money(Math.abs(change.prorationCents), after.currency)]);
  }
  if (after.nextChargeAt) rows.push(["Next charge", `${after.recurringCents !== null ? `${money(after.recurringCents, after.currency)} on ` : ""}${dateWords(after.nextChargeAt)}`]);
  const secondary: LayoutCta[] = [];
  if (change.invoice?.hostedInvoiceUrl) secondary.push({ label: "View the prorated invoice", url: change.invoice.hostedInvoiceUrl });
  if (change.invoice?.invoicePdf) secondary.push({ label: "Download PDF", url: change.invoice.invoicePdf });
  const { html, text } = emailLayout({
    baseUrl: base,
    title: "Your subscription was updated",
    intro: ["Here's what changed on your subscription. It was updated in place — you still have one subscription, on one bill."],
    sections: [{ heading: "What changed", lines: change.changes.map((text) => ({ label: text })) }],
    rows,
    cta: { label: "Review billing", url: billingLink(base) },
    secondary,
    note: change.prorationCents === null
      ? "The difference for the rest of this billing period is prorated: a charge or credit for it appears on your next receipt."
      : change.prorationCents === 0
        ? "No prorated charge was needed for this change."
        : "The prorated amount covers the rest of the current billing period; a receipt for it is sent separately.",
  });
  return { subject, html, text };
}

export function cancellationScheduledEmail(facts: SubscriptionFacts, baseUrl: string): EmailMessage {
  const base = baseUrl.replace(/\/+$/, "");
  const when = dateWords(facts.cancelAt) ?? "the end of your billing period";
  const subject = `Your ${BRAND} ${facts.planName} plan ends on ${when}`;
  const { html, text } = emailLayout({
    baseUrl: base,
    title: "Your cancellation is scheduled",
    intro: [
      `Your ${facts.planName} plan is set to end on ${when}. You keep everything until then and you won't be charged again.`,
      "Changed your mind? Resume the plan from Manage billing before that date and nothing is interrupted.",
    ],
    rows: [["Plan", `${facts.planName}${facts.interval ? ` — billed ${intervalWord(facts.interval)}` : ""}`], ["Access until", when]],
    cta: { label: "Resume my plan", url: billingLink(base) },
    note: "After the plan ends your data stays in your account; choose a plan again any time to pick up where you left off.",
  });
  return { subject, html, text };
}

export function cancellationRevertedEmail(facts: SubscriptionFacts, baseUrl: string): EmailMessage {
  const base = baseUrl.replace(/\/+$/, "");
  const subject = `Your ${BRAND} ${facts.planName} plan will continue`;
  const rows: LayoutRow[] = [["Plan", `${facts.planName}${facts.interval ? ` — billed ${intervalWord(facts.interval)}` : ""}`], ["Price", perInterval(facts)]];
  if (facts.nextChargeAt) rows.push(["Next charge", dateWords(facts.nextChargeAt)!]);
  const { html, text } = emailLayout({
    baseUrl: base,
    title: "Welcome back — your plan continues",
    intro: [`The scheduled cancellation of your ${facts.planName} plan was removed. Billing continues as before.`],
    rows,
    cta: { label: "Manage billing", url: billingLink(base) },
  });
  return { subject, html, text };
}

export function subscriptionEndedEmail(facts: SubscriptionFacts, baseUrl: string): EmailMessage {
  const base = baseUrl.replace(/\/+$/, "");
  const subject = `Your ${BRAND} ${facts.planName} plan has ended`;
  const { html, text } = emailLayout({
    baseUrl: base,
    title: "Your subscription has ended",
    intro: [
      `Your ${facts.planName} plan ended${facts.cancelAt ? ` on ${dateWords(facts.cancelAt)}` : ""} and you won't be billed again. Your account is now on no plan: your data, connections and history are kept, but plan features are paused.`,
      "Pick a plan whenever you're ready and everything is right where you left it.",
    ],
    cta: { label: "Choose a plan", url: `${base}/pricing` },
    secondary: [{ label: "Past invoices", url: billingLink(base) }],
  });
  return { subject, html, text };
}

const PURCHASE_NEXT: Record<PurchaseKind, string> = {
  course: "Your Master Class access is live now — open it from the dashboard any time.",
  service: "Our team will reach out within one business day to kick things off.",
  reinstatement: "Your account is reinstated and everything is back on.",
  other: "Thanks for your purchase.",
};

export function purchaseReceiptEmail(purchase: PurchaseFacts, baseUrl: string): EmailMessage {
  const base = baseUrl.replace(/\/+$/, "");
  const subject = `Receipt — ${money(purchase.totalCents, purchase.currency)} paid to ${BRAND}`;
  const secondary: LayoutCta[] = [];
  if (purchase.receiptUrl) secondary.push({ label: "View Stripe receipt", url: purchase.receiptUrl });
  const { html, text } = emailLayout({
    baseUrl: base,
    title: `Thanks — your payment of ${money(purchase.totalCents, purchase.currency)} went through`,
    intro: [`This is your receipt. ${PURCHASE_NEXT[purchase.kind]}`],
    rows: [
      ["Paid on", dateWords(purchase.paidAt) ?? "—"],
      ["Payment method", cardWords(purchase.card)],
      ["Reference", purchase.id],
    ],
    sections: [{
      heading: "What you bought",
      lines: purchase.items.map((item) => ({
        label: item.label,
        detail: [item.quantity && item.quantity > 1 ? `× ${item.quantity}` : null, item.detail].filter(Boolean).join(" · ") || null,
        amount: money(item.amountCents, purchase.currency),
      })),
      totals: [["Total paid", money(purchase.totalCents, purchase.currency)]],
    }],
    cta: purchase.kind === "course" ? { label: "Open Master Class", url: `${base}/master-class` } : { label: "Billing & receipts", url: billingLink(base) },
    secondary,
  });
  return { subject, html, text };
}
