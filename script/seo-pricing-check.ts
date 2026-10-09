/**
 * Real-Postgres check of the account pricing terms (owner decisions, 2026-10-08): the one-time SEO
 * cutover (tables + cutover in one transaction), the grandfathered SEO allowances through getEntitlements,
 * the founding member mark by the subscription's START date against the offer's open periods, the late
 * grandfathering of a pre-cutover sign-up, and the boot reconciliation.
 * THROWAWAY database: it creates a `subscriptions` table (the columns shared/schema.ts declares, plus
 * server/billing/schema.ts BILLING_SUBSCRIPTION_DDL) and writes users and rows.
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-pricing-check.ts
 */
import { pool } from "../server/db";
import { BILLING_SUBSCRIPTION_DDL } from "../server/billing/schema";
import {
  ensurePricingTerms, runSeoAgencyOnlyCutover, reconcilePricingTerms, noteSubscriptionTerms, setFoundingOffer, foundingOfferOpen,
  foundingOfferStatus, accountPricingTerms, offerPeriodsOf, periodContains, IN_OFFER_PERIOD_SQL, FOUNDING_OFFER_KEY, SEO_CUTOVER_KEY,
} from "../server/billing/pricing-terms";
import { getEntitlements, requirePlan, cheapestPlanWhere } from "../server/entitlements";
import { seoIncluded, seoAllowanceTest, SEO_FEATURE } from "../server/seo/plan";
import { foundingPrice, isFoundingMember } from "../shared/pricing-terms";
import { PLANS } from "../shared/plans";

