/**
 * Account pricing terms (owner, 2026-10-08): the founding price helper, the
 * price snapshot, the offer periods, the marks a subscription write applies,
 * the one-time SEO cutover and the boot reconciliation — pure modules and fake
 * query clients only. The real-Postgres run is script/seo-pricing-check.ts.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() }, db: {} }));

import { ACCESS_STATUSES, AGENCY_LOCATION_BANDS, ANNUAL_MONTHS, LEGACY_PLAN_MAP, PLANS, PLAN_KEYS } from "@shared/plans";
import {
  FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT, LEGACY_FOUNDING_PRICE_BOOK,
  FOUNDING_MEMBER_LINE, FOUNDING_OFFER_LINE, foundingPrice, isFoundingMember, parseFoundingPrices, priceSnapshot,
  type AccountPricingTerms, type FoundingPrices,
} from "@shared/pricing-terms";
import {
  FOUNDING_CUTOVER_STATUSES, FOUNDING_OFFER_KEY, IN_OFFER_PERIOD_SQL, KNOWN_PLAN_KEYS, OFFER_PERIODS_SQL, OFFER_TIME_RE,
  PRICING_TERMS_DDL, PRICING_TERMS_TABLES, RECONCILE_FOUNDING_SQL, RECONCILE_SEO_SQL, SEO_CUTOVER_KEY, SEO_CUTOVER_SQL,
  ensurePricingTermsSchema, foundingOfferOpen, nextOfferValue, noteFoundingMember, noteSeoGrandfathering, noteSubscriptionTerms,
  offerOpenOf, offerPeriodsOf, periodContains, reconcilePricingTerms, runSeoAgencyOnlyCutover, setFoundingOffer,
} from "./pricing-terms";
import { STRIPE_ENDED_STATUSES } from "../entitlements";

const snapshotAt = (iso: string) => priceSnapshot(new Date(iso));
const member = (prices: unknown, at: Date | string | null = "2026-10-08T12:00:00Z"): AccountPricingTerms =>
  ({ seoGrandfatheredAt: null, seoGrandfatheredPlan: null, foundingMemberAt: at, foundingPrices: prices as FoundingPrices | null });
const T = (iso: string) => new Date(iso);

// A start on the five-plan book: the boundary is the deploy time, so derive it rather than assume a date.
const AFTER_BOUNDARY = new Date(Date.parse(FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT) + 12 * 3_600_000).toISOString();
describe("the price snapshot a founding member keeps", () => {
  it("copies every plan's two prices and the Agency bands from the price book, with the time it was taken", () => {
    const snap = snapshotAt(AFTER_BOUNDARY);
    for (const key of PLAN_KEYS) expect(snap.plans[key]).toEqual({ monthlyCents: PLANS[key].monthlyCents, annualCents: PLANS[key].annualCents });
    expect(snap.agencyBands).toEqual(AGENCY_LOCATION_BANDS.map((b) => ({ upTo: b.upTo, centsPerLocation: b.centsPerLocation })));
    // Everything an Agency location charge is computed from (server/billing/prices.ts agencyLocationTiers).
    expect(snap.agencyIncludedLocations).toBe(PLANS.agency.limits.locations);
    expect(snap.annualMonths).toBe(ANNUAL_MONTHS);
    expect(snap.capturedAt).toBe(AFTER_BOUNDARY);
    // A copy, not a reference: the stored row cannot follow a later edit of PLANS.
    expect(snap.plans.starter).not.toBe(PLANS.starter);
    expect(parseFoundingPrices(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it("locks the complete four-plan book immediately before the UTC boundary, including legacy bands", () => {
    const snap = snapshotAt("2026-10-08T23:59:59.999Z");
    expect(snap.plans).toEqual({
      starter: { monthlyCents: 2900, annualCents: 29000 },
      pro: { monthlyCents: 7900, annualCents: 79000 },
      growth: { monthlyCents: 19900, annualCents: 199000 },
      agency: { monthlyCents: 34900, annualCents: 349000 },
    });
    expect(snap.agencyIncludedLocations).toBe(10);
    expect(snap.annualMonths).toBe(10);
    expect(snap.agencyBands).toEqual([
      { upTo: 10, centsPerLocation: 0 }, { upTo: 50, centsPerLocation: 1500 },
      { upTo: 250, centsPerLocation: 1000 }, { upTo: 500, centsPerLocation: 700 },
    ]);
    expect(parseFoundingPrices(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    expect(foundingPrice(member(snap), "pro", "month")).toBe(7900);
    expect(foundingPrice(member(snap), "pro", "year")).toBe(79000);
    // Team did not exist in this book; it falls back to the current price.
    expect(foundingPrice(member(snap), "team", "month")).toBe(4900);
    expect(Object.isFrozen(LEGACY_FOUNDING_PRICE_BOOK.plans.pro)).toBe(true);
    snap.plans.pro.monthlyCents = 1;
    snap.agencyBands[1].centsPerLocation = 1;
    expect(snapshotAt("2026-10-08T23:59:59.999Z").plans.pro.monthlyCents).toBe(7900);
    expect(snapshotAt("2026-10-08T23:59:59.999Z").agencyBands[1].centsPerLocation).toBe(1500);
  });

  it("uses the five-plan book at the inclusive cutover boundary", () => {
    const snap = snapshotAt(FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT);
    expect(snap.plans.pro).toEqual({ monthlyCents: 9900, annualCents: PLANS.pro.annualCents });
    expect(snap.plans.team).toEqual({ monthlyCents: 4900, annualCents: PLANS.team.annualCents });
    expect(snap.plans.agency).toEqual({ monthlyCents: 44900, annualCents: PLANS.agency.annualCents });
    expect(snap.agencyIncludedLocations).toBe(-1);
  });

  it("reads only a well-formed stored value", () => {
    expect(parseFoundingPrices(null)).toBeNull();
    expect(parseFoundingPrices("{}")).toBeNull();
    expect(parseFoundingPrices({ plans: { starter: { monthlyCents: 1, annualCents: 2 } } })).toBeNull(); // a plan missing
    expect(parseFoundingPrices({ ...snapshotAt("2026-10-08T12:00:00Z"), agencyBands: [{ upTo: 0, centsPerLocation: 1 }] })).toBeNull();
    const base = snapshotAt("2026-10-08T12:00:00Z");
    const noBands = parseFoundingPrices({ plans: base.plans, agencyIncludedLocations: 10, annualMonths: 10 });
    expect(noBands?.agencyBands).toEqual([]);
    expect(noBands?.capturedAt).toBe("");
    // The Agency charge inputs are part of the promise: a snapshot without them is not one.
    expect(parseFoundingPrices({ plans: base.plans, agencyBands: base.agencyBands })).toBeNull();
    expect(parseFoundingPrices({ ...base, annualMonths: 0 })).toBeNull();
    expect(parseFoundingPrices({ ...base, agencyIncludedLocations: "ten" })).toBeNull();
  });
});

describe("foundingPrice(terms, plan, interval)", () => {
  it("reads the price book without terms, or for an account that is not a founding member", () => {
    expect(foundingPrice(null, "starter", "month")).toBe(PLANS.starter.monthlyCents);
    expect(foundingPrice(undefined, "agency", "year")).toBe(PLANS.agency.annualCents);
    // Prices stored but never marked: the mark is what counts.
    expect(foundingPrice(member({ ...snapshotAt("2026-01-01T00:00:00Z"), plans: { ...snapshotAt("2026-01-01T00:00:00Z").plans, pro: { monthlyCents: 1, annualCents: 2 } } }, null), "pro", "month")).toBe(PLANS.pro.monthlyCents);
    expect(isFoundingMember(member(null, null))).toBe(false);
  });

  it("a founding member pays the snapshot's price whatever the price book says now, monthly and yearly", () => {
    const snap = snapshotAt("2026-10-08T12:00:00Z");
    snap.plans.pro = { monthlyCents: 5900, annualCents: 59000 };   // "the old price", kept
    snap.plans.agency = { monthlyCents: 29900, annualCents: 299000 };
    const terms = member(snap);
    expect(isFoundingMember(terms)).toBe(true);
    expect(foundingPrice(terms, "pro", "month")).toBe(5900);
    expect(foundingPrice(terms, "pro", "year")).toBe(59000);
    expect(foundingPrice(terms, "agency", "month")).toBe(29900);
    expect(foundingPrice(terms, "starter", "month")).toBe(PLANS.starter.monthlyCents); // unchanged in the snapshot
    expect(foundingPrice(terms, "pro", "month")).not.toBe(PLANS.pro.monthlyCents);
  });

  it("falls back to the price book when the stored snapshot is unreadable, and refuses an unknown plan", () => {
    expect(foundingPrice(member({ plans: "nope" }), "growth", "month")).toBe(PLANS.growth.monthlyCents);
    expect(() => foundingPrice(null, "platinum" as any, "month")).toThrow(/Unknown plan/);
  });
});

describe("public wording", () => {
  it("names no count, no limit and no deadline", () => {
    for (const line of [FOUNDING_OFFER_LINE, FOUNDING_MEMBER_LINE]) {
      expect(line).not.toMatch(/\d/);
      expect(line).not.toMatch(/limited|first \w+|spots|places|seats|until|deadline|ends/i);
    }
    expect(FOUNDING_OFFER_LINE).toMatch(/while the offer is open/);
    expect(FOUNDING_OFFER_LINE).toMatch(/locked in for life/);
    expect(FOUNDING_MEMBER_LINE).toMatch(/price is locked/);
  });
});

describe("the offer's open periods (pure)", () => {
  it("no row = open since the beginning; a legacy { open: false } without periods = never open", () => {
    expect(offerPeriodsOf(null)).toEqual([{ from: null, to: null }]);
    expect(offerPeriodsOf(undefined)).toEqual([{ from: null, to: null }]);
    expect(offerOpenOf(null)).toBe(true);
    expect(offerPeriodsOf({ open: false })).toEqual([]);
    expect(offerOpenOf({ open: false })).toBe(false);
    expect(offerPeriodsOf({ open: true })).toEqual([{ from: null, to: null }]);
    // An entry whose boundary is neither null nor an OFFER_TIME_RE string is ignored; the rest are read as written.
    expect(offerPeriodsOf({ periods: [{ from: null, to: "2026-10-09T00:00:00Z" }, { from: "nope", to: null }, { to: null }, { from: 1, to: null }, { from: "2026-10-10T00:00:00.000Z", to: null }] }))
      .toEqual([{ from: null, to: "2026-10-09T00:00:00Z" }, { from: "2026-10-10T00:00:00.000Z", to: null }]);
    expect(OFFER_TIME_RE.test(new Date().toISOString())).toBe(true);
    expect(OFFER_TIME_RE.test("2026-10-09 00:00:00")).toBe(false);
  });

  it("SQL reads a stored value by the same rule (script/seo-pricing-check.ts feeds both sides the same values)", () => {
    expect(OFFER_PERIODS_SQL).toMatch(/CASE WHEN jsonb_typeof\(value->'periods'\) = 'array' THEN value->'periods'\s*WHEN value->>'open' = 'false' THEN '\[\]'::jsonb\s*ELSE '\[\{"from":null,"to":null\}\]'::jsonb END/);
    expect(OFFER_PERIODS_SQL).toMatch(/, '\[\{"from":null,"to":null\}\]'::jsonb\)$/);
    const sql = IN_OFFER_PERIOD_SQL("$3::timestamptz");
    expect(sql).toContain(OFFER_PERIODS_SQL);
    // A malformed boundary makes the entry ignored (never cast), as offerPeriodsOf ignores it.
    expect(sql).toMatch(/per->'from' = 'null'::jsonb OR \(jsonb_typeof\(per->'from'\) = 'string' AND per->>'from' ~ '\^\[0-9\]\{4\}/);
    expect(sql).toMatch(/CASE WHEN jsonb_typeof\(per->'to'\) = 'string' AND per->>'to' ~ '[^']+' THEN \(per->>'to'\)::timestamptz END\)\)/);
    expect(sql).toMatch(/\(per->'from' = 'null'::jsonb OR \(CASE WHEN [^)]+\) = 'string' AND per->>'from' ~ '[^']+' THEN \(per->>'from'\)::timestamptz END\) <= \$3::timestamptz\)/);
  });

  it("closing ends the open period now; reopening starts a new one; repeating a state changes nothing", () => {
    const closed = nextOfferValue(null, false, T("2026-10-09T00:00:00Z"));
    expect(closed).toEqual({ open: false, periods: [{ from: null, to: "2026-10-09T00:00:00.000Z" }] });
    expect(nextOfferValue(closed, false, T("2026-10-09T01:00:00Z"))).toEqual(closed);
    const reopened = nextOfferValue(closed, true, T("2026-10-10T00:00:00Z"));
    expect(reopened).toEqual({ open: true, periods: [{ from: null, to: "2026-10-09T00:00:00.000Z" }, { from: "2026-10-10T00:00:00.000Z", to: null }] });
    expect(nextOfferValue(reopened, true, T("2026-10-11T00:00:00Z"))).toEqual(reopened);
    expect(nextOfferValue(reopened, false, T("2026-10-12T00:00:00Z")).periods[1]).toEqual({ from: "2026-10-10T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z" });
    expect(offerOpenOf(reopened)).toBe(true);
    expect(offerOpenOf(nextOfferValue(reopened, false))).toBe(false);
  });

  it("a moment qualifies when it falls inside any period (start inclusive, end exclusive)", () => {
    const periods = nextOfferValue(nextOfferValue(null, false, T("2026-10-09T00:00:00Z")), true, T("2026-10-10T00:00:00Z")).periods;
    expect(periodContains(periods, T("2026-10-08T00:00:00Z"))).toBe(true);     // open from the beginning
    expect(periodContains(periods, T("2026-10-09T00:00:00Z"))).toBe(false);    // the close itself
    expect(periodContains(periods, T("2026-10-09T12:00:00Z"))).toBe(false);    // the closed stretch
    expect(periodContains(periods, T("2026-10-10T00:00:00Z"))).toBe(true);     // the reopen itself
    expect(periodContains(periods, T("2030-01-01T00:00:00Z"))).toBe(true);     // still open
    expect(periodContains([], T("2026-10-08T00:00:00Z"))).toBe(false);
  });
});

type Call = { text: string; values: unknown[] };
/** A fake query client: records every call and answers from `answer`. */
function fakeQ(answer: (text: string, values: unknown[]) => { rows: any[]; rowCount?: number } = () => ({ rows: [] })) {
  const calls: Call[] = [];
  return {
    calls,
    query: async (text: string, values: unknown[] = []) => { calls.push({ text, values }); return answer(text, values); },
    release() {},
  };
}
const connectable = (q: ReturnType<typeof fakeQ>) => ({ connect: async () => q, query: q.query });

