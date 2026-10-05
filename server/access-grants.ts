/**
 * Admin access grants (/admin/access): a platform admin gives an account one
 * of the price book's plans for 1–1000 days, with no card, and can end it
 * early. Owner, 2026-10-02: "add a section where i can give people access for
 * 1-1000 days. however long i want and have a revoke button".
 *
 *   GET  /api/admin/access-grants?q=          accounts matching q (email, name, company or id; 20 at most)
 *                                             with their current access, plus the active and recently ended grants
 *   POST /api/admin/access-grants             { userId, plan, days, note? } → grant (or extend: grant again)
 *   POST /api/admin/access-grants/:id/revoke  end that grant now (idempotent)
 *
 * How a grant is stored: the same way a trial code is (server/entitlements.ts
 * redeemTrialCode) — the account's deciding subscriptions row, with the plan,
 * status 'active', no Stripe subscription and current_period_end = the end.
 * getEntitlements drops a Stripe-less row once that end passes, so access
 * stops on its own. Every grant also gets an admin_access_grants row: who gave
 * it, when, for how long, the note, and later who revoked it. Granting again
 * replaces the end date (the older grant is marked replaced).
 *
 * Never touches a paid plan: an account with a Stripe subscription that is not
 * over is refused (409), under the same per-account advisory lock (7170, user)
 * as trial codes and the plan-limit checks. A revoke ends only the row its
 * grant wrote, and only while that row is still the grant (no Stripe
 * subscription, same plan and end date); a row a paid plan or a trial code has
 * since taken over is left alone.
 *
 * Platform admins only (server/admin.ts, via requirePlatformAdmin — the admin
 * passphrase wall applies where it is configured). Writes also need an Origin
 * that is ours (server/hub/access.ts originOk), like the dashboard's writes.
 */
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { ACCESS_GRANTS_DDL } from "./access-grants-schema";
import { isPlatformAdminEmail } from "./admin";
import { requirePlatformAdmin } from "./crm/admin";
import { originOk } from "./hub/access";
import { activePlanKey, liveStripeSubscription, SUBSCRIPTION_ORDER } from "./entitlements";
import { forgetDashboard } from "./dashboard/cache";
import { forgetOwnerPlan } from "./agency/access";
import { clearSmsEntitlementCache } from "./crm/sms";
import { logActivity } from "./account-events";
import { appBaseUrl, deliverTransactionalEmail } from "./account/billing-emails";
import { dateWords, emailLayout, type EmailMessage } from "./account/billing-email-templates";
import { ACCESS_STATUSES, PLANS, PLAN_KEYS, storedPlanKey, type PlanKey } from "@shared/plans";
import {
  ACCESS_GRANT_MAX_DAYS, ACCESS_GRANT_MIN_DAYS, ACCESS_GRANT_NOTE_MAX, grantDaysLeft, grantEndsAt, validGrantDays,
  type AccessGrantAccount, type AccessGrantResult, type AccessGrantRow, type AccessGrantStatus, type AccessRevokeResult,
  type AccessSource, type AccountAccess,
} from "@shared/access-grants";

// ── Schema ──────────────────────────────────────────────────────────────────

let schemaReady: Promise<void> | null = null;
/** Once per process; a failure is retried on the next call. */
export function ensureAccessGrantsSchema(): Promise<void> {
  schemaReady ??= (async () => { for (const sql of ACCESS_GRANTS_DDL) await pool.query(sql); })()
    .catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

// ── Reading a grant ─────────────────────────────────────────────────────────

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };
type Actor = { id: number; email: string };
type GrantDbRow = {
  id: number; user_id: number; subscription_id: number | null; plan: string; days: number; note: string | null;
  granted_by_user_id: number; granted_by_email: string; granted_at: Date | string; ends_at: Date | string;
  revoked_at: Date | string | null; revoked_by_user_id: number | null; revoked_by_email: string | null;
  replaced_at: Date | string | null;
};
type SubDbRow = {
  id: number; plan: string; status: string; stripe_subscription_id: string | null; current_period_end: Date | string | null;
};

const iso = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).toISOString());
const planName = (plan: string) => PLANS[storedPlanKey(plan) ?? (plan as PlanKey)]?.name ?? plan;

