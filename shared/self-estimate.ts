/**
 * Client self-estimate ("Make your own estimate") — the pure half.
 *
 * The owner request (Alpine Exteriors, 2026-10-17): most clients get a bid for
 * ONE trade (usually siding). Their estimate page / portal suggests the trades
 * that are NOT on the bid ("Curious what a roof replacement would cost?"), lets
 * the client build a ballpark from the owner's own unit prices, records that
 * they poked around, and lets them send the result to the contractor.
 *
 * ONE implementation on purpose (same rule as shared/estimate-totals.ts): the
 * client dialog previews live with computeBallpark(), and the server
 * re-computes with the very same function from the ORG's configuration on
 * every quote/request — a client-supplied number is never read.
 *
 * Never-fabricate rules baked in here:
 *   • There are NO default prices. A product without an estimator-typed (or
 *     price-book) unit price is not quotable: it shows "Request a price" and
 *     the ballpark leaves it out (`unpriced`). Prices are per DIVISION and a
 *     division with nothing configured offers no prices — never another
 *     division's.
 *   • Quantities come from the home's measurement takeoff when there is one,
 *     otherwise from the client's own rough size, labelled as theirs. A size
 *     that can't be derived honestly (a house size with no estimator
 *     conversion factor) is unpriced, never guessed.
 *   • Discounts are the org's own Bid discounts (percent of the pre-tax
 *     subtotal, summed and capped at 100% — the same stacking rule as optional
 *     estimate discounts). Claimed discounts are always "to be verified".
 *
 * Money is integer cents, quantities are rounded once (to 0.01 of the unit),
 * every line rounds once. Tax is not part of a ballpark (the disclaimer says so).
 */
import { z } from "zod";

// ── Trades, units, products ─────────────────────────────────────────────────
//
// Owner spec 2026-10-17: the estimator sets up PRODUCTS per trade (Hardie lap,
// GAF HDZ, PGT…) with their own unit price, PER DIVISION (FL prices are not WA
// prices). Prices are stored canonically:
//   siding  → cents per ft²
//   roofing → cents per SQUARE (100 ft²); the estimator may type per ft² or
//             per square (`priceEntry`), the stored number is always per square
//   windows → cents per window
//   doors   → cents per door

export const SELF_ESTIMATE_TRADES = ["siding", "roofing", "windows", "doors"] as const;
export type SelfEstimateTrade = (typeof SELF_ESTIMATE_TRADES)[number];

export type SelfEstimateUnit = "sqft" | "square" | "window" | "door";
export const SELF_ESTIMATE_UNIT_LABEL: Record<SelfEstimateUnit, { short: string; per: string }> = {
  sqft: { short: "ft²", per: "per ft²" },
  square: { short: "squares", per: "per square (100 ft²)" },
  window: { short: "windows", per: "per window" },
  door: { short: "doors", per: "per door" },
};

export const SELF_ESTIMATE_TRADE_META: Record<SelfEstimateTrade, {
  label: string;
  /** The prompt card headline on the client page. */
  prompt: string;
  blurb: string;
  /** The canonical unit stored prices are per. */
  unit: SelfEstimateUnit;
  /** The owner's starting product list — NAMES ONLY, never prices. */
  starterProducts: string[];
}> = {
  siding: {
    label: "Siding",
    prompt: "Curious what new siding would cost?",
    blurb: "Get a ballpark for re-siding your home in a minute.",
    unit: "sqft",
    starterProducts: ["Hardie lap", "Hardie panels", "Hardie shingles", "Vinyl"],
  },
  roofing: {
    label: "Roofing",
    prompt: "Curious what a roof replacement would cost?",
    blurb: "See a ballpark range for a new roof — no commitment.",
    unit: "square",
    starterProducts: ["GAF HDZ", "Metal roofing", "Flat roof"],
  },
  windows: {
    label: "Windows",
    prompt: "Thinking about new windows?",
    blurb: "Price replacement windows for your home in a few taps.",
    unit: "window",
    starterProducts: ["PGT", "Silverlite", "CWS"],
  },
  doors: {
    label: "Doors",
    prompt: "Thinking about new doors?",
    blurb: "Get a ballpark for new entry or patio doors.",
    unit: "door",
    starterProducts: [],
  },
};