describe("the founding member mark (noteFoundingMember)", () => {
  it("marks an active or trialing Stripe subscription whose START date is in an open period — one statement, guarded by the periods and the existing mark", async () => {
    for (const status of ACCESS_STATUSES) {
      const q = fakeQ(() => ({ rows: [{ user_id: 7 }] }));
      expect(await noteFoundingMember(7, status, "sub_1", T("2026-10-08T10:00:00Z"), q, T("2026-10-08T12:00:00Z"))).toBe(true);
      expect(q.calls).toHaveLength(1);
      const [{ text, values }] = q.calls;
      expect(text).toMatch(/INSERT INTO account_pricing_terms \(user_id, founding_member_at, founding_prices\)/);
      // The period check reads the stored periods against the START date, not now(), with the one shared reading rule.
      expect(text).toContain(IN_OFFER_PERIOD_SQL("$3::timestamptz"));
      expect(text).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/);
      expect(text).toMatch(/WHERE account_pricing_terms\.founding_member_at IS NULL/);
      expect(values[0]).toBe(7);
      expect(JSON.parse(values[1] as string)).toEqual(snapshotAt("2026-10-08T10:00:00Z"));
      expect(values[2]).toEqual(T("2026-10-08T10:00:00Z"));
    }
  });

  it.each([
    ["2026-10-08T23:59:59.000Z", 7900],
    [FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT, 9900],
    ["2026-10-10T00:00:00.000Z", 9900],
  ])("locks the checkout/start book for %s when the first successful write happens later", async (start, cents) => {
    const q = fakeQ(() => ({ rows: [{ user_id: 7 }] }));
    await noteFoundingMember(7, "active", "sub_1", T(start), q, T("2026-10-15T00:00:00Z"));
    const snapshot = JSON.parse(q.calls[0].values[1] as string);
    expect(snapshot.capturedAt).toBe(start);
    expect(foundingPrice(member(snapshot), "pro", "month")).toBe(cents);
    expect(foundingPrice(member(snapshot), "pro", "year")).toBe(cents * (T(start) < T(FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT) ? LEGACY_FOUNDING_PRICE_BOOK.annualMonths : ANNUAL_MONTHS));
  });

  it("preserves an existing snapshot on conflicts, including one stored before the membership mark", async () => {
    const q = fakeQ();
    await noteFoundingMember(7, "active", "sub_retry", T("2026-10-10T00:00:00Z"), q);
    expect(q.calls[0].text).toContain("founding_prices = COALESCE(account_pricing_terms.founding_prices, EXCLUDED.founding_prices)");
    expect(q.calls[0].text).toContain("WHERE account_pricing_terms.founding_member_at IS NULL");
    // Reading an existing row never re-snapshots it, even after changing away and back.
    const stored = member(snapshotAt("2026-10-08T12:00:00Z"));
    const before = JSON.stringify(stored);
    expect(foundingPrice(stored, "agency", "month")).toBe(34900);
    expect(foundingPrice(stored, "pro", "month")).toBe(7900);
    expect(JSON.stringify(stored)).toBe(before);
  });

  it("without a start date the processing time stands in", async () => {
    const q = fakeQ(() => ({ rows: [{ user_id: 7 }] }));
    await noteFoundingMember(7, "active", "sub_1", null, q, T("2026-10-08T12:00:00Z"));
    expect(q.calls[0].values[2]).toEqual(T("2026-10-08T12:00:00Z"));
  });

  it("says false (nothing marked) when the statement wrote nothing: already a member, or the start date is in no open period", async () => {
    const q = fakeQ(() => ({ rows: [] }));
    expect(await noteFoundingMember(7, "active", "sub_1", T("2026-10-08T10:00:00Z"), q)).toBe(false);
    expect(q.calls).toHaveLength(1);
  });

  it("never marks without a Stripe subscription (trial codes, admin grants) or on a status without access", async () => {
    for (const [status, sub] of [["active", null], ["trialing", undefined], ["active", ""], ["past_due", "sub_1"], ["unpaid", "sub_1"], ["canceled", "sub_1"], ["incomplete", "sub_1"], [null, "sub_1"]] as const) {
      const q = fakeQ();
      expect(await noteFoundingMember(7, status, sub, T("2026-10-08T10:00:00Z"), q), `${status} ${sub}`).toBe(false);
      expect(q.calls).toHaveLength(0);
    }
    const q = fakeQ();
    expect(await noteFoundingMember(0, "active", "sub_1", T("2026-10-08T10:00:00Z"), q)).toBe(false);
    expect(q.calls).toHaveLength(0);
  });
});

