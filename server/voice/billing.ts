/**
 * Call Assistant billing: usage, overage metering and the Overview status
 * (SPEC.md § CRM API → Overview / Usage). OWNER: numbers+billing lane.
 *
 * Fixed by the architect:
 *   - the add-on block in shared/plans.ts (the four tiers in
 *     CALL_ASSISTANT_TIERS — call_assistant_lite, call_assistant = Solo,
 *     call_assistant_crew, call_assistant_fleet, each with its own overage
 *     rate — call_number, CALL_ASSISTANT_FREE_SPAM_CALLS) — the lane
 *     owns it from here on, and removes `preview` only when the owner confirms;
 *   - voice_usage is the meter (server/voice/schema.ts): minutes per org per
 *     month, included snapshot, overage billed to Stripe (billing-usage.ts);
 *   - GET /api/crm/voice/status is the one route that answers WITHOUT the add-on
 *     (skipModule), so the Overview tab can show the plan prompt itself.
 *
 * Buying the add-on itself is the EXISTING add-on machinery
 * (POST /api/stripe/addons → server/billing/order.ts checkAddonsForPlan →
 * Stripe subscription items): nothing voice-specific is needed there, and the
 * `preview` flag is what keeps it refused until the owner confirms pricing.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { voiceProfiles } from "@shared/schema";
import { voiceContext, type GetUser } from "./context";
import { moduleEnabled, modulePaused, BILLING_HREF } from "../entitlements";
import {
  ADDONS, CALL_ASSISTANT_TIERS, CALL_ASSISTANT_NAME, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_NUMBER_MIN_DAYS,
  callAssistantTier, callAssistantTierOf,
} from "@shared/plans";
import { voiceInternalConfigured } from "./internal-auth";
import { voiceEngineUrl } from "./proxy";
import { recordEngineHealth } from "../ops/call-assistant";

const engineHost = () => { try { return new URL(voiceEngineUrl()).host; } catch { return "unknown"; } };
import { listOrgNumbers, numberView, numberAllowance, countsAgainstAllowance, numbersMockEnabled } from "./numbers";
import { signalwireConfig } from "./numbers-signalwire";
import { releaseIsFinal } from "./number-release";
import { getVoiceUsageRow, listVoiceUsage, summarizeVoiceUsage, voiceMonthKey } from "./billing-usage";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type EngineStatus = { configured: boolean; reachable: boolean; models: boolean; checkedAt: string };
const ENGINE_PROBE_TTL_MS = 30_000;
let engineProbe: { at: number; value: Promise<Omit<EngineStatus, "configured">> } | null = null;

/** Is the engine actually up? GET `${VOICE_ENGINE_URL}/health` with a short timeout, cached ~30 s. */
export function probeEngine(now = Date.now()): Promise<Omit<EngineStatus, "configured">> {
  if (engineProbe && now - engineProbe.at < ENGINE_PROBE_TTL_MS) return engineProbe.value;
  const value = (async () => {
    const checkedAt = new Date(now).toISOString();
    let status: Omit<EngineStatus, "configured">;
    try {
      const r = await fetch(`${voiceEngineUrl()}/health`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) status = { reachable: false, models: false, checkedAt };
      else {
        const j = (await r.json().catch(() => null)) as { ok?: boolean; models?: boolean } | null;
        status = { reachable: j?.ok === true, models: j?.models === true, checkedAt };
      }
    } catch {
      status = { reachable: false, models: false, checkedAt };
    }
    // The issue desk hears about an engine this app is wired to (secret set) that is down or model-less.
    if (voiceInternalConfigured()) recordEngineHealth(status, engineHost());
    return status;
  })();
  engineProbe = { at: now, value };
  return value;
}
export function resetEngineProbe(): void { engineProbe = null; }

/**
 * Production: probe the engine every 5 minutes while any number is active, so
 * an outage reaches the issue desk even when nobody opens the Call Assistant
 * page (the probe records it — see probeEngine). Off elsewhere unless
 * VOICE_ENGINE_WATCH=1. Never throws; the timer is unref'd.
 */
