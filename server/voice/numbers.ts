/**
 * Numbers: search / buy / list / release on SignalWire (SPEC.md §6 Numbers, §13).
 * OWNER: numbers+billing lane (LANES.md). Siblings: numbers-signalwire.ts
 * (LaML REST client), numbers.test.ts.
 *
 * Rules fixed by the architect:
 *   - every route goes through voiceContext (add-on module + manageSettings);
 *   - purchase is refused above the allowance (callAssistantAllowance) with the
 *     standard limit_reached body (addon: "call_number");
 *   - VoiceUrl / StatusCallback = voiceWebhookUrls() (proxy.ts), friendly name = org name;
 *   - release honours CALL_NUMBER_MIN_DAYS (voice_numbers.release_eligible_at; the
 *     response says the date when refused);
 *   - at most ONE real number in the whole build, label "constructhub-test",
 *     is_test = true; everything else is mocked in tests.
 *
 * The number is part of the service (owner, 2026-10-02): an ended subscription
 * or a removed add-on releases it automatically — number-release.ts schedules
 * it ('releasing' + release_reason) and releases it once eligible. A payment
 * that needs fixing only pauses the assistant (reads stay open here, buying
 * and releasing answer 402 payment_required — context.ts).
 *
 * Without SignalWire credentials every buy/release answers 503
 * signalwire_unconfigured and nothing is bought. VOICE_NUMBERS_MOCK=true (dev
 * boxes and the e2e lanes only) swaps in an in-memory carrier so the wizard
 * can be walked end to end; mock rows carry provider = "mock" and every
 * response says `mock: true`, so nobody mistakes one for a real line.
 */
import type { Express, Response } from "express";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { voiceNumbers, type VoiceNumberRow } from "@shared/schema";
import { CALL_ASSISTANT_SPAM } from "@shared/plan-copy";
import { ADDONS, CALL_ASSISTANT_NAME, CALL_ASSISTANT_TIERS, CALL_NUMBER_MIN_DAYS, PLANS, callAssistantTierOf } from "@shared/plans";
import { sendLimitReached, sendModulePaymentNeeded } from "../entitlements";
import { releaseReasonText, releaseIsFinal, FINAL_RELEASE_REASONS } from "./number-release";
import { voiceContext, type GetUser, type VoiceContext } from "./context";
import { voiceWebhookUrls } from "./proxy";
import {
  signalwireConfig, signalwireNumbers, isUsStateCode, toE164, areaCodeOf,
  SignalWireError, SignalWireNotConfiguredError, type AvailableNumber, type SignalWireNumbersClient,
} from "./numbers-signalwire";

export const TEST_NUMBER_LABEL = "constructhub-test";
/** Rows that hold a carrier number (count against the allowance). */
export const HELD_STATUSES = ["pending", "active", "releasing"] as const;
const LABEL_MAX = 60, LOCATION_MAX = 120;
/** A purchase still `pending` after this long was interrupted; it can be dismissed. */
const STALE_PENDING_MS = 10 * 60_000;