export const SIDING_PORTIONS = {
  whole: { label: "The whole house", bps: 10_000 },
  most: { label: "Most of the house (about ¾)", bps: 7_500 },
  half: { label: "About half", bps: 5_000 },
  some: { label: "A wall or two (about ¼)", bps: 2_500 },
} as const;
export type SidingPortion = keyof typeof SIDING_PORTIONS;

// ── Trade detection (what is already on the client's bid) ──────────────────

// A siding bid routinely mentions windows and doors as TRIM work ("window trim
// wrap", "door casing") — that is not a window job, so trim words disqualify.
const TRIM_WORDS = /\b(trim|wrap|wrapping|casing|casings|surround|surrounds|flashing|sill|sills|header|headers|capping|j-?channel|jamb|jambs|brickmould|brick mold)\b/i;
const TRADE_PATTERNS: Record<SelfEstimateTrade, RegExp> = {
  siding: /\bsiding\b|\bhardie|\bcladding\b|board[- ]?(and|&)[- ]?batten|\blap\s+board\b/i,
  roofing: /\broof(s|ing)?\b|\bre-?roof|\bshingles?\b|\btear[- ]?off\b|\bunderlayment\b|\bridge\s+(vent|cap)\b/i,
  windows: /\bwindows?\b/i,
  doors: /\bdoors?\b/i,
};

/**
 * Which trades a set of line texts (item names/descriptions, the estimate
 * title, option names) already covers. Keyword-based by necessity — estimate
 * lines carry no trade field. Windows/doors only count when the text is not
 * trim work around them; "Hardie shingles" is siding, not roofing.
 */
export function detectBidTrades(texts: (string | null | undefined)[]): Set<SelfEstimateTrade> {
  const out = new Set<SelfEstimateTrade>();
  for (const raw of texts) {
    const t = String(raw ?? "");
    if (!t.trim()) continue;
    const siding = TRADE_PATTERNS.siding.test(t);
    if (siding) out.add("siding");
    const roofText = siding ? t.replace(/\bshingles?\b/gi, "") : t;
    if (TRADE_PATTERNS.roofing.test(roofText)) out.add("roofing");
    if (TRADE_PATTERNS.windows.test(t) && !TRIM_WORDS.test(t)) out.add("windows");
    if (TRADE_PATTERNS.doors.test(t) && !TRIM_WORDS.test(t)) out.add("doors");
  }
  return out;
}

// ── Configuration (crm_orgs.custom_fields.selfEstimate.divisions[key]) ──────

/** The config key of an estimate with no division (and of an org without divisions). */
export const NO_DIVISION_KEY = "org";

const priceCents = z.number().int().min(1).max(100_000_000);
const productId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, "Product ids are lowercase letters, digits and dashes");

export const selfEstimateProductSchema = z.object({
  id: productId,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240).nullable().default(null),
  /** An https image the estimator links (shown as a thumbnail). */
  photoUrl: z.string().trim().max(500).url().refine((u) => u.startsWith("https://"), "Photo links must be https://")
    .nullable().default(null),
  enabled: z.boolean().default(true),
  /** manual = the estimator typed unitPriceCents; pricebook = priced from pbItemId. */
  source: z.enum(["manual", "pricebook"]).default("manual"),
  /** Canonical unit of the trade (siding ft², roofing square, window, door). Null = "Request a price". */
  unitPriceCents: priceCents.nullable().default(null),
  pbItemId: z.string().min(1).max(64).nullable().default(null),
});

