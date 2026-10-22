/**
 * Payment-side org settings that both the server and the Settings page read:
 *
 *   - **Reconciliation prompts** — after a job is approved (the deposit) and
 *     after it is closed out (the final payment), the PM / staff are asked on
 *     a schedule (day 1, 3, 5 by default) how the money was received, so a
 *     check, cash or wire taken off the platform still lands in the ledger.
 *   - **Receipts** — the automatic receipt a client gets after any payment:
 *     by email (default), by text, both, or neither.
 *
 * Stored on crm_orgs.custom_fields->payments (next to the card fee and the
 * rail policy); absent keys fall back to the defaults below, so every account
 * gets the prompts without touching Settings.
 */
import { crmNotificationChannel } from "./schema";

export type ReconcilePhoto = "off" | "optional" | "required";
export type ReconcileNotify = "pm" | "pm_sales" | "owners";

export type ReconcileSettings = {
  /** Master switch for both prompt series. */
  enabled: boolean;
  /** Days after approval the deposit prompt fires (1 = next day). */
  approvalDays: number[];
  /** Days after close-out the final-payment prompt fires. */
  closeoutDays: number[];
  /** Ask for a photo / copy of the check when recording an off-platform payment. */
  photo: ReconcilePhoto;
  /** Who gets the prompt besides the in-app pop-up: the PM, PM + sales, or every owner. */
  notify: ReconcileNotify;
  /** Where the reminder also goes. The in-app pop-up is always on while enabled. */
  channels: { email: boolean; sms: boolean };
};

export const DEFAULT_RECONCILE: ReconcileSettings = {
  enabled: true,
  approvalDays: [1, 3, 5],
  closeoutDays: [1, 3, 5],
  photo: "optional",
  notify: "pm_sales",
  channels: { email: true, sms: false },
};

export const MAX_RECONCILE_DAY = 60;
export const MAX_RECONCILE_STEPS = 10;

/** "1, 3, 5" → [1, 3, 5]: whole days 1..60, unique, ascending, at most 10. */
export function parseDayList(raw: unknown): number[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,;]+/);
  const out = new Set<number>();
  for (const p of parts) {
    const n = Math.round(Number(p));
    if (Number.isFinite(n) && n >= 1 && n <= MAX_RECONCILE_DAY) out.add(n);
  }
  return [...out].sort((a, b) => a - b).slice(0, MAX_RECONCILE_STEPS);
}

const paymentsOf = (customFields: unknown): Record<string, any> =>
  ((customFields as Record<string, any> | null | undefined)?.payments ?? {}) as Record<string, any>;

export function reconcileSettingsOf(customFields: unknown): ReconcileSettings {
  const r = paymentsOf(customFields).reconcile;
  if (!r || typeof r !== "object") return { ...DEFAULT_RECONCILE, approvalDays: [...DEFAULT_RECONCILE.approvalDays], closeoutDays: [...DEFAULT_RECONCILE.closeoutDays] };
  const approval = parseDayList(r.approvalDays);
  const closeout = parseDayList(r.closeoutDays);
  return {
    enabled: r.enabled !== false,
    approvalDays: approval.length ? approval : [...DEFAULT_RECONCILE.approvalDays],
    closeoutDays: closeout.length ? closeout : [...DEFAULT_RECONCILE.closeoutDays],
    photo: r.photo === "off" || r.photo === "required" ? r.photo : "optional",
    notify: r.notify === "pm" || r.notify === "owners" ? r.notify : "pm_sales",
    channels: {
      email: r.channels?.email !== false,
      sms: r.channels?.sms === true,
    },
  };
}

export type ReceiptSettings = { email: boolean; sms: boolean };

/**
 * Receipts ride on the existing "paymentReceipt" notification pref so there is
 * ONE switch, not two: its email channel = email the client a receipt
 * (default on), its sms channel = also text it to their cell phone (default
 * off). Both off = automatic receipts disabled. The Settings page's
 * "Automatic receipts" section and the notifications grid write the same key.
 */
export function receiptSettingsOf(customFields: unknown): ReceiptSettings {
  return {
    email: crmNotificationChannel(customFields, "paymentReceipt", "email"),
    sms: crmNotificationChannel(customFields, "paymentReceipt", "sms"),
  };
}

/** The manual rails a payment can be recorded with. "Pick one" is enforced by the dropdown AND the server. */
export const MANUAL_PAYMENT_METHODS = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "wire", label: "Wire transfer" },
  { value: "credit_card", label: "Credit card" },
  { value: "ach", label: "Bank transfer (ACH)" },
  { value: "card", label: "Card (taken another way)" },
  { value: "financing", label: "Financing" },
  { value: "other", label: "Other" },
] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number]["value"];
export const MANUAL_PAYMENT_METHOD_VALUES = MANUAL_PAYMENT_METHODS.map((m) => m.value) as [ManualPaymentMethod, ...ManualPaymentMethod[]];

/** How a payment method reads on a receipt, a ledger row or an email. */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash", check: "Check", zelle: "Zelle", wire: "Wire transfer", credit_card: "Credit card",
  ach: "Bank transfer (ACH)", card: "Card", financing: "Financing", other: "Other",
};
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "Payment";
  return PAYMENT_METHOD_LABELS[method] ?? method.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The org's "pay by check or Zelle" instructions (Settings → Payments), shown with payment requests. Null when unset. */
export function offlinePaymentInstructionsOf(customFields: unknown): string | null {
  const v = (customFields as Record<string, any> | null | undefined)?.payments?.offlineInstructions;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 1500) : null;
}

/** The division's own check/Zelle instructions (crm_divisions.custom_fields.offlinePaymentInstructions — WA and FL
 *  bank differently), else the org's. Null when neither is set. */
export function offlinePaymentInstructionsFor(orgCustomFields: unknown, divisionCustomFields?: unknown): string | null {
  const v = (divisionCustomFields as Record<string, any> | null | undefined)?.offlinePaymentInstructions;
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 1500);
  return offlinePaymentInstructionsOf(orgCustomFields);
}
