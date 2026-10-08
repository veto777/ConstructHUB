/**
 * SMS (SignalWire) — bid reminders by text, a test-send for Settings, and the
 * "client is reviewing their bid again — call them" engagement alert.
 *
 * SignalWire is the carrier: same delivery as Twilio at roughly half the
 * per-message cost, over a Twilio-compatible (LaML) API. Credentials come
 * from env (SIGNALWIRE_SPACE_URL / PROJECT_ID / API_TOKEN / FROM_NUMBER) and
 * are read AT CALL TIME, never cached at module scope, so smsConfigured()
 * always tells the truth about the process it's running in. When the env vars
 * are absent the provider seam falls back to a LOG provider that records each
 * message to tmp/sms-outbox.jsonl (override with SMS_OUTBOX_PATH) instead of
 * sending — dev and e2e exercise the exact production code path without a
 * carrier account, and the result names the provider so the UI never pretends
 * a text went out.
 *
 * Every text an org sends is metered by segment against the org owner's
 * monthly allowance (shared/plans.ts teamTextSegments) — see sendSms and
 * reserveSmsSegments below.
 */
import type { Express } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "../db";
import {
  crmCustomers, crmEstimates, crmMembers, crmOrgs, crmProjects,
  crmClientTokens,
  crmEngagementSessions, crmNotificationEnabled,
  crmNotificationChannel,
  crmNotifications,
  crmSmsOptouts,
  type CrmNotificationPref,
} from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { logActivity } from "./activity";
import { sendWithFallback } from "../email";
import { getBaseUrl } from "../auth";
import { portalBaseUrl } from "../site-context";
import { getEntitlements, sendLimitReached } from "../entitlements";
import { reserveQuotaFor, refundReservation, monthKey, type LimitReachedBody, type QuotaReservation } from "../growth-quotas";
import { PLANS, PLAN_KEYS, type PlanKey, type PlanLimits } from "@shared/plans";
import { logEvent, presentEstimate } from "./entities";
import { smsSegments } from "./sms-segments";
import { pushSoon } from "../apns";
import { getCrmEntitlements } from "./entitlements";
import { CRM_PLANS, CRM_PLAN_KEYS, type CrmPlanLimits } from "@shared/crm-plans";

type GetUser = (req: any, res: any) => any;

// ── Configuration ───────────────────────────────────────────────────────────

export const SIGNALWIRE_ENV_VARS = [
  "SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER",
] as const;

/** Names of the env vars that still need to be set (empty = fully configured). */
export function smsMissingEnv(): string[] {
  return SIGNALWIRE_ENV_VARS.filter((k) => !process.env[k]);
}

export function smsConfigured(): boolean {
  return smsMissingEnv().length === 0;
}

/** What the Settings card renders — never leaks the auth token. */
export function smsStatus(orgCustomFields?: unknown) {
  const missing = smsMissingEnv();
  // An org on its OWN account can text even when the platform has no carrier.
  const sender = resolveSmsSender(orgCustomFields);
  return {
    configured: Boolean(sender),
    // Only meaningful for platform/dedicated senders; a BYO org fills its own.
    missing,
    provider: sender ? "signalwire" : null,
    mode: sender?.mode ?? orgSmsConfig(orgCustomFields).mode,
    fromNumber: sender?.from ?? null,
    /** False on the shared platform number: carriers banned one platform
     *  texting on behalf of many businesses, so CLIENT-facing texts need the
     *  org's own registered number/account. Contractor-facing notifications
     *  (a brand texting its own users) stay allowed either way. */
    canTextClients: orgCanTextClients(orgCustomFields),
  };
}

// ── Plan entitlement ────────────────────────────────────────────────────────

/** Texting (client texts, reminders, alert texts) comes with plans that include
 *  team text alerts or client texting (shared/plans.ts): Pro, Growth, Agency. */
export const planIncludesTexting = (l: PlanLimits) => l.teamTextSegments !== 0 || l.clientTexting !== "none";
const TEXTING_PLANS = PLAN_KEYS.filter((k) => planIncludesTexting(PLANS[k].limits));
/** The cheapest plan with texting, for the 402 upgrade prompt. */
export const SMS_REQUIRED_PLAN: PlanKey = TEXTING_PLANS[0] ?? PLAN_KEYS[PLAN_KEYS.length - 1];
const listNames = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
/** CRM plans with texting (shared/crm-plans.ts) — the CRM is its own product, with its own text allowance. */
const crmIncludesTexting = (l: CrmPlanLimits) => l.teamTextSegments !== 0 || l.clientTexting !== "none";
const CRM_TEXTING_PLANS = CRM_PLAN_KEYS.filter((k) => crmIncludesTexting(CRM_PLANS[k].limits));
export const SMS_NEEDS_PLAN =
  `Text messaging is included with the ${listNames(CRM_TEXTING_PLANS.map((k) => CRM_PLANS[k].name))} plans. Change your CRM plan in Pricing to turn it on.`;
/** The 402 body when an org's plan has no texting. */
export const smsPlanRequired = () => ({ code: "plan_required", requiredPlan: SMS_REQUIRED_PLAN, message: SMS_NEEDS_PLAN, planAllowsSms: false });

const entitlementCache = new Map<string, { ok: boolean; at: number }>();

/** True when the org owner's ConstructHUB plan includes texting (an active or
 *  trialing plan; legacy Premium / Gold / Platinum map through LEGACY_PLAN_MAP),
 *  or the owner is a platform admin. Cached for a minute; a lookup failure
 *  denies (texts cost money). */