export const selfEstimateTradeSchema = z.object({
  enabled: z.boolean().default(false),
  products: z.array(selfEstimateProductSchema).max(12).default([]),
  /** Roofing only: how the estimator types prices. Storage is per square regardless. */
  priceEntry: z.enum(["sqft", "square"]).default("square"),
  /** Optional minimum job price for this trade (cents). */
  minimumCents: priceCents.nullable().default(null),
  /** Roofing: added per square when the client says there are 2 layers to tear off. */
  extraLayerCents: priceCents.nullable().default(null),
  /** Roofing: gutters per linear foot, run measured as the home's footprint perimeter. */
  guttersPerLfCents: priceCents.nullable().default(null),
  /**
   * Siding/roofing: the estimator's own "ft² of this trade per ft² of living
   * area" factor (basis points, 13000 = 1.3). Null = the client is asked for
   * the trade area itself — a house size is never converted with a guess.
   */
  houseSqftFactorBps: z.number().int().min(1_000).max(100_000).nullable().default(null),
});

export const selfEstimateDivisionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** ± range around the computed number, basis points (1000 = ±10%). */
  rangeBps: z.number().int().min(0).max(5_000).default(1_000),
  disclaimer: z.string().trim().min(10).max(600),
  /** Codes of the org's Bid discounts the client may claim. */
  discountCodes: z.array(z.string().min(1).max(64)).max(20).default([]),
  trades: z.object({
    siding: selfEstimateTradeSchema.optional(),
    roofing: selfEstimateTradeSchema.optional(),
    windows: selfEstimateTradeSchema.optional(),
    doors: selfEstimateTradeSchema.optional(),
  }).default({}),
}).superRefine((cfg, ctx) => {
  for (const trade of SELF_ESTIMATE_TRADES) {
    const t = cfg.trades[trade];
    if (!t) continue;
    const ids = new Set<string>();
    for (const [i, p] of t.products.entries()) {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", path: ["trades", trade, "products", i, "id"], message: "Each product needs its own id" });
      ids.add(p.id);
      if (p.source === "pricebook" && !p.pbItemId) {
        ctx.addIssue({ code: "custom", path: ["trades", trade, "products", i, "pbItemId"], message: `Pick a price-book item for ${p.name}` });
      }
    }
  }
});

export type SelfEstimateProduct = z.infer<typeof selfEstimateProductSchema>;
export type SelfEstimateTradeConfig = z.infer<typeof selfEstimateTradeSchema>;
export type SelfEstimateDivisionConfig = z.infer<typeof selfEstimateDivisionConfigSchema>;
export type NormalizedDivisionConfig = SelfEstimateDivisionConfig & {
  trades: Record<SelfEstimateTrade, SelfEstimateTradeConfig>;
  /** False when nothing was ever saved for this division (the starter list is shown). */
  saved: boolean;
};

export const DEFAULT_SELF_ESTIMATE_DISCLAIMER =
  "Ballpark only — not a quote. Your final price comes after an in-person inspection and measurements. Taxes, permits and any repairs found during the job are not included.";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "product";

/** A trade nobody configured yet: off, the owner's starter product NAMES, no prices. */
export function starterTradeConfig(trade: SelfEstimateTrade): SelfEstimateTradeConfig {
  return {
    enabled: false,
    products: SELF_ESTIMATE_TRADE_META[trade].starterProducts.map((name) => ({
      id: slug(name), name, description: null, photoUrl: null, enabled: true,
      source: "manual" as const, unitPriceCents: null, pbItemId: null,
    })),
    priceEntry: "square",
    minimumCents: null, extraLayerCents: null, guttersPerLfCents: null, houseSqftFactorBps: null,
  };
}

