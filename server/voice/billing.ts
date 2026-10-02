/**
 * Call Assistant billing: usage, overage metering and the Overview status
 * (SPEC.md § CRM API → Overview / Usage). OWNER: numbers+billing lane.
 *
 * Fixed by the architect:
 *   - the add-on block in shared/plans.ts (call_assistant / call_number,
 *     CALL_ASSISTANT_INCLUDED_MINUTES, CALL_MINUTE_OVERAGE_CENTS) — the lane
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
import { moduleEnabled } from "../entitlements";
import { ADDONS, CALL_ASSISTANT_INCLUDED_MINUTES, CALL_MINUTE_OVERAGE_CENTS, CALL_NUMBER_MIN_DAYS } from "@shared/plans";
import { voiceInternalConfigured } from "./internal-auth";
import { voiceEngineUrl, voicePublicBase } from "./proxy";
import { listOrgNumbers, numberView, numberAllowance, HELD_STATUSES, numbersMockEnabled } from "./numbers";
import { signalwireConfig } from "./numbers-signalwire";
import { getVoiceUsageRow, listVoiceUsage, summarizeVoiceUsage, voiceMonthKey } from "./billing-usage";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function registerVoiceBillingRoutes(app: Express, getDevUser: GetUser): void {
  /**
   * Overview status. Answers for every org member; `enabled` is false (with
   * the add-on to buy) when the owner's subscription lacks the add-on. With
   * it, the numbers, the profile's state and this month's minutes come too.
   */
  app.get("/api/crm/voice/status", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { skipModule: true });
    if (!v) return;
    const enabled = moduleEnabled(v.ent, "callAssistant");
    res.setHeader("Cache-Control", "no-store");
    const base = {
      enabled,
      addon: { key: ADDONS.call_assistant.key, name: ADDONS.call_assistant.name, preview: ADDONS.call_assistant.preview === true, availableOn: ADDONS.call_assistant.availableOn, monthlyCents: ADDONS.call_assistant.monthlyCents, extraNumber: { key: ADDONS.call_number.key, name: ADDONS.call_number.name, monthlyCents: ADDONS.call_number.monthlyCents, preview: ADDONS.call_number.preview === true } },
      plan: v.ent.accessPlan,
      allowance: v.allowance,
      units: { callAssistant: v.ent.addons.call_assistant ?? 0, callNumber: v.ent.addons.call_number ?? 0 },
      pricing: { includedMinutes: CALL_ASSISTANT_INCLUDED_MINUTES, overageCentsPerMinute: CALL_MINUTE_OVERAGE_CENTS, numberMinDays: CALL_NUMBER_MIN_DAYS },
      engine: { configured: voiceInternalConfigured(), url: voiceEngineUrl(), publicBase: voicePublicBase() },
      numbersProvider: { configured: numbersMockEnabled() || signalwireConfig() !== null, mock: numbersMockEnabled() },
      canManage: v.ctx.permissions.manageSettings === true,
    };
    if (!enabled) return res.json({ ...base, numbers: [], profile: null, usage: null });
    const orgId = v.ctx.org.id;
    const month = voiceMonthKey();
    const [rows, profile, usageRow] = await Promise.all([
      listOrgNumbers(orgId),
      db.select({ status: voiceProfiles.status, publishedVersion: voiceProfiles.publishedVersion, setupCompletedAt: voiceProfiles.setupCompletedAt, updatedAt: voiceProfiles.updatedAt })
        .from(voiceProfiles).where(eq(voiceProfiles.orgId, orgId)).limit(1).then((r) => r[0] ?? null),
      getVoiceUsageRow(orgId, month),
    ]);
    const held = rows.filter((r) => (HELD_STATUSES as readonly string[]).includes(r.status)).length;
    res.json({
      ...base,
      numbers: rows.filter((r) => r.status !== "released").map(numberView),
      numberAllowance: numberAllowance(v, held),
      profile: profile ? { status: profile.status, publishedVersion: profile.publishedVersion, setupCompletedAt: profile.setupCompletedAt?.toISOString() ?? null, updatedAt: profile.updatedAt?.toISOString() ?? null } : null,
      usage: summarizeVoiceUsage(usageRow, month, v.allowance.minutes),
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
      ...summarizeVoiceUsage(row, asked, v.allowance.minutes),
      allowance: v.allowance,
      history: history.map((h) => summarizeVoiceUsage(h, h.month, h.includedMinutes ?? v.allowance.minutes)),
    });
  });
}