export async function orgSmsEntitled(orgId: string): Promise<boolean> {
  const hit = entitlementCache.get(orgId);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  let ok = false;
  try {
    const [org] = await db
      .select({ ownerUserId: crmOrgs.ownerUserId })
      .from(crmOrgs)
      .where(eq(crmOrgs.id, orgId))
      .limit(1);
    if (org) {
      // Texting comes with the owner's CRM plan (Essentials, Max) — or with a
      // ConstructHUB platform plan that lists team text alerts (Pro and up).
      const [ent, crm] = await Promise.all([getEntitlements(org.ownerUserId), getCrmEntitlements(org.ownerUserId)]);
      ok = ent.isPlatformAdmin || (!!ent.allowances && planIncludesTexting(ent.allowances))
        || (crm.active && !!crm.limits && crmIncludesTexting(crm.limits));
    }
  } catch (e: any) {
    console.error("[sms] plan check failed (not sending):", e?.message || e);
    return false;
  }
  entitlementCache.set(orgId, { ok, at: Date.now() });
  return ok;
}

/** Tests and plan changes: forget cached answers. */
export function clearSmsEntitlementCache(): void {
  entitlementCache.clear();
}

/** smsStatus plus the plan gate: an org without texting reads as not configured. */
export async function orgSmsStatus(org: { id: string; customFields: unknown }) {
  const status = smsStatus(org.customFields);
  if (await orgSmsEntitled(org.id)) return { ...status, planAllowsSms: true };
  return { ...status, configured: false, canTextClients: false, fromNumber: null, planAllowsSms: false, planMessage: SMS_NEEDS_PLAN };
}

// ── Monthly allowance (shared/plans.ts teamTextSegments) ────────────────────

/** Orgs already told this month that their allowance is spent: one log line per org per month. */
const limitWarned = new Set<string>();

type SmsMetered =
  | { ok: true; reservation: QuotaReservation | null; segments: number }
  /** `limit` is the 403 limit_reached body when the month's segments are spent (absent for a plan/lookup refusal). */
  | { ok: false; error: string; limit?: LimitReachedBody };

/**
 * Reserve the text's segments from the org owner's monthly allowance through
 * the same growth_budgets meter as every other monthly count (atomic, so
 * parallel sends can't overshoot; refundable when the send fails). The plan
 * resolves exactly as in orgSmsEntitled: the owner's effective plan (legacy
 * keys through LEGACY_PLAN_MAP), the top plan for platform admins. A lookup
 * failure denies — texts cost money. The first refusal of a month is logged;
 * later ones stay quiet, but every caller still gets the reason in its result.
 */
async function reserveSmsSegments(orgId: string, body: string): Promise<SmsMetered> {
  const segments = smsSegments(body);
  let result: Awaited<ReturnType<typeof reserveQuotaFor>>;
  try {
    const [org] = await db
      .select({ ownerUserId: crmOrgs.ownerUserId })
      .from(crmOrgs)
      .where(eq(crmOrgs.id, orgId))
      .limit(1);
    if (!org) return { ok: false, error: SMS_NEEDS_PLAN };
    // One monthly pool: the CRM plan's segments plus a platform plan's, if the owner has both.
    const crm = await getCrmEntitlements(org.ownerUserId);
    const crmTexts = crm.active && crm.limits && crm.plan ? { limit: crm.limits.teamTextSegments, planName: CRM_PLANS[crm.plan].name } : null;
    result = await reserveQuotaFor(org.ownerUserId, "texts", segments, crmTexts);
  } catch (e: any) {
    console.error("[sms] allowance check failed (not sending):", e?.message || e);
    return { ok: false, error: "This month's text allowance could not be checked — not sent." };
  }
  if (result.ok) return { ok: true, reservation: result.reservation, segments };
  if (result.status !== 403) return { ok: false, error: SMS_NEEDS_PLAN };
  const month = monthKey();
  if (!limitWarned.has(`${orgId}:${month}`)) {
    for (const k of limitWarned) if (!k.endsWith(`:${month}`)) limitWarned.delete(k);
    limitWarned.add(`${orgId}:${month}`);
    console.warn(`[sms] monthly text allowance spent for org ${orgId} — texts are skipped until the 1st (UTC). ${result.body.message}`);
  }
  return { ok: false, error: result.body.message, limit: result.body };
}

/** Tests: forget which orgs were already warned this month. */
export function clearSmsLimitWarnings(): void {
  limitWarned.clear();
}

// ── Per-org sender: shared platform number, own number, or own account ─────

/**
 * Every org picks how its texts go out (Settings → SMS):
 *   "platform"  — the shared ConstructHUB number (default; nothing to set up)
 *   "dedicated" — the org's own number, provisioned in ConstructHUB's carrier
 *                 account: platform credentials, THEIR number in the From
 *   "byo"       — the org's own SignalWire account entirely: their space,
 *                 project, token and number, billed and 10DLC-registered to
 *                 them. The token is encrypted at rest (AES-256-GCM).
 *
 * Anything missing or malformed falls back to the platform sender rather
 * than failing a send — an org can never silently lose its texts to a typo.
 */
export type OrgSmsMode = "platform" | "dedicated" | "byo";
export type OrgSmsConfig = {
  mode: OrgSmsMode;
  fromNumber?: string | null;
  spaceUrl?: string | null;
  projectId?: string | null;
  /** AES-256-GCM blob — never the raw token. */
  apiTokenEnc?: string | null;
};

const smsBoxKey = () =>
  createHash("sha256")
    .update(`sms-secret-box:${process.env.SESSION_SECRET || "dev-only-insecure-session-secret"}`)
    .digest();

export function encryptSmsSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", smsBoxKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
}

