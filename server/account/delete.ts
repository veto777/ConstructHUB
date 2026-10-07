import { fromNativeApp } from "../app-shell";
export { fromNativeApp } from "../app-shell";
/**
 * Self-serve account deletion (App Store guideline 5.1.1(v); docs/app/APP-STORE-PLAN.md). Before this, Settings →
 * Delete account only prefilled an email to support — Apple rejects that outside highly regulated industries.
 *
 * Two steps, as the privacy policy describes (account data kept until deletion is requested; payment records 7 years):
 *   1. Closing — now, POST /api/account/delete: billing is cancelled at Stripe, every session and API key stops
 *      working, a Sign in with Apple grant is revoked at Apple, connected Google / Ads / social / domain / LSA grants
 *      (their tokens) are deleted, personal fields are
 *      cleared (the avatar and logo files stay until step 2 erases them with their rows) and the email is freed (the address can sign up again). Login is impossible from this moment.
 *   2. Erasing — within 30 days (purgeClosedAccounts): the account's own data and the CRM workspaces it owned alone.
 *      Payment and invoice records stay, without the person's name or email, for the legal retention period.
 *
 * A CRM workspace with other active members is never deleted out from under them: closing is refused until the
 * owner removes them (or hands over the business), and the answer says so.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireRecentAuth } from "../account-security";
import { stripe, stripeConfigured } from "../billing/client";
import { sendTransactionalEmail, emailLayout } from "./email";
import { revokeAppleSignIn } from "../apple-auth";

export const ERASE_AFTER_DAYS = 30;

export const ACCOUNT_DELETION_DDL: readonly string[] = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz`,
  // Only for the confirmation email and the erase step's notice; cleared when the account is erased.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_email text`,
];

export async function ensureAccountDeletionSchema(): Promise<void> {
  for (const statement of ACCOUNT_DELETION_DDL) await pool.query(statement);
}

/** Stripe statuses that can still bill. */
const BILLABLE = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];

/** Tables that hold a connected service's grant or token for this user — deleted at closing, not 30 days later. */
const GRANT_TABLES = [
  "gbp_grants", "ads_grants", "social_connections", "youtube_customer_connections", "youtube_customer_videos",
  "domain_connections", "edge_connections", "lsa_connections",
  "app_auth_codes", "app_oauth_states", "app_push_tokens", "user_apple_ids",
  "mail_alert_grants", "agency_poll_grants", "account_api_keys", "account_trusted_devices", "account_recovery_codes",
] as const;

export type DeletionBlocker = { kind: "crm_team"; orgId: string; orgName: string; members: number };

/** What would stop closing this account (CRM workspaces it owns that other people still use). */
export async function deletionBlockers(userId: number): Promise<DeletionBlocker[]> {
  const { rows } = await pool.query(
    `SELECT o.id, o.name, count(m.id)::int AS members
       FROM crm_orgs o JOIN crm_members m ON m.org_id = o.id
      WHERE o.owner_user_id = $1 AND m.status = 'active' AND m.user_id IS DISTINCT FROM $1
      GROUP BY o.id, o.name`, [userId]);
  return rows.map((r) => ({ kind: "crm_team" as const, orgId: String(r.id), orgName: String(r.name ?? "Your CRM workspace"), members: Number(r.members) }));
}

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT to_regclass($1) AS t", [`public.${name}`]);
  return !!rows[0]?.t;
}

export type CloseResult =
  | { ok: true; eraseAfter: string; cancelledSubscriptions: number }
  | { ok: false; status: number; code: string; message: string; blockers?: DeletionBlocker[] };

/**
 * Close the account now (step 1). Stripe is cancelled FIRST: if that fails nothing else changes, so nobody is left
 * being billed for an account they can no longer open.
 */