describe("late SEO grandfathering (noteSeoGrandfathering)", () => {
  it("grandfathers a live Stripe subscription that started before the cutover's ranAt, once, keeping any existing mark", async () => {
    const q = fakeQ(() => ({ rows: [{ user_id: 7 }] }));
    expect(await noteSeoGrandfathering(7, "past_due", "sub_1", "starter", T("2026-10-08T10:00:00Z"), q)).toBe(true);
    const [{ text, values }] = q.calls;
    expect(text).toMatch(/INSERT INTO account_pricing_terms \(user_id, seo_grandfathered_at, seo_grandfathered_plan\)/);
    expect(text).toMatch(/WHERE \$3::timestamptz < \(SELECT \(value->>'ranAt'\)::timestamptz FROM pricing_settings WHERE key = \$4\)/);
    expect(text).toMatch(/seo_grandfathered_at = COALESCE\(account_pricing_terms\.seo_grandfathered_at, EXCLUDED\.seo_grandfathered_at\)/);
    expect(text).toMatch(/WHERE account_pricing_terms\.seo_grandfathered_at IS NULL/);
    // A legacy price without a plan in the write falls back to the stored row's plan ($2 is what SUBSCRIPTION_ORDER reads).
    expect(text).toMatch(/COALESCE\(\$5::text, \(SELECT x\.plan FROM subscriptions x WHERE x\.user_id = \$1 ORDER BY \(x\.status = ANY\(\$2::text\[\]\)\)/);
    expect(values).toEqual([7, ACCESS_STATUSES, T("2026-10-08T10:00:00Z"), SEO_CUTOVER_KEY, "starter"]);
  });

  it("never for an ended subscription, a grant, or without a start date", async () => {
    for (const [status, sub, started] of [["canceled", "sub_1", T("2026-10-08T10:00:00Z")], ["incomplete_expired", "sub_1", T("2026-10-08T10:00:00Z")], ["active", null, T("2026-10-08T10:00:00Z")], ["active", "sub_1", null]] as const) {
      const q = fakeQ();
      expect(await noteSeoGrandfathering(7, status, sub, "pro", started, q), `${status} ${sub} ${started}`).toBe(false);
      expect(q.calls).toHaveLength(0);
    }
  });

  it("noteSubscriptionTerms applies both rules for one write", async () => {
    const q = fakeQ((text) => ({ rows: /seo_grandfathered_plan\)/.test(text) ? [{ user_id: 7 }] : [] }));
    expect(await noteSubscriptionTerms(7, { status: "active", stripeSubscriptionId: "sub_1", plan: "pro" }, T("2026-10-08T10:00:00Z"), q)).toEqual({ grandfathered: true, founding: false });
    expect(q.calls).toHaveLength(2);
  });
});

describe("the founding offer switch", () => {
  it("reads open without a row, from the periods with one", async () => {
    expect(await foundingOfferOpen(fakeQ(() => ({ rows: [] })))).toBe(true);
    expect(await foundingOfferOpen(fakeQ(() => ({ rows: [{ value: { open: true, periods: [{ from: null, to: null }] } }] })))).toBe(true);
    expect(await foundingOfferOpen(fakeQ(() => ({ rows: [{ value: { open: false, periods: [{ from: null, to: "2026-10-09T00:00:00.000Z" }] } }] })))).toBe(false);
    expect(await foundingOfferOpen(fakeQ(() => ({ rows: [{ value: { open: false } }] })))).toBe(false);
  });

  it("closes and reopens under a lock, rewriting the periods and recording who did it", async () => {
    const q = fakeQ((text) => ({ rows: /SELECT value FROM pricing_settings/.test(text) ? [{ value: { open: true, periods: [{ from: null, to: null }] } }] : [] }));
    const out = await setFoundingOffer(false, 42, connectable(q), T("2026-10-09T00:00:00Z"));
    expect(out).toEqual({ open: false, periods: [{ from: null, to: "2026-10-09T00:00:00.000Z" }] });
    const texts = q.calls.map((c) => c.text.trim());
    expect(texts[0]).toBe("BEGIN");
    expect(texts[1]).toBe("SELECT pg_advisory_xact_lock($1)");
    expect(texts[2]).toMatch(/SELECT value FROM pricing_settings WHERE key = \$1/);
    expect(texts[3]).toMatch(/INSERT INTO pricing_settings \(key, value, updated_by\)/);
    expect(texts[3]).toMatch(/ON CONFLICT \(key\) DO UPDATE SET value = EXCLUDED\.value, updated_by = EXCLUDED\.updated_by, updated_at = now\(\)/);
    expect(q.calls[3].values).toEqual([FOUNDING_OFFER_KEY, JSON.stringify(out), 42]);
    expect(texts[4]).toBe("COMMIT");
  });

  it("rolls back on a failure", async () => {
    const q = fakeQ((text) => { if (/INSERT INTO pricing_settings/.test(text)) throw new Error("boom"); return { rows: [] }; });
    await expect(setFoundingOffer(true, 42, connectable(q))).rejects.toThrow("boom");
    expect(q.calls.at(-1)?.text).toBe("ROLLBACK");
  });
});

describe("the one-time SEO cutover", () => {
  it("selects the deciding row of every account, keeps the ones that are not over, and makes only the Stripe ones founding members", () => {
    expect(KNOWN_PLAN_KEYS).toEqual([...PLAN_KEYS, ...Object.keys(LEGACY_PLAN_MAP)]);
    expect(SEO_CUTOVER_SQL).toMatch(/ORDER BY \(x\.status = ANY\(\$2::text\[\]\)\) DESC, x\.id DESC LIMIT 1/);
    expect(SEO_CUTOVER_SQL).toMatch(/s\.plan = ANY\(\$3::text\[\]\)/);
    // Stripe: not ended (past_due and the other payment-needed statuses stay in), started before this transaction (or not synced yet).
    expect(SEO_CUTOVER_SQL).toMatch(/s\.stripe_subscription_id IS NOT NULL AND NOT \(s\.status = ANY\(\$4::text\[\]\)\) AND \(s\.start_date IS NULL OR s\.start_date < \$6::timestamptz\)/);
    // Grant: has access and has not run out.
    expect(SEO_CUTOVER_SQL).toMatch(/s\.stripe_subscription_id IS NULL AND s\.status = ANY\(\$2::text\[\]\) AND \(s\.current_period_end IS NULL OR s\.current_period_end > \$6::timestamptz\)/);
    // Every kept row is grandfathered; the founding mark and its snapshot only for a paying Stripe subscription.
    expect(FOUNDING_CUTOVER_STATUSES).toEqual(["active", "trialing", "past_due"]);
    expect(SEO_CUTOVER_SQL).toMatch(/SELECT u\.id, \$6::timestamptz, s\.plan,\s*CASE WHEN s\.stripe_subscription_id IS NOT NULL AND s\.status = ANY\(\$5::text\[\]\) THEN \$6::timestamptz END,\s*CASE WHEN s\.stripe_subscription_id IS NOT NULL AND s\.status = ANY\(\$5::text\[\]\) THEN/);
    expect(SEO_CUTOVER_SQL).toMatch(/seo_grandfathered_at = COALESCE\(account_pricing_terms\.seo_grandfathered_at, EXCLUDED\.seo_grandfathered_at\)/);
    expect(SEO_CUTOVER_SQL).toMatch(/founding_member_at = COALESCE\(account_pricing_terms\.founding_member_at, EXCLUDED\.founding_member_at\)/);
  });

  it("runs once: the DDL and the cutover in one transaction under the advisory lock, ranAt taken from the database inside it, then the marker", async () => {
    const q = fakeQ((text) => /INSERT INTO account_pricing_terms/.test(text) ? { rows: [], rowCount: 3 }
      : /SELECT now\(\) AS ran_at/.test(text) ? { rows: [{ ran_at: T("2026-10-08T12:00:00Z") }] } : { rows: [] });
    const out = await runSeoAgencyOnlyCutover(connectable(q));
    expect(out).toEqual({ ran: true, grandfathered: 3 });
    const texts = q.calls.map((c) => c.text.trim());
    expect(texts[0]).toBe("BEGIN");
    expect(texts[1]).toMatch(/pg_advisory_xact_lock/);
    expect(texts.slice(2, 2 + PRICING_TERMS_DDL.length)).toEqual(PRICING_TERMS_DDL.map((s) => s.trim()));
    const at = 2 + PRICING_TERMS_DDL.length;
    expect(texts[at]).toMatch(/SELECT 1 FROM pricing_settings WHERE key = \$1/);
    expect(q.calls[at].values).toEqual([SEO_CUTOVER_KEY]);
    // The boundary is the transaction's own clock, read after the lock — the snapshot and the marker carry it.
    expect(texts[at + 1]).toBe("SELECT now() AS ran_at");
    expect(texts[at + 2]).toBe(SEO_CUTOVER_SQL.trim());
    expect(q.calls[at + 2].values).toEqual([expect.any(String), ACCESS_STATUSES, KNOWN_PLAN_KEYS, STRIPE_ENDED_STATUSES, FOUNDING_CUTOVER_STATUSES, T("2026-10-08T12:00:00Z")]);
    expect(texts[at + 3]).toMatch(/INSERT INTO pricing_settings \(key, value\)/);
    expect(q.calls[at + 3].values).toEqual([SEO_CUTOVER_KEY, JSON.stringify({ ranAt: "2026-10-08T12:00:00.000Z", grandfathered: 3 })]);
    expect(texts[at + 4]).toBe("COMMIT");
    expect(texts).toHaveLength(at + 5);
  });

  it("does nothing once its marker exists — a later boot, a later sign-up — but still keeps the tables", async () => {
    const q = fakeQ((text) => /SELECT 1 FROM pricing_settings/.test(text) ? { rows: [{ "?column?": 1 }] } : { rows: [] });
    expect(await runSeoAgencyOnlyCutover(connectable(q))).toEqual({ ran: false, grandfathered: 0 });
    const texts = q.calls.map((c) => c.text.trim());
    expect(texts).toEqual(["BEGIN", "SELECT pg_advisory_xact_lock($1)", ...PRICING_TERMS_DDL.map((s) => s.trim()), "SELECT 1 FROM pricing_settings WHERE key = $1", "COMMIT"]);
  });

  it("rolls back and rethrows on a failure, so nothing is half-written and boot does not proceed", async () => {
    const q = fakeQ((text) => {
      if (/INSERT INTO account_pricing_terms/.test(text)) throw new Error("boom");
      return { rows: /SELECT now\(\) AS ran_at/.test(text) ? [{ ran_at: T("2026-10-08T12:00:00Z") }] : [] };
    });
    await expect(runSeoAgencyOnlyCutover(connectable(q))).rejects.toThrow("boom");
    expect(q.calls.at(-1)?.text).toBe("ROLLBACK");
    expect(q.calls.some((c) => /INSERT INTO pricing_settings/.test(c.text))).toBe(false);
  });
});

describe("boot reconciliation", () => {
  it("selects the old or new book per stored start date, independent of the reconciliation clock", async () => {
    const early = fakeQ();
    const late = fakeQ();
    await reconcilePricingTerms(early, T("2026-10-08T12:00:00Z"));
    await reconcilePricingTerms(late, T("2026-11-01T12:00:00Z"));
    expect(late.calls[1]).toEqual(early.calls[1]);
    const { text, values } = late.calls[1];
    expect(text).toContain(`CASE WHEN s.start_date::timestamptz < '${FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT}'::timestamptz`);
    expect(text).toContain("THEN $1::jsonb->'legacy' ELSE $1::jsonb->'current' END");
    expect(text).toContain(`jsonb_build_object('capturedAt', to_char(s.start_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`);
    const books = JSON.parse(values[0] as string);
    expect(books.legacy).toEqual(snapshotAt(new Date(Date.parse(FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT) - 1).toISOString()));
    expect(books.current).toEqual(snapshotAt(FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT));
    expect(foundingPrice(member(books.legacy), "pro", "month")).toBe(7900);
    expect(foundingPrice(member(books.current), "pro", "month")).toBe(9900);
    // Also guard a concurrent webhook winning after the SELECT's NOT EXISTS.
    expect(text).toContain("WHERE account_pricing_terms.founding_member_at IS NULL");
    expect(text).toContain("founding_prices = COALESCE(account_pricing_terms.founding_prices, EXCLUDED.founding_prices)");
  });

  it("uses the same dated books when the one-time SEO cutover first runs after repricing", async () => {
    const q = fakeQ((text) => ({ rows: text === "SELECT now() AS ran_at" ? [{ ran_at: T("2026-10-15T12:00:00Z") }] : [] }));
    await runSeoAgencyOnlyCutover(connectable(q));
    const cutover = q.calls.find((call) => call.text === SEO_CUTOVER_SQL)!;
    const reconciliation = fakeQ();
    await reconcilePricingTerms(reconciliation);
    expect(cutover.values[0]).toEqual(reconciliation.calls[1].values[0]);
    expect(cutover.text).toContain(`CASE WHEN COALESCE(s.start_date::timestamptz, '${FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT}'::timestamptz - interval '1 millisecond') < '${FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT}'::timestamptz`);
    // An existing subscriber with no stored start date is dated before the boundary: the four-plan book.
    expect(cutover.text).not.toContain("COALESCE(s.start_date::timestamptz, $6::timestamptz)");
    expect(cutover.text).toContain("THEN $1::jsonb->'legacy' ELSE $1::jsonb->'current' END");
    expect(cutover.text).toContain("founding_prices = COALESCE(account_pricing_terms.founding_prices, EXCLUDED.founding_prices)");
  });

  it("applies the two start-date rules from the stored subscriptions, leaving existing marks alone", async () => {
    expect(RECONCILE_SEO_SQL).toMatch(/s\.stripe_subscription_id IS NOT NULL AND NOT \(s\.status = ANY\(\$3::text\[\]\)\) AND s\.plan = ANY\(\$1::text\[\]\)/);
    expect(RECONCILE_SEO_SQL).toMatch(/s\.start_date IS NOT NULL/);
    expect(RECONCILE_SEO_SQL).toMatch(/s\.start_date < \(SELECT \(value->>'ranAt'\)::timestamptz FROM pricing_settings WHERE key = \$4\)/);
    expect(RECONCILE_SEO_SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM account_pricing_terms t WHERE t\.user_id = u\.id AND t\.seo_grandfathered_at IS NOT NULL\)/);
    expect(RECONCILE_FOUNDING_SQL).toMatch(/s\.stripe_subscription_id IS NOT NULL AND s\.status = ANY\(\$2::text\[\]\)/);
    expect(RECONCILE_FOUNDING_SQL).toContain(IN_OFFER_PERIOD_SQL("s.start_date::timestamptz"));
    expect(RECONCILE_FOUNDING_SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM account_pricing_terms t WHERE t\.user_id = u\.id AND t\.founding_member_at IS NOT NULL\)/);
    const q = fakeQ((text) => ({ rows: [], rowCount: /seo_grandfathered_plan\)/.test(text) ? 2 : 1 }));
    expect(await reconcilePricingTerms(q, T("2026-10-08T12:00:00Z"))).toEqual({ grandfathered: 2, founding: 1 });
    expect(q.calls[0].values).toEqual([KNOWN_PLAN_KEYS, ACCESS_STATUSES, STRIPE_ENDED_STATUSES, SEO_CUTOVER_KEY]);
    expect(q.calls[1].values).toEqual([expect.any(String), ACCESS_STATUSES]);
  });
});