/**
 * Is `sub` still the row this grant wrote? The same row, no Stripe
 * subscription, the grant's plan, status 'active' and its end date. Anything
 * else means a paid plan, a trial code or a newer grant has taken it over.
 */
export function grantHoldsRow(g: Pick<GrantDbRow, "subscription_id" | "plan" | "ends_at">, sub: SubDbRow | null | undefined): boolean {
  if (!sub || sub.id !== g.subscription_id || sub.stripe_subscription_id || sub.plan !== g.plan || sub.status !== "active" || !sub.current_period_end) return false;
  return Math.abs(new Date(sub.current_period_end).getTime() - new Date(g.ends_at).getTime()) < 1000;
}

/** Where a grant stands now, and how it ended. */
export function grantStatus(g: GrantDbRow, sub: SubDbRow | null | undefined, now = new Date()):
  { status: AccessGrantStatus; endedAt: string | null; endedHow: string | null } {
  if (g.revoked_at) return { status: "revoked", endedAt: iso(g.revoked_at), endedHow: `Revoked by ${g.revoked_by_email ?? "an admin"}` };
  if (g.replaced_at) return { status: "replaced", endedAt: iso(g.replaced_at), endedHow: "Replaced by a newer grant" };
  if (new Date(g.ends_at).getTime() <= now.getTime()) return { status: "expired", endedAt: iso(g.ends_at), endedHow: "Ran to its end date" };
  if (!grantHoldsRow(g, sub)) {
    const how = sub?.stripe_subscription_id ? "Replaced by a paid plan" : sub?.status === "trialing" ? "Replaced by a trial code" : "Changed outside this page";
    return { status: "replaced", endedAt: null, endedHow: how };
  }
  return { status: "active", endedAt: null, endedHow: null };
}

const GRANT_SELECT = `SELECT g.*, u.email, u.display_name, u.company_name,
       s.id AS s_id, s.plan AS s_plan, s.status AS s_status, s.stripe_subscription_id AS s_stripe, s.current_period_end AS s_end
  FROM admin_access_grants g
  JOIN users u ON u.id = g.user_id
  LEFT JOIN subscriptions s ON s.id = g.subscription_id`;

function toGrantRow(r: any, now: Date): AccessGrantRow {
  const sub: SubDbRow | null = r.s_id == null ? null
    : { id: r.s_id, plan: r.s_plan, status: r.s_status, stripe_subscription_id: r.s_stripe, current_period_end: r.s_end };
  const state = grantStatus(r, sub, now);
  return {
    id: r.id,
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name ?? null,
    companyName: r.company_name ?? null,
    plan: r.plan,
    planName: planName(r.plan),
    days: r.days,
    note: r.note ?? null,
    grantedBy: { id: r.granted_by_user_id, email: r.granted_by_email },
    grantedAt: iso(r.granted_at)!,
    endsAt: iso(r.ends_at)!,
    ...state,
    revokedBy: r.revoked_at ? { id: r.revoked_by_user_id, email: r.revoked_by_email } : null,
    daysLeft: state.status === "active" ? grantDaysLeft(r.ends_at, now) : 0,
  };
}

export async function accessGrantById(id: number, now = new Date()): Promise<AccessGrantRow | null> {
  const { rows: [r] } = await pool.query(`${GRANT_SELECT} WHERE g.id = $1`, [id]);
  return r ? toGrantRow(r, now) : null;
}

/** Every active grant (ending soonest first) and the 20 that ended most recently. */
export async function listAccessGrants(now = new Date()): Promise<{ active: AccessGrantRow[]; ended: AccessGrantRow[] }> {
  const open = "g.revoked_at IS NULL AND g.replaced_at IS NULL AND g.ends_at > $1";
  const [{ rows: openRows }, { rows: closedRows }] = await Promise.all([
    pool.query(`${GRANT_SELECT} WHERE ${open} ORDER BY g.ends_at, g.id`, [now]),
    pool.query(`${GRANT_SELECT} WHERE NOT (${open}) ORDER BY coalesce(g.revoked_at, g.replaced_at, g.ends_at) DESC, g.id DESC LIMIT 20`, [now]),
  ]);
  const rows = [...openRows, ...closedRows].map((r) => toGrantRow(r, now));
  const when = (g: AccessGrantRow) => new Date(g.endedAt ?? g.grantedAt).getTime();
  return {
    active: rows.filter((g) => g.status === "active"),
    ended: rows.filter((g) => g.status !== "active").sort((a, b) => when(b) - when(a) || b.id - a.id).slice(0, 20),
  };
}