export async function closeAccount(userId: number, deps: { cancelSubscription?: (id: string) => Promise<void> } = {}): Promise<CloseResult> {
  const { rows: [user] } = await pool.query("SELECT id, email, display_name, deletion_requested_at FROM users WHERE id = $1", [userId]);
  if (!user) return { ok: false, status: 404, code: "not_found", message: "Account not found." };
  if (user.deletion_requested_at) return { ok: false, status: 409, code: "already_closed", message: "This account is already closed." };

  const blockers = await deletionBlockers(userId);
  if (blockers.length) {
    const names = blockers.map((b) => `${b.orgName} (${b.members} other ${b.members === 1 ? "person" : "people"})`).join(", ");
    return {
      ok: false, status: 409, code: "crm_team", blockers,
      message: `Your CRM workspace is still used by your team: ${names}. Remove them in CRM → Team & Company first, then delete your account.`,
    };
  }

  const { rows: subs } = await pool.query(
    "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND stripe_subscription_id IS NOT NULL AND status = ANY($2::text[])",
    [userId, BILLABLE]);
  const cancel = deps.cancelSubscription ?? (async (id: string) => { await stripe.subscriptions.cancel(id); });
  if (subs.length && !deps.cancelSubscription && !stripeConfigured()) {
    return { ok: false, status: 503, code: "billing_unavailable", message: "Billing can't be reached right now, so your subscription can't be cancelled. Please try again later." };
  }
  for (const s of subs) {
    try { await cancel(String(s.stripe_subscription_id)); } catch (e: any) {
      // Already cancelled at Stripe is fine; anything else stops here.
      if (!/no such subscription|canceled|cancelled/i.test(String(e?.message ?? ""))) {
        return { ok: false, status: 502, code: "billing_cancel_failed", message: "We couldn't cancel your subscription, so nothing was deleted. Please try again in a few minutes." };
      }
    }
  }

  // Sign in with Apple: revoke the grant at Apple before its row goes (guideline 5.1.1(v)); best-effort.
  await revokeAppleSignIn(userId).catch((e) => console.warn(`[account-delete] Apple revoke failed: ${e?.message ?? e}`));

  // The customer's own YouTube channel: revoke the grant at Google and delete the connection, the video records and
  // any stored video file now (best-effort; the DELETEs below remove the rows even if this could not run).
  await import("../youtube/customer-service").then((m) => m.purgeCustomerYoutube(userId))
    .catch((e) => console.warn(`[account-delete] YouTube disconnect failed: ${e?.message ?? e}`));

  const grantTables: string[] = [];
  for (const t of GRANT_TABLES) if (await tableExists(t)) grantTables.push(t);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = false
        WHERE user_id = $1 AND status = ANY($2::text[])`, [userId, BILLABLE]).catch(() => undefined);
    for (const t of grantTables) await client.query(`DELETE FROM ${t} WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE users SET deletion_requested_at = now(), deleted_email = email,
              email = 'deleted+' || id || '.' || extract(epoch from now())::bigint || '@deleted.constructhub.invalid',
              password_hash = NULL, google_id = NULL, google_access_token = NULL, google_refresh_token = NULL,
              google_token_expiry = NULL, totp_secret = NULL, totp_enabled = false, verification_token = NULL,
              verification_expiry = NULL, reset_token = NULL, reset_expiry = NULL, display_name = NULL,
              company_name = NULL, google_profile_url = NULL
        WHERE id = $1`, [userId]);
    await client.query(`DELETE FROM session WHERE sess->'passport'->>'user' = $1 OR sess->>'pending2FAUserId' = $1`, [String(userId)]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally { client.release(); }

  const eraseAfter = new Date(Date.now() + ERASE_AFTER_DAYS * 86_400_000);
  const when = eraseAfter.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const { html, text } = emailLayout({
    title: "Your ConstructHUB account was deleted",
    preheader: "Your account is closed and your data will be erased.",
    intro: "Your ConstructHUB account was closed at your request. You were signed out everywhere, your subscription was "
      + "cancelled and your connected Google, Ads and social accounts were disconnected.",
    rows: [["Data erased by", when], ["Subscriptions cancelled", subs.length]],
    footer: "Payment and invoice records are kept without your name or email for as long as the law requires. "
      + "Didn't ask for this? Reply to this email right away.",
  });
  await sendTransactionalEmail(userId, "account.deleted", `account-deleted:${userId}`, { to: user.email, subject: "Your ConstructHUB account was deleted", html, text })
    .catch((e) => console.error("[account-delete] confirmation email failed:", e?.message ?? e));

  return { ok: true, eraseAfter: eraseAfter.toISOString(), cancelledSubscriptions: subs.length };
}

export function registerAccountDeletionRoutes(app: Express, getDevUser: (req: any, res: any) => any): void {
  /** Settings → Delete account: what would block it (a CRM workspace other people use) and what will happen. */
  app.get("/api/account/delete/preflight", async (req: Request, res: Response) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const [blockers, { rows: subs }] = await Promise.all([
      deletionBlockers(user.id),
      pool.query("SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1 AND stripe_subscription_id IS NOT NULL AND status = ANY($2::text[])", [user.id, BILLABLE]),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ blockers, activeSubscriptions: Number(subs[0]?.n ?? 0), eraseAfterDays: ERASE_AFTER_DAYS });
  });

  /** Settings → Delete account → "Delete my account": closes it now (recent sign-in + typing DELETE required).
   *  Only from the iPhone apps (owner, 2026-10-04: "just dont delete in the original site/mobile … we just want the
   *  native app to have the deletions"); the website keeps its email-support request. */
  app.post("/api/account/delete", async (req: any, res: Response) => {
    const user = getDevUser(req, res);
    if (!user) return;
    if (!fromNativeApp(req)) {
      return res.status(403).json({ code: "app_only", message: "To delete your account, email support@constructhub.us from your account's address." });
    }
    if (!requireRecentAuth(req, res)) return;
    const body = z.object({ confirm: z.literal("DELETE") }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ code: "confirm_required", message: 'Type DELETE to confirm.' });
    const result = await closeAccount(user.id);
    if (!result.ok) return res.status(result.status).json({ code: result.code, message: result.message, blockers: result.blockers });
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie("connect.sid");
    res.json({ deleted: true, eraseAfter: result.eraseAfter });
  });
}
