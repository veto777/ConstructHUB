/**
 * The ConstructHUB referral program (rules: ./rules.ts — owner, 2026-10-08).
 *
 *   Share link   https://constructhub.us/?ref=CODE (any page; /pricing?ref=CODE too). The first ?ref a browser
 *                brings is kept 30 days in the `ch_ref` cookie (first touch), and read ONLY when a NEW account is
 *                created (email sign-up, Google, Apple) — an existing account is never attributed later.
 *   Counting     invoice.paid (via billingEvents) records the referred account's paid subscription invoices;
 *                charge.refunded / charge.dispute.created on one of them before payout voids the referral.
 *   Paying out   a sweep (hourly, and shortly after a relevant event) earns rewards once the HOLD_DAYS window has
 *                passed and applies them in Stripe: a month = a customer-balance credit; annual30 = a one-time
 *                amount_off coupon on the referrer's annual subscription (their next annual invoice). A reward
 *                waits as `earned` while the referrer has no live plan in that product line (or, for annual30,
 *                no annual plan, or one was redeemed in the last 365 days).
 *
 *   GET  /api/referrals/me                       the account's code, link, counts and rewards
 *   GET  /api/admin/referrals                    platform admin: every referral and reward
 *   POST /api/admin/referrals/:id/void           platform admin: void a referral (and its unpaid reward)
 *   POST /api/admin/referrals/rewards/:id/void   platform admin: void an unpaid reward
 */
import type { Express, NextFunction, Request, Response } from "express";
import type Stripe from "stripe";
import { randomInt } from "crypto";
import { pool } from "../db";
import { stripe, stripeConfigured } from "../billing/client";
import { billingEvents } from "../billing/events";
import { roleOfPrice } from "../billing/prices";
import { idOf, invoiceSubscriptionId } from "../billing/invoices";
import { requirePlatformAdmin } from "../crm/admin";
import { parseCookieHeader } from "../analytics-attribution";
import { PRIMARY_DOMAIN } from "../site-context";
import {
  ANNUAL_SHARE, CODE_ALPHABET, HOLD_DAYS, MONTHS_TO_QUALIFY, annualRedeemable, blockReason, normalizeCode, qualify,
  rewardAmountCents, validTier, type CountedInvoice, type Product, type RewardKind, type Tier,
} from "./rules";
import type { BillingInterval } from "@shared/plans";

export const REF_COOKIE = "ch_ref";
const REF_COOKIE_DAYS = 30;
const PAYABLE_STATUSES = new Set(["active", "trialing"]);
/** Subscription invoices that are a real period paid for (a plan change's proration invoice is not). */
const COUNTED_REASONS = new Set(["subscription_create", "subscription_cycle"]);