// ── Accounts and their current access ───────────────────────────────────────

/** LIKE pattern for a search term: its own % _ \ are matched literally. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

async function accessFor(rows: any[], now: Date): Promise<AccessGrantAccount[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [{ rows: grants }, { rows: codes }] = await Promise.all([
    pool.query(
      `SELECT id, user_id, subscription_id, plan, ends_at FROM admin_access_grants
        WHERE user_id = ANY($1::int[]) AND revoked_at IS NULL AND replaced_at IS NULL AND ends_at > $2 ORDER BY id DESC`, [ids, now]),
    pool.query("SELECT DISTINCT redeemed_by_user_id AS id FROM beta_access_codes WHERE redeemed_by_user_id = ANY($1::int[]) AND NOT revoked", [ids]),
  ]);
  const trialCodeUsers = new Set(codes.map((c: any) => c.id));
  return rows.map((r) => {
    const sub: SubDbRow | null = r.sub_id == null ? null
      : { id: r.sub_id, plan: r.plan, status: r.status, stripe_subscription_id: r.stripe_subscription_id, current_period_end: r.current_period_end };
    const plan = activePlanKey(sub, now);
    const paidStripe = liveStripeSubscription(sub);
    let source: AccessSource = "none";
    let grantId: number | null = null;
    if (sub?.stripe_subscription_id && (plan || paidStripe)) source = "stripe";
    else if (plan) {
      const grant = grants.find((g: any) => g.user_id === r.id && grantHoldsRow(g, sub));
      if (grant) { source = "grant"; grantId = grant.id; }
      else source = sub!.status === "trialing" || trialCodeUsers.has(r.id) ? "trial_code" : "complimentary";
    }
    const access: AccountAccess = {
      plan,
      planName: plan ? PLANS[plan].name : null,
      source,
      status: sub?.status ?? null,
      endsAt: source === "none" ? null : iso(sub?.current_period_end),
      grantId,
      paidStripe,
    };
    return {
      id: r.id,
      email: r.email,
      displayName: r.display_name ?? null,
      companyName: r.company_name ?? null,
      createdAt: iso(r.created_at),
      isPlatformAdmin: isPlatformAdminEmail(r.email),
      access,
    };
  });
}

const ACCOUNT_SELECT = `SELECT u.id, u.email, u.display_name, u.company_name, u.created_at,
       s.id AS sub_id, s.plan, s.status, s.stripe_subscription_id, s.current_period_end
  FROM users u
  LEFT JOIN LATERAL (SELECT * FROM subscriptions x WHERE x.user_id = u.id ${SUBSCRIPTION_ORDER}) s ON true`;

/**
 * Up to 20 accounts whose email, name or company contains `q` (or whose id is
 * `q` / `#q`), an exact id or email first; the newest accounts when q is empty.
 */
export async function searchAccounts(q: string, now = new Date()): Promise<AccessGrantAccount[]> {
  const term = q.trim().slice(0, 200);
  const id = /^#?\d{1,9}$/.test(term) ? Number(term.replace("#", "")) : null;
  const { rows } = await pool.query(
    `${ACCOUNT_SELECT}
      WHERE $1 = '' OR u.email ILIKE $3 OR u.display_name ILIKE $3 OR u.company_name ILIKE $3 OR u.id = $4::int
      ORDER BY (u.id = $4::int) DESC NULLS LAST, (lower(u.email) = lower($1)) DESC, u.id DESC
      LIMIT 20`,
    [term, ACCESS_STATUSES, likePattern(term), id]);
  return accessFor(rows, now);
}

export async function accountById(userId: number, now = new Date()): Promise<AccessGrantAccount | null> {
  const { rows } = await pool.query(`${ACCOUNT_SELECT} WHERE u.id = $1`, [userId, ACCESS_STATUSES]);
  return (await accessFor(rows, now))[0] ?? null;
}

// ── Grant and revoke ────────────────────────────────────────────────────────