/** The stored division config with every trade filled in. Missing/bad data → the feature is OFF. */
export function normalizeDivisionConfig(raw: unknown): NormalizedDivisionConfig {
  const parsed = raw && typeof raw === "object" ? selfEstimateDivisionConfigSchema.safeParse(raw) : null;
  const ok = !!parsed?.success;
  const base: SelfEstimateDivisionConfig = parsed?.success
    ? parsed.data
    : { enabled: false, rangeBps: 1_000, disclaimer: DEFAULT_SELF_ESTIMATE_DISCLAIMER, discountCodes: [], trades: {} };
  const trades = {} as Record<SelfEstimateTrade, SelfEstimateTradeConfig>;
  for (const t of SELF_ESTIMATE_TRADES) trades[t] = base.trades[t] ?? starterTradeConfig(t);
  return { ...base, trades, saved: ok };
}

/**
 * One division's config out of the org's custom_fields. The estimate's OWN
 * division only — never another division's prices, never an org-wide fallback
 * for a division that has nothing set up.
 */
export function divisionConfigOf(orgCustomFields: unknown, divisionKey: string): NormalizedDivisionConfig {
  const all = (orgCustomFields as any)?.selfEstimate?.divisions;
  const raw = all && typeof all === "object" && Object.prototype.hasOwnProperty.call(all, divisionKey) ? all[divisionKey] : null;
  return normalizeDivisionConfig(raw);
}

// ── What the client page receives (prices resolved server-side) ─────────────

export type PricedProduct = {
  id: string; name: string; description: string | null; photoUrl: string | null;
  /** Canonical unit price; null → "Request a price". */
  unitPriceCents: number | null;
};
export type PricedTrade = {
  trade: SelfEstimateTrade;
  label: string;
  prompt: string;
  blurb: string;
  unit: SelfEstimateUnit;
  products: PricedProduct[];
  minimumCents: number | null;
  extraLayerCents: number | null;
  guttersPerLfCents: number | null;
  houseSqftFactorBps: number | null;
  /** At least one product has a price. False → "Request a price" only. */
  quotable: boolean;
};
export type OfferedDiscount = { code: string; label: string; percentBps: number; conditions: string | null };
export type PricedSelfEstimate = {
  rangeBps: number;
  disclaimer: string;
  trades: PricedTrade[];
  discounts: OfferedDiscount[];
};

/**
 * The home's measured quantities, from the HOVER takeoff (server adapter
 * self-estimate-measurements.ts). Every field is null when not measured.
 */
export type MeasuredQuantities = {
  /** Siding quantity, already rounded up to 100 ft² by the takeoff. */
  sidingSqft: number | null;
  /** Roof area as measured (no waste). */
  roofAreaSqft: number | null;
  /** Roof quantity WITH the takeoff's waste (≥ 5%). The number roofing prices from. */
  roofSqft: number | null;
  roofWastePct: number | null;
  windowsCount: number | null;
  doorsCount: number | null;
  perimeterFt: number | null;
};

export const NO_MEASUREMENTS: MeasuredQuantities = {
  sidingSqft: null, roofAreaSqft: null, roofSqft: null, roofWastePct: null,
  windowsCount: null, doorsCount: null, perimeterFt: null,
};

// ── The client's answers ────────────────────────────────────────────────────

export const selfEstimateTradeSelectionSchema = z.object({
  trade: z.enum(SELF_ESTIMATE_TRADES),
  productId: z.string().min(1).max(64),
  /** Siding: how much of the house. */
  portion: z.enum(["whole", "most", "half", "some"]).optional(),
  /** Roofing: layers to tear off. */
  layers: z.union([z.literal(1), z.literal(2)]).optional(),
  /** Roofing: include gutters. */
  gutters: z.boolean().optional(),
  /** Use the measured quantity (default true when there is one). */
  useMeasured: z.boolean().optional(),
  /** Windows/doors: how many (may differ from the measured count). */
  count: z.number().int().min(1).max(200).optional(),
  /** Siding/roofing without measurements: the client's rough size, ft². */
  clientSize: z.number().min(1).max(100_000).optional(),
  /** "area" = the trade's own area; "house" = living area × the estimator's factor. */
  clientSizeKind: z.enum(["area", "house"]).optional(),
}).strip();

