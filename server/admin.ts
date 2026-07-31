/**
 * Platform-level administration — the people who run ConstructHUB, as opposed
 * to org admins (a role INSIDE one customer's CRM org). Gating on org
 * membership would let any contractor's "admin" role see every customer, so
 * platform routes only ever consult this list.
 */

export const ADMIN_EMAILS = ["alpinesidingcompany@gmail.com", "support@constructhub.us"];

// Local dev only: the seeded dev account (dev@constructhub.local, user 1) is a
// platform admin so the admin console is exercisable without a real admin
// login. Gated on the same explicit opt-in as the auth bypass (routes.ts) and
// never in production — deployed boxes are unaffected.
const DEV_AUTH_BYPASS =
  process.env.DEV_AUTH_BYPASS_USER1 === "true" && process.env.NODE_ENV !== "production";
const DEV_BYPASS_EMAIL = "dev@constructhub.local";

export function isPlatformAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (ADMIN_EMAILS.includes(lower)) return true;
  if (DEV_AUTH_BYPASS && lower === DEV_BYPASS_EMAIL) return true;
  return false;
}

export function isPlatformAdmin(user: any): boolean {
  return !!user && isPlatformAdminEmail(user.email);
}