/** Everything that may have kept the account's old answer: the next read rebuilds. */
export function forgetAccess(userId: number): void {
  forgetDashboard(userId);
  forgetOwnerPlan(userId);
  clearSmsEntitlementCache();
}

export type GrantInput = { userId: number; plan: PlanKey; days: number; note?: string | null };

/**
 * Give the account `plan` for `days` from `now`: create the Stripe-less grant
 * row, or replace the deciding row in place (an ended Stripe subscription's
 * ids, add-ons, interval and billed locations go with it, as with a trial
 * code; its customer id stays for a later checkout). Refused while the
 * account has a Stripe subscription that is not over. Granting again replaces
 * the end date; the older grant is marked replaced.
 */
export async function grantAccess(input: GrantInput, actor: Actor, now = new Date()):
  Promise<{ grantId: number; endsAt: Date } | { refused: string; status: 404 | 409 }> {
  await ensureAccessGrantsSchema();
  const endsAt = grantEndsAt(input.days, now);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7170, $1)", [input.userId]);
    const refuse = async (refused: string, status: 404 | 409) => { await c.query("ROLLBACK"); return { refused, status }; };
    const { rows: [user] } = await c.query("SELECT id, email FROM users WHERE id = $1", [input.userId]);
    if (!user) return await refuse("No account has that id.", 404);
    const { rows: [sub] } = await c.query(`SELECT * FROM subscriptions x WHERE x.user_id = $1 ${SUBSCRIPTION_ORDER}`, [input.userId, ACCESS_STATUSES]);
    if (liveStripeSubscription(sub)) {
      return await refuse(
        `${user.email} pays for ${planName(sub.plan)} through Stripe (status: ${sub.status}). A grant would replace a paid subscription, so nothing was changed. Change their plan in Stripe instead.`,
        409);
    }
    const previous = sub
      ? { subscriptionId: sub.id, plan: sub.plan, status: sub.status, currentPeriodEnd: iso(sub.current_period_end), stripeSubscriptionId: sub.stripe_subscription_id ?? null }
      : null;
    let subscriptionId: number;
    if (sub) {
      await c.query(
        `UPDATE subscriptions SET plan=$2, status='active', current_period_end=$3, stripe_subscription_id=NULL, stripe_price_id=NULL,
                addons='{}'::jsonb, billing_interval=NULL, agency_locations=NULL WHERE id=$1`,
        [sub.id, input.plan, endsAt]);
      subscriptionId = sub.id;
    } else {
      const { rows: [row] } = await c.query(
        "INSERT INTO subscriptions(user_id, plan, status, current_period_end) VALUES ($1, $2, 'active', $3) RETURNING id",
        [input.userId, input.plan, endsAt]);
      subscriptionId = row.id;
    }
    const { rows: [grant] } = await c.query(
      `INSERT INTO admin_access_grants (user_id, subscription_id, plan, days, note, granted_by_user_id, granted_by_email, granted_at, ends_at, previous)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [input.userId, subscriptionId, input.plan, input.days, input.note || null, actor.id, actor.email, now, endsAt, previous ? JSON.stringify(previous) : null]);
    await c.query(
      `UPDATE admin_access_grants SET replaced_at = $3, replaced_by_grant_id = $2
        WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL AND replaced_at IS NULL AND ends_at > $3`,
      [input.userId, grant.id, now]);
    await c.query("COMMIT");
    forgetAccess(input.userId);
    return { grantId: grant.id, endsAt };
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * End a grant now: its subscriptions row becomes status 'canceled' with
 * current_period_end = now — only while that row is still this grant's (never
 * a Stripe-backed row, never one a trial code or a newer grant took over).
 * Idempotent: a revoked or already ended grant changes nothing.
 */
export async function revokeAccessGrant(grantId: number, actor: Actor, now = new Date()):
  Promise<{ changed: boolean; userId: number } | { refused: string; status: 404 }> {
  await ensureAccessGrantsSchema();
  const { rows: [found] } = await pool.query("SELECT user_id FROM admin_access_grants WHERE id = $1", [grantId]);
  if (!found) return { refused: "No grant has that id.", status: 404 };
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7170, $1)", [found.user_id]);
    const { rows: [g] } = await c.query("SELECT * FROM admin_access_grants WHERE id = $1 FOR UPDATE", [grantId]);
    const { rows: [sub] } = g.subscription_id == null ? { rows: [] as any[] }
      : await c.query("SELECT id, plan, status, stripe_subscription_id, current_period_end FROM subscriptions WHERE id = $1 FOR UPDATE", [g.subscription_id]);
    if (grantStatus(g, sub, now).status !== "active") {
      await c.query("ROLLBACK");
      return { changed: false, userId: g.user_id };
    }
    await c.query(
      "UPDATE subscriptions SET status='canceled', current_period_end=$2 WHERE id=$1 AND stripe_subscription_id IS NULL",
      [sub.id, now]);
    await c.query(
      "UPDATE admin_access_grants SET revoked_at = $2, revoked_by_user_id = $3, revoked_by_email = $4 WHERE id = $1",
      [grantId, now, actor.id, actor.email]);
    await c.query("COMMIT");
    forgetAccess(g.user_id);
    return { changed: true, userId: g.user_id };
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// ── Records: the admin audit log, the account's activity, the notice email ──

/** One row in admin_audit_log (the LSA console's Audit Log lists every admin write). Best effort. */
async function adminAudit(actor: Actor, action: string, target: string | null, parameters: Record<string, unknown>, error?: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (actor_email, actor_id, action, target_account_name, parameters, result, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actor.email, actor.id, action, target, JSON.stringify(parameters), error ? "error" : "success", error ?? null]);
  } catch (err) {
    console.error("[access-grants] could not write the admin audit log:", (err as Error)?.message || err);
  }
}

/** The account's own activity log (Settings → Audit log). No request: the admin's IP is not the customer's. */
async function accountActivity(userId: number, kind: string, detail: Record<string, unknown>): Promise<void> {
  try {
    await logActivity(null, userId, kind, detail);
  } catch (err) {
    console.error("[access-grants] could not write the account activity:", (err as Error)?.message || err);
  }
}

/** "You've been given Pro access on ConstructHUB until November 1, 2026". */
export function accessGrantedEmail(input: { plan: PlanKey; endsAt: Date; baseUrl: string }): EmailMessage {
  const base = input.baseUrl.replace(/\/+$/, "");
  const name = PLANS[input.plan].name;
  const until = dateWords(input.endsAt)!;
  const subject = `You've been given ${name} access on ConstructHUB until ${until}`;
  const { html, text } = emailLayout({
    baseUrl: base,
    title: `You've been given ${name} access`,
    intro: [
      `You've been given ${name} access on ConstructHUB until ${until}. No card is needed and nothing will be charged.`,
      "When it ends, your account goes back to no plan. Your data, connections and history stay, and you can choose a plan any time to keep going.",
    ],
    rows: [["Plan", name], ["Access until", until]],
    cta: { label: "Open ConstructHUB", url: `${base}/` },
    secondary: [{ label: "See what your plan includes", url: `${base}/settings?tab=billing` }],
  });
  return { subject, html, text };
}

