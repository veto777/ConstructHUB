/**
 * Call Assistant billing: usage, overage metering and the Overview status
 * (SPEC.md § CRM API → Overview / Usage). OWNER: numbers+billing lane.
 *
 * Fixed by the architect:
 *   - the add-on block in shared/plans.ts (call_assistant / call_number,
 *     CALL_ASSISTANT_INCLUDED_MINUTES, CALL_MINUTE_OVERAGE_CENTS) — the lane
 *     owns it from here on, and removes `preview` only when the owner confirms;
 *   - voice_usage is the meter (server/voice/schema.ts): minutes per org per
 *     month, included snapshot, overage reported to Stripe like
 *     server/growth-quotas.ts reports counts;
 *   - GET /api/crm/voice/status is the one route that answers WITHOUT the add-on
 *     (skipModule), so the Overview tab can show the plan prompt itself.
 */
import type { Express } from "express";
import { voiceContext, notImplemented, type GetUser } from "./context";
import { moduleEnabled } from "../entitlements";
import { ADDONS, CALL_ASSISTANT_INCLUDED_MINUTES, CALL_MINUTE_OVERAGE_CENTS } from "@shared/plans";
import { voiceInternalConfigured } from "./internal-auth";
import { voiceEngineUrl, voicePublicBase } from "./proxy";

const LANE = "numbers+billing";

export function registerVoiceBillingRoutes(app: Express, getDevUser: GetUser): void {
  /**
   * Overview status. Answers for every org member; `enabled` is false (with
   * the add-on to buy) when the owner's subscription lacks the add-on.
   * TODO(numbers+billing): fill numbers/profile/usage from the tables.
   */
  app.get("/api/crm/voice/status", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { skipModule: true });
    if (!v) return;
    const enabled = moduleEnabled(v.ent, "callAssistant");
    res.setHeader("Cache-Control", "no-store");
    res.json({
      enabled,
      addon: { key: ADDONS.call_assistant.key, name: ADDONS.call_assistant.name, preview: ADDONS.call_assistant.preview === true, availableOn: ADDONS.call_assistant.availableOn },
      plan: v.ent.accessPlan,
      allowance: v.allowance,
      pricing: { includedMinutes: CALL_ASSISTANT_INCLUDED_MINUTES, overageCentsPerMinute: CALL_MINUTE_OVERAGE_CENTS },
      engine: { configured: voiceInternalConfigured(), url: voiceEngineUrl(), publicBase: voicePublicBase() },
      // TODO(numbers+billing): numbers: [...], profile: { status, publishedVersion }, usage: { month, minutes, calls, overageMinutes }
      numbers: [], profile: null, usage: null,
    });
  });

  /** GET ?month=YYYY-MM → { month, minutes, includedMinutes, overageMinutes, calls, spamCalls, blockedCalls, resetsAt } */
  app.get("/api/crm/voice/usage", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "voice_usage for the month (+ history)");
  });
}