export function decryptSmsSecret(enc: string): string | null {
  try {
    const [v, iv, tag, ct] = enc.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", smsBoxKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function orgSmsConfig(customFields: unknown): OrgSmsConfig {
  const raw = (customFields as Record<string, any> | null | undefined)?.sms;
  const mode: OrgSmsMode =
    raw?.mode === "dedicated" || raw?.mode === "byo" ? raw.mode : "platform";
  return {
    mode,
    fromNumber: raw?.fromNumber ?? null,
    spaceUrl: raw?.spaceUrl ?? null,
    projectId: raw?.projectId ?? null,
    apiTokenEnc: raw?.apiTokenEnc ?? null,
  };
}

export type SmsSender = {
  space: string; project: string; token: string; from: string;
  /** Which of the three modes actually produced this sender. */
  mode: OrgSmsMode;
};

/** The platform sender from env, or null when the platform isn't configured. */
function platformSender(): Omit<SmsSender, "mode"> | null {
  if (!smsConfigured()) return null;
  return {
    space: process.env.SIGNALWIRE_SPACE_URL!.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    project: process.env.SIGNALWIRE_PROJECT_ID!,
    token: process.env.SIGNALWIRE_API_TOKEN!,
    from: process.env.SIGNALWIRE_FROM_NUMBER!,
  };
}

/**
 * Resolve who a given org's texts come FROM. Pure apart from env reads —
 * unit-tested. Returns null only when nothing can send at all.
 */
export function resolveSmsSender(customFields: unknown): SmsSender | null {
  const cfg = orgSmsConfig(customFields);
  const platform = platformSender();

  if (cfg.mode === "byo") {
    const token = cfg.apiTokenEnc ? decryptSmsSecret(cfg.apiTokenEnc) : null;
    const space = cfg.spaceUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") || null;
    if (space && cfg.projectId && token && cfg.fromNumber) {
      return { space, project: cfg.projectId, token, from: cfg.fromNumber, mode: "byo" };
    }
    return platform ? { ...platform, mode: "platform" } : null; // incomplete BYO → platform
  }

  if (cfg.mode === "dedicated" && cfg.fromNumber && platform) {
    // Their number, the platform's carrier account.
    return { ...platform, from: cfg.fromNumber, mode: "dedicated" };
  }

  return platform ? { ...platform, mode: "platform" } : null;
}

/** Client/homeowner texting is only allowed when the org brought its OWN
 *  registered number/account — never on the shared platform number. */
export function orgCanTextClients(customFields: unknown): boolean {
  const s = resolveSmsSender(customFields);
  return !!s && s.mode !== "platform";
}

/** The refusal reason the API returns (and the UI shows) when a platform-mode
 *  org tries to text a client. */
export const CLIENT_TEXT_NEEDS_OWN_NUMBER =
  "Client texting needs your own number — connect one in Settings → Text messaging";

// ── Opt-out suppression (carrier-required STOP/START) ───────────────────────

/** True while (orgId, phone) — or the platform-wide ('*', phone) — row exists. */
export async function isSmsOptedOut(orgId: string, phone: string): Promise<boolean> {
  const p = normalizePhone(phone);
  if (!p) return false;
  const [row] = await db.select({ id: crmSmsOptouts.id }).from(crmSmsOptouts)
    .where(and(inArray(crmSmsOptouts.orgId, [orgId, "*"]), eq(crmSmsOptouts.phone, p)))
    .limit(1);
  return !!row;
}

/** Record an opt-out. Idempotent via the (org_id, phone) unique index. */
export async function recordSmsOptout(orgId: string, phone: string, reason: string): Promise<void> {
  const p = normalizePhone(phone);
  if (!p) return;
  await db.insert(crmSmsOptouts).values({ orgId, phone: p, reason })
    .onConflictDoNothing({ target: [crmSmsOptouts.orgId, crmSmsOptouts.phone] });
}

/** START: every row for this phone comes off — the number may be texted again. */
export async function clearSmsOptout(phone: string): Promise<void> {
  const p = normalizePhone(phone);
  if (!p) return;
  await db.delete(crmSmsOptouts).where(eq(crmSmsOptouts.phone, p));
}

// ── The provider seam ───────────────────────────────────────────────────────

export type SmsResult = {
  ok: boolean;
  provider: "signalwire" | "log";
  sid?: string | null;
  error?: string | null;
  /** Segments charged to the org's monthly allowance (a refused or failed send charges none). */
  segments?: number;
  /** Set when the month's allowance refused the text: the 403 limit_reached body a manual route answers with. */
  limit?: LimitReachedBody;
};

const LOG_PATH = () => process.env.SMS_OUTBOX_PATH ?? path.join(process.cwd(), "tmp", "sms-outbox.jsonl");

/**
 * Dev/e2e provider: records instead of sends. Same call shape as the carrier, so
 * callers never branch on configuration — the RESULT tells them which
 * provider actually handled the message.
 */
function logProviderSend(to: string, body: string): SmsResult {
  const entry = { at: new Date().toISOString(), provider: "log", to, body };
  try {
    fs.mkdirSync(path.dirname(LOG_PATH()), { recursive: true });
    fs.appendFileSync(LOG_PATH(), JSON.stringify(entry) + "\n");
  } catch { /* a full disk must not break a bid reminder */ }
  console.log(`[SMS LOG] no carrier configured — recorded instead of sending (to: ${to})`);
  return { ok: true, provider: "log", sid: null };
}

/** SignalWire Compatibility API — Twilio-shaped: POST {space}/api/laml/2010-04-01/
 *  Accounts/{project}/Messages.json, basic auth project:token. */
async function signalwireSend(to: string, body: string, sender: SmsSender): Promise<SmsResult> {
  const { space, project, token, from } = sender;
  try {
    const resp = await fetch(
      `https://${space}/api/laml/2010-04-01/Accounts/${encodeURIComponent(project)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${project}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
      },
    );
    const payload: any = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = String(payload?.message ?? `SignalWire HTTP ${resp.status}`).slice(0, 300);
      console.error("[sms] SignalWire send failed:", msg);
      return { ok: false, provider: "signalwire", error: msg };
    }
    return { ok: true, provider: "signalwire", sid: payload?.sid ?? null };
  } catch (e: any) {
    console.error("[sms] SignalWire send failed:", e?.message || e);
    return { ok: false, provider: "signalwire", error: String(e?.message || e).slice(0, 300) };
  }
}

/**
 * Send a text: SignalWire when a sender resolves, the recording log provider
 * when nothing can send — check `result.provider` before telling a user a
 * text "went out". Pass the org's customFields to use ITS sender (own number
 * or own account); omit them for platform-level sends.
 *
 * Pass orgId whenever the org is known: a number on the opt-out list (STOP)
 * is SKIPPED and reported (`ok:false`, error names the opt-out) — never
 * thrown, never sent. A DB hiccup during the check fails OPEN (logged) so a
 * wobbly database can't take down notifications.
 *
 * With an org the text's segments are reserved from the owner's monthly
 * allowance first (reserveSmsSegments); a spent month is SKIPPED and reported
 * (`ok:false`, `limit` carries the 403 body for manual routes), and a send
 * the carrier refuses gives its segments back. Platform-level sends (no org)
 * belong to no allowance.
 */
export async function sendSms(
  to: string,
  body: string,
  orgCustomFields?: unknown,
  orgId?: string,
): Promise<SmsResult> {
  const sender = resolveSmsSender(orgCustomFields);
  if (orgId && orgId !== "*" && !(await orgSmsEntitled(orgId))) {
    return { ok: false, provider: sender ? "signalwire" : "log", sid: null, error: SMS_NEEDS_PLAN };
  }
  if (orgId) {
    try {
      if (await isSmsOptedOut(orgId, to)) {
        console.log(`[sms] suppressed — ${to} opted out (STOP) for org ${orgId}`);
        return {
          ok: false,
          provider: sender ? "signalwire" : "log",
          sid: null,
          error: "Recipient replied STOP — opted out of texts, not sent.",
        };
      }
    } catch (e: any) {
      console.error("[sms] opt-out check failed (sending anyway):", e?.message || e);
    }
  }
  // Charge the allowance after the opt-out check (a suppressed text costs
  // nothing) and before the carrier sees the text.
  let metered: SmsMetered | null = null;
  if (orgId && orgId !== "*") {
    metered = await reserveSmsSegments(orgId, body);
    if (!metered.ok) {
      return { ok: false, provider: sender ? "signalwire" : "log", sid: null, error: metered.error, limit: metered.limit };
    }
  }
  const result = sender ? await signalwireSend(to, body, sender) : logProviderSend(to, body);
  if (!result.ok) {
    // The text never went out: give its segments back.
    if (metered?.ok) await refundReservation(metered.reservation ?? undefined, metered.segments)
      .catch((e: any) => console.error("[sms] allowance refund failed:", e?.message || e));
    return result;
  }
  return metered?.ok ? { ...result, segments: metered.segments } : result;
}

/** Loose E.164 sanity: optional +, 7–15 digits. Returns null when unusable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return s.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

// ── Engagement re-engagement alert ──────────────────────────────────────────

/** UTC day key — the once-per-estimate-per-day idempotency unit. */
export function reengagementDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fire the "client is reviewing their bid — call them" alert. Callers decide
 * WHAT counts as a repeat open (a 2nd+ distinct engagement session, or a
 * deduped repeat view on the gated GET); this decides WHETHER to tell anyone:
 * once per estimate per UTC day, gated on the org's clientReengaged
 * notificationPref (default ON). Marks custom_fields->'reengagementAlerts'
 * by MERGING into the existing jsonb — never a wholesale replace.
 *
 * Email: the estimate's creator; fallback the admins of the estimate's
 * division; fallback the org owner(s). SMS: that person's member.phone
 * (falling back to the org phone when the target is the owner) — through the
 * same provider seam as everything else.
 *
 * Returns true when the alert fired (and the day marker was written).
 */
export async function maybeAlertReengagement(args: {
  est: typeof crmEstimates.$inferSelect;
  org: typeof crmOrgs.$inferSelect;
  cust: typeof crmCustomers.$inferSelect;
  req: any;
}): Promise<boolean> {
  const { est, org, cust, req } = args;
  if (!["inApp", "email", "sms"].some((c) => crmNotificationChannel(org.customFields, "clientReengaged", c as any))
      && !smsAlertsEnabled(org.customFields)) return false;

  const cf = { ...((est.customFields as Record<string, any> | null) ?? {}) };
  const prior = (cf.reengagementAlerts as { lastDay?: string; count?: number } | undefined) ?? null;
  const today = reengagementDayKey();
  if (prior?.lastDay === today) return false; // already alerted today

  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, est.orgId), eq(crmMembers.status, "active")));

  let targets = members.filter((m) => m.id === est.createdByMemberId);
  if (!targets.length && est.projectId) {
    const [p] = await db.select({ divisionId: crmProjects.divisionId }).from(crmProjects)
      .where(and(eq(crmProjects.orgId, est.orgId), eq(crmProjects.id, est.projectId))).limit(1);
    if (p?.divisionId) {
      targets = members.filter((m) => m.role === "admin" && m.divisionId === p.divisionId);
    }
  }
  if (!targets.length) targets = members.filter((m) => m.role === "owner");

  const clientLink = `${portalBaseUrl(req)}/crm/clients/${cust.id}`;
  const estLabel = est.number ? `estimate ${est.number}` : "their estimate";
  const total = money(est.totalCents);

  // Text the person who should make the call. The owner's fallback is the
  // org's main phone; anyone else without a mobile simply doesn't get a text.
  // The text honors the channel matrix like every other sms send: it fires
  // when the clientReengaged sms channel is ON, or when the org turned on the
  // legacy smsAlerts master toggle (the pre-matrix escape hatch).
  const smsOn = crmNotificationChannel(org.customFields, "clientReengaged", "sms")
    || smsAlertsEnabled(org.customFields);
  const smsPerson = !smsOn
    ? undefined
    : (targets.find((t) => t.phone) ?? targets.find((t) => t.role === "owner"));
  const smsTo = normalizePhone(smsPerson?.phone ?? (smsPerson?.role === "owner" ? org.phone : null));
  let smsResult: SmsResult | null = null;
  if (smsTo) {
    smsResult = await sendSms(
      smsTo,
      `${cust.displayName} is reviewing ${estLabel}${total ? ` (${total})` : ""} again — good time to call. ${clientLink}`,
      org.customFields,
      org.id,
    );
  }

  // Email when the channel is on — or when the text was skipped because the
  // month's text allowance is spent, so the alert still reaches someone.
  const emails = crmNotificationChannel(org.customFields, "clientReengaged", "email") || smsResult?.limit
    ? ([...new Set(targets.map((m) => m.email).filter(Boolean))] as string[])
    : [];

  if (emails.length) await sendWithFallback({
    to: emails.join(","),
    subject: `👀 ${cust.displayName} is reviewing ${estLabel} again — good time to call`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <p><strong>${esc(cust.displayName)}</strong> opened ${esc(estLabel)}${total ? ` (${total})` : ""} again.</p>
      <p>A second look usually means they're close to deciding — a quick call now wins the job.</p>
      <p><a href="${esc(clientLink)}">Open ${esc(cust.displayName)} in the CRM</a></p>
    </div>`,
  } as any).catch((e: any) => console.error("[crm] reengagement email failed:", e?.message || e));

  if (crmNotificationChannel(org.customFields, "clientReengaged", "inApp")) {
    await db.insert(crmNotifications).values(targets.map((m) => ({
      orgId: org.id, memberId: m.id, type: "clientReengaged",
      title: `${cust.displayName} is reviewing ${estLabel}${total ? ` (${total})` : ""} again — good time to call`,
      link: `/crm/clients/${cust.id}`,
    }))).catch((e: any) => console.error("[crm] reengagement notification failed:", e?.message || e));
    for (const m of targets) {
      if (m.userId) pushSoon(m.userId, "crm", { title: `${cust.displayName} is reviewing ${estLabel} again — good time to call`, link: `/crm/clients/${cust.id}` });
    }
  }

  // Mark AFTER the sends so a crashed alert can retry on the next open; the
  // day key still caps it at one alert per estimate per day.
  cf.reengagementAlerts = {
    lastDay: today,
    lastAlertedAt: new Date().toISOString(),
    count: (prior?.count ?? 0) + 1,
    emailedTo: emails,
    textedTo: smsResult?.ok ? smsTo : null,
    smsProvider: smsResult?.provider ?? null,
    smsError: smsResult?.error ?? null,
  };
  await db.update(crmEstimates).set({ customFields: cf, updatedAt: new Date() })
    .where(eq(crmEstimates.id, est.id));
  return true;
}

/**
 * Repeat-open detector for the engagement/start path: a 2nd+ DISTINCT
 * session on the same estimate means the client came back. First visit = 0
 * prior sessions = no alert (that's the "opened" notification's job).
 */
export async function priorEstimateSessionCount(estimateId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmEngagementSessions)
    .where(and(
      eq(crmEngagementSessions.docType, "estimate"),
      eq(crmEngagementSessions.docId, estimateId),
    ));
  return n;
}