// ── Routes ──────────────────────────────────────────────────────────────────

type GetUser = (req: any, res: any) => any;

/** The one plain sentence for a bad grant request, or null when it is fine. */
export function grantInputError(body: unknown): string | null {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const userId = b.userId;
  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0 || userId > 2147483647) return "Pick an account to give access to.";
  if (!PLAN_KEYS.includes(b.plan as PlanKey)) return `Choose a plan: ${PLAN_KEYS.map((k) => PLANS[k].name).join(", ")}.`;
  if (!validGrantDays(b.days)) return `Days must be a whole number from ${ACCESS_GRANT_MIN_DAYS} to ${ACCESS_GRANT_MAX_DAYS}.`;
  if (b.note != null && (typeof b.note !== "string" || b.note.trim().length > ACCESS_GRANT_NOTE_MAX)) {
    return `Keep the note to ${ACCESS_GRANT_NOTE_MAX} characters or fewer.`;
  }
  return null;
}

const failed = (res: Response, what: string) => (err: unknown) => {
  console.error(`[access-grants] ${what} failed:`, err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(500).json({ message: `Could not ${what}. Please try again.` });
};

export function registerAccessGrantRoutes(app: Express, getUser: GetUser): void {
  app.get("/api/admin/access-grants", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getUser, { skipGate: true });
    if (!admin) return;
    res.setHeader("Cache-Control", "private, no-store");
    try {
      await ensureAccessGrantsSchema();
      const now = new Date();
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const [accounts, grants] = await Promise.all([searchAccounts(q, now), listAccessGrants(now)]);
      res.json({ accounts, ...grants, maxDays: ACCESS_GRANT_MAX_DAYS });
    } catch (err) { failed(res, "load the access grants")(err); }
  });

  app.post("/api/admin/access-grants", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getUser, { skipGate: true });
    if (!admin) return;
    if (!originOk(req)) return void res.status(403).json({ message: "Forbidden" });
    if (!req.is("application/json")) return void res.status(415).json({ message: "Send JSON." });
    const problem = grantInputError(req.body);
    if (problem) return void res.status(400).json({ message: problem });
    const input: GrantInput = {
      userId: req.body.userId, plan: req.body.plan, days: req.body.days,
      note: typeof req.body.note === "string" && req.body.note.trim() ? req.body.note.trim() : null,
    };
    const actor = { id: admin.id, email: admin.email };
    try {
      const now = new Date();
      const outcome = await grantAccess(input, actor, now);
      const { rows: [target] } = await pool.query("SELECT email FROM users WHERE id = $1", [input.userId]);
      const audit = { userId: input.userId, plan: input.plan, days: input.days, note: input.note ?? null };
      if ("refused" in outcome) {
        // A refused grant on a real account (it pays through Stripe) is on the record too.
        if (target) await adminAudit(actor, "access_grant", target.email, audit, outcome.refused);
        return void res.status(outcome.status).json({ message: outcome.refused });
      }
      const until = dateWords(outcome.endsAt);
      await adminAudit(actor, "access_grant", target.email, { ...audit, grantId: outcome.grantId, endsAt: outcome.endsAt.toISOString() });
      await accountActivity(input.userId, "billing.access_granted", { plan: input.plan, days: input.days, until: outcome.endsAt.toISOString() });
      let email: AccessGrantResult["email"];
      try {
        email = await deliverTransactionalEmail(input.userId, "access.granted", `access_grant:${outcome.grantId}`,
          accessGrantedEmail({ plan: input.plan, endsAt: outcome.endsAt, baseUrl: appBaseUrl(req) }));
      } catch (err) {
        console.error("[access-grants] notice email failed:", (err as Error)?.message || err);
        email = "failed";
      }
      const [grant, account] = await Promise.all([accessGrantById(outcome.grantId, now), accountById(input.userId, now)]);
      const emailWords = email === "sent" ? ` We emailed ${target.email}.`
        : email === "queued" ? " The notice email is queued and will be retried."
        : email === "no_address" ? "" : " The notice email could not be sent.";
      const body: AccessGrantResult = {
        grant: grant!, account: account!, email,
        message: `${PLANS[input.plan].name} access granted to ${target.email} until ${until}.${emailWords}`,
      };
      res.status(201).json(body);
    } catch (err) { failed(res, "grant access")(err); }
  });

  app.post("/api/admin/access-grants/:id/revoke", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getUser, { skipGate: true });
    if (!admin) return;
    if (!originOk(req)) return void res.status(403).json({ message: "Forbidden" });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return void res.status(404).json({ message: "No grant has that id." });
    const actor = { id: admin.id, email: admin.email };
    try {
      const now = new Date();
      const outcome = await revokeAccessGrant(id, actor, now);
      if ("refused" in outcome) return void res.status(outcome.status).json({ message: outcome.refused });
      const grant = (await accessGrantById(id, now))!;
      if (outcome.changed) {
        await adminAudit(actor, "access_grant_revoke", grant.email, { grantId: id, userId: grant.userId, plan: grant.plan });
        await accountActivity(grant.userId, "billing.access_revoked", { plan: grant.plan });
      }
      const body: AccessRevokeResult = {
        grant, changed: outcome.changed,
        message: outcome.changed
          ? `${grant.planName} access for ${grant.email} has ended.`
          : grant.status === "revoked" ? "This grant was already revoked." : "This grant had already ended, so nothing changed.",
      };
      res.json(body);
    } catch (err) { failed(res, "revoke the grant")(err); }
  });
}
