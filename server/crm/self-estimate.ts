/**
 * Client self-estimate — "Curious what a roof replacement would cost?"
 *
 * The client's estimate page and portal suggest every trade the division
 * offers that is NOT already on the client's bid. The client picks a trade
 * and a product, the quantity comes from the home's HOVER takeoff (or their
 * own rough size), they tick the discounts they claim, and see a ballpark
 * range computed from the ESTIMATOR'S OWN prices for the estimate's division.
 * Everything they do is logged as interest on the estimate (crm_estimate_events
 * type interest_*), and "Send this to my contractor" creates a DRAFT estimate +
 * a follow-up task for the rep and notifies them. Nothing is ever sent to the
 * client automatically and nothing is purchased (iPhone-app rule).
 *
 * Routes
 *   Public, scoped by the estimate token + the email-gated client session
 *   (same gate as GET /api/public/estimates/:token; a contractor preview grant
 *   may READ, never write):
 *     GET  /api/public/estimates/:token/self-estimate
 *     POST /api/public/estimates/:token/self-estimate/event
 *     POST /api/public/estimates/:token/self-estimate/quote
 *     POST /api/public/estimates/:token/self-estimate/request
 *   Client portal, scoped by the crm_client session's customer ids (the
 *   anchor is the customer's latest SENT estimate):
 *     GET  /api/client/self-estimate
 *     POST /api/client/self-estimate/event | /quote | /request   { customerId, … }
 *   CRM (staff):
 *     GET  /api/crm/self-estimate/config?division=<key>   manageSettings OR manageEstimates
 *     PUT  /api/crm/self-estimate/config                  manageSettings OR manageEstimates
 *     GET  /api/crm/self-estimate/interest[?customerId|estimateId]   manageEstimates
 *     GET  /api/crm/tasks                                 any member (own / visible tasks)
 *     PATCH /api/crm/tasks/:id                            any member who can see the task
 *
 * Prices: per DIVISION (custom_fields.selfEstimate.divisions[<divisionId>|"org"]).
 * The estimate's own division only — a division with nothing configured offers
 * no prices, never another division's. Every number shown to or stored for the
 * client is recomputed here from that config (shared/self-estimate.ts); a
 * total in a request body is never read (zod strips it).
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db, pool } from "../db";
import {
  crmCustomers, crmEstimates, crmEstimateItems, crmEstimateOptions, crmEstimateEvents, crmEstimateDiscounts,
  crmOrgs, crmMembers, crmProjects, crmDivisions, crmPbItems, crmTasks,
  crmNotificationChannel,
} from "@shared/schema";
import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, like, sql } from "drizzle-orm";
import {
  SELF_ESTIMATE_TRADES, SELF_ESTIMATE_TRADE_META, NO_DIVISION_KEY, INTEREST_EVENT_TYPES,
  selfEstimateDivisionConfigSchema, selfEstimateSelectionSchema, divisionConfigOf, detectBidTrades,
  computeBallpark, summarizeInterest, interestBadgeText,
  type SelfEstimateTrade, type PricedSelfEstimate, type PricedTrade, type OfferedDiscount,
  type NormalizedDivisionConfig, type MeasuredQuantities, type SelfEstimateSelection, type Ballpark,
  type InterestSummary,
} from "@shared/self-estimate";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { allow as rateAllow, requireClient, resolveClientCustomerIds } from "./client-auth";
import { previewGrantValid } from "./portal";
import { logEvent, recalcEstimate } from "./entities";
import { nextDocNumber } from "./doc-number";
import { estimateDefaultsFromOrg } from "./doc-defaults";
import { resolveEstimateTaxRate } from "./tax";
import { attachDefaultFilesToEstimate } from "./estimate-default-files";
import { resolveEstimateDivision, divisionScopeOf, pinnedDivisionOf, companyBranding } from "./divisions";
import { DISCOUNT_PRESETS } from "./discounts";
import { recordActivity, logActivity } from "./activity";
import { notifyMembers } from "./notify";
import { objectPolicy } from "./object-access";
import { sendWithFallback } from "../email";
import { portalBaseUrl } from "../site-context";
import { getCustomerTakeoff, measuredFromTakeoff } from "./self-estimate-measurements";

type GetUser = (req: any, res: any) => any;
type Org = typeof crmOrgs.$inferSelect;
type Cust = typeof crmCustomers.$inferSelect;
type Est = typeof crmEstimates.$inferSelect;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0].trim().slice(0, 60);

// ── Pricing resolution ──────────────────────────────────────────────────────

/** The org's Bid discounts (Settings) — or, never saved, the presets in discounts.ts. */
export function discountSourceOf(orgCustomFields: unknown): OfferedDiscount[] {
  const saved = (orgCustomFields as any)?.discountDefaults;
  const list: any[] = Array.isArray(saved) && saved.length ? saved : (DISCOUNT_PRESETS as readonly any[]).slice();
  return list
    .filter((o) => o && typeof o.code === "string" && typeof o.label === "string"
      && Number.isInteger(o.percentBps) && o.percentBps > 0 && o.percentBps <= 10_000)
    .map((o) => ({ code: o.code, label: o.label, percentBps: o.percentBps, conditions: o.conditions ?? null }));
}

/**
 * A price-book item's price in the trade's canonical unit (siding ft²,
 * roofing square, window/door each), or null when the item can't honestly be
 * read as one: inactive, an assembly priced by expansion, or a unit that
 * doesn't convert.
 */
