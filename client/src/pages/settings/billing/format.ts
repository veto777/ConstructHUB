/**
 * Display helpers shared by the account panels (Billing, API keys, API usage).
 * Pure functions: money and dates come out of here the same way in every
 * panel, and the e2e specs format their expectations through the same rules.
 */

/** "$29", "$1,649.50" — cents only when there are any. Stripe amounts are in the smallest unit. */
export function formatMoney(cents: number, currency: string | null | undefined = "usd"): string {
  const code = (currency || "usd").toUpperCase();
  const value = (Number(cents) || 0) / 100;
  const whole = Math.round(value * 100) % 100 === 0;
  try {
    return value.toLocaleString("en-US", {
      style: "currency", currency: code,
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    });
  } catch {
    // An unknown ISO code: still a readable number rather than a crash.
    return `${value.toFixed(2)} ${code}`;
  }
}

/** "Oct 1, 2026" in the viewer's time zone; "—" for a missing value. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Oct 1, 2026, 3:04 PM" in the viewer's time zone; "—" for a missing value. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Oct 1 – Oct 31, 2026" for an invoice's billing period. */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "—";
  if (!start || !end) return formatDate(start || end);
  const s = new Date(start), e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const sameYear = s.getFullYear() === e.getFullYear();
  const left = s.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${left} – ${formatDate(end)}`;
}

/** Whole-number counts with thousands separators. */
export const formatCount = (n: number | null | undefined) => (Math.max(0, Number(n) || 0)).toLocaleString("en-US");

/** Whole days until a date (negative when past); null for no date. */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Clipboard writes can be refused (no permission, insecure context, some
 * browsers); report the outcome instead of assuming the copy worked.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * GET helper for queries whose key is not a plain URL (cursor pagination):
 * the same rules as the app's default query function — session cookie, no
 * browser cache, "STATUS: body" errors that apiErrorMessage can unwrap.
 */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}