let n = 0;
const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  ok(pass, pass ? label : `${label}  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
const fakeRes = () => { const r: any = { code: 0, body: null, status(c: number) { r.code = c; return r; }, json(b: unknown) { r.body = b; return r; } }; return r; };
const minutes = (base: Date, m: number) => new Date(base.getTime() + m * 60_000);

(async () => {
  // The users table is the runner's (id serial, email, company_name); subscriptions is built here. The pricing
  // terms tables are NOT created up front: the cutover creates them inside its own transaction, as boot does.
  await pool.query(`CREATE TABLE IF NOT EXISTS subscriptions (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, user_id integer NOT NULL,
    stripe_customer_id text, stripe_subscription_id text, stripe_price_id text,
    plan text NOT NULL DEFAULT 'free', status text NOT NULL DEFAULT 'inactive',
    current_period_end timestamp, created_at timestamp NOT NULL DEFAULT now())`);
  for (const sql of BILLING_SUBSCRIPTION_DDL) await pool.query(sql);
  await pool.query("DROP TABLE IF EXISTS account_pricing_terms; DROP TABLE IF EXISTS pricing_settings; DELETE FROM subscriptions; DELETE FROM users WHERE email LIKE '%@pricing.example' OR email = 'support@constructhub.us'");

  const user = async (name: string) => (await one("INSERT INTO users(email, company_name) VALUES ($1, $2) RETURNING id", [name === "admin" ? "support@constructhub.us" : `${name}@pricing.example`, name])).id as number;
  const sub = (userId: number, plan: string, status: string, stripeId: string | null, end: string | null = null, startDate: Date | null = null) =>
    pool.query("INSERT INTO subscriptions(user_id, plan, status, stripe_subscription_id, current_period_end, start_date) VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz)", [userId, plan, status, stripeId, end, startDate]);
  const terms = (userId: number) => accountPricingTerms(userId, pool);
  const seo = async (userId: number) => { const e = await getEntitlements(userId); return { included: seoIncluded(e), keywords: e.allowances?.seoKeywords ?? null, cents: e.allowances?.seoCreditCents ?? null, grandfathered: e.seoGrandfathered, founding: !!e.foundingMember }; };
  /** A Stripe subscription write as server/stripe.ts makes it. */
  const write = (userId: number, status: string, stripeId: string | null, plan: string, startedAt: Date | null) =>
    noteSubscriptionTerms(userId, { status, stripeSubscriptionId: stripeId, plan }, startedAt, pool);

  // Accounts as they stand the moment the cutover runs.
  const starterLive = await user("starter-live");   await sub(starterLive, "starter", "active", "sub_starter");
  const proPastDue = await user("pro-pastdue");     await sub(proPastDue, "pro", "past_due", "sub_pro");
  const grantLive = await user("grant-live");       await sub(grantLive, "growth", "active", null, "2099-01-01T00:00:00Z");
  const canceled = await user("canceled");          await sub(canceled, "pro", "canceled", "sub_gone");
  const grantExpired = await user("grant-expired"); await sub(grantExpired, "agency", "trialing", null, "2020-01-01T00:00:00Z");
  const agencyLive = await user("agency-live");     await sub(agencyLive, "agency", "active", "sub_agency");
  const legacy = await user("legacy-business");     await sub(legacy, "business", "active", "sub_legacy");
  const freeRow = await user("free-row");           await sub(freeRow, "free", "inactive", null);
  const noRow = await user("no-row");
  const admin = await user("admin");
  // Two rows: the ended one is newer, the live one wins (SUBSCRIPTION_ORDER).
  const twoRows = await user("two-rows");           await sub(twoRows, "pro", "active", "sub_two_live"); await sub(twoRows, "pro", "canceled", "sub_two_old");
  // Stripe rows that never paid (or are paused): live for liveStripeSubscription(), so they keep SEO — but no locked price.
  const unpaidRow = await user("unpaid");           await sub(unpaidRow, "pro", "unpaid", "sub_unpaid");
  const incompleteRow = await user("incomplete");   await sub(incompleteRow, "pro", "incomplete", "sub_incomplete");
  const pausedRow = await user("paused");           await sub(pausedRow, "growth", "paused", "sub_paused");

  // 1. The cutover. Its boundary (ranAt) is the transaction's own clock, read from the marker afterwards; everything that
  // follows is placed relative to it (minutes after it — the clock never matters, only the order against the boundary).
  const first = await ensurePricingTerms(pool);
  eq("1a boot created the tables and the cutover grandfathered the live Starter, past_due Pro, unexpired grant, Agency, legacy, two-row, unpaid, incomplete and paused accounts; nothing to reconcile yet", first, { cutover: { ran: true, grandfathered: 9 }, reconciled: { grandfathered: 0, founding: 0 } });
  for (const [label, id, plan] of [["live Starter", starterLive, "starter"], ["past_due Pro", proPastDue, "pro"], ["Agency", agencyLive, "agency"], ["legacy business", legacy, "business"], ["two rows", twoRows, "pro"]] as const) {
    const t = await terms(id);
    ok(!!t?.seoGrandfatheredAt && t.seoGrandfatheredPlan === plan && !!t.foundingMemberAt && !!t.foundingPrices, `1b ${label} (a Stripe subscription): grandfathered on its stored plan '${plan}' AND a founding member with a price snapshot`);
  }
  const grantTerms = await terms(grantLive);
  ok(!!grantTerms?.seoGrandfatheredAt && grantTerms.seoGrandfatheredPlan === "growth" && !grantTerms.foundingMemberAt && !grantTerms.foundingPrices, "1b2 the unexpired grant keeps SEO but is NOT a founding member (no locked price for a trial code or an admin grant)");
  for (const [label, id, plan] of [["unpaid", unpaidRow, "pro"], ["incomplete", incompleteRow, "pro"], ["paused", pausedRow, "growth"]] as const) {
    const t = await terms(id);
    ok(!!t?.seoGrandfatheredAt && t.seoGrandfatheredPlan === plan && !t.foundingMemberAt && !t.foundingPrices, `1b3 a ${label} Stripe subscription keeps SEO but is NOT a founding member (it is not paying)`);
  }
  for (const [label, id] of [["canceled sub", canceled], ["expired grant", grantExpired], ["free/inactive row", freeRow], ["no row", noRow], ["admin without a plan", admin]] as const) {
    eq(`1c ${label}: NOT grandfathered`, await terms(id), null);
  }
  const marker = await one("SELECT value FROM pricing_settings WHERE key=$1", [SEO_CUTOVER_KEY]);
  const T0 = new Date(marker?.value?.ranAt);
  const dbNow = new Date((await one("SELECT now() AS t")).t);
  ok(marker?.value?.grandfathered === 9 && Number.isFinite(T0.getTime()) && Math.abs(dbNow.getTime() - T0.getTime()) < 120_000, "1d the marker row carries the count and the cutover's own transaction time (the database clock, moments ago)");
  eq("1d2 every row the cutover wrote carries that same instant as its grandfathering time", (await one("SELECT count(*)::int n FROM account_pricing_terms WHERE seo_grandfathered_at <> $1::timestamptz", [T0])).n, 0);
  eq("1e founding members after the cutover: the five paying accounts", (await foundingOfferStatus(pool)).foundingMembers, 5);

  // 2. Runs once; the boundary is durable.
  const before = await pool.query("SELECT user_id, seo_grandfathered_at, founding_member_at, updated_at FROM account_pricing_terms ORDER BY user_id");
  const lateStarter = await user("late-starter"); await sub(lateStarter, "starter", "active", "sub_late", null, minutes(T0, 1));
  const second = await runSeoAgencyOnlyCutover(pool);
  eq("2a a second boot does nothing", second, { ran: false, grandfathered: 0 });
  const after = await pool.query("SELECT user_id, seo_grandfathered_at, founding_member_at, updated_at FROM account_pricing_terms ORDER BY user_id");
  eq("2b ...and changes no row", after.rows, before.rows);
  eq("2c a subscription created after the cutover is not grandfathered by it", await terms(lateStarter), null);
  eq("2d the marker is still the first run's", (await one("SELECT value FROM pricing_settings WHERE key=$1", [SEO_CUTOVER_KEY]))?.value, { ranAt: T0.toISOString(), grandfathered: 9 });
  // A pre-cutover sign-up whose webhook lands after the cutover: its Stripe start date decides.
  const preCutover = await user("pre-cutover-late-webhook"); await sub(preCutover, "starter", "active", "sub_pre", null, minutes(T0, -1));
  eq("2e a subscription that STARTED before the cutover, written after it: grandfathered (and, started in the open period, a founding member)", await write(preCutover, "active", "sub_pre", "starter", minutes(T0, -1)), { grandfathered: true, founding: true });
  eq("2f ...with Starter's old allowances", await seo(preCutover), { included: true, keywords: 50, cents: 1000, grandfathered: true, founding: true });
  eq("2g a subscription that started after the cutover, written now: not grandfathered, but a founding member (the offer is open)", await write(lateStarter, "active", "sub_late", "starter", minutes(T0, 1)), { grandfathered: false, founding: true });
  const preAgain = await terms(preCutover);
  eq("2h the same write again moves nothing", [await write(preCutover, "active", "sub_pre", "starter", minutes(T0, -1)), JSON.stringify(await terms(preCutover)) === JSON.stringify(preAgain)], [{ grandfathered: false, founding: false }, true]);
  // A write whose marks failed (nothing in account_pricing_terms) is healed by boot's reconciliation from start_date.
  const missed = await user("missed-marks"); await sub(missed, "growth", "active", "sub_missed", null, minutes(T0, -5));
  const ended = await user("ended-pre-cutover"); await sub(ended, "growth", "canceled", "sub_ended", null, minutes(T0, -5));
  eq("2i reconciliation grandfathers and marks the live pre-cutover row it finds, not the ended one", [await reconcilePricingTerms(pool), !!(await terms(missed))?.seoGrandfatheredAt, isFoundingMember(await terms(missed)), await terms(ended)], [{ grandfathered: 1, founding: 1 }, true, true, null]);
  eq("2j ...and a second reconciliation finds nothing to do", await reconcilePricingTerms(pool), { grandfathered: 0, founding: 0 });

  // 3. Entitlements.
  eq("3a new Starter: no SEO tools (0 keywords, $0 data)", await seo(lateStarter), { included: false, keywords: 0, cents: 0, grandfathered: false, founding: true });
  const r = fakeRes();
  eq("3b ...and the 402 names Agency", [await requirePlan(r, lateStarter, SEO_FEATURE, seoAllowanceTest), r.code, r.body?.code, r.body?.requiredPlan, /Agency plan/.test(r.body?.message ?? "")], [null, 402, "plan_required", "agency", true]);
  eq("3c cheapestPlanWhere(seoAllowanceTest) is Agency", cheapestPlanWhere(seoAllowanceTest), "agency");
  eq("3d grandfathered Starter keeps 50 keywords and $10", await seo(starterLive), { included: true, keywords: 50, cents: 1000, grandfathered: true, founding: true });
  await pool.query("UPDATE subscriptions SET plan='pro' WHERE user_id=$1", [starterLive]);
  eq("3e ...then upgraded to Pro: 200 and $20 (follows the plan it is on now)", await seo(starterLive), { included: true, keywords: 200, cents: 2000, grandfathered: true, founding: true });
  eq("3f grandfathered legacy 'business' maps to Pro: 200 and $20", await seo(legacy), { included: true, keywords: 200, cents: 2000, grandfathered: true, founding: true });
  eq("3g grandfathered unexpired Growth grant: 1,000 and $40, and not a founding member", await seo(grantLive), { included: true, keywords: 1000, cents: 4000, grandfathered: true, founding: false });
  eq("3h Agency: 1,000 and $40", await seo(agencyLive), { included: true, keywords: 1000, cents: 4000, grandfathered: true, founding: true });
  eq("3i platform admin: unlimited", await seo(admin), { included: true, keywords: -1, cents: -1, grandfathered: false, founding: false });
  eq("3j past_due Pro: grandfathered, but no plan access until the payment goes through", await seo(proPastDue), { included: false, keywords: null, cents: null, grandfathered: false, founding: true });
  await pool.query("UPDATE subscriptions SET status='active' WHERE user_id=$1", [proPastDue]);
  eq("3k ...and once Stripe collects, its 200 and $20 are back", await seo(proPastDue), { included: true, keywords: 200, cents: 2000, grandfathered: true, founding: true });
  await pool.query("UPDATE subscriptions SET status='canceled' WHERE user_id=$1", [starterLive]);
  eq("3l a grandfathered account whose plan ended has nothing to keep (the mark stays for when it returns)", [await seo(starterLive), !!(await terms(starterLive))?.seoGrandfatheredAt], [{ included: false, keywords: null, cents: null, grandfathered: false, founding: true }, true]);
  eq("3m canceled before the cutover: nothing", await seo(canceled), { included: false, keywords: null, cents: null, grandfathered: false, founding: false });

  // 4. Founding members: by the subscription's start date, Stripe only, once.
  eq("4a the offer is open by default (one period since the beginning)", [await foundingOfferOpen(pool), (await foundingOfferStatus(pool)).periods], [true, [{ from: null, to: null }]]);
  const late = await terms(lateStarter);
  eq("4b the late Starter's snapshot holds today's prices: Starter monthly / Agency yearly", [foundingPrice(late, "starter", "month"), foundingPrice(late, "agency", "year")], [PLANS.starter.monthlyCents, PLANS.agency.annualCents]);
  const agencyBefore = (await terms(agencyLive))?.foundingMemberAt;
  eq("4c a grandfathered founding member is not marked again (the mark does not move)", [await write(agencyLive, "active", "sub_agency", "agency", minutes(T0, -30)), (await terms(agencyLive))?.foundingMemberAt], [{ grandfathered: false, founding: false }, agencyBefore]);
  const trialing = await user("trialing-stripe"); await sub(trialing, "pro", "trialing", "sub_trial", null, minutes(T0, 2));
  eq("4d a trialing Stripe subscription (the 1-day trial) is marked", [await write(trialing, "trialing", "sub_trial", "pro", minutes(T0, 2)), isFoundingMember(await terms(trialing))], [{ grandfathered: false, founding: true }, true]);
  const pastDueNew = await user("pastdue-new"); await sub(pastDueNew, "pro", "past_due", "sub_pd", null, minutes(T0, 2));
  eq("4e past_due is not", [await write(pastDueNew, "past_due", "sub_pd", "pro", minutes(T0, 2)), await terms(pastDueNew)], [{ grandfathered: false, founding: false }, null]);
  const grantNew = await user("grant-new"); await sub(grantNew, "agency", "active", null, "2099-01-01T00:00:00Z");
  eq("4f a grant (no Stripe subscription) never is", [await write(grantNew, "active", null, "agency", minutes(T0, 2)), await terms(grantNew)], [{ grandfathered: false, founding: false }, null]);
  eq("4g the admin card counts them: 5 from the cutover + pre-cutover + late Starter + reconciled + trialing", (await foundingOfferStatus(pool)).foundingMembers, 9);

  // 4z. SQL and TypeScript read a stored 'founding_offer' value by one rule: feed both the same values.
  const X = "2026-10-09T00:00:00.000Z", Y = "2026-10-10T00:00:00.000Z";
  const storedValues: unknown[] = [
    undefined,                                                    // no row
    { open: false },                                              // legacy closed, no periods: closed everywhere
    { open: true },                                               // legacy open, no periods: since the beginning
    { open: false, periods: [{ from: null, to: X }] },
    { open: true, periods: [{ from: null, to: X }, { from: Y, to: null }] },
    { open: true, periods: [{ from: "garbage", to: null }, { to: null }, { from: null, to: X }] },   // malformed entries ignored
    { open: true, periods: [] },
    { open: true, periods: [{ from: "2026-10-09 00:00:00", to: null }] },                           // not ISO: ignored → nothing
  ];
  const probes = ["2026-10-08T00:00:00Z", "2026-10-09T00:00:00Z", "2026-10-09T12:00:00Z", "2026-10-10T00:00:00Z", "2030-01-01T00:00:00Z"].map((d) => new Date(d));
  let agree = 0, disagree: string[] = [];
  for (const value of storedValues) {
    await pool.query("DELETE FROM pricing_settings WHERE key=$1", [FOUNDING_OFFER_KEY]);
    if (value !== undefined) await pool.query("INSERT INTO pricing_settings (key, value) VALUES ($1, $2::jsonb)", [FOUNDING_OFFER_KEY, JSON.stringify(value)]);
    for (const at of probes) {
      const ts = periodContains(offerPeriodsOf(value), at);
      const { inside } = await one(`SELECT ${IN_OFFER_PERIOD_SQL("$1::timestamptz")} AS inside`, [at]);
      if (ts === inside) agree++; else disagree.push(`${JSON.stringify(value)} @ ${at.toISOString()}: ts ${ts} sql ${inside}`);
    }
  }
  await pool.query("DELETE FROM pricing_settings WHERE key=$1", [FOUNDING_OFFER_KEY]);
  eq(`4z SQL and TypeScript agree on every stored value and probe (${storedValues.length} values x ${probes.length} probes)`, [agree, disagree], [storedValues.length * probes.length, []]);

  // 5. Closing and reopening: eligibility follows the sign-up time, not when the webhook is processed.
  const C = minutes(T0, 10), R = minutes(T0, 20);
  await setFoundingOffer(false, admin, pool, C);
  const closed = await foundingOfferStatus(pool);
  eq("5a closed: the open period ends at the close, recorded with who closed it", [closed.open, closed.periods, closed.updatedBy?.id, closed.updatedBy?.email, await foundingOfferOpen(pool)], [false, [{ from: null, to: C.toISOString() }], admin, "support@constructhub.us", false]);
  const signedBeforeClose = await user("signed-before-close"); await sub(signedBeforeClose, "growth", "active", "sub_before_close", null, minutes(T0, 5));
  eq("5b a subscription that started while the offer was open, whose webhook lands after the close: still a founding member", [await write(signedBeforeClose, "active", "sub_before_close", "growth", minutes(T0, 5)), isFoundingMember(await terms(signedBeforeClose))], [{ grandfathered: false, founding: true }, true]);
  const signedWhileClosed = await user("signed-while-closed"); await sub(signedWhileClosed, "growth", "active", "sub_while_closed", null, minutes(T0, 15));
  eq("5c a subscription that started while the offer was closed: not marked", [await write(signedWhileClosed, "active", "sub_while_closed", "growth", minutes(T0, 15)), await terms(signedWhileClosed)], [{ grandfathered: false, founding: false }, null]);
  eq("5d existing founding members keep their mark", isFoundingMember(await terms(lateStarter)), true);
  await setFoundingOffer(true, admin, pool, R);
  const reopened = await foundingOfferStatus(pool);
  eq("5e reopened: a second period starts at the reopen", [reopened.open, reopened.periods, await foundingOfferOpen(pool)], [true, [{ from: null, to: C.toISOString() }, { from: R.toISOString(), to: null }], true]);
  eq("5f the sign-up from the closed stretch does not qualify because the offer reopened", [await write(signedWhileClosed, "active", "sub_while_closed", "growth", minutes(T0, 15)), await terms(signedWhileClosed)], [{ grandfathered: false, founding: false }, null]);
  const signedAfterReopen = await user("signed-after-reopen"); await sub(signedAfterReopen, "growth", "active", "sub_after_reopen", null, minutes(T0, 25));
  eq("5g a sign-up after the reopen qualifies", [await write(signedAfterReopen, "active", "sub_after_reopen", "growth", minutes(T0, 25)), isFoundingMember(await terms(signedAfterReopen))], [{ grandfathered: false, founding: true }, true]);
  // Reconciliation respects the periods too: a row from the closed stretch stays unmarked, one from the open stretch is marked.
  const missedClosed = await user("missed-while-closed"); await sub(missedClosed, "pro", "active", "sub_missed_closed", null, minutes(T0, 12));
  const missedOpen = await user("missed-after-reopen"); await sub(missedOpen, "pro", "active", "sub_missed_open", null, minutes(T0, 30));
  eq("5h reconciliation marks the open-stretch row only", [await reconcilePricingTerms(pool), await terms(missedClosed), isFoundingMember(await terms(missedOpen))], [{ grandfathered: 0, founding: 1 }, null, true]);
  eq("5i the count follows: 9 + before-close + after-reopen + reconciled", (await foundingOfferStatus(pool)).foundingMembers, 12);
  eq("5j closing twice changes nothing; the periods stay as they were", [(await setFoundingOffer(false, admin, pool, minutes(T0, 40))).periods.length, (await setFoundingOffer(false, admin, pool, minutes(T0, 41))).periods], [2, [{ from: null, to: C.toISOString() }, { from: R.toISOString(), to: minutes(T0, 40).toISOString() }]]);

  console.log(`pricing checks passed: ${n}`);
  await pool.end();
})().catch((e) => { console.error("CRASHED", e); process.exit(2); });