/** Forwarding instructions the Numbers tab shows (static copy; §13). Codes vary by line type — the copy says so. */
export const FORWARDING_CARRIERS: readonly { id: string; name: string; kind: "mobile" | "landline" | "tracking" | "tollfree" | "voip"; steps: string[]; off?: string; note?: string }[] = [
  { id: "att", name: "AT&T wireless", kind: "mobile", steps: ["Always: dial *21*<assistant number># and press call.", "Only when you don't answer: *61*<assistant number>#.", "Only when busy: *67*<assistant number>#.", "Only when unreachable / phone off: *62*<assistant number>#."], off: "Turn off: ##21# (always), ##61#, ##67#, ##62#.", note: "GSM codes; AT&T landlines use *72 / *73 instead." },
  { id: "verizon", name: "Verizon wireless", kind: "mobile", steps: ["Always: dial *72 followed by the assistant number and press call; hang up after the confirmation tone.", "Only when busy or unanswered: *71 followed by the assistant number."], off: "Turn off: dial *73.", note: "Verizon landline / Fios Digital Voice: *72 / *73, or Fios → Voice → Call Forwarding online." },
  { id: "tmobile", name: "T-Mobile", kind: "mobile", steps: ["Always: dial **21*<assistant number># and press call.", "Only when you don't answer: **61*<assistant number>#.", "Only when busy: **67*<assistant number>#.", "Only when unreachable: **62*<assistant number>#."], off: "Turn off: ##21# (always), ##61#, ##67#, ##62#." },
  { id: "spectrum", name: "Spectrum / Charter voice", kind: "landline", steps: ["Pick up, dial *72, wait for the tone, dial the assistant number; stay on until it answers (or hang up and repeat within two minutes).", "Or Spectrum.net → Voice → Call Forwarding → Always / Selective."], off: "Turn off: dial *73." },
  { id: "xfinity", name: "Comcast Xfinity Voice", kind: "landline", steps: ["Pick up, dial *72, wait for the tone, dial the assistant number; wait for the confirmation.", "Or the Xfinity app / xfinity.com → Voice → Call Forwarding (Always, Busy, No answer)."], off: "Turn off: dial *73." },
  { id: "googlevoice", name: "Google Voice", kind: "voip", steps: ["voice.google.com → Settings → Calls → add the assistant number as a linked number, or set 'Forward calls' to it.", "Business (Workspace) numbers: Admin → Google Voice → the user → Call forwarding."] },
  { id: "callrail", name: "CallRail tracking numbers", kind: "tracking", steps: ["Tracking → Numbers → open each tracking number → Routing → change the destination (ring-to) number to the assistant number.", "Turn OFF the Call Whisper on those numbers (the assistant would hear and answer it).", "Leave CallRail's call recording off for these lines — the assistant records every call itself — unless you want both copies.", "Keep the tracking number as the number on your site and ads; only its destination changes."], note: "The same steps apply to other tracking tools (CallTrackingMetrics, WhatConverts): change the destination, turn off whispers." },
  { id: "tollfree", name: "800 / toll-free numbers", kind: "tollfree", steps: ["Toll-free numbers forward at the toll-free carrier (the RespOrg), not with star codes: sign in there and change the ring-to / destination number to the assistant number.", "If an agency or phone vendor holds the number for you, send them the assistant number and ask for the ring-to change."] },
  { id: "other", name: "Other carriers and office phone systems", kind: "landline", steps: ["Most US landlines: *72 then the number (always), *73 to cancel; many support *92 / *93 for no-answer forwarding.", "VoIP / PBX systems (RingCentral, Nextiva, 8x8, Ooma, Dialpad): set the after-hours or no-answer rule to forward to the assistant number, then move to 'always' when you trust it."] },
];

export const FORWARDING_ADVICE = [
  `Start with no-answer / after-hours forwarding so the assistant only takes what you miss; switch to 'always' once you've listened to a few calls. ${CALL_ASSISTANT_SPAM.forwarding}`,
  "Call your own line after setting it up: the assistant should answer with your greeting. Caller-ID keeps showing the caller's number, so the CRM matches existing customers.",
  "Keep your old number on your website, trucks and ads — only where it rings changes.",
];

export type NumbersMock = {
  search: SignalWireNumbersClient["searchAvailable"];
  purchase: SignalWireNumbersClient["purchase"];
  release: SignalWireNumbersClient["release"];
};

export const numbersMockEnabled = () => /^(1|true|yes)$/i.test(process.env.VOICE_NUMBERS_MOCK ?? "");

