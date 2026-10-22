/**
 * The three-step sign-up (owner, 2026-10-21: "fix the sign-up flow like the
 * competitors" — Housecall Pro, Jobber, Roofr): email first, a few questions
 * one per screen, password last. The browser (client/src/pages/auth.tsx) and
 * the server (server/signup-leads.ts, POST /api/auth/signup) validate with the
 * same rules from here, so a screen never accepts what the server refuses.
 */

/** The trade chips on "About your business". The value is what is stored. */
export const SIGNUP_TRADES = [
  { value: "roofing", label: "Roofing" },
  { value: "siding_exteriors", label: "Siding/Exteriors" },
  { value: "remodeling", label: "Remodeling" },
  { value: "general_contractor", label: "General contractor" },
  { value: "hvac", label: "HVAC" },
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "painting", label: "Painting" },
  { value: "landscaping", label: "Landscaping" },
  { value: "concrete", label: "Concrete" },
  { value: "other", label: "Other" },
] as const;
export type SignupTrade = (typeof SIGNUP_TRADES)[number]["value"];

export const SIGNUP_TEAM_SIZES = [
  { value: "1", label: "Just me" },
  { value: "2-5", label: "2–5" },
  { value: "6-10", label: "6–10" },
  { value: "11+", label: "11+" },
] as const;
export type SignupTeamSize = (typeof SIGNUP_TEAM_SIZES)[number]["value"];

export const isSignupTrade = (v: unknown): v is SignupTrade => SIGNUP_TRADES.some((t) => t.value === v);
export const isSignupTeamSize = (v: unknown): v is SignupTeamSize => SIGNUP_TEAM_SIZES.some((t) => t.value === v);
export const tradeLabel = (v: string | null | undefined) => SIGNUP_TRADES.find((t) => t.value === v)?.label ?? null;
export const teamSizeLabel = (v: string | null | undefined) => SIGNUP_TEAM_SIZES.find((t) => t.value === v)?.label ?? null;

/** Deliberately loose (one @, a dot in the domain, no spaces) — the verification email is the real check. */
export function normalizeSignupEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * A US mobile number in E.164 (+1XXXXXXXXXX), or null. Accepts the usual ways
 * people type it — (555) 123-4567, 555.123.4567, +1 555 123 4567 — and refuses
 * what can't be dialed under the NANP (area code or exchange starting 0/1).
 * Same output as normalizePhone in server/crm/sms.ts for a 10-digit number.
 */
export function normalizeUsMobile(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  if (/[a-z]/i.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

/** As-you-type display: "5551234567" → "(555) 123-4567". A leading country code 1 is dropped (no US area code starts with 1). */
export function formatUsPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, "").replace(/^1/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 100) : "");

export type SignupDetails = { firstName: string; lastName: string; phone: string; trade: SignupTrade; teamSize: SignupTeamSize };

/** Step 2 ("About your business"): every field is required. */
export function parseSignupDetails(body: any): { ok: true; details: SignupDetails } | { ok: false; message: string } {
  const firstName = cleanName(body?.firstName);
  const lastName = cleanName(body?.lastName);
  if (!firstName || !lastName) return { ok: false, message: "Enter your first and last name" };
  const phone = normalizeUsMobile(body?.phone);
  if (!phone) return { ok: false, message: "Enter a valid US mobile number" };
  if (!isSignupTrade(body?.trade)) return { ok: false, message: "Pick your trade" };
  if (!isSignupTeamSize(body?.teamSize)) return { ok: false, message: "Pick your team size" };
  return { ok: true, details: { firstName, lastName, phone, trade: body.trade, teamSize: body.teamSize } };
}