export const REFERRAL_DDL = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id integer`,
  `CREATE TABLE IF NOT EXISTS referral_codes (
     user_id integer PRIMARY KEY,
     code text NOT NULL UNIQUE,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS referrals (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     referrer_user_id integer NOT NULL,
     referred_user_id integer NOT NULL UNIQUE,
     code text NOT NULL,
     status text NOT NULL DEFAULT 'pending',
     reason text,
     kind text, product text, tier text,
     qualified_at timestamp, earn_at timestamp,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id)`,
  `CREATE TABLE IF NOT EXISTS referral_invoices (
     invoice_id text PRIMARY KEY,
     referral_id integer NOT NULL,
     charge_id text, payment_intent_id text,
     product text NOT NULL, tier text NOT NULL, billing_interval text NOT NULL,
     amount_paid integer NOT NULL, amount_remaining integer NOT NULL DEFAULT 0,
     refunded boolean NOT NULL DEFAULT false,
     paid_at timestamp NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS referral_invoices_ref_idx ON referral_invoices (referral_id)`,
  `CREATE INDEX IF NOT EXISTS referral_invoices_charge_idx ON referral_invoices (charge_id)`,
  // One reward per referral: the UNIQUE referral_id is the rule, not a convention.
  `CREATE TABLE IF NOT EXISTS referral_rewards (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     referral_id integer NOT NULL UNIQUE,
     referrer_user_id integer NOT NULL,
     kind text NOT NULL, product text NOT NULL, tier text NOT NULL,
     amount_cents integer,
     status text NOT NULL DEFAULT 'earned',
     reason text,
     stripe_customer_id text, stripe_balance_txn_id text, stripe_coupon_id text, stripe_subscription_id text,
     earned_at timestamp NOT NULL DEFAULT now(),
     claimed_at timestamp, applied_at timestamp, voided_at timestamp, voided_by text
   )`,
  `CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx ON referral_rewards (referrer_user_id, status)`,
];

export async function ensureReferralSchema(): Promise<void> {
  for (const sql of REFERRAL_DDL) await pool.query(sql);
}

// ── Codes ─────────────────────────────────────────────────────────────────────────────────────

const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

export async function referralCodeFor(userId: number): Promise<string> {
  const have = (await pool.query(`SELECT code FROM referral_codes WHERE user_id = $1`, [userId])).rows[0];
  if (have) return have.code;
  for (let i = 0; i < 5; i++) {
    const r = await pool.query(`INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code`, [userId, newCode()]);
    if (r.rows[0]) return r.rows[0].code;
    const again = (await pool.query(`SELECT code FROM referral_codes WHERE user_id = $1`, [userId])).rows[0];
    if (again) return again.code;   // a parallel request made it
  }
  throw new Error("could not mint a referral code");
}

/** First touch: the first valid ?ref a browser brings is kept; a later link never overwrites it. */
export function captureReferralCookie(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" && typeof req.query?.ref === "string") {
    const code = normalizeCode(req.query.ref);
    if (code && !parseCookieHeader(req.headers.cookie)[REF_COOKIE]) {
      res.cookie(REF_COOKIE, code, {
        maxAge: REF_COOKIE_DAYS * 86_400_000, httpOnly: true, sameSite: "lax",
        secure: process.env.NODE_ENV === "production", path: "/",
      });
    }
  }
  next();
}

/**
 * Called ONLY where a new account was just inserted. Reads the browser's ch_ref cookie and records the referral.
 * Never throws (a sign-up never fails over a referral). A self-referral is dropped; a same-company domain is kept
 * as `void` so the admin sees it.
 */
export async function attachReferral(newUserId: number, email: string, cookieHeader: unknown): Promise<void> {
  try {
    const code = normalizeCode(parseCookieHeader(cookieHeader)[REF_COOKIE]);
    if (!code) return;
    await ensureReady();
    const ref = (await pool.query(
      `SELECT c.user_id, u.email FROM referral_codes c JOIN users u ON u.id = c.user_id WHERE c.code = $1 AND u.deletion_requested_at IS NULL`, [code])).rows[0];
    if (!ref) return;
    // Defense in depth: only an account created in the last 10 minutes can be attributed.
    const fresh = (await pool.query(`SELECT 1 FROM users WHERE id = $1 AND created_at > now() - interval '10 minutes' AND referred_by_user_id IS NULL`, [newUserId])).rows[0];
    if (!fresh) return;
    const block = blockReason({ id: ref.user_id, email: ref.email }, { id: newUserId, email });
    if (block === "self") return;
    const ins = await pool.query(
      `INSERT INTO referrals (referrer_user_id, referred_user_id, code, status, reason) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (referred_user_id) DO NOTHING RETURNING id`,
      [ref.user_id, newUserId, code, block ? "void" : "pending", block]);
    if (ins.rows[0] && !block) await pool.query(`UPDATE users SET referred_by_user_id = $1 WHERE id = $2 AND referred_by_user_id IS NULL`, [ref.user_id, newUserId]);
  } catch (e: any) {
    console.error("[referrals] attach failed:", e?.message || e);
  }
}

// ── Counting the referred account's payments ────────────────────────────────────────────────────

type PlanLine = { product: Product; tier: Tier; interval: BillingInterval };

/** The plan an invoice / subscription bills, from the prices we created (platform plan or CRM plan). */
export function planLineOf(prices: (Stripe.Price | null | undefined)[]): PlanLine | null {
  for (const p of prices) {
    const role = roleOfPrice(p);
    if (role?.kind === "plan") return { product: "platform", tier: role.key, interval: role.interval };
    if (role?.kind === "crm_plan") return { product: "crm", tier: role.key, interval: role.interval };
  }
  return null;
}

async function planLineOfInvoice(inv: Stripe.Invoice): Promise<PlanLine | null> {
  const fromLines = planLineOf((inv.lines?.data ?? []).map((l: any) => (typeof l.price === "object" ? l.price : null)));
  if (fromLines) return fromLines;
  const subId = invoiceSubscriptionId(inv);
  if (!subId || !stripeConfigured()) return null;
  const sub = await stripe.subscriptions.retrieve(subId);
  return planLineOf(sub.items.data.map((i) => i.price));
}

export async function onReferredInvoicePaid(userId: number, inv: Stripe.Invoice): Promise<void> {
  await ensureReady();
  const referral = (await pool.query(`SELECT id, status FROM referrals WHERE referred_user_id = $1`, [userId])).rows[0];
  if (!referral || !["pending", "qualified"].includes(referral.status)) return;
  if (!COUNTED_REASONS.has(String(inv.billing_reason)) || !(inv.amount_paid > 0)) return;
  const line = await planLineOfInvoice(inv);
  if (!line) return;
  const any = inv as any;
  const paidAt = new Date(((inv.status_transitions?.paid_at ?? inv.created) || Date.now() / 1000) * 1000);
  await pool.query(
    `INSERT INTO referral_invoices (invoice_id, referral_id, charge_id, payment_intent_id, product, tier, billing_interval, amount_paid, amount_remaining, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (invoice_id) DO NOTHING`,
    [inv.id, referral.id, idOf(any.charge), idOf(any.payment_intent), line.product, line.tier, line.interval, inv.amount_paid, inv.amount_remaining ?? 0, paidAt]);
  await evaluate(referral.id);
  scheduleSweep();
}

async function countedInvoices(referralId: number): Promise<CountedInvoice[]> {
  const { rows } = await pool.query(`SELECT * FROM referral_invoices WHERE referral_id = $1`, [referralId]);
  return rows.filter((r: any) => validTier(r.product, r.tier)).map((r: any) => ({
    product: r.product, tier: r.tier, interval: r.billing_interval, amountPaid: r.amount_paid,
    amountRemaining: r.amount_remaining, refunded: r.refunded, paidAt: new Date(r.paid_at),
  }));
}

/** Re-reads the counted invoices: pending ↔ qualified. A rewarded or void referral never changes here. */
async function evaluate(referralId: number): Promise<void> {
  const q = qualify(await countedInvoices(referralId));
  if (q) {
    await pool.query(
      `UPDATE referrals SET status = 'qualified', kind = $2, product = $3, tier = $4, qualified_at = $5, earn_at = $6, updated_at = now()
       WHERE id = $1 AND status IN ('pending','qualified')`, [referralId, q.kind, q.product, q.tier, q.qualifiedAt, q.earnAt]);
  } else {
    await pool.query(
      `UPDATE referrals SET status = 'pending', kind = NULL, product = NULL, tier = NULL, qualified_at = NULL, earn_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'qualified'`, [referralId]);
  }
}

/**
 * charge.refunded / charge.dispute.created: a refund or chargeback on a counted invoice before the reward is paid
 * voids the referral (and an earned, unpaid reward). After payout it is only noted for the admin.
 */
export async function onChargeReversed(event: Stripe.Event): Promise<void> {
  await ensureReady();
  const obj: any = event.data.object;
  const charge: any = event.type === "charge.dispute.created" ? { id: idOf(obj.charge), payment_intent: obj.payment_intent, invoice: null } : obj;
  if (event.type === "charge.refunded" && !(charge.amount_refunded > 0)) return;
  const chargeId = idOf(charge.id), piId = idOf(charge.payment_intent), invId = idOf(charge.invoice);
  const { rows } = await pool.query(
    `UPDATE referral_invoices SET refunded = true
      WHERE ($1::text IS NOT NULL AND invoice_id = $1) OR ($2::text IS NOT NULL AND charge_id = $2) OR ($3::text IS NOT NULL AND payment_intent_id = $3)
      RETURNING referral_id`, [invId, chargeId, piId]);
  const why = event.type === "charge.dispute.created" ? "chargeback" : "refund";
  for (const { referral_id } of rows) {
    const reward = (await pool.query(`SELECT id, status FROM referral_rewards WHERE referral_id = $1`, [referral_id])).rows[0];
    if (reward?.status === "applied") {
      await pool.query(`UPDATE referral_rewards SET reason = $2 WHERE id = $1`, [reward.id, `${why}_after_payout`]);
      continue;
    }
    if (reward) await pool.query(`UPDATE referral_rewards SET status = 'void', reason = $2, voided_at = now(), voided_by = 'stripe' WHERE id = $1 AND status IN ('earned','applying')`, [reward.id, why]);
    await pool.query(`UPDATE referrals SET status = 'void', reason = $2, updated_at = now() WHERE id = $1 AND status <> 'void'`, [referral_id, why]);
  }
}

// ── Paying out ───────────────────────────────────────────────────────────────────────────────

type ReferrerPlan = { tier: string; interval: string | null; status: string; customerId: string | null; subscriptionId: string | null };

async function referrerPlan(userId: number, product: Product): Promise<ReferrerPlan | null> {
  const table = product === "platform" ? "subscriptions" : "crm_subscriptions";
  const r = (await pool.query(
    `SELECT plan, billing_interval, status, stripe_customer_id, stripe_subscription_id FROM ${table} WHERE user_id = $1 AND stripe_subscription_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [userId])).rows[0];
  if (!r || !PAYABLE_STATUSES.has(r.status) || !validTier(product, r.plan)) return null;
  return { tier: r.plan, interval: r.billing_interval, status: r.status, customerId: r.stripe_customer_id, subscriptionId: r.stripe_subscription_id };
}

