/**
 * Wire shapes of the account billing endpoints (the shared account contract).
 * Money is in the currency's smallest unit (cents); dates are ISO strings.
 *
 *   GET /api/billing/invoices?limit=&starting_after=  -> InvoicesResponse
 *   GET /api/billing/payment-methods                  -> PaymentMethodsResponse
 *   GET /api/billing/purchases                        -> PurchasesResponse
 */

export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void" | string;

export type BillingInvoice = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  amountPaid: number;
  amountDue: number;
  currency: string;
  created: string;
  periodStart: string | null;
  periodEnd: string | null;
  description: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

export type InvoicesResponse = { invoices: BillingInvoice[]; hasMore: boolean };

export type PaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

export type PaymentMethodsResponse = { methods: PaymentMethod[] };

export type PurchaseKind = "course" | "service" | "reinstatement" | "other" | string;

export type Purchase = {
  id: string;
  kind: PurchaseKind;
  description: string | null;
  amount: number;
  currency: string;
  created: string;
  receiptUrl: string | null;
};

export type PurchasesResponse = { purchases: Purchase[] };

/** Stripe invoice statuses as people read them. */
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft", open: "Open", paid: "Paid", uncollectible: "Uncollectible", void: "Void",
};

/** Purchase kinds as people read them. */
export const PURCHASE_KIND_LABELS: Record<string, string> = {
  course: "Course", service: "Service", reinstatement: "Reinstatement", other: "Purchase",
};

/** "visa" -> "Visa", "amex" -> "American Express". */
export const CARD_BRAND_LABELS: Record<string, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover",
  diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay", cartes_bancaires: "Cartes Bancaires",
  eftpos_au: "eftpos", link: "Link",
};

export function cardBrandLabel(brand: string | null | undefined): string {
  const key = (brand || "").toLowerCase();
  if (CARD_BRAND_LABELS[key]) return CARD_BRAND_LABELS[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "Card";
}