export function startEngineHealthWatch(intervalMs = 5 * 60_000): ReturnType<typeof setInterval> | null {
  if (process.env.NODE_ENV !== "production" && process.env.VOICE_ENGINE_WATCH !== "1") return null;
  const tick = async () => {
    try {
      if (!voiceInternalConfigured()) return;
      const { pool } = await import("../db");
      const { rows } = await pool.query("SELECT 1 FROM voice_numbers WHERE status = 'active' LIMIT 1");
      if (rows.length) await probeEngine();
    } catch { /* the next tick tries again */ }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  return timer;
}

export function registerVoiceBillingRoutes(app: Express, getDevUser: GetUser): void {
  /**
   * Overview status. Answers for every org member; `enabled` is false (with
   * the add-on to buy) when the owner's subscription lacks the add-on. With
   * it, the numbers, the profile's state and this month's minutes come too.
   * `paused` (enabled false) = the add-on is bought but the subscription needs
   * a payment: the assistant doesn't answer, the numbers are held, and the
   * Overview says "Paused — update your payment method" (billingHref).
   */
  app.get("/api/crm/voice/status", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { skipModule: true });
    if (!v) return;
    const enabled = moduleEnabled(v.ent, "callAssistant");
    const paused = modulePaused(v.ent, "callAssistant");
    res.setHeader("Cache-Control", "no-store");
    // A paused add-on keeps showing what it bought (the stored row).
    const heldAddons = Object.keys(v.ent.addons).length ? v.ent.addons : v.ent.storedAddons;
    const tier = callAssistantTierOf(heldAddons);
    const entry = ADDONS[tier?.addon ?? "call_assistant"];
    const base = {
      enabled,
      paused,
      pausedReason: paused ? ("payment_needed" as const) : null,
      billingHref: BILLING_HREF,
      subscriptionStatus: v.ent.subscriptionStatus,
      // `addon` is the held tier's add-on (Solo when none is held: the one a prompt offers).
      addon: { key: entry.key, name: CALL_ASSISTANT_NAME, preview: entry.preview === true, availableOn: entry.availableOn, monthlyCents: entry.monthlyCents, annualCents: entry.annualCents, extraNumber: { key: ADDONS.call_number.key, name: ADDONS.call_number.name, monthlyCents: ADDONS.call_number.monthlyCents, preview: ADDONS.call_number.preview === true } },
      /** The held tier (null without one — a platform admin has the add-on, unlimited minutes, without holding a tier). */
      tier: tier ? { key: tier.tier, addon: tier.addon, name: tier.name } : null,
      tiers: CALL_ASSISTANT_TIERS.map((t) => ({
        key: t.tier, addon: t.addon, name: t.name, monthlyCents: t.monthlyCents, annualCents: t.annualCents,
        includedMinutes: t.includedMinutes, includedNumbers: t.includedNumbers, overageCentsPerMinute: t.overageCentsPerMinute, preview: ADDONS[t.addon].preview === true,
      })),
      plan: v.ent.accessPlan,
      allowance: v.allowance,
      units: { callAssistant: tier ? 1 : 0, tier: tier?.tier ?? null, callNumber: heldAddons.call_number ?? 0 },
      pricing: {
        // Without a held tier: Solo's (the tier a prompt offers; an admin's own minutes are unlimited — `allowance`).
        includedMinutes: (tier ?? callAssistantTier("solo")).includedMinutes, overageCentsPerMinute: (tier ?? callAssistantTier("solo")).overageCentsPerMinute,
        numberMinDays: CALL_NUMBER_MIN_DAYS, freeSpamCalls: CALL_ASSISTANT_FREE_SPAM_CALLS,
      },
      // The engine's internal address never goes to the browser; only whether it answers.
      engine: { configured: voiceInternalConfigured(), ...(await probeEngine()) } satisfies EngineStatus,
      numbersProvider: { configured: numbersMockEnabled() || signalwireConfig() !== null, mock: numbersMockEnabled() },
      canManage: v.ctx.permissions.manageSettings === true,
    };
    if (!enabled && !paused) return res.json({ ...base, numbers: [], profile: null, usage: null });
    const orgId = v.ctx.org.id;
    const month = voiceMonthKey();
    const [rows, profile, usageRow] = await Promise.all([
      listOrgNumbers(orgId),
      db.select({ status: voiceProfiles.status, publishedVersion: voiceProfiles.publishedVersion, setupCompletedAt: voiceProfiles.setupCompletedAt, updatedAt: voiceProfiles.updatedAt })
        .from(voiceProfiles).where(eq(voiceProfiles.orgId, orgId)).limit(1).then((r) => r[0] ?? null),
      getVoiceUsageRow(orgId, month),
    ]);
    const held = rows.filter(countsAgainstAllowance).length;
    // For the "paused" banner: can a fixed card still keep the number ("releasing"),
    // or has it gone / is its release final ("released")? null = no automatic release.
    const auto = rows.filter((r) => !r.isTest && r.releaseReason && (r.status === "releasing" || r.status === "released"));
    const numberRelease = auto.some((r) => r.status === "releasing" && !releaseIsFinal({ status: r.status, release_reason: r.releaseReason, last_error: r.lastError }))
      ? "releasing" as const : auto.length ? "released" as const : null;
    res.json({
      ...base,
      numberRelease,
      numbers: rows.filter((r) => r.status !== "released").map(numberView),
      numberAllowance: numberAllowance(v, held),
      profile: profile ? { status: profile.status, publishedVersion: profile.publishedVersion, setupCompletedAt: profile.setupCompletedAt?.toISOString() ?? null, updatedAt: profile.updatedAt?.toISOString() ?? null } : null,
      usage: summarizeVoiceUsage(usageRow, month, v.allowance.minutes, v.allowance.overageCentsPerMinute),
    });
  });

  /** GET ?month=YYYY-MM → this month's summary (or the asked month) plus `history` (newest first). */
  app.get("/api/crm/voice/usage", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const asked = req.query.month ? String(req.query.month) : voiceMonthKey();
    if (!MONTH_RE.test(asked)) return res.status(400).json({ message: "month must look like 2026-10." });
    const orgId = v.ctx.org.id;
    const [row, history] = await Promise.all([getVoiceUsageRow(orgId, asked), listVoiceUsage(orgId, 12)]);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ...summarizeVoiceUsage(row, asked, v.allowance.minutes, v.allowance.overageCentsPerMinute),
      allowance: v.allowance,
      history: history.map((h) => summarizeVoiceUsage(h, h.month, h.includedMinutes ?? v.allowance.minutes, v.allowance.overageCentsPerMinute)),
    });
  });
}
