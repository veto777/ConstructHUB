/**
 * Account pricing terms (owner decisions, 2026-10-08):
 *
 *   account_pricing_terms — one row per account that keeps something the price
 *     book no longer sells: seo_grandfathered_at / seo_grandfathered_plan (it
 *     had the SEO tools before they became Agency-only; server/entitlements.ts
 *     lays SEO_GRANDFATHERED_LIMITS over its allowances while it has a plan),
 *     founding_member_at / founding_prices (it subscribed while the founding
 *     offer was open and keeps that moment's prices for life —
 *     shared/pricing-terms.ts foundingPrice).
 *   pricing_settings — key/value: 'founding_offer' = { open, periods } (the
 *     offer's open periods; no row = open since the beginning; the owner closes
 *     and reopens it from /admin) and 'seo_agency_only_cutover', the marker
 *     that the one-time cutover below has run, with its ranAt — the durable
 *     boundary everything after it reads.
 *
 * Boot (server/index.ts awaits ensurePricingTerms; a failure fails boot):
 *   1. runSeoAgencyOnlyCutover — ONE transaction under an advisory lock: the
 *      two tables (CREATE TABLE IF NOT EXISTS is transactional, so two first
 *      boots cannot race the DDL), then, once ever, every account whose
 *      deciding subscription row is not over — a Stripe subscription
 *      liveStripeSubscription() accepts (past_due included) or an unexpired
 *      Stripe-less grant — gets seo_grandfathered_at; the Stripe ones also
 *      become founding members (a grant keeps SEO, never a locked price).
 *      Then the marker row. A later boot finds the marker and does nothing.
 *   2. reconcilePricingTerms — heals what a webhook write may have missed
 *      (a marking failure is logged, not fatal, in server/stripe.ts): any live
 *      Stripe row whose start date is before the cutover's ranAt is
 *      grandfathered; any active/trialing Stripe row whose start date falls in
 *      an open period is marked a founding member. Idempotent.
 *
 * Every Stripe subscription write (server/stripe.ts writeSubscriptionRow →
 * noteSubscriptionTerms) applies the same two rules by the subscription's
 * START date — never by when the webhook happens to be processed: a
 * pre-cutover sign-up whose webhook lands after the cutover is still
 * grandfathered; a sign-up during an open period still qualifies after the
 * close; a sign-up during a closed period never qualifies because the offer
 * reopened. Trial codes and admin grants never pass through there.
 *
 * Nothing here changes a Stripe price, a checkout amount or an existing
 * subscription. No public count: the number of founding members is read only
 * by the admin route (./pricing-terms-routes.ts). Plain SQL on the shared
 * pool, like the rest of server/billing.
 */
import { pool } from "../db";
import { ACCESS_STATUSES, LEGACY_PLAN_MAP, PLAN_KEYS } from "@shared/plans";
import { ANNUAL_11X_PRICE_BOOK_EFFECTIVE_AT, FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT, priceSnapshot, parseFoundingPrices, type AccountPricingTerms } from "@shared/pricing-terms";
import { STRIPE_ENDED_STATUSES, SUBSCRIPTION_ORDER } from "../entitlements";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Client = Queryable & { release: () => void };
type Connectable = { connect: () => Promise<Client> };

// ── Schema ──────────────────────────────────────────────────────────────────

export { PRICING_TERMS_DDL, PRICING_TERMS_TABLES } from "./pricing-terms-schema";
import { PRICING_TERMS_DDL, PRICING_TERMS_TABLES } from "./pricing-terms-schema";

/**
 * The two tables, idempotently, OUTSIDE the cutover transaction — for scripts
 * (scripts/apply-schema-migration.ts lists the DDL itself). Boot creates them
 * inside runSeoAgencyOnlyCutover, under its lock.
 */
export async function ensurePricingTermsSchema(q: Queryable = pool): Promise<void> {
  const { rows } = await q.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [PRICING_TERMS_TABLES]);
  if (rows.length === PRICING_TERMS_TABLES.length) return;
  for (const statement of PRICING_TERMS_DDL) await q.query(statement);
}

// ── Settings ────────────────────────────────────────────────────────────────