/** Same card on both accounts → not a real referral. Best-effort: a Stripe hiccup never blocks a reward. */
async function sameCard(referralId: number, referrerUserId: number): Promise<boolean> {
  try {
    const customer = (await pool.query(
      `SELECT stripe_customer_id FROM (SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 UNION ALL SELECT stripe_customer_id FROM crm_subscriptions WHERE user_id = $1) s WHERE stripe_customer_id IS NOT NULL LIMIT 1`,
      [referrerUserId])).rows[0]?.stripe_customer_id;
    if (!customer) return false;
    const mine = new Set((await stripe.paymentMethods.list({ customer, type: "card", limit: 20 })).data.map((p) => p.card?.fingerprint).filter(Boolean));
    if (!mine.size) return false;
    const { rows } = await pool.query(`SELECT charge_id FROM referral_invoices WHERE referral_id = $1 AND charge_id IS NOT NULL`, [referralId]);
    for (const { charge_id } of rows) {
      const ch = await stripe.charges.retrieve(charge_id);
      const fp = ch.payment_method_details?.card?.fingerprint;
      if (fp && mine.has(fp)) return true;
    }
  } catch (e: any) {
    console.warn("[referrals] card check skipped:", e?.message || e);
  }
  return false;
}

/** Step 1: qualified referrals past the hold become one earned reward each. */
async function earnDue(): Promise<void> {
  const { rows } = await pool.query(`SELECT * FROM referrals WHERE status = 'qualified' AND earn_at <= now() ORDER BY earn_at LIMIT 100`);
  for (const r of rows) {
    if (await sameCard(r.id, r.referrer_user_id)) {
      await pool.query(`UPDATE referrals SET status = 'void', reason = 'same_card', updated_at = now() WHERE id = $1 AND status = 'qualified'`, [r.id]);
      continue;
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const upd = await c.query(`UPDATE referrals SET status = 'rewarded', updated_at = now() WHERE id = $1 AND status = 'qualified' AND earn_at <= now() RETURNING id`, [r.id]);
      if (upd.rows[0]) {
        await c.query(`INSERT INTO referral_rewards (referral_id, referrer_user_id, kind, product, tier) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (referral_id) DO NOTHING`,
          [r.id, r.referrer_user_id, r.kind, r.product, r.tier]);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { c.release(); }
  }
}

const PRODUCT_WORDS: Record<Product, string> = { platform: "ConstructHUB", crm: "ConstructHUB CRM" };

async function applyOne(w: any): Promise<"applied" | "wait"> {
  const product: Product = w.product, kind: RewardKind = w.kind;
  const plan = await referrerPlan(w.referrer_user_id, product);
  if (!plan?.customerId || !plan.subscriptionId) return "wait";
  const amount = rewardAmountCents(kind, product, w.tier, plan.tier as Tier);
  if (!amount || amount <= 0) return "wait";
  if (kind === "month") {
    const txn = await stripe.customers.createBalanceTransaction(plan.customerId, {
      amount: -amount, currency: "usd",
      description: `Referral reward: one free month (${PRODUCT_WORDS[product]})`,
      metadata: { chub_referral_reward: String(w.id) },
    }, { idempotencyKey: `chub-referral-reward-${w.id}` });
    await pool.query(`UPDATE referral_rewards SET status = 'applied', amount_cents = $2, stripe_customer_id = $3, stripe_balance_txn_id = $4, stripe_subscription_id = $5, applied_at = now() WHERE id = $1`,
      [w.id, amount, plan.customerId, txn.id, plan.subscriptionId]);
    return "applied";
  }
  // annual30: on the referrer's annual plan in this line, at most once per 365 days.
  if (plan.interval !== "year") return "wait";
  const last = (await pool.query(`SELECT max(applied_at) AS at FROM referral_rewards WHERE referrer_user_id = $1 AND kind = 'annual30' AND status = 'applied'`, [w.referrer_user_id])).rows[0]?.at;
  if (!annualRedeemable(last ? new Date(last) : null, new Date())) return "wait";
  const couponId = `chub-referral-${w.id}`;
  let coupon: Stripe.Coupon;
  try { coupon = await stripe.coupons.retrieve(couponId); }
  catch {
    coupon = await stripe.coupons.create({
      id: couponId, amount_off: amount, currency: "usd", duration: "once", max_redemptions: 1,
      name: `Referral reward: ${Math.round(ANNUAL_SHARE * 100)}% off your annual plan`, metadata: { chub_referral_reward: String(w.id) },
    }, { idempotencyKey: `chub-referral-coupon-${w.id}` });
  }
  const sub = await stripe.subscriptions.retrieve(plan.subscriptionId, { expand: ["discounts"] });
  const existing = ((sub as any).discounts ?? []) as (string | Stripe.Discount)[];
  const already = existing.some((d: any) => typeof d !== "string" && (idOf(d.coupon) ?? idOf(d.source?.coupon)) === coupon.id);
  if (!already) {
    await stripe.subscriptions.update(plan.subscriptionId, {
      discounts: [...existing.map((d) => ({ discount: typeof d === "string" ? d : d.id })), { coupon: coupon.id }],
    } as any, { idempotencyKey: `chub-referral-apply-${w.id}` });
  }
  await pool.query(`UPDATE referral_rewards SET status = 'applied', amount_cents = $2, stripe_customer_id = $3, stripe_coupon_id = $4, stripe_subscription_id = $5, applied_at = now() WHERE id = $1`,
    [w.id, amount, plan.customerId, coupon.id, plan.subscriptionId]);
  return "applied";
}

/** Step 2: apply earned rewards whose referrer now has the plan to apply them to. */
async function applyEarned(): Promise<void> {
  if (!stripeConfigured()) return;
  // A claim is a row lock in time: an 'applying' row older than 10 minutes (a crash mid-way) is retried —
  // every Stripe write above is idempotent or checked first, so a retry never pays twice.
  const { rows } = await pool.query(
    `UPDATE referral_rewards SET status = 'applying', claimed_at = now()
      WHERE id IN (SELECT id FROM referral_rewards WHERE status = 'earned' OR (status = 'applying' AND claimed_at < now() - interval '10 minutes') ORDER BY earned_at LIMIT 100)
      RETURNING *`);
  for (const w of rows) {
    try {
      if ((await applyOne(w)) === "wait") await pool.query(`UPDATE referral_rewards SET status = 'earned' WHERE id = $1 AND status = 'applying'`, [w.id]);
    } catch (e: any) {
      console.error(`[referrals] reward ${w.id} not applied:`, e?.message || e);
      await pool.query(`UPDATE referral_rewards SET status = 'earned' WHERE id = $1 AND status = 'applying'`, [w.id]);
    }
  }
}

let sweeping = false;
export async function runReferralSweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  const c = await pool.connect();
  try {
    // One sweep across every app process.
    if (!(await c.query(`SELECT pg_try_advisory_lock(hashtext('referral-sweep')) AS ok`)).rows[0].ok) return;
    try { await earnDue(); await applyEarned(); }
    finally { await c.query(`SELECT pg_advisory_unlock(hashtext('referral-sweep'))`); }
  } catch (e: any) {
    console.error("[referrals] sweep failed:", e?.message || e);
  } finally { c.release(); sweeping = false; }
}

let sweepTimer: NodeJS.Timeout | null = null;
function scheduleSweep() {
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => { sweepTimer = null; void runReferralSweep(); }, 5_000);
  sweepTimer.unref?.();
}