describe("schema", () => {
  it("creates the two tables as specified, only when they are missing (the script path; boot creates them inside the cutover)", async () => {
    expect(PRICING_TERMS_TABLES).toEqual(["account_pricing_terms", "pricing_settings"]);
    expect(PRICING_TERMS_DDL[0]).toMatch(/CREATE TABLE IF NOT EXISTS account_pricing_terms \(\s*user_id integer PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE,\s*seo_grandfathered_at timestamptz,\s*seo_grandfathered_plan text,\s*founding_member_at timestamptz,\s*founding_prices jsonb,\s*updated_at timestamptz NOT NULL DEFAULT now\(\)\s*\)/);
    expect(PRICING_TERMS_DDL[1]).toMatch(/CREATE TABLE IF NOT EXISTS pricing_settings \(\s*key text PRIMARY KEY,\s*value jsonb NOT NULL,\s*updated_at timestamptz NOT NULL DEFAULT now\(\),\s*updated_by integer\s*\)/);
    const present = fakeQ(() => ({ rows: [{}, {}] }));
    await ensurePricingTermsSchema(present);
    expect(present.calls).toHaveLength(1);
    expect(present.calls[0].text).toMatch(/information_schema\.tables/);
    const missing = fakeQ(() => ({ rows: [{}] }));
    await ensurePricingTermsSchema(missing);
    expect(missing.calls.slice(1).map((c) => c.text)).toEqual([...PRICING_TERMS_DDL]);
  });
});