export const SEO_CUTOVER_KEY = "seo_agency_only_cutover";
export const FOUNDING_OFFER_KEY = "founding_offer";
/** Advisory locks (other keys in use: 7160–7181, 8159…, 8189): the one-time cutover, and the offer switch. */
const CUTOVER_LOCK = 7174;
const OFFER_LOCK = 7175;

/** One stretch of time the offer was open: `to` null = still open. Both ISO strings; `from` null = since the beginning. */
export type OfferPeriod = { from: string | null; to: string | null };
/** The stored 'founding_offer' value. `open` repeats what the last period says, for readers that only want the switch. */
export type FoundingOfferValue = { open: boolean; periods: OfferPeriod[] };

/** The one period a database without the row stands for: open since the beginning. */
const SINCE_THE_BEGINNING: OfferPeriod = { from: null, to: null };

/**
 * The one form a period boundary may take — what Date#toISOString writes (the
 * only writer is setFoundingOffer). The SQL reader (OFFER_PERIODS_SQL below)
 * applies the same expression, so an entry one side ignores the other ignores.
 */
export const OFFER_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const OFFER_TIME_SQL_RE = String.raw`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$`;
const boundary = (v: unknown): string | null | undefined => (v === null ? null : typeof v === "string" && OFFER_TIME_RE.test(v) ? v : undefined);

/**
 * Pure: the offer's periods out of a stored value — the ONE reading, which
 * OFFER_PERIODS_SQL mirrors exactly (script/seo-pricing-check.ts feeds both
 * the same stored values):
 *   no row                        → one period, open since the beginning;
 *   a `periods` list              → read as written; an entry whose from or to
 *                                   is neither null nor an OFFER_TIME_RE string
 *                                   is ignored;
 *   no `periods`, `open` false    → no period at all: closed everywhere, so
 *                                   nothing qualifies;
 *   no `periods`, anything else   → one period, open since the beginning.
 */
export function offerPeriodsOf(value: unknown): OfferPeriod[] {
  if (value == null) return [SINCE_THE_BEGINNING];
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.periods)) {
    const out: OfferPeriod[] = [];
    for (const p of v.periods as Record<string, unknown>[]) {
      const from = boundary(p?.from), to = boundary(p?.to);
      if (from === undefined || to === undefined) continue;
      out.push({ from, to });
    }
    return out;
  }
  return v.open === false ? [] : [SINCE_THE_BEGINNING];
}

/** Pure: is the offer open now — does the last period have no end? */
export const offerOpenOf = (value: unknown): boolean => {
  const periods = offerPeriodsOf(value);
  return periods.length > 0 && periods[periods.length - 1].to === null;
};

/** Pure: does `at` fall inside any period (from inclusive, to exclusive)? */
export function periodContains(periods: readonly OfferPeriod[], at: Date): boolean {
  const t = at.getTime();
  return periods.some((p) => (p.from === null || Date.parse(p.from) <= t) && (p.to === null || t < Date.parse(p.to)));
}

/**
 * Pure: the value to store after the owner closes (`open` false: the open
 * period ends now) or reopens (`open` true: a new period starts now). Closing
 * an already closed offer, or opening an open one, changes nothing.
 */
export function nextOfferValue(current: unknown, open: boolean, now = new Date()): FoundingOfferValue {
  const periods = offerPeriodsOf(current).map((p) => ({ ...p }));
  const last = periods[periods.length - 1];
  const isOpen = !!last && last.to === null;
  if (open && !isOpen) periods.push({ from: now.toISOString(), to: null });
  if (!open && isOpen) last.to = now.toISOString();
  return { open, periods };
}

/** SQL: the stored periods list, read with offerPeriodsOf's rule (no row → open since the beginning; `open` false without periods → none). */
export const OFFER_PERIODS_SQL = `COALESCE((SELECT CASE WHEN jsonb_typeof(value->'periods') = 'array' THEN value->'periods'
                                                  WHEN value->>'open' = 'false' THEN '[]'::jsonb
                                                  ELSE '[{"from":null,"to":null}]'::jsonb END
                                      FROM pricing_settings WHERE key = '${FOUNDING_OFFER_KEY}'), '[{"from":null,"to":null}]'::jsonb)`;