export const selfEstimateSelectionSchema = z.object({
  trades: z.array(selfEstimateTradeSelectionSchema).min(1).max(SELF_ESTIMATE_TRADES.length),
  discountCodes: z.array(z.string().min(1).max(64)).max(20).default([]),
}).strip();

export type SelfEstimateTradeSelection = z.infer<typeof selfEstimateTradeSelectionSchema>;
export type SelfEstimateSelection = z.infer<typeof selfEstimateSelectionSchema>;

// ── The math ────────────────────────────────────────────────────────────────

export type BallparkExtra = {
  label: string; quantity: number; unit: string; unitPriceCents: number; amountCents: number;
};
export type BallparkLine = {
  trade: SelfEstimateTrade;
  label: string;
  productId: string;
  productName: string;
  unit: SelfEstimateUnit;
  quantity: number;
  quantitySource: "measured" | "client";
  /** "Based on your home's measurements: 2,418 ft² of roof" / "Your estimate: …" */
  basis: string;
  unitPriceCents: number;
  amountCents: number;
  extras: BallparkExtra[];
  /** Cents added to reach the trade's minimum job price (0 when not applied). */
  minimumAdjustmentCents: number;
  totalCents: number;
  /** Answers worth passing to the contractor ("2 layers to tear off"). */
  details: string[];
  /** Things priced at inspection rather than in the ballpark. */
  notes: string[];
};
export type UnpricedReason = "not_offered" | "no_price" | "need_size";
export type BallparkUnpriced = {
  trade: SelfEstimateTrade; label: string; productName: string | null; reason: UnpricedReason; message: string;
};
export type BallparkDiscount = OfferedDiscount & { amountCents: number; verified: false };
export type Ballpark = {
  lines: BallparkLine[];
  unpriced: BallparkUnpriced[];
  subtotalCents: number;
  discounts: BallparkDiscount[];
  discountBps: number;
  discountCents: number;
  totalCents: number;
  /** null when nothing could be priced. */
  lowCents: number | null;
  highCents: number | null;
  rangeBps: number;
};

const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
/** Quantities round UP to 0.01 of the unit — a ballpark never under-counts. */
const ceil2 = (n: number) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;
const lineCents = (unitPriceCents: number, qty: number) =>
  Math.round((unitPriceCents * Math.round(qty * 1000)) / 1000);
const DOLLARS_100 = 10_000;

function unpriced(trade: SelfEstimateTrade, reason: UnpricedReason, productName: string | null = null): BallparkUnpriced {
  const label = SELF_ESTIMATE_TRADE_META[trade].label;
  const what = productName ? `${productName} ${label.toLowerCase()}` : label;
  const message =
    reason === "not_offered" ? `${label} isn't offered here.`
    : reason === "no_price" ? `${what} is priced after a visit — send a request and we'll get you a number.`
    : `Tell us roughly how big the job is to see a ballpark for ${label.toLowerCase()}.`;
  return { trade, label, productName, reason, message };
}

/** Area (ft²) for siding/roofing: measured first, then the client's own size. */
function areaFor(
  trade: "siding" | "roofing",
  pt: PricedTrade,
  m: MeasuredQuantities,
  s: SelfEstimateTradeSelection,
): { sqft: number; source: "measured" | "client"; basis: string; wholeHouse: boolean } | null {
  const measured = trade === "siding" ? m.sidingSqft : m.roofSqft;
  if (measured && measured > 0 && s.useMeasured !== false) {
    const what = trade === "siding" ? "of siding" : "of roof";
    const waste = trade === "roofing" && m.roofWastePct ? ` (incl. ${fmt(m.roofWastePct, 1)}% waste)` : "";
    return { sqft: measured, source: "measured", basis: `Based on your home's measurements: ${fmt(measured)} ft² ${what}${waste}`, wholeHouse: true };
  }
  if (!s.clientSize || s.clientSize <= 0) return null;
  const noun = trade === "siding" ? "siding" : "roof";
  if (s.clientSizeKind === "house") {
    if (!pt.houseSqftFactorBps) return null; // no estimator factor → never convert with a guess
    const sqft = Math.ceil((s.clientSize * pt.houseSqftFactorBps) / 10_000);
    return { sqft, source: "client", basis: `Your estimate: a ${fmt(s.clientSize)} ft² home (≈ ${fmt(sqft)} ft² of ${noun})`, wholeHouse: true };
  }
  const sqft = Math.ceil(s.clientSize);
  return { sqft, source: "client", basis: `Your estimate: about ${fmt(sqft)} ft² of ${noun}`, wholeHouse: false };
}