/** Dev-box stand-in for the carrier: deterministic candidates, nothing bought anywhere. */
const MOCK_AREA_CODES: Record<string, string[]> = { WA: ["360", "206", "425", "253", "509"], FL: ["813", "727", "407", "305", "904"], TX: ["512", "214", "713", "210", "817"], CA: ["415", "213", "619", "916", "408"], NY: ["212", "718", "516", "585", "716"] };
export function mockCarrier(): NumbersMock {
  return {
    async search(p) {
      const state = p.state.toUpperCase();
      if (!isUsStateCode(state)) throw new SignalWireError(400, "Pick a US state (two-letter code).");
      const limit = Math.max(1, Math.min(20, p.limit ?? 10));
      const codes = p.areaCode ? [p.areaCode] : MOCK_AREA_CODES[state] ?? ["555"];
      const city = p.city?.trim() || null;
      return Array.from({ length: limit }, (_, i) => {
        const code = codes[i % codes.length];
        const e164 = `+1${code}555${String(100 + i).padStart(4, "0")}`;
        return { phoneNumber: e164, friendlyName: `(${code}) 555-${String(100 + i).padStart(4, "0")}`, locality: city ?? `Mock ${state} city ${(i % 3) + 1}`, region: state, areaCode: code, capabilities: { voice: true, sms: true, mms: false } } satisfies AvailableNumber;
      });
    },
    async purchase(p) {
      return { sid: `PNmock${p.phoneNumber.slice(2)}`, phoneNumber: p.phoneNumber, friendlyName: p.friendlyName, voiceUrl: p.voiceUrl, statusCallback: p.statusCallbackUrl, dateCreated: new Date().toISOString() };
    },
    async release() { return { released: true, alreadyGone: false }; },
  };
}

function signalwireCarrier(): NumbersMock {
  const sw = signalwireNumbers();
  return { search: (p) => sw.searchAvailable(p), purchase: (p) => sw.purchase(p), release: (sid) => sw.release(sid) };
}

/** The carrier the routes talk to: the mock on a dev box, SignalWire everywhere else. */
export function carrier(): { client: NumbersMock; mock: boolean } {
  if (numbersMockEnabled()) return { client: mockCarrier(), mock: true };
  return { client: signalwireCarrier(), mock: false };
}

/**
 * The carrier that holds an existing row's number: decided by the row, never
 * by the env, so turning VOICE_NUMBERS_MOCK on can't make a real SignalWire
 * number "release" through the mock while SignalWire keeps billing it.
 */
export function carrierForRow(row: Pick<VoiceNumberRow, "provider">): NumbersMock {
  return row.provider === "mock" ? mockCarrier() : signalwireCarrier();
}

/** A failure after which the purchase may or may not have gone through (timeout, connection drop, 5xx). */
export const purchaseOutcomeUnknown = (e: unknown) => e instanceof SignalWireError && e.status >= 500;

/** The org's numbers, oldest first (held ones first, released after). */
export async function listOrgNumbers(orgId: string): Promise<VoiceNumberRow[]> {
  return db.select().from(voiceNumbers).where(eq(voiceNumbers.orgId, orgId)).orderBy(asc(voiceNumbers.purchasedAt), asc(voiceNumbers.createdAt));
}

/**
 * Whether a row counts against the allowance: it holds a carrier number and is
 * not on a final release (a cancelled customer's old number, or one whose
 * release was already attempted — number-release.ts releaseIsFinal), so a
 * returning customer can buy a new number at once.
 */
export function countsAgainstAllowance(row: Pick<VoiceNumberRow, "status" | "releaseReason" | "lastError">): boolean {
  return (HELD_STATUSES as readonly string[]).includes(row.status)
    && !releaseIsFinal({ status: row.status, release_reason: row.releaseReason, last_error: row.lastError });
}

export async function heldNumberCount(orgId: string, tx: { select: typeof db.select } = db): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(voiceNumbers)
    .where(and(eq(voiceNumbers.orgId, orgId), inArray(voiceNumbers.status, [...HELD_STATUSES]),
      sql`NOT (${voiceNumbers.status} = 'releasing' AND ${voiceNumbers.releaseReason} IS NOT NULL
               AND (${inArray(voiceNumbers.releaseReason, [...FINAL_RELEASE_REASONS])} OR ${voiceNumbers.lastError} IS NOT NULL))`));
  return Number(row?.n ?? 0);
}

/** The numbers the tier itself includes (Solo 1, Crew 3, Fleet 5); every one above that is a call_number unit. */
function includedNumbers(v: VoiceContext): number {
  return Math.max(0, v.allowance.numbers - (v.ent.addons.call_number ?? 0));
}