// ── Inbound webhook (carrier-required STOP / HELP / START) ─────────────────

const SMS_STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const SMS_HELP_WORDS = new Set(["help", "info"]);
const SMS_START_WORDS = new Set(["start", "unstop", "yes"]);

/** LaML (Twilio-shaped) reply document. No message = an empty <Response/>. */
export function smsLamlReply(message?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${esc(message)}</Message>` : ""}</Response>`;
}

/**
 * Carrier-webhook verification. SignalWire signs like Twilio — HMAC-SHA1 of
 * url + concatenated sorted POST params, base64 — but the key is the
 * project's SIGNING KEY (Dashboard → API Credentials → Signing Key), NOT the
 * API token. Verified 2026-08-27: a real inbound signed by SignalWire did not
 * match the token, and every carrier STOP was being 403'd.
 *
 *  - SIGNALWIRE_SIGNING_KEY set → a signature is required and must match it (the API
 *    token is also accepted, for Twilio-shaped senders); wrong → rejected.
 *  - not set → we cannot verify, so a mismatch is logged (once) and ACCEPTED:
 *    an inbound STOP must never be dropped.
 *  - no signing key and no signature header → accepted for the legacy setup.
 */
let warnedNoSigningKey = false;

/** The request carries a signature that matches the signing key (or the API token). */
function signatureMatches(req: any): boolean {
  const sig = req.headers?.["x-signalwire-signature"] ?? req.headers?.["x-twilio-signature"];
  const keys = [process.env.SIGNALWIRE_SIGNING_KEY, process.env.SIGNALWIRE_API_TOKEN].filter((k): k is string => !!k);
  if (!sig || !keys.length) return false;
  const body = (req.body ?? {}) as Record<string, string>;
  const data = Object.keys(body).sort().map((k) => `${k}${body[k]}`).join("");
  const signed = `${getBaseUrl(req)}${req.originalUrl}${data}`;
  return keys.some((k) => {
    const expected = createHmac("sha1", k).update(signed).digest("base64");
    try {
      return timingSafeEqual(Buffer.from(String(sig)), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

/**
 * Strict: true only when the request is cryptographically verified. Anything
 * that changes state beyond the carrier-mandated STOP/START/HELP (Call
 * Assistant escalation confirmations) must use this, never the fail-open
 * signalwireSignatureOk.
 */
export function signalwireSignatureVerified(req: any): boolean {
  return signatureMatches(req);
}

export function signalwireSignatureOk(req: any): boolean {
  const sig = req.headers?.["x-signalwire-signature"] ?? req.headers?.["x-twilio-signature"];
  const signingKey = process.env.SIGNALWIRE_SIGNING_KEY;
  if (!sig) return !signingKey;
  const keys = [signingKey, process.env.SIGNALWIRE_API_TOKEN].filter((k): k is string => !!k);
  if (!keys.length) return true;
  if (signatureMatches(req)) return true;
  if (!signingKey) {
    if (!warnedNoSigningKey) {
      warnedNoSigningKey = true;
      console.warn("[sms] inbound webhook signature did not match SIGNALWIRE_API_TOKEN — SignalWire signs with the project SIGNING KEY. Set SIGNALWIRE_SIGNING_KEY (Dashboard → API Credentials) to enforce verification; accepting unverified inbound until then.");
    }
    return true;
  }
  return false;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerCrmSmsRoutes(app: Express, getDevUser: GetUser): void {
  /**
   * PUBLIC carrier webhook — SignalWire/Twilio LaML shape (form-encoded
   * From/To/Body). Handles the mandatory opt-out keywords and answers with
   * LaML XML. No auth: the carrier calls this, not a signed-in user.
   */
  app.post("/api/crm/sms/inbound", async (req: any, res) => {
    if (!signalwireSignatureOk(req)) return res.status(403).json({ message: "Bad webhook signature" });
    res.type("text/xml");

    const from = normalizePhone(req.body?.From);
    if (!from) return res.send(smsLamlReply());
    const keyword = String(req.body?.Body ?? "").trim().toLowerCase();

    if (SMS_STOP_WORDS.has(keyword)) {
      // Opt the phone out everywhere it is reachable: every org with a member
      // (or org main line) on that number, plus the '*' platform-wide row —
      // the shared number is ONE sender in the carriers' eyes, so a STOP to
      // it suppresses the phone for every org. A persistence failure still
      // gets the unsubscribe reply: the carrier contract is the reply.
      const digits = from.replace(/\D/g, "").slice(-10);
      try {
        const orgIds = new Set<string>(["*"]);
        const memberOrgs = await db.selectDistinct({ orgId: crmMembers.orgId }).from(crmMembers)
          .where(sql`regexp_replace(coalesce(${crmMembers.phone}, ''), '[^0-9]', '', 'g') like ${"%" + digits}`);
        memberOrgs.forEach((r) => orgIds.add(r.orgId));
        const orgRows = await db.select({ id: crmOrgs.id }).from(crmOrgs)
          .where(sql`regexp_replace(coalesce(${crmOrgs.phone}, ''), '[^0-9]', '', 'g') like ${"%" + digits}`);
        orgRows.forEach((r) => orgIds.add(r.id));
        for (const orgId of orgIds) await recordSmsOptout(orgId, from, keyword.toUpperCase());
      } catch (e: any) {
        console.error("[sms] inbound STOP persistence failed:", e?.message || e);
      }
      return res.send(smsLamlReply("ConstructHub: you are unsubscribed and will receive no more texts from us. Reply START to resubscribe, HELP for help."));
    }

    if (SMS_START_WORDS.has(keyword)) {
      await clearSmsOptout(from)
        .catch((e: any) => console.error("[sms] inbound START failed:", e?.message || e));
      return res.send(smsLamlReply("ConstructHub: you are resubscribed to account-notification texts. Reply STOP to unsubscribe, HELP for help."));
    }

    if (SMS_HELP_WORDS.has(keyword)) {
      return res.send(smsLamlReply("ConstructHub account alerts. Help: support@constructhub.us or portal.constructhub.us. Msg&data rates may apply. Reply STOP to opt out."));
    }

    // ── lane: calls+crm — Call Assistant escalation replies (after STOP/START/HELP, never before) ──
    // Any other text from a number that holds an open escalation (of the org
    // that sends from the `To` number) confirms it ("OK") or, after the
    // next-day follow-up, closes it ("DONE"); the sender gets a one-line ack.
    // A failure here is logged and the carrier still gets its normal reply.
    // Only a VERIFIED webhook with a `To` may change escalation state: the route itself fails open (an
    // unverifiable STOP must still be honoured), and an anonymous "OK" from an owner's number must not
    // silence urgent-escalation reminders.
    try {
      const to = normalizePhone(req.body?.To);
      if (to && signalwireSignatureVerified(req)) {
        const { confirmEscalationByReply } = await import("../voice/escalations");
        const touched = await confirmEscalationByReply(from, String(req.body?.Body ?? ""), to);
        if (touched > 0) return res.send(smsLamlReply("Got it, thanks."));
      }
    } catch (e: any) {
      console.error("[sms] escalation reply hook failed:", e?.message || e);
    }
    // ── end lane: calls+crm ──

    return res.send(smsLamlReply());
  });

  /** Settings card: configured/not-configured, naming the missing env vars. */
  app.get("/api/crm/sms/status", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    res.json(await orgSmsStatus(ctx.org));
  });

  /** Send a real test text — manageIntegrations only. Honest 503 when the
   *  carrier env vars are missing (the log provider is for system sends, not
   *  for pretending a test reached a phone). */
  /** The org's own sender setup: shared platform number, own number, or own
   *  SignalWire account. manageIntegrations only; the token is write-only
   *  (stored encrypted, never returned). */
  app.put("/api/crm/sms/sender", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageIntegrations")) return;
    if (!(await orgSmsEntitled(ctx.org.id))) return res.status(402).json(smsPlanRequired());

    const parsed = z.object({
      mode: z.enum(["platform", "dedicated", "byo"]),
      fromNumber: z.string().max(20).nullable().optional(),
      spaceUrl: z.string().max(200).nullable().optional(),
      projectId: z.string().max(100).nullable().optional(),
      /** Raw token — encrypted here, never stored or echoed in the clear. */
      apiToken: z.string().max(200).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid SMS sender", issues: parsed.error.issues });
    const p = parsed.data;

    const from = p.fromNumber ? normalizePhone(p.fromNumber) : null;
    if (p.mode !== "platform" && !from) {
      return res.status(400).json({ message: "A valid From number is required for your own number or account." });
    }
    if (p.mode === "byo" && !(p.spaceUrl && p.projectId)) {
      return res.status(400).json({ message: "Your own account needs a space URL and project id." });
    }

    const cf = { ...((ctx.org.customFields as Record<string, any> | null) ?? {}) };
    const prior = orgSmsConfig(cf);
    if (p.mode === "platform") {
      delete cf.sms;
    } else {
      cf.sms = {
        mode: p.mode,
        fromNumber: from,
        spaceUrl: p.mode === "byo" ? p.spaceUrl : null,
        projectId: p.mode === "byo" ? p.projectId : null,
        // Keep the stored token when the form leaves it blank (edit without
        // re-typing); clear it when switching away from BYO.
        apiTokenEnc: p.mode === "byo"
          ? (p.apiToken ? encryptSmsSecret(p.apiToken) : prior.apiTokenEnc ?? null)
          : null,
      };
      if (p.mode === "byo" && !cf.sms.apiTokenEnc) {
        return res.status(400).json({ message: "Your own account needs an API token." });
      }
    }
    const [row] = await db.update(crmOrgs)
      .set({ customFields: cf, updatedAt: new Date() })
      .where(eq(crmOrgs.id, ctx.org.id)).returning();
    res.json(await orgSmsStatus(row));
  });

  app.post("/api/crm/sms/test", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageIntegrations")) return;
    if (!(await orgSmsEntitled(ctx.org.id))) return res.status(402).json(smsPlanRequired());

    if (!smsConfigured()) {
      return res.status(503).json({
        message: `SMS is not configured — set ${smsMissingEnv().join(", ")} on the server.`,
        missing: smsMissingEnv(),
      });
    }

    const parsed = z.object({
      to: z.string().min(7).max(24),
      body: z.string().max(1600).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid test text", issues: parsed.error.issues });

    const to = normalizePhone(parsed.data.to);
    if (!to) return res.status(400).json({ message: "That doesn't look like a phone number." });

    const result = await sendSms(to, parsed.data.body?.trim() || `Test text from ${ctx.org.name} — SMS is working.`, ctx.org.customFields, ctx.org.id);
    if (result.limit) return sendLimitReached(res, result.limit);
    if (!result.ok) return res.status(502).json({ message: `SignalWire rejected the text: ${result.error}` });
    res.json({ ok: true, provider: result.provider, sid: result.sid, to });
  });

  /**
   * Bid reminder: re-email the estimate link (existing resend path) and, when
   * the client has a phone, text it too. Every reminder is appended to
   * estimate custom_fields->'reminders' (who/when/channel) — merged into the
   * existing jsonb, never clobbered.
   */
  app.post("/api/crm/estimates/:id/remind", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageEstimates")) return;

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!est.sentAt) return res.status(409).json({ message: "Send the estimate before reminding about it." });
    if (est.approvedAt) return res.status(409).json({ message: "This estimate has been approved — no reminder needed." });
    if (est.declinedAt) return res.status(409).json({ message: "This estimate has been declined." });

    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found" });

    const to = cust.email || est.sentToEmail;
    const phone = normalizePhone(cust.phone);
    if (!to && !phone) {
      return res.status(400).json({ message: "This client has no email address or phone number. Add one first." });
    }

    const base = getBaseUrl(req);
    // First-open pass, exactly like the original send (portal.ts): clicking
    // from the inbox proves inbox possession, so the reminder's own link signs
    // the client straight in instead of landing on the "email me a secure
    // link" gate. Single-use; valid as long as the estimate is.
    const now = Date.now();
    const passExpiresAt = est.expiresAt && est.expiresAt.getTime() > now
      ? est.expiresAt
      : new Date(now + 7 * 86_400_000);
    const pass = randomBytes(32).toString("hex");
    await db.insert(crmClientTokens).values({
      tokenHash: createHash("sha256").update(pass).digest("hex"),
      customerIds: [cust.id],
      email: (to ?? cust.email ?? est.sentToEmail ?? "").toLowerCase(),
      expiresAt: passExpiresAt,
    });
    const link = `${base}/e/${est.publicToken}?k=${pass}`;
    const estLabel = est.number ? `estimate ${est.number}` : "your estimate";
    const total = money(est.totalCents);

    // Email — the same resend path as the original send.
    let emailed = false;
    let emailError: string | null = null;
    if (to) {
      try {
        await sendWithFallback({
          to,
          subject: `Reminder: ${estLabel} from ${ctx.org.name} is waiting`,
          html: `
            <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;padding:28px 24px">
              <p style="font-size:16px">Hi ${esc(cust.displayName)},</p>
              <p style="font-size:16px">Just a friendly reminder from <strong>${esc(ctx.org.name)}</strong> —
                 ${esc(estLabel)}${total ? ` for <strong>${total}</strong>` : ""} is still waiting for your answer.</p>
              <p style="text-align:center;margin:30px 0 18px">
                <a href="${link}" style="background:#2563eb;color:#fff;padding:14px 34px;border-radius:24px;
                   text-decoration:none;font-weight:600;font-size:16px;display:inline-block">View estimate</a>
              </p>
              <p style="font-size:12px;color:#999;word-break:break-all">If the button doesn't work, paste this into your browser: ${link}</p>
            </div>`,
          replyTo: ctx.org.email || undefined,
        } as any);
        emailed = true;
      } catch (e: any) {
        emailError = String(e?.message || e).slice(0, 300);
        console.error("[crm] estimate reminder email failed:", emailError);
      }
    }

    // Text — only when the client has a usable phone AND the org may text
    // clients at all (own registered number/account — never the shared
    // platform number). `provider` says whether it really went out
    // (signalwire) or was recorded (log, unconfigured dev).
    let texted = false;
    let smsProvider: SmsResult["provider"] | null = null;
    let smsError: string | null = null;
    if (phone) {
      if (!orgCanTextClients(ctx.org.customFields)) {
        smsError = CLIENT_TEXT_NEEDS_OWN_NUMBER;
      } else {
        const r = await sendSms(
          phone,
          `${ctx.org.name}: reminder — ${estLabel}${total ? ` for ${total}` : ""} is waiting: ${link}`,
          ctx.org.customFields,
          ctx.org.id,
        );
        texted = r.ok;
        smsProvider = r.provider;
        smsError = r.error ?? null;
      }
    }

    // Record who/when/channel — append into custom_fields->'reminders'.
    const cf = { ...((est.customFields as Record<string, any> | null) ?? {}) };
    const reminders = [...(Array.isArray(cf.reminders) ? cf.reminders : [])];
    reminders.push({
      at: new Date().toISOString(),
      by: ctx.member.id,
      channel: [emailed ? "email" : null, texted ? "sms" : null].filter(Boolean).join("+") || "none",
      email: to ?? null,
      phone: texted ? phone : null,
      smsProvider,
      emailed, emailError, smsError,
    });
    cf.reminders = reminders;
    const [row] = await db.update(crmEstimates).set({ customFields: cf, updatedAt: new Date() })
      .where(eq(crmEstimates.id, est.id)).returning();

    await logEvent(ctx.org.id, est.id, "reminded", ctx.member.id, req, {
      to, emailed, emailError, texted, smsProvider, smsError,
    });
    logActivity(ctx, "estimate.reminded", {
      entityType: "estimate", entityId: est.id, customerId: est.customerId,
      meta: { number: est.number, to: to ?? (texted ? phone : null), emailed, texted },
    });

    res.json({
      estimate: presentEstimate(row, ctx), link, reminders,
      emailed, emailError, texted, smsProvider, smsError,
    });
  });
}

// ── Owner text alerts (money events) ────────────────────────────────────────

/**
 * Text the org's owner(s) when something important happens — a signed
 * approval, money landing. Opt-in per org via customFields.smsAlerts
 * (default OFF: texting costs money and nobody should be surprised by it;
 * the matching EMAIL notification is what's on by default).
 *
 * Recipients: active owner members' mobiles, falling back to the org's main
 * phone. Best-effort — a carrier hiccup never breaks an approval or a payment.
 */
/** Org default for "text the estimate link when I send a bid" (default OFF). */
export function smsEstimatesDefault(customFields: unknown): boolean {
  return (customFields as Record<string, unknown> | null | undefined)?.smsEstimates === true;
}

export function smsAlertsEnabled(customFields: unknown): boolean {
  const v = (customFields as Record<string, unknown> | null | undefined)?.smsAlerts;
  return v === true;
}

/** What came of the owner texts: how many went out, and the allowance refusal when the month is spent (callers fall back to email). */
export type OwnerTextOutcome = { sent: number; limit: LimitReachedBody | null };

export async function textOrgOwners(
  org: typeof crmOrgs.$inferSelect,
  body: string,
  pref?: CrmNotificationPref,
): Promise<OwnerTextOutcome> {
  const outcome: OwnerTextOutcome = { sent: 0, limit: null };
  // The legacy master toggle OR the per-event text channel from Settings.
  const perPref = pref ? crmNotificationChannel(org.customFields, pref, "sms") : false;
  if (!smsAlertsEnabled(org.customFields) && !perPref) return outcome;
  if (!resolveSmsSender(org.customFields)) return outcome; // no sender → say nothing

  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));
  const numbers = new Set<string>();
  for (const m of members) {
    if (m.role !== "owner") continue;
    const p = normalizePhone(m.phone);
    if (p) numbers.add(p);
  }
  if (!numbers.size) {
    const fallback = normalizePhone(org.phone);
    if (fallback) numbers.add(fallback);
  }
  for (const to of numbers) {
    const r = await sendSms(to, body, org.customFields, org.id).catch((e: any) => {
      console.error("[crm] owner text alert failed:", e?.message || e);
      return null;
    });
    if (r?.ok) outcome.sent++;
    if (r?.limit) outcome.limit = r.limit;
  }
  return outcome;
}