function priceTrade(pt: PricedTrade, m: MeasuredQuantities, s: SelfEstimateTradeSelection): BallparkLine | BallparkUnpriced {
  const product = pt.products.find((p) => p.id === s.productId);
  if (!product) return unpriced(pt.trade, "not_offered");
  if (product.unitPriceCents === null || product.unitPriceCents <= 0) return unpriced(pt.trade, "no_price", product.name);
  const price = product.unitPriceCents;
  const details: string[] = [];
  const notes: string[] = [];
  const extras: BallparkExtra[] = [];
  let quantity: number;
  let source: "measured" | "client";
  let basis: string;

  if (pt.trade === "siding" || pt.trade === "roofing") {
    const area = areaFor(pt.trade, pt, m, s);
    if (!area) return unpriced(pt.trade, "need_size", product.name);
    let sqft = area.sqft;
    if (pt.trade === "siding" && area.wholeHouse) {
      const portion = SIDING_PORTIONS[s.portion ?? "whole"];
      if (portion.bps < 10_000) {
        sqft = Math.ceil((sqft * portion.bps) / 10_000);
        details.push(`${portion.label}: ≈ ${fmt(sqft)} ft²`);
      } else details.push(portion.label);
    }
    // Roofing prices per square (canonical); siding per ft².
    quantity = pt.unit === "square" ? ceil2(sqft / 100) : sqft;
    source = area.source;
    basis = area.basis;
    if (pt.trade === "roofing") {
      const layers = s.layers ?? 1;
      details.push(layers === 2 ? "2 layers to tear off" : "1 layer to tear off");
      if (layers === 2) {
        if (pt.extraLayerCents) {
          extras.push({
            label: "Second layer tear-off", quantity, unit: SELF_ESTIMATE_UNIT_LABEL[pt.unit].short,
            unitPriceCents: pt.extraLayerCents, amountCents: lineCents(pt.extraLayerCents, quantity),
          });
        } else notes.push("Removing a second layer is priced at inspection.");
      }
      if (s.gutters) {
        details.push("Include gutters");
        if (pt.guttersPerLfCents && m.perimeterFt && m.perimeterFt > 0) {
          const lf = Math.ceil(m.perimeterFt);
          extras.push({
            label: `Gutters (≈ ${fmt(lf)} ft around your home's measured footprint)`, quantity: lf, unit: "ft",
            unitPriceCents: pt.guttersPerLfCents, amountCents: lineCents(pt.guttersPerLfCents, lf),
          });
        } else notes.push("Gutters are priced at inspection.");
      }
    }
  } else {
    // Windows/doors: the measured count, which the client may adjust; without
    // measurements, the client's own count.
    const measured = pt.trade === "windows" ? m.windowsCount : m.doorsCount;
    const noun = pt.trade === "windows" ? "window" : "door";
    const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
    if (measured && measured > 0 && s.useMeasured !== false) {
      quantity = s.count ?? measured;
      source = "measured";
      basis = quantity === measured
        ? `Based on your home's measurements: ${plural(measured)}`
        : `${plural(quantity)} (your home measured ${plural(measured)})`;
    } else if (s.count && s.count > 0) {
      quantity = s.count;
      source = "client";
      basis = `Your estimate: ${plural(quantity)}`;
    } else return unpriced(pt.trade, "need_size", product.name);
  }

  const amountCents = lineCents(price, quantity);
  const preMin = amountCents + extras.reduce((sum, x) => sum + x.amountCents, 0);
  const minimumAdjustmentCents = pt.minimumCents && preMin < pt.minimumCents ? pt.minimumCents - preMin : 0;
  return {
    trade: pt.trade, label: pt.label, productId: product.id, productName: product.name, unit: pt.unit,
    quantity, quantitySource: source, basis,
    unitPriceCents: price, amountCents, extras, minimumAdjustmentCents,
    totalCents: preMin + minimumAdjustmentCents,
    details, notes,
  };
}