/** What the next number costs the org per month: free while within the included ones, else the extra-number price. */
export function nextNumberMonthlyCents(v: VoiceContext, held: number): number {
  return held < includedNumbers(v) ? 0 : ADDONS.call_number.monthlyCents;
}

export function numberAllowance(v: VoiceContext, held: number) {
  return { numbers: v.allowance.numbers, used: held, remaining: Math.max(0, v.allowance.numbers - held), includedNumbers: includedNumbers(v), extraNumberMonthlyCents: ADDONS.call_number.monthlyCents };
}

function limitBody(v: VoiceContext, held: number) {
  const plan = v.ent.accessPlan ? PLANS[v.ent.accessPlan].name : "your";
  const sells = !!v.ent.accessPlan && ADDONS.call_number.availableOn.includes(v.ent.accessPlan);
  const n = v.allowance.numbers;
  const tier = callAssistantTierOf(v.ent.addons);
  const tierName = tier?.name ?? null;
  const bigger = tier ? CALL_ASSISTANT_TIERS.find((t) => t.includedNumbers > tier.includedNumbers) ?? null : null;
  return {
    feature: "voiceNumbers",
    limit: n,
    used: held,
    upgradePlan: null,
    addon: sells ? ("call_number" as const) : null,
    message: `Your ${CALL_ASSISTANT_NAME}${tierName ? ` ${tierName} tier` : ""} includes ${n} number${n === 1 ? "" : "s"} and all ${n === 1 ? "of it is" : "are"} in use.` +
      (sells ? ` To add another, add the ${ADDONS.call_number.name} add-on in Settings → Billing (${(ADDONS.call_number.monthlyCents / 100).toFixed(2).replace(/\.00$/, "")} dollars a month each)${bigger ? `, or move to ${bigger.name} (${bigger.includedNumbers} numbers included)` : ""}.` : ` The ${plan} plan cannot add more.`),
  };
}

export function releaseEligibleAt(purchasedAt: Date): Date {
  return new Date(purchasedAt.getTime() + CALL_NUMBER_MIN_DAYS * 86_400_000);
}

/** The row as the API returns it (dates as ISO strings; nothing secret on it). */
export function numberView(row: VoiceNumberRow) {
  return {
    id: row.id, phoneNumber: row.phoneNumber, label: row.label, location: row.location, state: row.state, areaCode: row.areaCode, locality: row.locality,
    provider: row.provider, providerSid: row.providerSid ? row.providerSid : null, friendlyName: row.friendlyName, voiceUrl: row.voiceUrl, statusCallbackUrl: row.statusCallbackUrl,
    status: row.status, isTest: row.isTest, forwardingFrom: row.forwardingFrom, monthlyCents: row.monthlyCents,
    purchasedAt: row.purchasedAt?.toISOString() ?? null, releaseEligibleAt: row.releaseEligibleAt?.toISOString() ?? null,
    releasable: row.status === "active" && !!row.releaseEligibleAt && row.releaseEligibleAt.getTime() <= Date.now(),
    releasedAt: row.releasedAt?.toISOString() ?? null, lastError: row.lastError, createdAt: row.createdAt?.toISOString() ?? null,
    /** Set when the number is being released automatically (number-release.ts): why, when decided; it goes on releaseEligibleAt. */
    releaseReason: row.releaseReason ?? null,
    releaseReasonText: row.releaseReason ? releaseReasonText(row.releaseReason) : null,
    releaseScheduledAt: row.releaseScheduledAt?.toISOString() ?? null,
  };
}
export type VoiceNumberView = ReturnType<typeof numberView>;

function carrierError(res: Response, e: unknown): boolean {
  if (e instanceof SignalWireNotConfiguredError) {
    res.status(503).json({ code: e.code, message: e.message });
    return true;
  }
  if (e instanceof SignalWireError) {
    const status = e.status === 400 || e.status === 404 || e.status === 409 ? e.status : 502;
    res.status(status).json({ code: "signalwire_error", status: e.status, message: e.status >= 500 || e.status === 502 ? `SignalWire could not complete that (${e.message}). Nothing changed.` : e.message });
    return true;
  }
  return false;
}