export function pbUnitPriceFor(
  trade: SelfEstimateTrade,
  item: { active: boolean; pricingMode: string; unit: string; flatPriceCents: number | null; rateCentsPerSqft: number | null } | undefined,
): number | null {
  if (!item || !item.active) return null;
  let perSf: number | null = null, perSq: number | null = null, each: number | null = null;
  if (item.pricingMode === "per_sqft" && item.rateCentsPerSqft && item.rateCentsPerSqft > 0) perSf = item.rateCentsPerSqft;
  else if (item.pricingMode === "flat" && item.flatPriceCents && item.flatPriceCents > 0) {
    if (item.unit === "sf") perSf = item.flatPriceCents;
    else if (item.unit === "sq") perSq = item.flatPriceCents;
    else if (item.unit === "ea") each = item.flatPriceCents;
  }
  if (trade === "siding") return perSf ?? (perSq ? Math.round(perSq / 100) : null);
  if (trade === "roofing") return perSq ?? (perSf ? perSf * 100 : null);
  return each;
}

/** The division's config with prices resolved, for the trades a client may explore. */
export async function pricedConfigFor(org: Org, divisionKey: string): Promise<{ cfg: NormalizedDivisionConfig; priced: PricedSelfEstimate }> {
  const cfg = divisionConfigOf(org.customFields, divisionKey);
  const pbIds = SELF_ESTIMATE_TRADES.flatMap((t) => cfg.trades[t].products)
    .filter((p) => p.source === "pricebook" && p.pbItemId).map((p) => p.pbItemId!) ;
  const pbRows = pbIds.length
    ? await db.select().from(crmPbItems).where(and(eq(crmPbItems.orgId, org.id), inArray(crmPbItems.id, pbIds)))
    : [];
  const pbById = new Map(pbRows.map((r) => [r.id, r]));
  const trades: PricedTrade[] = [];
  for (const trade of SELF_ESTIMATE_TRADES) {
    const t = cfg.trades[trade];
    if (!t.enabled) continue;
    const products = t.products.filter((p) => p.enabled).map((p) => ({
      id: p.id, name: p.name, description: p.description, photoUrl: p.photoUrl,
      unitPriceCents: p.source === "pricebook" ? pbUnitPriceFor(trade, pbById.get(p.pbItemId ?? "")) : p.unitPriceCents,
    }));
    if (!products.length) continue;
    const meta = SELF_ESTIMATE_TRADE_META[trade];
    trades.push({
      trade, label: meta.label, prompt: meta.prompt, blurb: meta.blurb, unit: meta.unit, products,
      minimumCents: t.minimumCents,
      extraLayerCents: trade === "roofing" ? t.extraLayerCents : null,
      guttersPerLfCents: trade === "roofing" ? t.guttersPerLfCents : null,
      houseSqftFactorBps: trade === "siding" || trade === "roofing" ? t.houseSqftFactorBps : null,
      quotable: products.some((p) => p.unitPriceCents !== null && p.unitPriceCents > 0),
    });
  }
  const offeredCodes = new Set(cfg.discountCodes);
  return {
    cfg,
    priced: {
      rangeBps: cfg.rangeBps,
      disclaimer: cfg.disclaimer,
      trades,
      discounts: discountSourceOf(org.customFields).filter((d) => offeredCodes.has(d.code)),
    },
  };
}

// ── The anchor: which estimate the interest belongs to ──────────────────────

type Anchor = { org: Org; cust: Cust; est: Est; divisionKey: string; divisionId: string | null; surface: "estimate" | "portal" };

async function anchorFor(est: Est, surface: Anchor["surface"]): Promise<Anchor | null> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, est.orgId)).limit(1);
  const [cust] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.id, est.customerId), eq(crmCustomers.orgId, est.orgId))).limit(1);
  if (!org || !cust) return null;
  const division = await resolveEstimateDivision(est);
  const divisionId = est.divisionId ?? division?.id ?? null;
  return { org, cust, est, divisionId, divisionKey: divisionId ?? NO_DIVISION_KEY, surface };
}

/** The portal's anchor for one customer: their latest estimate that was actually sent. */
async function portalAnchor(customerId: string): Promise<Anchor | null> {
  const [est] = await db.select().from(crmEstimates)
    .where(and(eq(crmEstimates.customerId, customerId), isNotNull(crmEstimates.sentAt)))
    .orderBy(desc(crmEstimates.sentAt)).limit(1);
  return est ? anchorFor(est, "portal") : null;
}

/** Trades already on the bid: the anchor estimate (page) or every sent estimate of the client (portal). */
async function tradesOnBid(a: Anchor): Promise<Set<SelfEstimateTrade>> {
  const ests = a.surface === "estimate"
    ? [a.est]
    : await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, a.org.id), eq(crmEstimates.customerId, a.cust.id), isNotNull(crmEstimates.sentAt)));
  const ids = ests.map((e) => e.id);
  const [items, options] = await Promise.all([
    db.select({ name: crmEstimateItems.name, description: crmEstimateItems.description }).from(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, a.org.id), inArray(crmEstimateItems.estimateId, ids))),
    db.select({ name: crmEstimateOptions.name, description: crmEstimateOptions.description, items: crmEstimateOptions.items })
      .from(crmEstimateOptions).where(inArray(crmEstimateOptions.estimateId, ids)),
  ]);
  const texts: (string | null)[] = [...ests.map((e) => e.title), ...items.flatMap((i) => [i.name, i.description])];
  for (const o of options) {
    texts.push(o.name, o.description);
    if (Array.isArray(o.items)) for (const i of o.items as any[]) texts.push(i?.name ?? null);
  }
  return detectBidTrades(texts);
}

async function measuredFor(a: Anchor): Promise<MeasuredQuantities> {
  const takeoff = await getCustomerTakeoff(a.org.id, a.cust.id, {
    addressLine1: a.cust.addressLine1, postalCode: a.cust.postalCode,
  }).catch(() => null);
  return measuredFromTakeoff(takeoff);
}