/** An entry's boundary is well-formed: null, or an OFFER_TIME_RE string (anything else: the entry is ignored, as in offerPeriodsOf). */
const BOUNDARY_OK_SQL = (field: "from" | "to") =>
  `(per->'${field}' = 'null'::jsonb OR (jsonb_typeof(per->'${field}') = 'string' AND per->>'${field}' ~ '${OFFER_TIME_SQL_RE}'))`;
/** The boundary as a timestamptz; the CASE keeps a malformed string from ever being cast. */
const BOUNDARY_SQL = (field: "from" | "to") =>
  `(CASE WHEN jsonb_typeof(per->'${field}') = 'string' AND per->>'${field}' ~ '${OFFER_TIME_SQL_RE}' THEN (per->>'${field}')::timestamptz END)`;
/**
 * SQL: is the timestamptz expression `at` inside one of the stored periods
 * (from inclusive, to exclusive — periodContains)? Reads the row at statement
 * time, so the check and the write are one statement.
 */
export const IN_OFFER_PERIOD_SQL = (at: string) => `EXISTS (
  SELECT 1 FROM jsonb_array_elements(${OFFER_PERIODS_SQL}) AS per
   WHERE ${BOUNDARY_OK_SQL("from")} AND ${BOUNDARY_OK_SQL("to")}
     AND (per->'from' = 'null'::jsonb OR ${BOUNDARY_SQL("from")} <= ${at})
     AND (per->'to' = 'null'::jsonb OR ${at} < ${BOUNDARY_SQL("to")}))`;

/** The founding offer is open unless the owner closed it; no row = open. */
export async function foundingOfferOpen(q: Queryable = pool): Promise<boolean> {
  const { rows: [r] } = await q.query("SELECT value FROM pricing_settings WHERE key = $1", [FOUNDING_OFFER_KEY]);
  return offerOpenOf(r?.value);
}

/**
 * Close or reopen the offer: the row is read and rewritten under a lock, so
 * two admins at once cannot lose a period. `byUserId` is recorded as
 * updated_by. Returns the stored value.
 */