const str = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

export function registerVoiceNumberRoutes(app: Express, getDevUser: GetUser): void {
  /** GET ?state=WA&areaCode=360&city=Bellingham&contains=555&limit=10 → { numbers: [...], monthlyCents, mock } */
  app.get("/api/crm/voice/numbers/search", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const state = String(req.query.state ?? "").toUpperCase();
    if (!isUsStateCode(state)) return res.status(400).json({ message: "Pick a US state (two-letter code, e.g. WA)." });
    const areaCode = req.query.areaCode ? String(req.query.areaCode).replace(/\D/g, "") : "";
    if (areaCode && !/^\d{3}$/.test(areaCode)) return res.status(400).json({ message: "An area code is three digits." });
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 10));
    res.setHeader("Cache-Control", "no-store");
    // Paused for a payment: nothing can be bought, so don't offer numbers either.
    if (v.paused) return sendModulePaymentNeeded(res, "callAssistant");
    try {
      const { client, mock } = carrier();
      const numbers = await client.search({ state, areaCode: areaCode || undefined, city: str(req.query.city, 60) ?? undefined, contains: str(req.query.contains, 12) ?? undefined, limit });
      const held = await heldNumberCount(v.ctx.org.id);
      return res.json({ numbers, monthlyCents: nextNumberMonthlyCents(v, held), allowance: numberAllowance(v, held), mock });
    } catch (e) {
      if (carrierError(res, e)) return;
      throw e;
    }
  });

  /** GET → { numbers, allowance, forwarding: { carriers, advice }, webhooks, configured, mock } */
  app.get("/api/crm/voice/numbers", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const rows = await listOrgNumbers(v.ctx.org.id);
    const held = rows.filter(countsAgainstAllowance).length;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      numbers: rows.map(numberView),
      allowance: numberAllowance(v, held),
      nextNumberMonthlyCents: nextNumberMonthlyCents(v, held),
      minDays: CALL_NUMBER_MIN_DAYS,
      forwarding: { carriers: FORWARDING_CARRIERS, advice: FORWARDING_ADVICE },
      webhooks: voiceWebhookUrls(),
      configured: numbersMockEnabled() || signalwireConfig() !== null,
      mock: numbersMockEnabled(),
      canManage: v.ctx.permissions.manageSettings === true,
      /** The add-on is bought but paused until a payment goes through: the list is read-only. */
      paused: v.paused,
    });
  });

  /** POST { phoneNumber, label?, location?, forwardingFrom? } → 201 { number, mock } */
  app.post("/api/crm/voice/numbers", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const phoneNumber = toE164(String(req.body?.phoneNumber ?? ""));
    if (!phoneNumber) return res.status(400).json({ message: "Pick a number from the search results (a US number in E.164, like +13605550100)." });
    const label = str(req.body?.label, LABEL_MAX);
    const location = str(req.body?.location, LOCATION_MAX);
    const forwardingFrom = req.body?.forwardingFrom ? toE164(String(req.body.forwardingFrom)) : null;
    if (req.body?.forwardingFrom && !forwardingFrom) return res.status(400).json({ message: "The line you forward from must be a US phone number." });
    const isTest = label === TEST_NUMBER_LABEL;
    // The reserved label is the build's one test number: platform staff only (a customer org would block it
    // for everyone, and learn that it exists).
    if (isTest && !v.ent.isPlatformAdmin) return res.status(400).json({ message: `"${TEST_NUMBER_LABEL}" is reserved for the build's test number.` });
    const stateRaw = req.body?.state ? String(req.body.state).toUpperCase() : null;
    if (stateRaw && !isUsStateCode(stateRaw)) return res.status(400).json({ message: "State must be a two-letter US state code." });
    res.setHeader("Cache-Control", "no-store");

    let client: NumbersMock, mock: boolean;
    try { ({ client, mock } = carrier()); } catch (e) { if (carrierError(res, e)) return; throw e; }

    // Reserve the slot under the org's advisory lock: two buys at the limit can't both get through.
    type Reserved = { kind: "refused"; body: ReturnType<typeof limitBody> } | { kind: "conflict"; message: string } | { kind: "row"; row: VoiceNumberRow };
    const reserved: Reserved = await db.transaction(async (tx): Promise<Reserved> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7172, hashtext(${v.ctx.org.id}))`);
      const held = await heldNumberCount(v.ctx.org.id, tx);
      if (held >= v.allowance.numbers) return { kind: "refused", body: limitBody(v, held) };
      if (isTest) {
        const [other] = await tx.select({ id: voiceNumbers.id }).from(voiceNumbers)
          .where(and(eq(voiceNumbers.isTest, true), inArray(voiceNumbers.status, [...HELD_STATUSES]))).limit(1);
        if (other) return { kind: "conflict", message: "The build's one test number already exists; release it before buying another." };
      }
      const [existing] = await tx.select({ id: voiceNumbers.id, status: voiceNumbers.status }).from(voiceNumbers).where(eq(voiceNumbers.phoneNumber, phoneNumber)).limit(1);
      if (existing && (HELD_STATUSES as readonly string[]).includes(existing.status)) return { kind: "conflict", message: "That number is already taken. Search again and pick another." };
      if (existing) await tx.delete(voiceNumbers).where(eq(voiceNumbers.id, existing.id));
      const urls = voiceWebhookUrls();
      const [row] = await tx.insert(voiceNumbers).values({
        orgId: v.ctx.org.id, phoneNumber, label, location, state: stateRaw, areaCode: areaCodeOf(phoneNumber), locality: str(req.body?.locality, 80),
        provider: mock ? "mock" : "signalwire", friendlyName: v.ctx.org.name.slice(0, 64), voiceUrl: urls.voiceUrl, statusCallbackUrl: urls.statusCallbackUrl,
        status: "pending", isTest, forwardingFrom, monthlyCents: nextNumberMonthlyCents(v, held), purchasedAt: null, releaseEligibleAt: null,
      }).returning();
      return { kind: "row", row };
    });
    if (reserved.kind === "refused") return sendLimitReached(res, reserved.body);
    if (reserved.kind === "conflict") return res.status(409).json({ code: "number_taken", message: reserved.message });
    const pending = reserved.row;

    let bought: Awaited<ReturnType<NumbersMock["purchase"]>>;
    try {
      bought = await client.purchase({ phoneNumber, friendlyName: v.ctx.org.name.slice(0, 64), voiceUrl: pending.voiceUrl!, statusCallbackUrl: pending.statusCallbackUrl! });
    } catch (e: any) {
      if (purchaseOutcomeUnknown(e)) {
        // SignalWire may have bought it before the connection dropped: keep the
        // row as `failed` (it frees the slot) with the reason, so a person can
        // check the SignalWire dashboard instead of the number being forgotten.
        await db.update(voiceNumbers).set({
          status: "failed", updatedAt: new Date(),
          lastError: `Purchase not confirmed (${String(e?.message ?? e).slice(0, 200)}). Check SignalWire before buying it again.`,
        }).where(eq(voiceNumbers.id, pending.id));
      } else {
        // A clear refusal: nothing was bought, drop the reservation.
        await db.delete(voiceNumbers).where(eq(voiceNumbers.id, pending.id));
      }
      if (carrierError(res, e)) return;
      throw e;
    }
    // Bought. From here on a failure must not lose the SID: record it first.
    const purchasedAt = new Date();
    const [row] = await db.update(voiceNumbers).set({
      status: "active", providerSid: bought.sid, friendlyName: bought.friendlyName,
      purchasedAt, releaseEligibleAt: releaseEligibleAt(purchasedAt), lastError: null, updatedAt: purchasedAt,
    }).where(eq(voiceNumbers.id, pending.id)).returning();
    return res.status(201).json({ number: numberView(row), mock });
  });

  /** PATCH { label?, location?, forwardingFrom? } → { number } */
  app.patch("/api/crm/voice/numbers/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const patch: Partial<typeof voiceNumbers.$inferInsert> = { updatedAt: new Date() };
    if ("label" in (req.body ?? {})) {
      const label = str(req.body.label, LABEL_MAX);
      if (label === TEST_NUMBER_LABEL) return res.status(400).json({ message: `"${TEST_NUMBER_LABEL}" is reserved for the build's test number.` });
      patch.label = label;
    }
    if ("location" in (req.body ?? {})) patch.location = str(req.body.location, LOCATION_MAX);
    if ("forwardingFrom" in (req.body ?? {})) {
      const from = req.body.forwardingFrom ? toE164(String(req.body.forwardingFrom)) : null;
      if (req.body.forwardingFrom && !from) return res.status(400).json({ message: "The line you forward from must be a US phone number." });
      patch.forwardingFrom = from;
    }
    const [row] = await db.update(voiceNumbers).set(patch)
      .where(and(eq(voiceNumbers.id, String(req.params.id)), eq(voiceNumbers.orgId, v.ctx.org.id), ne(voiceNumbers.status, "released"))).returning();
    if (!row) return res.status(404).json({ message: "No such number in this workspace." });
    res.setHeader("Cache-Control", "no-store");
    res.json({ number: numberView(row) });
  });

  /** DELETE → { released: true, number } · { released: false, dismissed: true } for an unfinished purchase · 409 { code: "too_early", releaseEligibleAt } */
  app.delete("/api/crm/voice/numbers/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const [row] = await db.select().from(voiceNumbers).where(and(eq(voiceNumbers.id, String(req.params.id)), eq(voiceNumbers.orgId, v.ctx.org.id))).limit(1);
    if (!row) return res.status(404).json({ message: "No such number in this workspace." });
    res.setHeader("Cache-Control", "no-store");
    if (row.status === "released") return res.json({ released: true, number: numberView(row) });
    // A purchase that never completed (refused mid-flight, or a server stopped
    // during it) is dismissed without calling the carrier: nothing to release.
    const stalePending = row.status === "pending" && (row.updatedAt ?? row.createdAt ?? new Date()).getTime() < Date.now() - STALE_PENDING_MS;
    if (row.status === "failed" || stalePending) {
      await db.delete(voiceNumbers).where(eq(voiceNumbers.id, row.id));
      return res.json({ released: false, dismissed: true, message: "Removed the unfinished purchase. If SignalWire shows the number on the account, release it there." });
    }
    if (row.status === "releasing" && row.releaseReason) {
      const at = row.releaseEligibleAt ? row.releaseEligibleAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
      return res.status(409).json({
        code: "release_scheduled", releaseEligibleAt: row.releaseEligibleAt?.toISOString() ?? null,
        message: `${row.phoneNumber} is already being released because ${releaseReasonText(row.releaseReason)}${at ? `; it goes back to the carrier on ${at}` : ""}.`,
      });
    }
    if (row.status === "pending" || row.status === "releasing") return res.status(409).json({ code: "busy", message: "That number is still being set up or released. Try again in a minute." });
    const eligible = row.releaseEligibleAt ?? releaseEligibleAt(row.purchasedAt ?? new Date());
    if (eligible.getTime() > Date.now()) {
      return res.status(409).json({
        code: "too_early", releaseEligibleAt: eligible.toISOString(),
        message: `SignalWire keeps a number for at least ${CALL_NUMBER_MIN_DAYS} days. ${row.phoneNumber} can be released on ${eligible.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}.`,
      });
    }
    let client: NumbersMock;
    try { client = carrierForRow(row); } catch (e) { if (carrierError(res, e)) return; throw e; }
    await db.update(voiceNumbers).set({ status: "releasing", updatedAt: new Date() }).where(eq(voiceNumbers.id, row.id));
    try {
      if (row.providerSid) await client.release(row.providerSid);
      const [done] = await db.update(voiceNumbers).set({ status: "released", releasedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(voiceNumbers.id, row.id)).returning();
      return res.json({ released: true, number: numberView(done) });
    } catch (e: any) {
      await db.update(voiceNumbers).set({ status: "active", lastError: String(e?.message ?? e).slice(0, 300), updatedAt: new Date() }).where(eq(voiceNumbers.id, row.id));
      if (carrierError(res, e)) return;
      throw e;
    }
  });
}
