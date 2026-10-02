/**
 * engine → app: the compiled call profile for an inbound number
 * (SPEC.md § Internal API → GET /profile). OWNER: studio-backend lane.
 *
 * The engine calls this once per call, at the SignalWire webhook, before it
 * answers; the answer carries everything the call needs (profile, persona,
 * timings, the caller's block status, the CRM match) so the engine touches the
 * app again only to report the call. Bearer VOICE_INTERNAL_SECRET (internal-auth.ts).
 */
import type { Express } from "express";
import { requireVoiceInternal, VOICE_INTERNAL_PATH } from "./internal-auth";
import { lookupNumber, callerStatus, publishedState, normalizeE164 } from "./profile-store";
import { getEntitlements, moduleEnabled } from "../entitlements";

/** What the engine speaks (then hangs up) when a number rings but nothing can answer. */
export const UNPUBLISHED_LINE = "Thank you for calling. Our phone assistant isn't set up yet, so please try again later or reach us through our website. Goodbye.";
export const PAUSED_LINE = "Thank you for calling. Our phone assistant is taking a short break, so please try again later or reach us through our website. Goodbye.";

export function registerVoiceInternalProfileRoutes(app: Express): void {
  /** Lets the engine verify its secret at boot: { ok: true, app: "constructhub" }. */
  app.get(`${VOICE_INTERNAL_PATH}/health`, requireVoiceInternal, (_req, res) => {
    res.json({ ok: true, app: "constructhub" });
  });

  /**
   * GET ?to=+1…&from=+1…&callSid=CA…
   *  200 { org: { id, name, timezone }, number: { id, label, location, isTest },
   *        status: "live", version, compiled: CompiledProfile,
   *        caller: { number, blocked: boolean, strikes, customer: { id, firstName, email } | null } }
   *  400 { code: "bad_request" }         `to` is not E.164
   *  404 { code: "unknown_number" }      the app does not own `to`
   *  423 { code: "paused" | "unpublished", say }   the engine speaks `say` and hangs up
   *      (also "paused" when the org owner's subscription no longer carries the Call Assistant add-on:
   *      a lapsed or cancelled org gets no receptionist — the platform pays for GPU, AI and minutes)
   */
  app.get(`${VOICE_INTERNAL_PATH}/profile`, requireVoiceInternal, async (req, res) => {
    const to = normalizeE164(typeof req.query.to === "string" ? req.query.to : null);
    if (!to) return res.status(400).json({ code: "bad_request", message: "to must be an E.164 number" });
    const from = typeof req.query.from === "string" ? req.query.from : null;
    const found = await lookupNumber(to);
    if (!found) return res.status(404).json({ code: "unknown_number" });
    const { number, org, profile } = found;
    const ent = await getEntitlements(org.ownerUserId);
    if (!moduleEnabled(ent, "callAssistant")) {
      return res.status(423).json({ code: "paused", reason: "addon_inactive", say: PAUSED_LINE, org: { id: org.id, name: org.name } });
    }
    const st = publishedState(profile);
    if (st.state !== "live") return res.status(423).json({ code: st.state, say: st.state === "paused" ? PAUSED_LINE : UNPUBLISHED_LINE, org: { id: org.id, name: org.name } });
    const caller = await callerStatus(org.id, from);
    return res.json({
      org: { id: org.id, name: org.name, timezone: st.profile.company.timezone || org.timezone || "America/Los_Angeles" },
      number: { id: number.id, label: number.label, location: number.location, isTest: number.isTest, phoneNumber: number.phoneNumber },
      status: "live",
      version: st.version,
      compiled: st.compiled,
      caller: { number: normalizeE164(from), ...caller },
    });
  });
}
