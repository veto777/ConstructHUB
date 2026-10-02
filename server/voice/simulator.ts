/**
 * Simulator: a text chat against the compiled profile, through the app
 * (SPEC.md § CRM API → Simulator). OWNER: studio-backend lane.
 *
 * Fixed by the architect: the brain runs in the ENGINE (voice/brain.py), not
 * in TypeScript — the simulator proxies to the engine's /sim/* routes with
 * voiceInternalHeaders() so the Studio tests the exact code a caller gets.
 * Engine unreachable → 503 { code: "voice_engine_unavailable" }, never a fake
 * reply. Sessions are in the engine's memory (30-minute TTL); the app passes
 * the DRAFT's compiled profile so unpublished edits can be tried.
 */
import type { Express } from "express";
import { voiceContext, notImplemented, type GetUser } from "./context";

const LANE = "studio-backend";

export function registerVoiceSimulatorRoutes(app: Express, getDevUser: GetUser): void {
  /** POST { useDraft?: boolean, callerNumber?: string } → { sessionId, greeting, compiledVersion } */
  app.post("/api/crm/voice/simulator/session", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "compile draft (or take published) → engine POST /sim/session");
  });

  /** POST { sessionId, text } → { say, action, slots, events, ended, outcome } */
  app.post("/api/crm/voice/simulator/turn", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "engine POST /sim/turn (decision JSON passthrough)");
  });

  /** DELETE → { ended: true, summary } */
  app.delete("/api/crm/voice/simulator/session/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "engine DELETE /sim/session/:id");
  });
}
