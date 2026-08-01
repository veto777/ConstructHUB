/**
 * Owner-level notifications — the "runs a tight ship" switches: bid sent,
 * team member signed in, team member changed their own account. Each is
 * gated by the org's notificationPrefs (default ON, see CRM_NOTIFICATION_PREFS)
 * and mailed to the org's active owner member(s) via sendWithFallback —
 * the same shape as the estimate-approved mail in portal.ts.
 *
 * The actor is always excluded from the recipients: an owner who logs in or
 * edits their own profile does not need an email about themselves.
 *
 * Best-effort everywhere: a dead SMTP never breaks a login, a send, or a
 * profile save.
 */
import { db } from "../db";
import {
  crmMembers,
  crmOrgs,
  crmNotificationEnabled,
  type CrmNotificationPref,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { sendWithFallback } from "../email";

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

/** Active owner inboxes for an org, minus anyone we must not mail (the actor). */
async function orgOwnerEmails(orgId: string, excludeEmails: string[] = []): Promise<string[]> {
  const exclude = new Set(excludeEmails.filter(Boolean).map((e) => e.toLowerCase()));
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.status, "active")));
  const out = new Set<string>();
  for (const m of members) {
    if (m.role === "owner" && m.email && !exclude.has(m.email.toLowerCase())) out.add(m.email);
  }
  return [...out];
}

/**
 * Email the org owner(s), honoring the pref switch. `bodyHtml` is the inner
 * content (already escaped by the caller); it gets the standard font wrapper
 * and an optional CRM link button. Returns true when a send was attempted.
 */
export async function notifyOrgOwners(args: {
  org: typeof crmOrgs.$inferSelect;
  pref: CrmNotificationPref;
  subject: string;
  bodyHtml: string;
  /** Never mail the actor, even when they hold an owner seat. */
  excludeEmails?: string[];
  link?: string;
  linkLabel?: string;
}): Promise<boolean> {
  if (!crmNotificationEnabled(args.org.customFields, args.pref)) return false;
  const to = await orgOwnerEmails(args.org.id, args.excludeEmails);
  if (!to.length) return false;

  await sendWithFallback({
    to: to.join(","),
    subject: args.subject,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">` +
      args.bodyHtml +
      (args.link
        ? `<p style="margin:20px 0"><a href="${args.link}" style="background:#4f46e5;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">${esc(args.linkLabel ?? "Open in the CRM")}</a></p>`
        : "") +
      `</div>`,
  } as any).catch((e: any) => console.error("[crm] owner notify failed:", e?.message || e));
  return true;
}

// ── Member-activity events (login, account changes) ─────────────────────────

// Sign-in debounce: at most one "signed in" email per user per org per hour.
// In-memory on purpose — it resets on deploy/restart, which at worst sends
// one extra email; a durable store would be overkill for a rate limiter.
const LOGIN_DEBOUNCE_MS = 60 * 60 * 1000;
const loginNotifiedAt = new Map<string, number>();

type Actor = { id: number; email: string; displayName: string | null };

/** Every org the user holds an active seat in, with its org row. */
async function activeOrgsOf(userId: number) {
  const seats = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.userId, userId), eq(crmMembers.status, "active")));
  const out: { org: typeof crmOrgs.$inferSelect; member: typeof crmMembers.$inferSelect }[] = [];
  for (const seat of seats) {
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, seat.orgId)).limit(1);
    if (org) out.push({ org, member: seat });
  }
  return out;
}

const actorName = (user: Actor, member?: typeof crmMembers.$inferSelect) =>
  member?.displayName || user.displayName || user.email;

/** "Team member signs in" — one email per user per org per hour. */
export async function notifyMemberLogin(user: Actor): Promise<void> {
  for (const { org, member } of await activeOrgsOf(user.id)) {
    const key = `${user.id}:${org.id}`;
    const last = loginNotifiedAt.get(key) ?? 0;
    if (Date.now() - last < LOGIN_DEBOUNCE_MS) continue;
    const sent = await notifyOrgOwners({
      org,
      pref: "memberLogin",
      excludeEmails: [user.email],
      subject: `🔐 ${actorName(user, member)} signed in`,
      bodyHtml:
        `<p><strong>${esc(actorName(user, member))}</strong> (${esc(user.email)}) signed in to ` +
        `${esc(org.name)} at ${new Date().toLocaleString("en-US")}.</p>`,
    });
    // Debounce every login for the org — even a pref-off or recipient-less
    // one, so flipping the switch never replays the last hour's sign-ins.
    loginNotifiedAt.set(key, Date.now());
  }
}

/**
 * "Team member changes their account" — profile fields or password. Field
 * NAMES only: a password or token never leaves the box in an email.
 */
export async function notifyMemberAccountChange(user: Actor, fields: string[]): Promise<void> {
  if (!fields.length) return;
  for (const { org, member } of await activeOrgsOf(user.id)) {
    await notifyOrgOwners({
      org,
      pref: "memberAccountChange",
      excludeEmails: [user.email],
      subject: `✏️ ${actorName(user, member)} updated their account`,
      bodyHtml:
        `<p><strong>${esc(actorName(user, member))}</strong> (${esc(user.email)}) changed ` +
        `${fields.map(esc).join(", ")} on their ${esc(org.name)} account.</p>`,
    });
  }
}