export async function setFoundingOffer(open: boolean, byUserId: number, db: Connectable = pool, now = new Date()): Promise<FoundingOfferValue> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock($1)", [OFFER_LOCK]);
    const { rows: [r] } = await c.query("SELECT value FROM pricing_settings WHERE key = $1", [FOUNDING_OFFER_KEY]);
    const next = nextOfferValue(r?.value, open, now);
    await c.query(
      `INSERT INTO pricing_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [FOUNDING_OFFER_KEY, JSON.stringify(next), byUserId]);
    await c.query("COMMIT");
    return next;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export type FoundingOfferStatus = {
  open: boolean;
  /** Every stretch the offer was open, oldest first (the last one has no end while it is open). */
  periods: OfferPeriod[];
  /** When the switch was last set; null while it has never been touched (open by default). */
  updatedAt: string | null;
  updatedBy: { id: number; email: string | null } | null;
  /** Admins only — never in a public response. */
  foundingMembers: number;
};

/** What the admin card shows: the switch, its periods, who set it, and how many founding members there are. */
export async function foundingOfferStatus(q: Queryable = pool): Promise<FoundingOfferStatus> {
  const { rows: [s] } = await q.query(
    `SELECT p.value, p.updated_at, p.updated_by, u.email FROM pricing_settings p LEFT JOIN users u ON u.id = p.updated_by WHERE p.key = $1`,
    [FOUNDING_OFFER_KEY]);
  const { rows: [c] } = await q.query("SELECT count(*)::int AS n FROM account_pricing_terms WHERE founding_member_at IS NOT NULL");
  return {
    open: offerOpenOf(s?.value),
    periods: offerPeriodsOf(s?.value),
    updatedAt: s?.updated_at ? new Date(s.updated_at).toISOString() : null,
    updatedBy: s?.updated_by != null ? { id: Number(s.updated_by), email: s.email ?? null } : null,
    foundingMembers: Number(c?.n ?? 0),
  };
}

// ── Reading an account's terms ──────────────────────────────────────────────

/** The stored row as AccountPricingTerms, or null without one. getEntitlements reads the same columns in its own query. */
export async function accountPricingTerms(userId: number, q: Queryable = pool): Promise<AccountPricingTerms | null> {
  const { rows: [r] } = await q.query(
    "SELECT seo_grandfathered_at, seo_grandfathered_plan, founding_member_at, founding_prices FROM account_pricing_terms WHERE user_id = $1",
    [userId]);
  if (!r) return null;
  return {
    seoGrandfatheredAt: r.seo_grandfathered_at ?? null,
    seoGrandfatheredPlan: r.seo_grandfathered_plan ?? null,
    foundingMemberAt: r.founding_member_at ?? null,
    foundingPrices: parseFoundingPrices(r.founding_prices),
  };
}

// ── Marks on a Stripe subscription write ────────────────────────────────────

/** Select the immutable book by subscription start, even on a delayed write. */
const snapshotJson = (startedAt: Date) => JSON.stringify(priceSnapshot(startedAt));

// Bulk writes select independently for each subscription, in the same atomic
// statement as eligibility and conflict handling. Keep the books in the shared
// helper; SQL only selects one and stamps the subscription's UTC start time.
// 'current' is always the newest book; the older ones keep their own keys.
const snapshotBooksJson = JSON.stringify({
  legacy: priceSnapshot(new Date(Date.parse(FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT) - 1)),
  fivePlan: priceSnapshot(new Date(FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT)),
  current: priceSnapshot(new Date(ANNUAL_11X_PRICE_BOOK_EFFECTIVE_AT)),
});
const SNAPSHOT_AT_SQL = (at: string) => `(
  (CASE WHEN ${at} < '${FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT}'::timestamptz THEN $1::jsonb->'legacy'
    WHEN ${at} < '${ANNUAL_11X_PRICE_BOOK_EFFECTIVE_AT}'::timestamptz THEN $1::jsonb->'fivePlan'
    ELSE $1::jsonb->'current' END)
  || jsonb_build_object('capturedAt', to_char(${at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) `;

/**
 * Mark an account as a founding member when its Stripe subscription STARTED
 * inside one of the offer's open periods, it is active or trialing, and it is
 * not one yet — all in one statement, so the period check and the write
 * cannot disagree and two webhooks at once cannot mark twice. `startedAt` is
 * the subscription's Stripe start date; without one (never for a real Stripe
 * object) the processing time stands in. Stripe-less rows (trial codes, admin
 * grants) never reach here with a subscription id. Returns true when this
 * call marked the account.
 *
 * Two things are deliberately left as they are (audit #2, 2026-10-08):
 *   - This statement is not serialized against the owner's close
 *     (setFoundingOffer). A close committed in the very instant a marking
 *     statement reads the old open period can let one sign-up from that
 *     instant through: at worst one extra founding member, never a lost one.
 *     A lock on every subscription write is not worth that.
 *   - Eligibility is "started inside an open period, and active or trialing
 *     when recorded". A subscription that started while the offer was open
 *     and is first recorded active after the close still qualifies, by its
 *     start. One cancelled before its first webhook is never recorded active
 *     and gets no mark — there is no price to lock for it.
 */
export async function noteFoundingMember(userId: number, status: string | null | undefined, stripeSubscriptionId: string | null | undefined, startedAt: Date | null | undefined, q: Queryable = pool, now = new Date()): Promise<boolean> {
  if (!userId || !stripeSubscriptionId || !ACCESS_STATUSES.includes(status ?? "")) return false;
  const { rows } = await q.query(
    `INSERT INTO account_pricing_terms (user_id, founding_member_at, founding_prices)
     SELECT $1, now(), $2::jsonb
      WHERE ${IN_OFFER_PERIOD_SQL("$3::timestamptz")}
     ON CONFLICT (user_id) DO UPDATE SET founding_member_at = now(), founding_prices = COALESCE(account_pricing_terms.founding_prices, EXCLUDED.founding_prices), updated_at = now()
      WHERE account_pricing_terms.founding_member_at IS NULL
     RETURNING user_id`,
    [userId, snapshotJson(startedAt ?? now), startedAt ?? now]);
  return rows.length > 0;
}

/**
 * Grandfather the SEO tools on a Stripe subscription that STARTED before the
 * cutover's ranAt and is not over (the cutover's own rule, applied late: its
 * webhook landed after the cutover selected the rows). One statement, COALESCE
 * on an existing row, so a mark never moves. `plan` is the plan the write
 * stores; a legacy price without one falls back to the stored row's plan.
 * Returns true when this call grandfathered the account.
 */
export async function noteSeoGrandfathering(userId: number, status: string | null | undefined, stripeSubscriptionId: string | null | undefined, plan: string | null | undefined, startedAt: Date | null | undefined, q: Queryable = pool): Promise<boolean> {
  if (!userId || !stripeSubscriptionId || !startedAt || STRIPE_ENDED_STATUSES.includes(status ?? "")) return false;
  // $2 is ACCESS_STATUSES because SUBSCRIPTION_ORDER reads it there.
  const { rows } = await q.query(
    `INSERT INTO account_pricing_terms (user_id, seo_grandfathered_at, seo_grandfathered_plan)
     SELECT $1, now(), COALESCE($5::text, (SELECT x.plan FROM subscriptions x WHERE x.user_id = $1 ${SUBSCRIPTION_ORDER}))
      WHERE $3::timestamptz < (SELECT (value->>'ranAt')::timestamptz FROM pricing_settings WHERE key = $4)
     ON CONFLICT (user_id) DO UPDATE SET
       seo_grandfathered_at = COALESCE(account_pricing_terms.seo_grandfathered_at, EXCLUDED.seo_grandfathered_at),
       seo_grandfathered_plan = COALESCE(account_pricing_terms.seo_grandfathered_plan, EXCLUDED.seo_grandfathered_plan),
       updated_at = now()
      WHERE account_pricing_terms.seo_grandfathered_at IS NULL
     RETURNING user_id`,
    [userId, ACCESS_STATUSES, startedAt, SEO_CUTOVER_KEY, plan ?? null]);
  return rows.length > 0;
}

/** Both marks for one Stripe subscription write (server/stripe.ts writeSubscriptionRow). */
export async function noteSubscriptionTerms(userId: number, set: { status?: string | null; stripeSubscriptionId?: string | null; plan?: string | null }, startedAt: Date | null, q: Queryable = pool, now = new Date()): Promise<{ grandfathered: boolean; founding: boolean }> {
  const grandfathered = await noteSeoGrandfathering(userId, set.status, set.stripeSubscriptionId, set.plan, startedAt, q);
  const founding = await noteFoundingMember(userId, set.status, set.stripeSubscriptionId, startedAt, q, now);
  return { grandfathered, founding };
}

// ── The one-time cutover ────────────────────────────────────────────────────

/** Every plan key a subscription row may carry: the current ones and the legacy ones that map to them. */
export const KNOWN_PLAN_KEYS: readonly string[] = [...PLAN_KEYS, ...Object.keys(LEGACY_PLAN_MAP)];

/**
 * The Stripe statuses the cutover makes founding members: paying customers
 * (active, trialing) and ones whose card is being retried (past_due). A
 * subscription that is incomplete, unpaid or paused keeps its SEO
 * grandfathering and nothing more.
 */
export const FOUNDING_CUTOVER_STATUSES: readonly string[] = [...ACCESS_STATUSES, "past_due"];

/**
 * The cutover's one INSERT: each account's deciding row (SUBSCRIPTION_ORDER:
 * one with access first, then the newest), kept when it is not over —
 *   Stripe: a subscription id, a status liveStripeSubscription() accepts
 *     (not canceled / incomplete_expired / inactive; past_due counts), and a
 *     start date before the cutover (or none stored yet) — the same rule the
 *     late arrivals meet in noteSeoGrandfathering, against the same ranAt
 *     (now() is this transaction's time, the one the marker stores);
 *   grant: no subscription id, status active or trialing, and no end date or
 *     one still ahead (server/entitlements.ts grantExpired).
 * Every kept row is grandfathered; only Stripe rows in FOUNDING_CUTOVER_STATUSES
 * become founding members — a trial code, an admin grant or a subscription that
 * never paid keeps SEO and nothing more. $1 the dated price books (jsonb), $2
 * ACCESS_STATUSES, $3 KNOWN_PLAN_KEYS, $4 STRIPE_ENDED_STATUSES, $5
 * FOUNDING_CUTOVER_STATUSES, $6 the boundary (ranAt: the transaction's clock
 * read under the lock, to the millisecond the marker stores — the selection,
 * every stamp and the marker are that one value). A row that somehow already
 * exists keeps what it has (COALESCE), so running the statement twice could
 * never move a date.
 */
/**
 * The start the cutover snapshots by. A row this one-time statement selects
 * already existed before the deploy, so one with no stored start date (the
 * column is added without a backfill) was sold on the book before the
 * five-plan boundary: date it just before that boundary, never at the
 * cutover's own clock, which would lock today's higher prices.
 */
const CUTOVER_START_SQL = `COALESCE(s.start_date::timestamptz, '${FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT}'::timestamptz - interval '1 millisecond')`;

export const SEO_CUTOVER_SQL = `
  INSERT INTO account_pricing_terms (user_id, seo_grandfathered_at, seo_grandfathered_plan, founding_member_at, founding_prices)
  SELECT u.id, $6::timestamptz, s.plan,
         CASE WHEN s.stripe_subscription_id IS NOT NULL AND s.status = ANY($5::text[]) THEN $6::timestamptz END,
         CASE WHEN s.stripe_subscription_id IS NOT NULL AND s.status = ANY($5::text[]) THEN ${SNAPSHOT_AT_SQL(CUTOVER_START_SQL)} END
    FROM users u
    JOIN LATERAL (SELECT * FROM subscriptions x WHERE x.user_id = u.id ${SUBSCRIPTION_ORDER}) s ON true
   WHERE s.plan = ANY($3::text[])
     AND ((s.stripe_subscription_id IS NOT NULL AND NOT (s.status = ANY($4::text[])) AND (s.start_date IS NULL OR s.start_date < $6::timestamptz))
       OR (s.stripe_subscription_id IS NULL AND s.status = ANY($2::text[]) AND (s.current_period_end IS NULL OR s.current_period_end > $6::timestamptz)))
  ON CONFLICT (user_id) DO UPDATE SET
    seo_grandfathered_at = COALESCE(account_pricing_terms.seo_grandfathered_at, EXCLUDED.seo_grandfathered_at),
    seo_grandfathered_plan = COALESCE(account_pricing_terms.seo_grandfathered_plan, EXCLUDED.seo_grandfathered_plan),
    founding_member_at = COALESCE(account_pricing_terms.founding_member_at, EXCLUDED.founding_member_at),
    founding_prices = COALESCE(account_pricing_terms.founding_prices, EXCLUDED.founding_prices),
    updated_at = now()`;

export type CutoverResult = { ran: boolean; grandfathered: number };

/**
 * The tables, then — once, ever — grandfather every account on a plan today
 * and make the paying ones founding members. One transaction under an
 * advisory lock: a second process booting at the same moment waits for the
 * DDL and the cutover, then finds the marker and leaves. The boundary is the
 * transaction's own time (now() inside it, after the lock): the selection
 * compares every start date to it and the marker stores it as ranAt, so a
 * late arrival (noteSeoGrandfathering, reconcilePricingTerms) meets exactly
 * the rule the selection applied. Throws on a database error (nothing is
 * half-written: the transaction rolls back, boot fails, and the next boot
 * tries again).
 */
export async function runSeoAgencyOnlyCutover(db: Connectable = pool): Promise<CutoverResult> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock($1)", [CUTOVER_LOCK]);
    for (const statement of PRICING_TERMS_DDL) await c.query(statement);
    const { rows: done } = await c.query("SELECT 1 FROM pricing_settings WHERE key = $1", [SEO_CUTOVER_KEY]);
    if (done.length) {
      await c.query("COMMIT");
      return { ran: false, grandfathered: 0 };
    }
    // The one boundary: this transaction's time, taken under the lock, to the millisecond (what the marker can store);
    // the INSERT selects and stamps with that same value.
    const { rows: [clock] } = await c.query("SELECT now() AS ran_at");
    const ranAt = new Date(clock.ran_at);
    const { rowCount } = await c.query(SEO_CUTOVER_SQL, [snapshotBooksJson, ACCESS_STATUSES, KNOWN_PLAN_KEYS, STRIPE_ENDED_STATUSES, FOUNDING_CUTOVER_STATUSES, ranAt]);
    const grandfathered = Number(rowCount ?? 0);
    await c.query(
      "INSERT INTO pricing_settings (key, value) VALUES ($1, $2::jsonb)",
      [SEO_CUTOVER_KEY, JSON.stringify({ ranAt: ranAt.toISOString(), grandfathered })]);
    await c.query("COMMIT");
    console.log(`[billing] SEO agency-only cutover at ${ranAt.toISOString()}: ${grandfathered} account(s) grandfathered; the paying ones are founding members.`);
    return { ran: true, grandfathered };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ── Reconciliation ──────────────────────────────────────────────────────────

/**
 * The two subscription-write rules, applied to every account's deciding Stripe
 * row from what the database holds — for writes whose mark failed (logged,
 * not fatal) and for webhooks that landed between the cutover's selection and
 * its marker. Reads `subscriptions.start_date` (the Stripe start date
 * server/billing/sync.ts recordCancellation stores; a row not yet synced is
 * left for its next webhook). Idempotent: an existing mark never moves.
 */
export const RECONCILE_SEO_SQL = `
  INSERT INTO account_pricing_terms (user_id, seo_grandfathered_at, seo_grandfathered_plan)
  SELECT u.id, now(), s.plan
    FROM users u
    JOIN LATERAL (SELECT * FROM subscriptions x WHERE x.user_id = u.id ${SUBSCRIPTION_ORDER}) s ON true
   WHERE s.stripe_subscription_id IS NOT NULL AND NOT (s.status = ANY($3::text[])) AND s.plan = ANY($1::text[])
     AND s.start_date IS NOT NULL
     AND s.start_date < (SELECT (value->>'ranAt')::timestamptz FROM pricing_settings WHERE key = $4)
     AND NOT EXISTS (SELECT 1 FROM account_pricing_terms t WHERE t.user_id = u.id AND t.seo_grandfathered_at IS NOT NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    seo_grandfathered_at = COALESCE(account_pricing_terms.seo_grandfathered_at, EXCLUDED.seo_grandfathered_at),
    seo_grandfathered_plan = COALESCE(account_pricing_terms.seo_grandfathered_plan, EXCLUDED.seo_grandfathered_plan),
    updated_at = now()`;

export const RECONCILE_FOUNDING_SQL = `
  INSERT INTO account_pricing_terms (user_id, founding_member_at, founding_prices)
  SELECT u.id, now(), ${SNAPSHOT_AT_SQL("s.start_date::timestamptz")}
    FROM users u
    JOIN LATERAL (SELECT * FROM subscriptions x WHERE x.user_id = u.id ${SUBSCRIPTION_ORDER}) s ON true
   WHERE s.stripe_subscription_id IS NOT NULL AND s.status = ANY($2::text[])
     AND s.start_date IS NOT NULL
     AND ${IN_OFFER_PERIOD_SQL("s.start_date::timestamptz")}
     AND NOT EXISTS (SELECT 1 FROM account_pricing_terms t WHERE t.user_id = u.id AND t.founding_member_at IS NOT NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    founding_member_at = COALESCE(account_pricing_terms.founding_member_at, EXCLUDED.founding_member_at),
    founding_prices = COALESCE(account_pricing_terms.founding_prices, EXCLUDED.founding_prices),
    updated_at = now()
    WHERE account_pricing_terms.founding_member_at IS NULL`;

export type ReconcileResult = { grandfathered: number; founding: number };

export async function reconcilePricingTerms(q: Queryable = pool, _now = new Date()): Promise<ReconcileResult> {
  const seo = await q.query(RECONCILE_SEO_SQL, [KNOWN_PLAN_KEYS, ACCESS_STATUSES, STRIPE_ENDED_STATUSES, SEO_CUTOVER_KEY]);
  const founding = await q.query(RECONCILE_FOUNDING_SQL, [snapshotBooksJson, ACCESS_STATUSES]);
  const out = { grandfathered: Number(seo.rowCount ?? 0), founding: Number(founding.rowCount ?? 0) };
  if (out.grandfathered || out.founding) console.log(`[billing] pricing terms reconciled: ${out.grandfathered} grandfathered, ${out.founding} founding member(s) marked from stored subscriptions.`);
  return out;
}

/** Boot: the tables and the one-time cutover (one transaction), then the reconciliation. Throws on failure — boot must not proceed. */
export async function ensurePricingTerms(db: Connectable & Queryable = pool, now = new Date()): Promise<{ cutover: CutoverResult; reconciled: ReconcileResult }> {
  const cutover = await runSeoAgencyOnlyCutover(db);
  const reconciled = await reconcilePricingTerms(db, now);
  return { cutover, reconciled };
}