/**
 * The ballpark for a selection. `priced` is the division's resolved config,
 * `m` the home's measurements (NO_MEASUREMENTS when none). Unknown/disabled
 * trades or products and discount codes the division doesn't offer are
 * dropped — the client can only pick from what's on offer, and no total it
 * sends is ever read.
 */
export function computeBallpark(
  priced: PricedSelfEstimate,
  m: MeasuredQuantities,
  selection: SelfEstimateSelection,
): Ballpark {
  const lines: BallparkLine[] = [];
  const out: BallparkUnpriced[] = [];
  const seen = new Set<SelfEstimateTrade>();
  for (const s of selection.trades) {
    if (seen.has(s.trade)) continue;
    seen.add(s.trade);
    const pt = priced.trades.find((t) => t.trade === s.trade);
    if (!pt) { out.push(unpriced(s.trade, "not_offered")); continue; }
    const r = priceTrade(pt, m, s);
    if ("reason" in r) out.push(r); else lines.push(r);
  }
  const subtotalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);

  // Stacking: percentages add, capped at 100%, applied once to the pre-tax
  // subtotal — the optional-discount rule of shared/estimate-totals.ts.
  const wanted = new Set(selection.discountCodes ?? []);
  const claimed = priced.discounts.filter((d) => wanted.has(d.code) && d.percentBps > 0);
  const discountBps = Math.min(10_000, claimed.reduce((sum, d) => sum + d.percentBps, 0));
  const discountCents = Math.round((subtotalCents * discountBps) / 10_000);
  const discounts: BallparkDiscount[] = claimed.map((d) => ({
    ...d, amountCents: Math.round((subtotalCents * d.percentBps) / 10_000), verified: false as const,
  }));
  const totalCents = Math.max(0, subtotalCents - discountCents);
  const rangeBps = Math.max(0, Math.min(5_000, priced.rangeBps));
  const hasNumber = lines.length > 0 && totalCents > 0;
  return {
    lines, unpriced: out, subtotalCents, discounts, discountBps, discountCents, totalCents,
    lowCents: hasNumber ? Math.max(0, Math.floor((totalCents * (10_000 - rangeBps)) / 10_000 / DOLLARS_100) * DOLLARS_100) : null,
    highCents: hasNumber ? Math.ceil((totalCents * (10_000 + rangeBps)) / 10_000 / DOLLARS_100) * DOLLARS_100 : null,
    rangeBps,
  };
}

// ── Interest (contractor side) ──────────────────────────────────────────────

/** crm_estimate_events.type values this feature writes. */
export const INTEREST_EVENT_TYPES = [
  "interest_prompt_viewed",
  "interest_trade_opened",
  "interest_questionnaire_completed",
  "interest_ballpark_shown",
  "interest_discounts_claimed",
  "interest_just_looking",
  "interest_request_sent",
] as const;
export type InterestEventType = (typeof INTEREST_EVENT_TYPES)[number];

export type InterestSummary = {
  trades: SelfEstimateTrade[];
  /** Distinct visits (session keys) in which the client opened a trade. */
  explored: number;
  lastAt: string | null;
  requested: boolean;
  lastRequestAt: string | null;
};