let ready: Promise<void> | null = null;
const ensureReady = () => (ready ??= ensureReferralSchema().catch((e) => { ready = null; throw e; }));

// ── Routes ───────────────────────────────────────────────────────────────────────────────────

export function registerReferralRoutes(app: Express, getDevUser: any) {
  app.use(captureReferralCookie);

  billingEvents.on("invoice.paid", ({ userId, stripeInvoice }) => onReferredInvoicePaid(userId, stripeInvoice));
  // A referrer who just started a plan may have rewards waiting.
  billingEvents.on("subscription.started", () => scheduleSweep());
  const hourly = setInterval(() => void runReferralSweep(), 60 * 60_000);
  hourly.unref?.();
  setTimeout(() => void runReferralSweep(), 60_000).unref?.();

  app.get("/api/referrals/me", async (req: any, res) => {
    const u = getDevUser(req, res); if (!u) return;
    await ensureReady();
    const code = await referralCodeFor(u.id);
    const base = `https://${PRIMARY_DOMAIN}`;
    const refs = (await pool.query(`SELECT status, count(*)::int AS n FROM referrals WHERE referrer_user_id = $1 GROUP BY status`, [u.id])).rows;
    const counts: Record<string, number> = { pending: 0, qualified: 0, rewarded: 0, void: 0 };
    for (const r of refs) counts[r.status] = r.n;
    const rewards = (await pool.query(
      `SELECT id, kind, product, tier, amount_cents, CASE WHEN status = 'applying' THEN 'earned' ELSE status END AS status, earned_at, applied_at
         FROM referral_rewards WHERE referrer_user_id = $1 ORDER BY earned_at DESC LIMIT 100`, [u.id])).rows;
    res.json({
      code, link: `${base}/?ref=${code}`, pricingLink: `${base}/pricing?ref=${code}`,
      signedUp: Object.values(counts).reduce((a, b) => a + b, 0) - counts.void, counts, rewards,
      rules: { monthsToQualify: MONTHS_TO_QUALIFY, annualSharePct: Math.round(ANNUAL_SHARE * 100), holdDays: HOLD_DAYS },
    });
  });

  app.get("/api/admin/referrals", async (req: any, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    await ensureReady();
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.reason, r.kind, r.product, r.tier, r.qualified_at, r.earn_at, r.created_at,
              a.email AS referrer_email, b.email AS referred_email,
              (SELECT count(*)::int FROM referral_invoices i WHERE i.referral_id = r.id AND NOT i.refunded) AS paid_invoices,
              w.id AS reward_id, w.status AS reward_status, w.amount_cents, w.applied_at, w.reason AS reward_reason
         FROM referrals r LEFT JOIN users a ON a.id = r.referrer_user_id LEFT JOIN users b ON b.id = r.referred_user_id
         LEFT JOIN referral_rewards w ON w.referral_id = r.id
        ORDER BY r.created_at DESC LIMIT 1000`);
    res.json({ referrals: rows });
  });

  const reasonOf = (b: any) => String(b?.reason || "voided by admin").slice(0, 200);

  app.post("/api/admin/referrals/:id/void", async (req: any, res) => {
    const admin: any = await requirePlatformAdmin(req, res, getDevUser); if (!admin) return;
    const id = Number(req.params.id);
    const reward = (await pool.query(`SELECT status FROM referral_rewards WHERE referral_id = $1`, [id])).rows[0];
    if (reward && ["applied", "applying"].includes(reward.status)) return res.status(409).json({ message: "The reward is already in Stripe. Reverse the credit or coupon there." });
    const r = await pool.query(`UPDATE referrals SET status = 'void', reason = $2, updated_at = now() WHERE id = $1 RETURNING id`, [id, reasonOf(req.body)]);
    if (!r.rows[0]) return res.status(404).json({ message: "Referral not found" });
    await pool.query(`UPDATE referral_rewards SET status = 'void', reason = $2, voided_at = now(), voided_by = $3 WHERE referral_id = $1 AND status = 'earned'`, [id, reasonOf(req.body), admin.email ?? "admin"]);
    res.json({ ok: true });
  });

  app.post("/api/admin/referrals/rewards/:id/void", async (req: any, res) => {
    const admin: any = await requirePlatformAdmin(req, res, getDevUser); if (!admin) return;
    const r = await pool.query(`UPDATE referral_rewards SET status = 'void', reason = $2, voided_at = now(), voided_by = $3 WHERE id = $1 AND status = 'earned' RETURNING id`,
      [Number(req.params.id), reasonOf(req.body), admin.email ?? "admin"]);
    if (!r.rows[0]) return res.status(409).json({ message: "Only an earned, unpaid reward can be voided here. An applied one is reversed in Stripe." });
    res.json({ ok: true });
  });
}
