/**
 * Client self-estimate ("Curious what a roof replacement would cost?").
 *
 * Part 1 is pure math/config (shared/self-estimate.ts + the server helpers) —
 * no server needed.
 *
 * Part 2 runs against a dev server like engagement.test.ts:
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=<lane> npx tsx server/index.ts
 * inside its OWN throwaway org (FL + WA divisions), deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "crypto";
import pg from "pg";
import {
  computeBallpark, detectBidTrades, divisionConfigOf, normalizeDivisionConfig, summarizeInterest, interestBadgeText,
  selfEstimateSelectionSchema, selfEstimateDivisionConfigSchema, starterTradeConfig, NO_MEASUREMENTS, ballparkWithinLimits,
  type PricedSelfEstimate, type MeasuredQuantities, type PricedTrade,
} from "@shared/self-estimate";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

let pbUnitPriceFor: any, draftLinesFor: any, discountSourceOf: any, measuredFromTakeoff: any, oneLine: any, taskBodyText: any;
beforeAll(async () => {
  ({ pbUnitPriceFor, draftLinesFor, discountSourceOf, oneLine, taskBodyText } = await import("./self-estimate"));
  ({ measuredFromTakeoff } = await import("./self-estimate-measurements"));
});

// The example job from the owner brief: siding 2169 ft² → 2200; roof 2303 → 2418 at 5%; 9 windows; 4 doors.
const TAKEOFF = {
  siding: { areaSqft: 2169, quantitySqft: 2200 },
  roof: { areaSqft: 2303, wastePct: 5, quantitySqft: 2418, squares: 24.18, predominantPitch: "6/12" },
  footprint: { areaSqft: 1650, perimeterFt: 182.4, stories: 2 },
  windows: Array.from({ length: 9 }, (_, i) => ({ opening: `W${i + 1}`, widthIn: 36, heightIn: 60, unitedInches: 96, areaSqft: 15 })),
  doors: Array.from({ length: 4 }, (_, i) => ({ opening: `D${i + 1}`, widthIn: 36, heightIn: 80, areaSqft: 20 })),
  counts: { windows: 9, doors: 4 },
};

const trade = (t: Partial<PricedTrade> & Pick<PricedTrade, "trade" | "unit" | "products">): PricedTrade => ({
  label: t.trade[0].toUpperCase() + t.trade.slice(1), prompt: "", blurb: "",
  minimumCents: null, extraLayerCents: null, guttersPerLfCents: null, houseSqftFactorBps: null,
  quotable: t.products.some((p) => p.unitPriceCents), ...t,
});
const P = (id: string, name: string, unitPriceCents: number | null) => ({ id, name, description: null, photoUrl: null, unitPriceCents });

const PRICED: PricedSelfEstimate = {
  rangeBps: 1000,
  disclaimer: "Ballpark only — final price after inspection.",
  discounts: [
    { code: "military", label: "Military discount", percentBps: 200, conditions: null },
    { code: "pay_in_full", label: "Pay-in-full discount", percentBps: 500, conditions: null },
  ],
  trades: [
    trade({ trade: "siding", unit: "sqft", products: [P("hardie-lap", "Hardie lap", 500), P("vinyl", "Vinyl", null)] }),
    trade({ trade: "roofing", unit: "square", products: [P("gaf-hdz", "GAF HDZ", 45_000), P("metal", "Metal roofing", null)], extraLayerCents: 5_000, guttersPerLfCents: 1_200 }),
    trade({ trade: "windows", unit: "window", products: [P("pgt", "PGT", 95_000)], minimumCents: 500_000 }),
    trade({ trade: "doors", unit: "door", products: [P("entry", "Entry door", 210_000)] }),
  ],
};

describe("measurements adapter", () => {
  it("maps the HOVER takeoff to the quantities the math prices from", () => {
    const m: MeasuredQuantities = measuredFromTakeoff(TAKEOFF);
    expect(m).toMatchObject({ sidingSqft: 2200, roofSqft: 2418, roofAreaSqft: 2303, roofWastePct: 5, windowsCount: 9, doorsCount: 4, perimeterFt: 182.4 });
    expect(measuredFromTakeoff(null)).toEqual(NO_MEASUREMENTS);
  });
});

describe("ballpark math (pure)", () => {
  const m = () => measuredFromTakeoff(TAKEOFF) as MeasuredQuantities;

  it("siding: measured 2,200 ft² × $5.00 = $11,000, ±10% → $9,900–$12,100", () => {
    const bp = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "siding", productId: "hardie-lap" }] }));
    expect(bp.lines[0]).toMatchObject({ quantity: 2200, unitPriceCents: 500, amountCents: 1_100_000, quantitySource: "measured", productName: "Hardie lap" });
    expect(bp.lines[0].basis).toContain("2,200 ft² of siding");
    expect(bp.totalCents).toBe(1_100_000);
    expect(bp.lowCents).toBe(990_000);
    expect(bp.highCents).toBe(1_210_000);
  });

  it("siding portion: about half of 2,200 ft² = 1,100 ft²", () => {
    const bp = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "siding", productId: "hardie-lap", portion: "half" }] }));
    expect(bp.lines[0].quantity).toBe(1100);
    expect(bp.totalCents).toBe(550_000);
  });

  it("roofing prices the takeoff's waste quantity: 2,418 ft² = 24.18 sq × $450 = $10,881", () => {
    const bp = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "roofing", productId: "gaf-hdz" }] }));
    expect(bp.lines[0].quantity).toBe(24.18);
    expect(bp.lines[0].amountCents).toBe(1_088_100);
    expect(bp.lines[0].basis).toContain("2,418 ft² of roof");
    expect(bp.lines[0].basis).toContain("5% waste");
  });

  it("roofing extras: a 2nd layer per square, gutters on the measured perimeter (rounded up)", () => {
    const bp = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "roofing", productId: "gaf-hdz", layers: 2, gutters: true }] }));
    const l = bp.lines[0];
    expect(l.extras.map((x) => x.amountCents)).toEqual([120_900, 183 * 1_200]);
    expect(l.totalCents).toBe(1_088_100 + 120_900 + 219_600);
    // No gutter price configured → no number, an inspection note instead.
    const noGutter = { ...PRICED, trades: PRICED.trades.map((t) => (t.trade === "roofing" ? { ...t, guttersPerLfCents: null, extraLayerCents: null } : t)) };
    const bp2 = computeBallpark(noGutter, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "roofing", productId: "gaf-hdz", layers: 2, gutters: true }] }));
    expect(bp2.lines[0].extras).toEqual([]);
    expect(bp2.lines[0].notes.length).toBe(2);
    expect(bp2.lines[0].totalCents).toBe(1_088_100);
  });

  it("windows: measured count, adjustable by the client", () => {
    const all = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "windows", productId: "pgt" }] }));
    expect(all.lines[0]).toMatchObject({ quantity: 9, amountCents: 855_000, minimumAdjustmentCents: 0 });
    const six = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "windows", productId: "pgt", count: 6 }] }));
    expect(six.lines[0].quantity).toBe(6);
    expect(six.lines[0].basis).toContain("measured 9 windows");
  });

  it("minimum job price lifts a small job to the minimum", () => {
    const bp = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "windows", productId: "pgt", count: 2 }] }));
    expect(bp.lines[0].amountCents).toBe(190_000);
    expect(bp.lines[0].minimumAdjustmentCents).toBe(310_000);
    expect(bp.totalCents).toBe(500_000);
  });

  it("discounts stack additively on the pre-tax subtotal; unknown codes are ignored", () => {
    const bp = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({
      trades: [{ trade: "siding", productId: "hardie-lap" }],
      discountCodes: ["military", "pay_in_full", "made_up_99pct"],
    }));
    expect(bp.discountBps).toBe(700);
    expect(bp.discountCents).toBe(77_000);
    expect(bp.totalCents).toBe(1_023_000);
    expect(bp.discounts.every((d) => d.verified === false)).toBe(true);
    expect(bp.discounts.map((d) => d.code)).toEqual(["military", "pay_in_full"]);
  });

  it("combined discounts are capped at 100%", () => {
    const greedy = { ...PRICED, discounts: [
      { code: "a", label: "A", percentBps: 8000, conditions: null },
      { code: "b", label: "B", percentBps: 8000, conditions: null },
    ] };
    const bp = computeBallpark(greedy, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "doors", productId: "entry" }], discountCodes: ["a", "b"] }));
    expect(bp.discountBps).toBe(10_000);
    expect(bp.totalCents).toBe(0);
    expect(bp.lowCents).toBeNull();
    // Per-discount amounts are scaled to the cap and add up to the applied discount.
    expect(bp.discounts.map((d) => d.amountCents)).toEqual([420_000, 420_000]);
    expect(bp.discounts.reduce((s, d) => s + d.amountCents, 0)).toBe(bp.discountCents);
  });

  it("per-discount amounts always sum to the applied discount (odd cents)", () => {
    const odd = { ...PRICED, discounts: [
      { code: "a", label: "A", percentBps: 7000, conditions: null },
      { code: "b", label: "B", percentBps: 4000, conditions: null },
      { code: "c", label: "C", percentBps: 333, conditions: null },
    ] };
    const sel = selfEstimateSelectionSchema.parse({ trades: [{ trade: "siding", productId: "hardie-lap", clientSize: 1237 }], discountCodes: ["a", "b", "c"] });
    const bp = computeBallpark(odd, NO_MEASUREMENTS, sel);
    expect(bp.discountBps).toBe(10_000);
    expect(bp.discounts.reduce((s, d) => s + d.amountCents, 0)).toBe(bp.discountCents);
    const fine = computeBallpark({ ...odd, discounts: odd.discounts.slice(1) }, NO_MEASUREMENTS, { ...sel, discountCodes: ["b", "c"] });
    expect(fine.discounts.reduce((s, d) => s + d.amountCents, 0)).toBe(fine.discountCents);
  });

  it("sizes that would overflow the money/quantity columns are refused, not truncated", () => {
    const huge = { ...PRICED, trades: PRICED.trades.map((t) => (t.trade === "roofing"
      ? { ...t, houseSqftFactorBps: 100_000, products: [P("gaf-hdz", "GAF HDZ", 100_000_000)] } : t)) };
    const bp = computeBallpark(huge, NO_MEASUREMENTS, selfEstimateSelectionSchema.parse({
      trades: [{ trade: "roofing", productId: "gaf-hdz", clientSize: 100_000, clientSizeKind: "house" }],
    }));
    expect(bp.totalCents).toBeGreaterThan(2_147_483_647);
    expect(ballparkWithinLimits(bp)).toBe(false);
    const normal = computeBallpark(PRICED, measuredFromTakeoff(TAKEOFF), selfEstimateSelectionSchema.parse({ trades: [{ trade: "roofing", productId: "gaf-hdz" }] }));
    expect(ballparkWithinLimits(normal)).toBe(true);
  });

  it("names in email subjects are single-line", () => {
    expect(oneLine("Ann\r\nBcc: evil@example.com x")).toBe("Ann Bcc: evil@example.com x");
  });

  it("task text carries amounts only for seats that see prices", () => {
    const meta = { lowCents: 950_000, highCents: 1_180_000, priced: true, discountLabels: ["Military discount"], draftNumber: "E-9" };
    expect(taskBodyText(meta, true)).toContain("$9,500–$11,800");
    expect(taskBodyText(meta, false)).not.toMatch(/\$|\d{3},\d{3}/);
    expect(taskBodyText(meta, false)).toContain("Military discount");
  });

  it("an unpriced product gives NO number — 'Request a price'", () => {
    const bp = computeBallpark(PRICED, m(), selfEstimateSelectionSchema.parse({ trades: [{ trade: "roofing", productId: "metal" }] }));
    expect(bp.lines).toEqual([]);
    expect(bp.unpriced[0]).toMatchObject({ trade: "roofing", reason: "no_price", productName: "Metal roofing" });
    expect(bp.totalCents).toBe(0);
    expect(bp.lowCents).toBeNull();
    expect(bp.highCents).toBeNull();
  });

  it("no measurements: the client's own size, labelled as theirs; no size → no number", () => {
    const own = computeBallpark(PRICED, NO_MEASUREMENTS, selfEstimateSelectionSchema.parse({ trades: [{ trade: "siding", productId: "hardie-lap", clientSize: 1800 }] }));
    expect(own.lines[0]).toMatchObject({ quantity: 1800, quantitySource: "client" });
    expect(own.lines[0].basis).toMatch(/^Your estimate/);
    const none = computeBallpark(PRICED, NO_MEASUREMENTS, selfEstimateSelectionSchema.parse({ trades: [{ trade: "windows", productId: "pgt" }] }));
    expect(none.unpriced[0].reason).toBe("need_size");
  });

  it("a house size is never converted without the estimator's own factor", () => {
    const sel = selfEstimateSelectionSchema.parse({ trades: [{ trade: "roofing", productId: "gaf-hdz", clientSize: 2000, clientSizeKind: "house" }] });
    expect(computeBallpark(PRICED, NO_MEASUREMENTS, sel).unpriced[0].reason).toBe("need_size");
    const withFactor = { ...PRICED, trades: PRICED.trades.map((t) => (t.trade === "roofing" ? { ...t, houseSqftFactorBps: 12_000 } : t)) };
    const bp = computeBallpark(withFactor, NO_MEASUREMENTS, sel);
    expect(bp.lines[0].quantity).toBe(24); // 2,400 ft² = 24 squares
  });

  it("client-supplied totals are stripped by the schema and never read", () => {
    const sel = selfEstimateSelectionSchema.parse({
      trades: [{ trade: "doors", productId: "entry", count: 1, unitPriceCents: 1, totalCents: 1 }],
      totalCents: 1, lowCents: 1,
    } as any);
    expect(JSON.stringify(sel)).not.toContain("totalCents");
    expect(JSON.stringify(sel)).not.toContain("unitPriceCents");
    expect(computeBallpark(PRICED, NO_MEASUREMENTS, sel).totalCents).toBe(210_000);
  });

  it("a trade the division doesn't offer is reported, not priced", () => {
    const only = { ...PRICED, trades: PRICED.trades.filter((t) => t.trade === "siding") };
    const bp = computeBallpark(only, NO_MEASUREMENTS, selfEstimateSelectionSchema.parse({ trades: [{ trade: "roofing", productId: "gaf-hdz", clientSize: 2000 }] }));
    expect(bp.unpriced[0].reason).toBe("not_offered");
    expect(bp.totalCents).toBe(0);
  });
});

describe("configuration (pure)", () => {
  it("the starter list is product NAMES with empty prices — never a number", () => {
    const cfg = normalizeDivisionConfig(null);
    expect(cfg.enabled).toBe(false);
    expect(cfg.saved).toBe(false);
    expect(cfg.trades.siding.products.map((p) => p.name)).toEqual(["Hardie lap", "Hardie panels", "Hardie shingles", "Vinyl"]);
    expect(cfg.trades.roofing.products.map((p) => p.name)).toEqual(["GAF HDZ", "Metal roofing", "Flat roof"]);
    expect(cfg.trades.windows.products.map((p) => p.name)).toEqual(["PGT", "Silverlite", "CWS"]);
    for (const t of Object.values(cfg.trades)) for (const p of t.products) expect(p.unitPriceCents).toBeNull();
    expect(cfg.trades.siding.minimumCents).toBeNull();
  });

  it("a division reads its OWN prices only — never another division's, never an org fallback", () => {
    const fl = { ...normalizeDivisionConfig(null), enabled: true };
    const cf = { selfEstimate: { divisions: { "fl-id": fl } } };
    expect(divisionConfigOf(cf, "fl-id").enabled).toBe(true);
    expect(divisionConfigOf(cf, "wa-id").enabled).toBe(false);
    expect(divisionConfigOf(cf, "org").enabled).toBe(false);
    expect(divisionConfigOf({ selfEstimate: { divisions: { __proto__: fl } } }, "enabled").enabled).toBe(false);
  });

  it("validation: duplicate product ids and price-book picks without an item are refused", () => {
    const base = normalizeDivisionConfig(null);
    const dup = { ...base, trades: { siding: { ...starterTradeConfig("siding"), products: [
      { ...starterTradeConfig("siding").products[0] }, { ...starterTradeConfig("siding").products[0] },
    ] } } };
    expect(selfEstimateDivisionConfigSchema.safeParse(dup).success).toBe(false);
    const pb = { ...base, trades: { siding: { ...starterTradeConfig("siding"), products: [
      { ...starterTradeConfig("siding").products[0], source: "pricebook", pbItemId: null },
    ] } } };
    expect(selfEstimateDivisionConfigSchema.safeParse(pb).success).toBe(false);
  });

  it("price-book items convert to the trade's canonical unit or stay unpriced", () => {
    const item = (o: any) => ({ active: true, pricingMode: "flat", unit: "ea", flatPriceCents: null, rateCentsPerSqft: null, ...o });
    expect(pbUnitPriceFor("siding", item({ pricingMode: "per_sqft", rateCentsPerSqft: 525 }))).toBe(525);
    expect(pbUnitPriceFor("roofing", item({ pricingMode: "per_sqft", rateCentsPerSqft: 450 }))).toBe(45_000);
    expect(pbUnitPriceFor("roofing", item({ unit: "sq", flatPriceCents: 42_500 }))).toBe(42_500);
    expect(pbUnitPriceFor("windows", item({ unit: "ea", flatPriceCents: 90_000 }))).toBe(90_000);
    expect(pbUnitPriceFor("windows", item({ unit: "sf", flatPriceCents: 90_000 }))).toBeNull();
    expect(pbUnitPriceFor("siding", item({ pricingMode: "computed" }))).toBeNull();
    expect(pbUnitPriceFor("siding", item({ active: false, pricingMode: "per_sqft", rateCentsPerSqft: 525 }))).toBeNull();
  });

  it("discount source: the org's saved Bid discounts, else the discounts.ts presets (0% offers dropped)", () => {
    expect(discountSourceOf({ discountDefaults: [{ code: "senior", label: "Senior", percentBps: 300 }] }))
      .toEqual([{ code: "senior", label: "Senior", percentBps: 300, conditions: null }]);
    const presets = discountSourceOf(null).map((d: any) => d.code);
    expect(presets).toContain("military");
    expect(presets).not.toContain("price_match");
  });
});

describe("trade detection (pure)", () => {
  it("a siding bid with window trim and Hardie shingles is a siding bid only", () => {
    expect([...detectBidTrades(["Hardie lap siding — full house", "Window trim wrap (9)", "Door casing", "Hardie shingles gable accent"])])
      .toEqual(["siding"]);
  });
  it("roofing, windows and doors are recognised", () => {
    expect([...detectBidTrades(["Tear-off and re-roof, GAF HDZ shingles", "Replace 9 vinyl windows", "New entry door"])].sort())
      .toEqual(["doors", "roofing", "windows"]);
  });
});

describe("interest summary (pure)", () => {
  it("counts visits, not clicks; ignores prompt views; flags requests", () => {
    const at = "2026-10-17T15:00:00Z";
    const s = summarizeInterest([
      { type: "interest_prompt_viewed", at, meta: { trades: ["siding"], sessionKey: "s0" } },
      { type: "interest_trade_opened", at: "2026-10-10T10:00:00Z", meta: { trades: ["roofing"], sessionKey: "s1" } },
      { type: "interest_trade_opened", at: "2026-10-12T10:00:00Z", meta: { trades: ["roofing"], sessionKey: "s2" } },
      { type: "interest_trade_opened", at, meta: { trades: ["windows"], sessionKey: "s3" } },
      { type: "interest_ballpark_shown", at, meta: { trades: ["windows"], sessionKey: "s3" } },
    ]);
    expect(s).toMatchObject({ trades: ["roofing", "windows"], explored: 3, requested: false, lastAt: "2026-10-17T15:00:00.000Z" });
    expect(interestBadgeText(s)).toBe("Interested in: Roofing, Windows — explored 3×, last Oct 17");
    expect(interestBadgeText(summarizeInterest([{ type: "interest_prompt_viewed", at, meta: {} }]))).toBeNull();
  });
});

describe("draft lines (pure)", () => {
  it("use the product name + the estimator's unit price; unpriced picks are $0 'price needed' lines", () => {
    const sel = selfEstimateSelectionSchema.parse({ trades: [{ trade: "roofing", productId: "gaf-hdz" }, { trade: "siding", productId: "vinyl" }] });
    const bp = computeBallpark(PRICED, measuredFromTakeoff(TAKEOFF), sel);
    const lines = draftLinesFor(bp, sel, PRICED);
    expect(lines[0]).toMatchObject({ name: "GAF HDZ — roofing", quantityMilli: 24_180, unit: "sq", unitPriceCents: 45_000 });
    expect(lines[1]).toMatchObject({ name: "Vinyl — siding (price needed)", unitPriceCents: 0 });
  });
});

// ── Part 2: against the dev server ──────────────────────────────────────────

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString: process.env.CRM_TEST_DATABASE_URL
    ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
async function clientCookie(customerIds: string[]): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await pool.query(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify(customerIds)],
  );
  return `crm_client=${raw}`;
}
let staffCookie = "";
async function api(method: string, path: string, body?: unknown, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie !== undefined ? (cookie ? { cookie } : {}) : staffCookie ? { cookie: staffCookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (cookie === undefined) staffCookie = res.headers.get("set-cookie")?.split(";")[0] ?? staffCookie;
  return { status: res.status, body: await res.json().catch(() => null) };
}

const org = randomUUID();
const me = randomUUID();
const rep = randomUUID();
const fl = randomUUID();
const wa = randomUUID();
const custA = randomUUID();
const custB = randomUUID();
const estA = randomUUID();
const estB = randomUUID();
const estWa = randomUUID();
const tokA = randomBytes(24).toString("hex");
const tokB = randomBytes(24).toString("hex");
const tokWa = randomBytes(24).toString("hex");
const tag = `se${org.slice(0, 8)}`;
const sessionKey = `sk${randomBytes(8).toString("hex")}`;

let serverUp = false;

describe("self-estimate against the dev server", () => {
  beforeAll(async () => {
    serverUp = await fetch(`${BASE}/api/crm/me`).then(() => true).catch(() => false);
    if (!serverUp) return;
    const q = (s: string, p: unknown[]) => pool.query(s, p);
    await q("insert into crm_orgs(id,name,owner_user_id,custom_fields) values ($1,$2,1,$3)",
      [org, `${tag} Alpine test`, JSON.stringify({ discountDefaults: [
        { code: "military", label: "Military discount", percentBps: 200, conditions: "Military ID required.", enabled: true },
        { code: "pay_in_full", label: "Pay-in-full discount", percentBps: 500, conditions: null, enabled: true },
        { code: "marketing", label: "Marketing discount", percentBps: 100, conditions: null, enabled: true },
      ] })]);
    await q("insert into crm_members(id,org_id,user_id,email,role,status,display_name) values ($1,$2,1,$3,'owner','active','Owner Seat')", [me, org, `${tag}-me@example.invalid`]);
    await q("insert into crm_members(id,org_id,email,role,status,display_name,division_id) values ($1,$2,$3,'sales','active','Rita Rep',$4)", [rep, org, `${tag}-rep@example.invalid`, fl]);
    await q("insert into crm_divisions(id,org_id,name,code) values ($1,$2,'Florida','FL'),($3,$2,'Washington','WA')", [fl, org, wa]);
    await q(`insert into crm_customers(id,org_id,display_name,email,portal_token,address_line1,postal_code)
             values ($1,$2,'Ann Client',$3,$4,'1 Palm St','33101'),($5,$2,'Bob Other',$6,$7,'2 Oak St','98101')`,
      [custA, org, `${tag}-a@example.invalid`, randomBytes(24).toString("hex"), custB, `${tag}-b@example.invalid`, randomBytes(24).toString("hex")]);
    for (const [id, cust, tok, div, num] of [[estA, custA, tokA, fl, "SE-1"], [estB, custB, tokB, fl, "SE-2"], [estWa, custA, tokWa, wa, "SE-3"]]) {
      await q(`insert into crm_estimates(id,org_id,customer_id,public_token,number,title,status,subtotal_cents,total_cents,created_by_member_id,sent_at,division_id)
               values ($1,$2,$3,$4,$5,'Siding replacement','sent',1100000,1100000,$6,now() - interval '1 day',$7)`, [id, org, cust, tok, `${tag}-${num}`, rep, div]);
      await q(`insert into crm_estimate_items(org_id,estimate_id,name,quantity_milli,unit,unit_price_cents) values ($1,$2,'Hardie lap siding — full house',2200000,'sf',500)`, [org, id]);
    }
    // The WA estimate is older, so the portal anchors on the FL one.
    await q("update crm_estimates set sent_at = now() - interval '5 days' where id = $1", [estWa]);
    await q(`insert into crm_measurements(org_id,customer_id,provider,status,address_line1,postal_code,raw_payload)
             values ($1,$2,'hover','ready','1 Palm St','33101',$3)`, [org, custA, JSON.stringify({ takeoff: TAKEOFF })]);

    await api("GET", "/api/crm/me");
    expect((await api("POST", "/api/crm/org/switch", { orgId: org })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    if (serverUp) {
      const { rows } = await pool.query(
        "select table_name from information_schema.columns where column_name='org_id' and table_schema=current_schema() and table_name <> 'crm_orgs'");
      for (const { table_name } of rows) await pool.query(`delete from "${table_name}" where org_id = $1`, [org]).catch(() => {});
      await pool.query("delete from crm_orgs where id=$1", [org]);
      await pool.query("delete from crm_client_sessions where customer_ids ?| $1", [[custA, custB]]).catch(() => {});
    }
    await pool.end();
  }, 60_000);

  it("estimators configure FL prices; the starter list arrives with empty prices", async () => {
    if (!serverUp) return;
    const got = await api("GET", `/api/crm/self-estimate/config?division=${fl}`);
    expect(got.status).toBe(200);
    expect(got.body.divisionKey).toBe(fl);
    expect(got.body.config.trades.roofing.products.every((p: any) => p.unitPriceCents === null)).toBe(true);
    const cfg = got.body.config;
    cfg.enabled = true;
    cfg.discountCodes = ["military", "pay_in_full"];
    cfg.trades.roofing.enabled = true;
    cfg.trades.roofing.products[0].unitPriceCents = 45_000; // GAF HDZ per square; Metal + Flat stay unpriced
    cfg.trades.windows.enabled = true;
    cfg.trades.windows.products[0].unitPriceCents = 95_000;  // PGT per window
    cfg.trades.siding.enabled = true;
    cfg.trades.siding.products[0].unitPriceCents = 500;
    delete cfg.saved;
    const put = await api("PUT", "/api/crm/self-estimate/config", { divisionKey: fl, config: cfg });
    expect(put.status).toBe(200);
    expect(put.body.config.trades.roofing.products[0].unitPriceCents).toBe(45_000);
    // Unknown division → 404; junk config → 400.
    expect((await api("PUT", "/api/crm/self-estimate/config", { divisionKey: randomUUID(), config: cfg })).status).toBe(404);
    expect((await api("PUT", "/api/crm/self-estimate/config", { divisionKey: fl, config: { enabled: true } })).status).toBe(400);
  });

  it("the client page offers the trades NOT on the bid, priced in FL, measured from HOVER", async () => {
    if (!serverUp) return;
    const cookie = await clientCookie([custA]);
    const r = await api("GET", `/api/public/estimates/${tokA}/self-estimate`, undefined, cookie);
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(true);
    expect(r.body.onBid).toEqual(["siding"]);
    expect(r.body.config.trades.map((t: any) => t.trade)).toEqual(["roofing", "windows"]);
    const roof = r.body.config.trades.find((t: any) => t.trade === "roofing");
    expect(roof.products.map((p: any) => [p.name, p.unitPriceCents])).toEqual([["GAF HDZ", 45_000], ["Metal roofing", null], ["Flat roof", null]]);
    expect(r.body.measured).toMatchObject({ roofSqft: 2418, windowsCount: 9 });
    expect(r.body.config.discounts.map((d: any) => d.code)).toEqual(["military", "pay_in_full"]);
  });

  it("is gated like the estimate: no session → 401, another client's session → 401", async () => {
    if (!serverUp) return;
    expect((await api("GET", `/api/public/estimates/${tokA}/self-estimate`, undefined, "")).status).toBe(401);
    const other = await clientCookie([custB]);
    expect((await api("GET", `/api/public/estimates/${tokA}/self-estimate`, undefined, other)).status).toBe(401);
    expect((await api("POST", `/api/public/estimates/${tokA}/self-estimate/quote`, {
      selection: { trades: [{ trade: "roofing", productId: "gaf-hdz" }] }, sessionKey,
    }, other)).status).toBe(401);
  });

  it("a division with nothing configured offers nothing — never another division's prices", async () => {
    if (!serverUp) return;
    const cookie = await clientCookie([custA]);
    const r = await api("GET", `/api/public/estimates/${tokWa}/self-estimate`, undefined, cookie);
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(false);
  });

  it("the server recomputes the ballpark and ignores client totals; logs it once per visit", async () => {
    if (!serverUp) return;
    const cookie = await clientCookie([custA]);
    const body = {
      selection: { trades: [{ trade: "roofing", productId: "gaf-hdz", totalCents: 1 }], discountCodes: ["military", "bogus"], totalCents: 1 },
      sessionKey, lowCents: 1, highCents: 2,
    };
    const r = await api("POST", `/api/public/estimates/${tokA}/self-estimate/quote`, body, cookie);
    expect(r.status).toBe(200);
    expect(r.body.ballpark.subtotalCents).toBe(1_088_100);
    expect(r.body.ballpark.discountCents).toBe(21_762);
    expect(r.body.ballpark.totalCents).toBe(1_066_338);
    expect(r.body.ballpark.lowCents).toBe(950_000);
    expect(r.body.ballpark.highCents).toBe(1_180_000);
    await api("POST", `/api/public/estimates/${tokA}/self-estimate/quote`, body, cookie);
    const { rows } = await pool.query(
      "select meta from crm_estimate_events where estimate_id=$1 and type='interest_ballpark_shown'", [estA]);
    expect(rows.length).toBe(1);
    expect(rows[0].meta).toMatchObject({ lowCents: 950_000, highCents: 1_180_000, trades: ["roofing"], surface: "estimate" });
    // Unpriced product → no number.
    const metal = await api("POST", `/api/public/estimates/${tokA}/self-estimate/quote`, {
      selection: { trades: [{ trade: "roofing", productId: "metal-roofing" }] }, sessionKey,
    }, cookie);
    expect(metal.body.ballpark.lowCents).toBeNull();
    expect(metal.body.ballpark.unpriced[0].reason).toBe("no_price");
  });

  it("interaction events are logged and deduped per visit", async () => {
    if (!serverUp) return;
    const cookie = await clientCookie([custA]);
    const ev = (type: string, trades: string[], key = sessionKey) =>
      api("POST", `/api/public/estimates/${tokA}/self-estimate/event`, { type, trades, sessionKey: key }, cookie);
    expect((await ev("prompt_viewed", ["roofing", "windows"])).body.logged).toBe(true);
    expect((await ev("prompt_viewed", ["windows", "roofing"])).body.logged).toBe(false);
    expect((await ev("trade_opened", ["roofing"])).body.logged).toBe(true);
    expect((await ev("trade_opened", ["roofing"])).body.logged).toBe(false);
    expect((await ev("trade_opened", ["roofing"], `${sessionKey}x2`)).body.logged).toBe(true);
    // A trade not offered here (siding is on the bid) is refused.
    expect((await ev("trade_opened", ["siding"])).status).toBe(400);
    expect((await api("POST", `/api/public/estimates/${tokA}/self-estimate/event`, { type: "request_sent", trades: ["roofing"], sessionKey }, cookie)).status).toBe(400);
  });

  it("'Send this to my contractor' → a DRAFT in the FL division, a task for the rep, a notification", async () => {
    if (!serverUp) return;
    const cookie = await clientCookie([custA]);
    const reqBody = {
      selection: { trades: [{ trade: "roofing", productId: "gaf-hdz" }, { trade: "windows", productId: "pgt", count: 6 }], discountCodes: ["military"] },
      sessionKey, submissionKey: `sub${randomBytes(6).toString("hex")}`, note: "Thinking about doing the roof next spring",
    };
    // No submission key → refused (idempotency is mandatory).
    expect((await api("POST", `/api/public/estimates/${tokA}/self-estimate/request`, { ...reqBody, submissionKey: undefined }, cookie)).status).toBe(400);
    // A double tap: two concurrent sends + a retry with the same key → ONE draft, ONE task.
    const [r, r2] = await Promise.all([
      api("POST", `/api/public/estimates/${tokA}/self-estimate/request`, reqBody, cookie),
      api("POST", `/api/public/estimates/${tokA}/self-estimate/request`, reqBody, cookie),
    ]);
    const r3 = await api("POST", `/api/public/estimates/${tokA}/self-estimate/request`, reqBody, cookie);
    expect([r.status, r2.status, r3.status]).toEqual([200, 200, 200]);
    expect(r.body.ok).toBe(true);
    expect([r.body.duplicate, r2.body.duplicate].filter(Boolean)).toHaveLength(1);
    expect(r3.body.duplicate).toBe(true);
    expect(r3.body.ballpark.totalCents).toBe(r.body.ballpark.totalCents);
    const { rows: drafts } = await pool.query(
      "select * from crm_estimates where org_id=$1 and custom_fields->'selfEstimate'->>'fromEstimateId' = $2", [org, estA]);
    expect(drafts.length).toBe(1);
    const d = drafts[0];
    expect(d.status).toBe("draft");
    expect(d.sent_at).toBeNull();
    expect(d.division_id).toBe(fl);
    expect(d.created_by_member_id).toBe(rep);
    const { rows: items } = await pool.query("select name, quantity_milli, unit_price_cents from crm_estimate_items where estimate_id=$1 order by sort_order", [d.id]);
    expect(items).toEqual([
      { name: "GAF HDZ — roofing", quantity_milli: 24_180, unit_price_cents: 45_000 },
      { name: "PGT — windows", quantity_milli: 6_000, unit_price_cents: 95_000 },
    ]);
    const { rows: discounts } = await pool.query("select code, percent_bps, conditions from crm_estimate_discounts where estimate_id=$1", [d.id]);
    expect(discounts).toHaveLength(1);
    expect(discounts[0]).toMatchObject({ code: "military", percent_bps: 200 });
    expect(discounts[0].conditions).toMatch(/NOT verified/);
    expect(d.custom_fields.selfEstimate.claimedDiscounts[0].verified).toBe(false);
    const { rows: tasks } = await pool.query("select * from crm_tasks where org_id=$1", [org]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ assigned_member_id: rep, related_estimate_id: d.id, estimate_id: estA, division_id: fl, source: "self_estimate_request" });
    const { rows: notes } = await pool.query("select member_id from crm_notifications where org_id=$1 and type='selfEstimateRequest'", [org]);
    expect(notes.map((n) => n.member_id).sort()).toEqual([me, rep].sort());
    const { rows: ev } = await pool.query("select meta from crm_estimate_events where estimate_id=$1 and type='interest_request_sent'", [estA]);
    expect(ev).toHaveLength(1);
    expect(ev[0].meta.draftEstimateId).toBe(d.id);
    // Totals were written in the same transaction (no separate recalc step).
    expect(d.subtotal_cents).toBe(1_088_100 + 570_000);
    // The stored task text carries no amounts.
    expect(tasks[0].body).not.toMatch(/\$/);
  });

  it("refuses a request whose numbers would overflow, and writes nothing", async () => {
    if (!serverUp) return;
    const got = await api("GET", `/api/crm/self-estimate/config?division=${fl}`);
    const cfg = got.body.config;
    delete cfg.saved;
    cfg.trades.roofing.products[2].unitPriceCents = 100_000_000; // Flat roof at the max allowed unit price
    expect((await api("PUT", "/api/crm/self-estimate/config", { divisionKey: fl, config: cfg })).status).toBe(200);
    const cookie = await clientCookie([custB]); // custB has no measurements → the client's own size
    const sel = { trades: [{ trade: "roofing", productId: "flat-roof", clientSize: 100_000 }] };
    const q = await api("POST", `/api/public/estimates/${tokB}/self-estimate/quote`, { selection: sel, sessionKey }, cookie);
    expect(q.status).toBe(400);
    const r = await api("POST", `/api/public/estimates/${tokB}/self-estimate/request`, {
      selection: sel, sessionKey, submissionKey: `sub${randomBytes(6).toString("hex")}`,
    }, cookie);
    expect(r.status).toBe(400);
    const { rows } = await pool.query("select id from crm_estimates where org_id=$1 and custom_fields->'selfEstimate'->>'fromEstimateId' = $2", [org, estB]);
    expect(rows).toHaveLength(0);
    cfg.trades.roofing.products[2].unitPriceCents = null;
    expect((await api("PUT", "/api/crm/self-estimate/config", { divisionKey: fl, config: cfg })).status).toBe(200);
  });

  it("measurements of another property are never used", async () => {
    if (!serverUp) return;
    // An estimate for Ann's OTHER property (a project at a different address): not measured.
    const proj = randomUUID(), est2 = randomUUID(), tok2 = randomBytes(24).toString("hex");
    await pool.query("insert into crm_projects(id,org_id,customer_id,name,status,address_line1,postal_code,division_id) values ($1,$2,$3,'Rental','lead','9 Other Rd','33602',$4)", [proj, org, custA, fl]);
    await pool.query(`insert into crm_estimates(id,org_id,customer_id,project_id,public_token,number,title,status,created_by_member_id,sent_at,division_id)
                      values ($1,$2,$3,$4,$5,$6,'Siding replacement','sent',$7,now(),$8)`, [est2, org, custA, proj, tok2, `${tag}-SE-4`, rep, fl]);
    await pool.query("insert into crm_estimate_items(org_id,estimate_id,name,quantity_milli,unit,unit_price_cents) values ($1,$2,'Vinyl siding',1000,'sf',1)", [org, est2]);
    const cookie = await clientCookie([custA]);
    const other = await api("GET", `/api/public/estimates/${tok2}/self-estimate`, undefined, cookie);
    expect(other.body.enabled).toBe(true);
    expect(other.body.measured.roofSqft).toBeNull();
    expect(other.body.hasMeasurements).toBe(false);
    // The home estimate (customer address = the measured address) still uses them.
    expect((await api("GET", `/api/public/estimates/${tokA}/self-estimate`, undefined, cookie)).body.measured.roofSqft).toBe(2418);
    // The portal anchors on the latest sent estimate — take the rental back out for the portal test below.
    await pool.query("delete from crm_estimate_items where estimate_id=$1", [est2]);
    await pool.query("delete from crm_estimates where id=$1", [est2]);
  });

  it("tasks: a seat pinned to FL never reads or completes a WA task, even as its assignee", async () => {
    if (!serverUp) return;
    const waTask = randomUUID(), flTask = randomUUID();
    await pool.query(`insert into crm_tasks(id,org_id,customer_id,estimate_id,division_id,assigned_member_id,source,title,meta)
                      values ($1,$2,$3,$4,$5,$6,'self_estimate_request','WA call',$7),($8,$2,$3,$9,$10,$6,'self_estimate_request','FL call',$7)`,
      [waTask, org, custA, estWa, wa, me, JSON.stringify({ lowCents: 7111100, highCents: 7111200, priced: true }), flTask, estA, fl]);
    try {
      await pool.query("update crm_members set role='sales', division_id=$2 where id=$1", [me, fl]);
      const list = await api("GET", "/api/crm/tasks");
      expect(list.status).toBe(200);
      const ids = list.body.tasks.map((t: any) => t.id);
      expect(ids).toContain(flTask);
      expect(ids).not.toContain(waTask);
      expect((await api("PATCH", `/api/crm/tasks/${waTask}`, { done: true })).status).toBe(404);
      const { rows } = await pool.query("select done_at from crm_tasks where id=$1", [waTask]);
      expect(rows[0].done_at).toBeNull();
      const att = await api("GET", "/api/crm/attention");
      expect(att.body.priceRequests.map((t: any) => t.id)).not.toContain(waTask);
    } finally {
      await pool.query("update crm_members set role='owner', division_id=null, permissions=null where id=$1", [me]);
    }
  });

  it("price-blind seats get task text, attention rows and draft details without amounts", async () => {
    if (!serverUp) return;
    try {
      await pool.query(`update crm_members set permissions='{"seePrices": false}'::jsonb where id=$1`, [me]);
      const list = await api("GET", "/api/crm/tasks");
      expect(list.status).toBe(200);
      expect(list.body.tasks.length).toBeGreaterThan(0);
      expect(JSON.stringify(list.body)).not.toMatch(/\$|7111|9,5|11,8/);
      const att = await api("GET", "/api/crm/attention");
      expect(JSON.stringify(att.body.priceRequests)).not.toMatch(/\$/);
      const { rows } = await pool.query("select id from crm_estimates where org_id=$1 and custom_fields->'selfEstimate'->>'fromEstimateId' = $2", [org, estA]);
      const est = await api("GET", `/api/crm/estimates/${rows[0].id}`);
      expect(est.status).toBe(200);
      const se = (est.body.estimate ?? est.body).selfEstimate;
      expect(se).toBeTruthy();
      expect(se.ballpark).toBeUndefined();
    } finally {
      await pool.query("update crm_members set permissions=null where id=$1", [me]);
    }
    const { rows } = await pool.query("select id from crm_estimates where org_id=$1 and custom_fields->'selfEstimate'->>'fromEstimateId' = $2", [org, estA]);
    const est = await api("GET", `/api/crm/estimates/${rows[0].id}`);
    expect((est.body.estimate ?? est.body).selfEstimate.ballpark.lowCents).toBe(1_460_000);
    const list = await api("GET", "/api/crm/tasks");
    expect(JSON.stringify(list.body)).toMatch(/Their ballpark: \$/);
  });

  it("the contractor sees the interest badge, the timeline rows and the task on Home", async () => {
    if (!serverUp) return;
    const i = await api("GET", `/api/crm/self-estimate/interest?customerId=${custA}`);
    expect(i.status).toBe(200);
    const s = i.body.byCustomer[custA];
    expect(s.trades).toEqual(["roofing", "windows"]);
    expect(s.requested).toBe(true);
    expect(s.explored).toBe(2);
    expect(s.text).toMatch(/^Interested in: Roofing, Windows — asked for a price, explored 2×/);
    expect(i.body.byEstimate[estA].requested).toBe(true);
    const tl = await api("GET", `/api/crm/customers/${custA}/timeline`);
    const texts = (tl.body as any[]).map((e) => e.text);
    expect(texts.some((t) => /asked for a Roofing, Windows price/.test(t))).toBe(true);
    expect(texts.some((t) => /prompt/i.test(t))).toBe(false);
    const att = await api("GET", "/api/crm/attention");
    expect(att.body.priceRequests.some((t: any) => t.customerId === custA)).toBe(true);
    const taskId = att.body.priceRequests.find((t: any) => t.customerId === custA).id;
    const done = await api("PATCH", `/api/crm/tasks/${taskId}`, { done: true });
    expect(done.status).toBe(200);
    expect(done.body.task.doneAt).toBeTruthy();
    expect((await api("PATCH", `/api/crm/tasks/${randomUUID()}`, { done: true })).status).toBe(404);
  });

  it("portal: offers per covered customer; a customer id outside the session is refused", async () => {
    if (!serverUp) return;
    const cookie = await clientCookie([custA]);
    const r = await api("GET", "/api/client/self-estimate", undefined, cookie);
    expect(r.status).toBe(200);
    expect(r.body.offers.map((o: any) => o.customerId)).toEqual([custA]);
    expect(r.body.offers[0].config.trades.map((t: any) => t.trade)).toEqual(["roofing", "windows"]);
    const q = await api("POST", "/api/client/self-estimate/quote", {
      customerId: custA, selection: { trades: [{ trade: "windows", productId: "pgt" }] }, sessionKey,
    }, cookie);
    expect(q.body.ballpark.totalCents).toBe(855_000);
    expect((await api("POST", "/api/client/self-estimate/quote", {
      customerId: custB, selection: { trades: [{ trade: "windows", productId: "pgt" }] }, sessionKey,
    }, cookie)).status).toBe(404);
    expect((await api("GET", "/api/client/self-estimate", undefined, "")).status).toBe(401);
  });
});