/** Fold interest events into the badge numbers. Pure; events in any order. */
export function summarizeInterest(events: { type: string; at: Date | string | null; meta: unknown }[]): InterestSummary {
  const trades = new Set<SelfEstimateTrade>();
  const sessions = new Set<string>();
  let last = 0, lastReq = 0, opens = 0;
  for (const e of events) {
    if (e.type === "interest_prompt_viewed") continue; // seeing a card isn't interest
    if (!(INTEREST_EVENT_TYPES as readonly string[]).includes(e.type)) continue;
    const meta = (e.meta ?? {}) as Record<string, unknown>;
    const at = e.at ? new Date(e.at).getTime() : 0;
    if (at > last) last = at;
    const ts = Array.isArray(meta.trades) ? meta.trades : typeof meta.trade === "string" ? [meta.trade] : [];
    for (const t of ts) if ((SELF_ESTIMATE_TRADES as readonly string[]).includes(String(t))) trades.add(t as SelfEstimateTrade);
    if (e.type === "interest_trade_opened") {
      opens++;
      if (typeof meta.sessionKey === "string" && meta.sessionKey) sessions.add(meta.sessionKey);
    }
    if (e.type === "interest_request_sent" && at > lastReq) lastReq = at;
  }
  return {
    trades: SELF_ESTIMATE_TRADES.filter((t) => trades.has(t)),
    explored: sessions.size || (opens > 0 ? 1 : 0),
    lastAt: last ? new Date(last).toISOString() : null,
    requested: lastReq > 0,
    lastRequestAt: lastReq ? new Date(lastReq).toISOString() : null,
  };
}

/** "Interested in: Roofing, Windows — explored 3×, last Oct 17" */
export function interestBadgeText(s: InterestSummary): string | null {
  if (!s.trades.length && !s.requested) return null;
  const names = s.trades.map((t) => SELF_ESTIMATE_TRADE_META[t].label).join(", ") || "other work";
  const last = s.lastAt
    ? new Date(s.lastAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : null;
  const bits = [s.requested ? "asked for a price" : null, s.explored ? `explored ${s.explored}×` : null, last ? `last ${last}` : null]
    .filter(Boolean).join(", ");
  return `Interested in: ${names}${bits ? ` — ${bits}` : ""}`;
}

const wholeDollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Human text for one interest event (client timeline). null = not shown there. */
export function interestEventText(type: string, meta: any, ref: string | null): string | null {
  const names = (Array.isArray(meta?.trades) ? meta.trades : [])
    .map((t: string) => (SELF_ESTIMATE_TRADE_META as any)[t]?.label).filter(Boolean).join(", ") || "other work";
  const where = meta?.surface === "portal" ? "in their portal" : ref ? `from estimate ${ref}` : "";
  const range = meta?.lowCents != null && meta?.highCents != null ? ` (${wholeDollars(meta.lowCents)}–${wholeDollars(meta.highCents)})` : "";
  switch (type) {
    case "interest_trade_opened": return `Client started a self-estimate for ${names} ${where}`.trim();
    case "interest_questionnaire_completed": return `Client answered the ${names} questions ${where}`.trim();
    case "interest_ballpark_shown": return `Client saw a ${names} ballpark${range} ${where}`.trim();
    case "interest_discounts_claimed": return `Client claimed discounts on a ${names} self-estimate: ${(meta?.discountLabels ?? meta?.discounts ?? []).join?.(", ") || "—"} (to be verified)`;
    case "interest_just_looking": return `Client looked at ${names} pricing — "just looking"`;
    case "interest_request_sent":
      return `Client asked for a ${names} price${range} — draft ${meta?.draftNumber ?? ""} created${meta?.note ? `. Note: "${String(meta.note).slice(0, 200)}"` : ""}`.replace(/\s+/g, " ").trim();
    default: return null;
  }
}