async function repOf(a: Anchor): Promise<typeof crmMembers.$inferSelect | null> {
  let repId = a.est.createdByMemberId ?? null;
  if (!repId && a.est.projectId) {
    const [p] = await db.select({ sales: crmProjects.salesMemberId, pm: crmProjects.projectManagerMemberId })
      .from(crmProjects).where(and(eq(crmProjects.orgId, a.org.id), eq(crmProjects.id, a.est.projectId))).limit(1);
    repId = p?.sales ?? p?.pm ?? null;
  }
  if (!repId) return null;
  const [m] = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.id, repId), eq(crmMembers.orgId, a.org.id), eq(crmMembers.status, "active"))).limit(1);
  return m ?? null;
}

/** What GET answers: the trades to suggest, priced, with the home's measurements. */
async function offerFor(a: Anchor) {
  const { cfg, priced } = await pricedConfigFor(a.org, a.divisionKey);
  if (!cfg.enabled || !priced.trades.length) return { enabled: false as const };
  const onBid = await tradesOnBid(a);
  const suggested = priced.trades.filter((t) => !onBid.has(t.trade));
  if (!suggested.length) return { enabled: false as const };
  const measured = await measuredFor(a);
  const rep = await repOf(a);
  const division = a.divisionId ? (await db.select().from(crmDivisions)
    .where(and(eq(crmDivisions.orgId, a.org.id), eq(crmDivisions.id, a.divisionId))).limit(1))[0] ?? null : null;
  return {
    enabled: true as const,
    companyName: companyBranding(a.org, division).name,
    repName: rep ? rep.displayName || rep.email : null,
    onBid: SELF_ESTIMATE_TRADES.filter((t) => onBid.has(t)),
    config: { ...priced, trades: suggested } satisfies PricedSelfEstimate,
    measured,
    hasMeasurements: Object.values(measured).some((v) => v !== null),
  };
}

// ── Interest events ─────────────────────────────────────────────────────────

const sessionKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const tradeList = z.array(z.enum(SELF_ESTIMATE_TRADES)).max(SELF_ESTIMATE_TRADES.length).default([]);

/** Client-reported interactions. ballpark_shown / request_sent are logged by the server itself. */
const eventBodySchema = z.object({
  type: z.enum(["prompt_viewed", "trade_opened", "questionnaire_completed", "discounts_claimed", "just_looking"]),
  trades: tradeList,
  sessionKey: sessionKeySchema,
  discountCodes: z.array(z.string().min(1).max(64)).max(20).optional(),
}).strip();

/** Same visit, same thing, same trades → one row (a re-render is not new interest). */
const DEDUPE_MINS: Record<string, number> = {
  interest_prompt_viewed: 24 * 60,
  interest_trade_opened: 24 * 60,
  interest_questionnaire_completed: 30,
  interest_discounts_claimed: 30,
  interest_just_looking: 30,
  interest_ballpark_shown: 30,
};

/** Insert an interest event unless the same one is already on file for this visit. Returns true when written. */
export async function logInterest(
  a: Pick<Anchor, "org" | "est" | "cust" | "surface">,
  type: (typeof INTEREST_EVENT_TYPES)[number],
  req: any,
  meta: { sessionKey: string; trades: SelfEstimateTrade[]; dedupeKey?: string; [k: string]: unknown },
): Promise<boolean> {
  const trades = [...new Set(meta.trades)].sort();
  const dedupeKey = meta.dedupeKey ?? trades.join(",");
  const mins = DEDUPE_MINS[type];
  if (mins) {
    const dup = await db.select({ id: crmEstimateEvents.id }).from(crmEstimateEvents)
      .where(and(
        eq(crmEstimateEvents.orgId, a.org.id),
        eq(crmEstimateEvents.estimateId, a.est.id),
        eq(crmEstimateEvents.type, type),
        sql`${crmEstimateEvents.meta}->>'sessionKey' = ${meta.sessionKey}`,
        sql`${crmEstimateEvents.meta}->>'dedupeKey' = ${dedupeKey}`,
        sql`${crmEstimateEvents.createdAt} >= now() - make_interval(mins => ${mins})`,
      )).limit(1);
    if (dup.length) return false;
  }
  await logEvent(a.org.id, a.est.id, type, "client", req, {
    ...meta, trades, dedupeKey, surface: a.surface, customerId: a.cust.id,
  });
  return true;
}

// ── Request → draft estimate + task + notification ─────────────────────────

const requestBodySchema = z.object({
  selection: selfEstimateSelectionSchema,
  sessionKey: sessionKeySchema,
  note: z.string().trim().max(1000).optional(),
}).strip();

const UNIT_CODE: Record<string, string> = { sqft: "sf", square: "sq", window: "ea", door: "ea" };

/** The draft estimate lines for a ballpark (pure — unit-tested). Unpriced picks become $0 "price needed" lines. */
export function draftLinesFor(bp: Ballpark, selection: SelfEstimateSelection, priced: PricedSelfEstimate) {
  const lines: { kind: string; name: string; description: string | null; quantityMilli: number; unit: string; unitPriceCents: number }[] = [];
  for (const l of bp.lines) {
    lines.push({
      kind: "labor",
      name: `${l.productName} — ${l.label.toLowerCase()}`.slice(0, 300),
      description: [l.basis, ...l.details, "From the client's online self-estimate — verify on site."].join(" · ").slice(0, 2000),
      quantityMilli: Math.round(l.quantity * 1000), unit: UNIT_CODE[l.unit] ?? "ea", unitPriceCents: l.unitPriceCents,
    });
    for (const x of l.extras) {
      lines.push({
        kind: "labor", name: x.label.slice(0, 300), description: null,
        quantityMilli: Math.round(x.quantity * 1000), unit: x.unit === "ft" ? "lf" : UNIT_CODE[l.unit] ?? "ea",
        unitPriceCents: x.unitPriceCents,
      });
    }
    if (l.minimumAdjustmentCents > 0) {
      lines.push({
        kind: "fee", name: `Minimum job charge — ${l.label.toLowerCase()}`, description: null,
        quantityMilli: 1000, unit: "job", unitPriceCents: l.minimumAdjustmentCents,
      });
    }
  }
  for (const u of bp.unpriced) {
    if (u.reason === "not_offered") continue;
    const s = selection.trades.find((t) => t.trade === u.trade);
    const product = priced.trades.find((t) => t.trade === u.trade)?.products.find((p) => p.id === s?.productId);
    lines.push({
      kind: "labor",
      name: `${product?.name ?? u.label} — ${u.label.toLowerCase()} (price needed)`.slice(0, 300),
      description: `The client asked for a price: ${u.message}`.slice(0, 2000),
      quantityMilli: 1000, unit: UNIT_CODE[SELF_ESTIMATE_TRADE_META[u.trade].unit] ?? "ea", unitPriceCents: 0,
    });
  }
  return lines;
}

