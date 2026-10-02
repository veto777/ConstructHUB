/**
 * Call Assistant route registration — the only place routes are mounted.
 *
 * ARCHITECT-OWNED (docs/call-assistant/LANES.md). Each lane fills in its own
 * file's register function; nobody edits this file. The order matters only
 * in that the internal API (bearer-authenticated, called by the engine)
 * is registered before the session-authenticated CRM routes.
 *
 *   /api/voice-internal/*   engine → app   (internal-profile.ts, internal-calls.ts)
 *   /api/crm/voice/*        browser → app  (numbers.ts, billing.ts, profile.ts, simulator.ts, calls.ts)
 *
 * The /voice/* reverse proxy to the engine is registered separately, before
 * the body parsers, in server/index.ts (proxy.ts).
 */
import type { Express } from "express";
import type { GetUser } from "./context";
import { registerVoiceInternalProfileRoutes } from "./internal-profile";
import { registerVoiceInternalCallRoutes } from "./internal-calls";
import { registerVoiceNumberRoutes } from "./numbers";
import { registerVoiceBillingRoutes } from "./billing";
import { registerVoiceProfileRoutes } from "./profile";
import { registerVoiceSimulatorRoutes } from "./simulator";
import { registerVoiceCallRoutes } from "./calls";
import { startVoiceOverageWorker } from "./billing-usage";

export function registerVoiceRoutes(app: Express, getDevUser: GetUser): void {
  // engine → app
  registerVoiceInternalProfileRoutes(app);
  registerVoiceInternalCallRoutes(app);
  // browser → app (every route goes through voiceContext in ./context.ts)
  registerVoiceBillingRoutes(app, getDevUser);
  registerVoiceNumberRoutes(app, getDevUser);
  registerVoiceProfileRoutes(app, getDevUser);
  registerVoiceSimulatorRoutes(app, getDevUser);
  registerVoiceCallRoutes(app, getDevUser); // also starts the escalation reminder worker (off unless VOICE_ESCALATION_WORKER_ENABLED=true)
  // Overage minutes → Stripe (off unless production + STRIPE_SECRET_KEY + VOICE_OVERAGE_WORKER_ENABLED=true).
  startVoiceOverageWorker();
}
