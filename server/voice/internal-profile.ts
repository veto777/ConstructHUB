/**
 * engine → app: the compiled call profile for an inbound number
 * (SPEC.md § Internal API → GET /profile). OWNER: studio-backend lane.
 *
 * The engine calls this once per call, at the SignalWire webhook, before it
 * answers; the answer carries everything the call needs (profile, persona,
 * timings, the caller's block status) so the engine touches the app again
 * only to report the call. Bearer VOICE_INTERNAL_SECRET (internal-auth.ts).
 */
import type { Express } from "express";
import { requireVoiceInternal, VOICE_INTERNAL_PATH } from "./internal-auth";
import { notImplemented } from "./context";

const LANE = "studio-backend";

export function registerVoiceInternalProfileRoutes(app: Express): void {
  /** Lets the engine verify its secret at boot: { ok: true, app: "constructhub" }. */
  app.get(`${VOICE_INTERNAL_PATH}/health`, requireVoiceInternal, (_req, res) => {
    res.json({ ok: true, app: "constructhub" });
  });

  /**
   * GET ?to=+1…&from=+1…&callSid=CA…
   *  200 { org: { id, name, timezone }, number: { id, label, location, isTest },
   *        status: "live", version, compiled: CompiledProfile,
   *        caller: { blocked: boolean, strikes, customer: { id, firstName, email } | null } }
   *  404 { code: "unknown_number" }   the app does not own `to`
   *  423 { code: "paused" | "unpublished", say: "<line the engine speaks before hanging up>" }
   */
  app.get(`${VOICE_INTERNAL_PATH}/profile`, requireVoiceInternal, (_req, res) => {
    return notImplemented(res, LANE, "voice_numbers → voice_profiles.compiled + voice_spam block check + crm_customers prefill");
  });
}