async function createRequest(a: Anchor, body: z.infer<typeof requestBodySchema>, req: any) {
  const { priced } = await pricedConfigFor(a.org, a.divisionKey);
  const onBid = await tradesOnBid(a);
  // Only trades this client was offered (the division's, not already on the bid).
  priced.trades = priced.trades.filter((t) => !onBid.has(t.trade));
  const measured = await measuredFor(a);
  const bp = computeBallpark(priced, measured, body.selection);
  const offeredTrades = new Set(priced.trades.map((t) => t.trade));
  const chosen = body.selection.trades.map((t) => t.trade).filter((t) => offeredTrades.has(t));
  if (!chosen.length) return { error: 400 as const, message: "Pick a trade we offer to send a request." };
  const labels = [...new Set(chosen)].map((t) => SELF_ESTIMATE_TRADE_META[t].label);
  const rep = await repOf(a);
  const tax = await resolveEstimateTaxRate(a.org.id, { customerId: a.cust.id, projectId: a.est.projectId });

  // The DRAFT. Never sent: status draft, no sentAt — the estimator reviews it.
  const draft = await db.transaction(async (tx) => {
    const number = await nextDocNumber(tx, "E", a.org.id);
    const [row] = await tx.insert(crmEstimates).values({
      orgId: a.org.id, customerId: a.cust.id, projectId: a.est.projectId,
      number, title: `${labels.join(" + ")} estimate`.slice(0, 200),
      introText: null, termsText: a.org.termsAndConditions ?? null,
      ...estimateDefaultsFromOrg(a.org),
      taxRateBps: tax.bps, publicToken: randomBytes(24).toString("hex"),
      status: "draft",
      createdByMemberId: rep?.id ?? a.est.createdByMemberId ?? null,
      // The request stays in the original estimate's division.
      divisionId: a.divisionId,
      customFields: {
        selfEstimate: {
          fromEstimateId: a.est.id, fromNumber: a.est.number ?? null, surface: a.surface,
          requestedAt: new Date().toISOString(),
          ballpark: { lowCents: bp.lowCents, highCents: bp.highCents, totalCents: bp.totalCents, subtotalCents: bp.subtotalCents },
          claimedDiscounts: bp.discounts.map((d) => ({ code: d.code, label: d.label, percentBps: d.percentBps, verified: false })),
          note: body.note ?? null,
          measured: Object.values(measured).some((v) => v !== null),
        },
        // Pre-ticked for the client when the estimator sends it — still the client's claim.
        preselectedDiscountCodes: bp.discounts.map((d) => d.code),
        taxSource: { source: tax.source, bps: tax.bps, matchedCity: tax.matchedCity ?? null },
      },
    } as any).returning();
    return row;
  });
  const lines = draftLinesFor(bp, body.selection, priced);
  if (lines.length) {
    await db.insert(crmEstimateItems).values(lines.map((l, idx) => ({
      orgId: a.org.id, estimateId: draft.id, sortOrder: idx, kind: l.kind, name: l.name, description: l.description,
      quantityMilli: l.quantityMilli, unit: l.unit, unitPriceCents: l.unitPriceCents, taxable: true, hiddenFromClient: false,
    })) as any);
  }
  if (bp.discounts.length) {
    await db.insert(crmEstimateDiscounts).values(bp.discounts.map((d, idx) => ({
      orgId: a.org.id, estimateId: draft.id, code: d.code, label: d.label, percentBps: d.percentBps,
      conditions: `Claimed by the client online — NOT verified yet.${d.conditions ? ` ${d.conditions}` : ""}`.slice(0, 1000),
      enabled: true, sortOrder: idx,
    })) as any);
  }
  await attachDefaultFilesToEstimate(a.org.id, draft.id).catch(() => 0);
  const fresh = await recalcEstimate(a.org.id, draft.id);
  const draftNumber = fresh?.number ?? draft.number;
  await logEvent(a.org.id, draft.id, "created", "client", req, {
    selfEstimate: true, from: a.est.number ?? a.est.id, trades: chosen,
  });

  const range = bp.lowCents !== null && bp.highCents !== null ? `${dollars(bp.lowCents)}–${dollars(bp.highCents)}` : null;
  const [task] = await db.insert(crmTasks).values({
    orgId: a.org.id, customerId: a.cust.id, estimateId: a.est.id, relatedEstimateId: draft.id,
    divisionId: a.divisionId, assignedMemberId: rep?.id ?? null, source: "self_estimate_request",
    title: `Call ${a.cust.displayName} about a ${labels.join(" + ").toLowerCase()} price`.slice(0, 300),
    body: [
      range ? `Their ballpark: ${range}.` : "They asked for a price on work that isn't priced online.",
      bp.discounts.length ? `Claimed (verify): ${bp.discounts.map((d) => d.label).join(", ")}.` : null,
      body.note ? `Note: ${body.note}` : null,
      `Draft ${draftNumber} is ready to review — nothing was sent to the client.`,
    ].filter(Boolean).join(" ").slice(0, 2000),
    dueAt: new Date(Date.now() + 24 * 3600_000),
    meta: { trades: chosen, draftNumber, lowCents: bp.lowCents, highCents: bp.highCents },
  } as any).returning();

  await logInterest(a, "interest_request_sent", req, {
    sessionKey: body.sessionKey, trades: chosen, dedupeKey: task.id,
    inputs: body.selection, lowCents: bp.lowCents, highCents: bp.highCents, totalCents: bp.totalCents,
    discounts: bp.discounts.map((d) => d.code), note: body.note ?? null,
    draftEstimateId: draft.id, draftNumber, taskId: task.id,
  });
  recordActivity({
    orgId: a.org.id, actorLabel: "client", action: "self_estimate.requested",
    entityType: "estimate", entityId: draft.id, customerId: a.cust.id,
    meta: { number: draftNumber, from: a.est.number ?? null, trades: labels, lowCents: bp.lowCents, highCents: bp.highCents },
  });

  // Tell the rep (+ owners) on the channels the org chose for client messages.
  const title = `${a.cust.displayName} asked for a ${labels.join(" + ").toLowerCase()} price${range ? ` (ballpark ${range})` : ""}`;
  await notifyMembers({
    org: a.org, pref: "clientComments", type: "selfEstimateRequest",
    title, body: `Draft ${draftNumber} was created for you to review — it has not been sent.`,
    link: `/crm/estimates/${draft.id}`,
    extraMemberIds: rep ? [rep.id] : [],
  });
  if (crmNotificationChannel(a.org.customFields, "clientComments", "email")) {
    const owners = await db.select().from(crmMembers)
      .where(and(eq(crmMembers.orgId, a.org.id), eq(crmMembers.status, "active"), eq(crmMembers.role, "owner")));
    const to = new Set<string>([...(rep?.email ? [rep.email] : []), ...owners.map((o) => o.email).filter(Boolean) as string[]]);
    if (to.size) {
      const link = `${portalBaseUrl(req)}/crm/estimates/${draft.id}`;
      await sendWithFallback({
        to: [...to].join(","),
        subject: title,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
          <p><strong>${esc(a.cust.displayName)}</strong> built their own ${esc(labels.join(" + ").toLowerCase())} estimate online and asked you for a price.</p>
          ${range ? `<p>Their ballpark: <strong>${esc(range)}</strong> (from your ${esc(a.divisionKey === NO_DIVISION_KEY ? "" : "division's ")}self-estimate prices).</p>` : ""}
          ${bp.discounts.length ? `<p>Discounts they claimed (to be verified): ${esc(bp.discounts.map((d) => d.label).join(", "))}</p>` : ""}
          ${body.note ? `<p>Their note: ${esc(body.note)}</p>` : ""}
          <p><a href="${esc(link)}">Review draft ${esc(draftNumber ?? "")}</a> — nothing was sent to the client.</p>
        </div>`,
      } as any).catch((e: any) => console.error("[crm] self-estimate email failed:", e?.message || e));
    }
  }
  return { ok: true as const, ballpark: bp, repName: rep ? rep.displayName || rep.email : null };
}

// ── Interest summaries (contractor side) ────────────────────────────────────

const INTEREST_WINDOW_DAYS = 180;

/** Interest per estimate and per customer over the visible estimates of the org. */
export async function interestFor(ctx: OrgContext, filter: { customerId?: string; estimateId?: string } = {}) {
  const conds = [
    eq(crmEstimateEvents.orgId, ctx.org.id),
    like(crmEstimateEvents.type, "interest\\_%"),
    gte(crmEstimateEvents.createdAt, new Date(Date.now() - INTEREST_WINDOW_DAYS * 86400_000)),
  ];
  if (filter.estimateId) conds.push(eq(crmEstimateEvents.estimateId, filter.estimateId));
  if (filter.customerId) conds.push(sql`${crmEstimateEvents.meta}->>'customerId' = ${filter.customerId}`);
  const events = await db.select().from(crmEstimateEvents).where(and(...conds))
    .orderBy(desc(crmEstimateEvents.createdAt)).limit(5000);
  const estIds = [...new Set(events.map((e) => e.estimateId))];
  const ests = estIds.length
    ? await db.select().from(crmEstimates).where(and(eq(crmEstimates.orgId, ctx.org.id), inArray(crmEstimates.id, estIds)))
    : [];
  const visible = await objectPolicy(ctx).filter("estimates", ests);
  const estById = new Map(visible.map((e) => [e.id, e]));
  const byEst = new Map<string, typeof events>();
  const byCust = new Map<string, typeof events>();
  for (const e of events) {
    const est = estById.get(e.estimateId);
    if (!est) continue;
    (byEst.get(est.id) ?? byEst.set(est.id, []).get(est.id)!).push(e);
    (byCust.get(est.customerId) ?? byCust.set(est.customerId, []).get(est.customerId)!).push(e);
  }
  const fold = (rows: typeof events) => {
    const s = summarizeInterest(rows.map((r) => ({ type: r.type, at: r.createdAt, meta: r.meta })));
    return { ...s, text: interestBadgeText(s) };
  };
  const out = { byEstimate: {} as Record<string, InterestSummary & { text: string | null }>, byCustomer: {} as Record<string, InterestSummary & { text: string | null }> };
  for (const [id, rows] of byEst) { const f = fold(rows); if (f.text) out.byEstimate[id] = f; }
  for (const [id, rows] of byCust) { const f = fold(rows); if (f.text) out.byCustomer[id] = f; }
  return out;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

/** Open tasks this seat should see: its own, plus (seats that see all jobs) the visible clients' unassigned/others'. */
export async function visibleOpenTasks(ctx: OrgContext, limit = 50) {
  const rows = await db.select().from(crmTasks)
    .where(and(eq(crmTasks.orgId, ctx.org.id), isNull(crmTasks.doneAt)))
    .orderBy(asc(crmTasks.dueAt)).limit(500);
  const policy = objectPolicy(ctx);
  const out: (typeof rows) = [];
  for (const t of rows) {
    if (out.length >= limit) break;
    if (t.assignedMemberId === ctx.member.id) { out.push(t); continue; }
    if (!ctx.permissions.manageEstimates) continue;
    if (t.estimateId ? await policy.visible("estimates", t.estimateId) : t.customerId ? await policy.visible("customers", t.customerId) : false) out.push(t);
  }
  return out;
}

async function presentTasks(orgId: string, rows: (typeof crmTasks.$inferSelect)[]) {
  const custIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
  const memberIds = [...new Set(rows.map((r) => r.assignedMemberId).filter(Boolean))] as string[];
  const custs = custIds.length ? await db.select({ id: crmCustomers.id, name: crmCustomers.displayName }).from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), inArray(crmCustomers.id, custIds))) : [];
  const members = memberIds.length ? await db.select({ id: crmMembers.id, name: crmMembers.displayName, email: crmMembers.email }).from(crmMembers)
    .where(and(eq(crmMembers.orgId, orgId), inArray(crmMembers.id, memberIds))) : [];
  const cName = new Map(custs.map((c) => [c.id, c.name]));
  const mName = new Map(members.map((m) => [m.id, m.name || m.email]));
  return rows.map((t) => ({
    id: t.id, title: t.title, body: t.body, source: t.source,
    customerId: t.customerId, customerName: t.customerId ? cName.get(t.customerId) ?? null : null,
    estimateId: t.estimateId, relatedEstimateId: t.relatedEstimateId,
    assignedMemberId: t.assignedMemberId, assignedName: t.assignedMemberId ? mName.get(t.assignedMemberId) ?? null : null,
    dueAt: t.dueAt, doneAt: t.doneAt, createdAt: t.createdAt,
    trades: Array.isArray((t.meta as any)?.trades) ? (t.meta as any).trades : [],
  }));
}

export async function attentionTasksFor(ctx: OrgContext, cap = 10) {
  return presentTasks(ctx.org.id, await visibleOpenTasks(ctx, cap));
}

// ── Routes ──────────────────────────────────────────────────────────────────

/** Rate buckets (15-minute fixed windows, client-auth.ts allow()). */
const LIMITS = { readIp: 120, eventIp: 240, eventDoc: 120, quoteDoc: 90, requestDoc: 5, requestIp: 15 };

function limited(res: any, ok: boolean): boolean {
  if (ok) return false;
  res.status(429).json({ message: "Too many requests — please wait a few minutes and try again." });
  return true;
}

/** Can this seat edit the self-estimate prices of a division? Pinned seats: only their own. */
function canEditDivision(ctx: OrgContext, key: string): boolean {
  const pinned = pinnedDivisionOf(ctx.member);
  if (pinned) return key === pinned;
  const scope = divisionScopeOf(ctx);
  return !scope || key === scope;
}

export function registerCrmSelfEstimateRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    return requireOrg(req, res, user.id);
  }
  /** Estimators set their own products and prices: manageSettings OR manageEstimates. */
  const canConfigure = (res: any, ctx: OrgContext) => {
    if (ctx.permissions.manageSettings || ctx.permissions.manageEstimates) return true;
    res.status(403).json({ message: "Requires permission: manageSettings or manageEstimates" });
    return false;
  };

  // ── Staff: configuration ──────────────────────────────────────────────────

  app.get("/api/crm/self-estimate/config", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx || !canConfigure(res, ctx)) return;
    const divisions = await db.select({ id: crmDivisions.id, name: crmDivisions.name }).from(crmDivisions)
      .where(eq(crmDivisions.orgId, ctx.org.id)).orderBy(asc(crmDivisions.name));
    const editable = [
      ...divisions.map((d) => ({ key: d.id, name: d.name })),
      { key: NO_DIVISION_KEY, name: divisions.length ? "No division" : ctx.org.name },
    ].filter((d) => canEditDivision(ctx, d.key));
    if (!editable.length) return res.status(403).json({ message: "No division you can set prices for." });
    const want = typeof req.query.division === "string" ? req.query.division : null;
    const key = want && editable.some((d) => d.key === want) ? want : editable[0].key;
    const cfg = divisionConfigOf(ctx.org.customFields, key);
    const pb = await db.select().from(crmPbItems)
      .where(and(eq(crmPbItems.orgId, ctx.org.id), eq(crmPbItems.active, true))).orderBy(asc(crmPbItems.name)).limit(500);
    // Prices are prices: a price-blind seat reads the product list without them (and can't save).
    const shown = ctx.permissions.seePrices ? cfg : {
      ...cfg,
      trades: Object.fromEntries(Object.entries(cfg.trades).map(([k, t]) => [k, {
        ...t, minimumCents: null, extraLayerCents: null, guttersPerLfCents: null,
        products: t.products.map((x) => ({ ...x, unitPriceCents: null })),
      }])),
    };
    res.json({
      divisionKey: key,
      divisions: editable,
      config: shown,
      canEditPrices: ctx.permissions.seePrices,
      discountSource: discountSourceOf(ctx.org.customFields),
      // Items usable as a product price, with their price in each trade's unit (price-blind seats get names only).
      pricebookItems: pb.map((i) => ({
        id: i.id, name: i.name, unit: i.unit, pricingMode: i.pricingMode,
        unitPrices: ctx.permissions.seePrices
          ? Object.fromEntries(SELF_ESTIMATE_TRADES.map((t) => [t, pbUnitPriceFor(t, i)]))
          : undefined,
      })),
    });
  });

  app.put("/api/crm/self-estimate/config", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx || !canConfigure(res, ctx)) return;
    const p = z.object({
      divisionKey: z.string().min(1).max(64),
      config: selfEstimateDivisionConfigSchema,
    }).safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ message: "Invalid self-estimate settings", issues: p.error.issues });
    const key = p.data.divisionKey;
    if (!ctx.permissions.seePrices) return res.status(403).json({ message: "Requires permission: seePrices" });
    if (key !== NO_DIVISION_KEY) {
      const [d] = await db.select({ id: crmDivisions.id }).from(crmDivisions)
        .where(and(eq(crmDivisions.orgId, ctx.org.id), eq(crmDivisions.id, key))).limit(1);
      if (!d) return res.status(404).json({ message: "Division not found" });
    }
    if (!canEditDivision(ctx, key)) return res.status(403).json({ message: "You can only set prices for your own division." });
    const pbIds = Object.values(p.data.config.trades).flatMap((t) => t?.products ?? [])
      .filter((x) => x.source === "pricebook" && x.pbItemId).map((x) => x.pbItemId!);
    if (pbIds.length) {
      const found = await db.select({ id: crmPbItems.id }).from(crmPbItems)
        .where(and(eq(crmPbItems.orgId, ctx.org.id), inArray(crmPbItems.id, pbIds)));
      if (found.length !== new Set(pbIds).size) return res.status(400).json({ message: "A selected price-book item doesn't exist." });
    }
    // Atomic nested merge: only this division's entry is replaced.
    await pool.query(
      `update crm_orgs set updated_at = now(), custom_fields =
         coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('selfEstimate',
           coalesce(custom_fields->'selfEstimate', '{}'::jsonb) || jsonb_build_object('divisions',
             coalesce(custom_fields #> '{selfEstimate,divisions}', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)))
       where id = $1`,
      [ctx.org.id, key, JSON.stringify(p.data.config)],
    );
    logActivity(ctx, "self_estimate.settings_updated", {
      entityType: "org", entityId: ctx.org.id,
      meta: { division: key, enabled: p.data.config.enabled },
    });
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, ctx.org.id)).limit(1);
    res.json({ divisionKey: key, config: divisionConfigOf(org?.customFields, key) });
  });

  // ── Staff: interest + tasks ───────────────────────────────────────────────

  app.get("/api/crm/self-estimate/interest", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    // Who explored what is sales intelligence — the estimate-engagement rule.
    if (!requirePermission(res, ctx, "manageEstimates")) return;
    const q = z.object({ customerId: z.string().max(64).optional(), estimateId: z.string().max(64).optional() })
      .safeParse(req.query ?? {});
    if (!q.success) return res.status(400).json({ message: "Invalid filter" });
    res.json(await interestFor(ctx, q.data));
  });

  app.get("/api/crm/tasks", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    res.json({ tasks: await presentTasks(ctx.org.id, await visibleOpenTasks(ctx, 100)) });
  });

  app.patch("/api/crm/tasks/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const p = z.object({ done: z.boolean() }).safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ message: "Send { done: true | false }" });
    const [t] = await db.select().from(crmTasks)
      .where(and(eq(crmTasks.orgId, ctx.org.id), eq(crmTasks.id, String(req.params.id)))).limit(1);
    const policy = objectPolicy(ctx);
    const canSee = t && (t.assignedMemberId === ctx.member.id || (ctx.permissions.manageEstimates
      && (t.estimateId ? await policy.visible("estimates", t.estimateId) : t.customerId ? await policy.visible("customers", t.customerId) : false)));
    if (!t || !canSee) return res.status(404).json({ message: "Task not found" });
    const [row] = await db.update(crmTasks).set(p.data.done
      ? { doneAt: new Date(), doneByMemberId: ctx.member.id }
      : { doneAt: null, doneByMemberId: null })
      .where(eq(crmTasks.id, t.id)).returning();
    logActivity(ctx, p.data.done ? "task.done" : "task.reopened", {
      entityType: "task", entityId: t.id, customerId: t.customerId, meta: { title: t.title },
    });
    res.json({ task: (await presentTasks(ctx.org.id, [row]))[0] });
  });

  // ── Public estimate page (token + email-gated session) ────────────────────

  /** The estimate for a token when the browser may READ it (client session or contractor preview). */
  async function readable(req: any, res: any): Promise<{ est: Est; preview: boolean } | null> {
    const t = String(req.params.token || "");
    if (t.length < 24 || t.length > 120) { res.status(404).json({ message: "Not found" }); return null; }
    const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, t)).limit(1);
    if (!est) { res.status(404).json({ message: "Not found" }); return null; }
    const preview = previewGrantValid("estimate", est.id, String(req.query?.preview || ""));
    if (!preview) {
      const ids = await resolveClientCustomerIds(req);
      if (!ids.includes(est.customerId)) {
        res.status(401).json({ message: "Verify the email address this estimate was sent to.", requiresVerification: true });
        return null;
      }
    }
    // A draft was never put in front of the client — nothing to explore from it.
    if (!est.sentAt) { res.json({ enabled: false }); return null; }
    return { est, preview };
  }

  /** Writes: the real client session only (never a preview grant), on a sent estimate. */
  async function writable(req: any, res: any): Promise<Anchor | null> {
    const t = String(req.params.token || "");
    if (t.length < 24 || t.length > 120) { res.status(404).json({ message: "Not found" }); return null; }
    const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, t)).limit(1);
    if (!est) { res.status(404).json({ message: "Not found" }); return null; }
    const ids = await resolveClientCustomerIds(req);
    if (!ids.includes(est.customerId)) {
      res.status(401).json({ message: "Verify the email address this estimate was sent to.", requiresVerification: true });
      return null;
    }
    if (!est.sentAt) { res.status(409).json({ message: "This estimate hasn't been sent yet." }); return null; }
    const a = await anchorFor(est, "estimate");
    if (!a) { res.status(404).json({ message: "Not found" }); return null; }
    return a;
  }

  app.get("/api/public/estimates/:token/self-estimate", async (req: any, res) => {
    if (limited(res, rateAllow(`se-read:${clientIp(req)}`, LIMITS.readIp))) return;
    const r = await readable(req, res);
    if (!r) return;
    const a = await anchorFor(r.est, "estimate");
    if (!a) return res.json({ enabled: false });
    res.json({ ...(await offerFor(a)), preview: r.preview || undefined });
  });

  // Shared write handlers for both surfaces.
  async function handleEvent(a: Anchor, req: any, res: any) {
    const p = eventBodySchema.safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ message: "Invalid event", issues: p.error.issues });
    if (limited(res, rateAllow(`se-ev-ip:${clientIp(req)}`, LIMITS.eventIp))) return;
    if (limited(res, rateAllow(`se-ev:${a.est.id}`, LIMITS.eventDoc))) return;
    const offer = await offerFor(a);
    if (!offer.enabled) return res.json({ ok: true, logged: false });
    const offered = new Set(offer.config.trades.map((t) => t.trade));
    const trades = p.data.trades.filter((t) => offered.has(t));
    if (!trades.length && p.data.type !== "prompt_viewed") return res.status(400).json({ message: "Unknown trade" });
    const codes = (p.data.discountCodes ?? []).filter((c) => offer.config.discounts.some((d) => d.code === c));
    const logged = await logInterest(a, `interest_${p.data.type}` as any, req, {
      sessionKey: p.data.sessionKey,
      trades: p.data.type === "prompt_viewed" && !trades.length ? [...offered] : trades,
      ...(p.data.type === "discounts_claimed" ? {
        discounts: codes,
        discountLabels: offer.config.discounts.filter((d) => codes.includes(d.code)).map((d) => d.label),
        dedupeKey: `${trades.sort().join(",")}|${[...codes].sort().join(",")}`,
      } : {}),
    });
    res.json({ ok: true, logged });
  }

  async function handleQuote(a: Anchor, req: any, res: any) {
    const p = z.object({ selection: selfEstimateSelectionSchema, sessionKey: sessionKeySchema }).strip().safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ message: "Invalid selection", issues: p.error.issues });
    if (limited(res, rateAllow(`se-q:${a.est.id}`, LIMITS.quoteDoc))) return;
    const offer = await offerFor(a);
    if (!offer.enabled) return res.status(409).json({ message: "Online estimates aren't available right now." });
    const bp = computeBallpark(offer.config, offer.measured, p.data.selection);
    const trades = p.data.selection.trades.map((t) => t.trade).filter((t) => offer.config.trades.some((x) => x.trade === t));
    if (trades.length) {
      await logInterest(a, "interest_ballpark_shown", req, {
        sessionKey: p.data.sessionKey, trades,
        dedupeKey: JSON.stringify(p.data.selection).slice(0, 900),
        inputs: p.data.selection, lowCents: bp.lowCents, highCents: bp.highCents, totalCents: bp.totalCents,
        unpriced: bp.unpriced.map((u) => u.trade),
      });
    }
    res.json({ ballpark: bp, disclaimer: offer.config.disclaimer });
  }

  async function handleRequest(a: Anchor, req: any, res: any) {
    const p = requestBodySchema.safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ message: "Invalid request", issues: p.error.issues });
    if (limited(res, rateAllow(`se-req-ip:${clientIp(req)}`, LIMITS.requestIp))) return;
    if (limited(res, rateAllow(`se-req:${a.est.id}`, LIMITS.requestDoc))) return;
    const offer = await offerFor(a);
    if (!offer.enabled) return res.status(409).json({ message: "Online estimates aren't available right now." });
    const r = await createRequest(a, p.data, req);
    if ("error" in r) return res.status(r.error).json({ message: r.message });
    res.json({ ok: true, ballpark: r.ballpark, repName: r.repName });
  }

  app.post("/api/public/estimates/:token/self-estimate/event", async (req: any, res) => {
    const a = await writable(req, res);
    if (a) await handleEvent(a, req, res);
  });
  app.post("/api/public/estimates/:token/self-estimate/quote", async (req: any, res) => {
    const a = await writable(req, res);
    if (a) await handleQuote(a, req, res);
  });
  app.post("/api/public/estimates/:token/self-estimate/request", async (req: any, res) => {
    const a = await writable(req, res);
    if (a) await handleRequest(a, req, res);
  });

  // ── Client portal (crm_client session) ────────────────────────────────────

  app.get("/api/client/self-estimate", async (req: any, res) => {
    if (limited(res, rateAllow(`se-read:${clientIp(req)}`, LIMITS.readIp))) return;
    const client = await requireClient(req, res);
    if (!client) return;
    const offers = [];
    for (const customerId of client.customerIds.slice(0, 10)) {
      const a = await portalAnchor(customerId);
      if (!a) continue;
      const offer = await offerFor(a);
      if (offer.enabled) offers.push({ customerId, ...offer });
    }
    res.json({ offers, preview: client.contractorPreview === true || undefined });
  });

  async function portalWritable(req: any, res: any): Promise<Anchor | null> {
    const client = await requireClient(req, res);
    if (!client) return null;
    if (client.contractorPreview) {
      res.status(403).json({ message: "This is a read-only preview of the client portal.", contractorPreview: true });
      return null;
    }
    const customerId = typeof req.body?.customerId === "string" ? req.body.customerId : "";
    // Only a customer this session covers — never another client's.
    if (!customerId || !client.customerIds.includes(customerId)) {
      res.status(404).json({ message: "Not found" });
      return null;
    }
    const a = await portalAnchor(customerId);
    if (!a) { res.status(409).json({ message: "Online estimates aren't available right now." }); return null; }
    return a;
  }

  app.post("/api/client/self-estimate/event", async (req: any, res) => {
    const a = await portalWritable(req, res);
    if (a) await handleEvent(a, req, res);
  });
  app.post("/api/client/self-estimate/quote", async (req: any, res) => {
    const a = await portalWritable(req, res);
    if (a) await handleQuote(a, req, res);
  });
  app.post("/api/client/self-estimate/request", async (req: any, res) => {
    const a = await portalWritable(req, res);
    if (a) await handleRequest(a, req, res);
  });
}
