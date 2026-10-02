/**
 * Calls log for the CRM (SPEC.md § CRM API → Calls). OWNER: calls+crm lane.
 * Sibling files for that lane: leads.ts (CRM delivery), escalations.ts (rules
 * + reminder worker), spam.ts (ledger), internal-calls.ts (engine → app),
 * recordings via server/r2.ts.
 *
 * Fixed by the architect:
 *   - list/filter is org-scoped through voiceContext; members with seePrices
 *     have no special role here — every member may read calls;
 *   - recordings stream from R2 through the app (never a public bucket URL);
 *   - the spam view is ?spam=1 (outcome spam|blocked) plus the ledger, with
 *     unblock needing manageSettings.
 */
import type { Express } from "express";
import { voiceContext, notImplemented, type GetUser } from "./context";

const LANE = "calls+crm";

export function registerVoiceCallRoutes(app: Express, getDevUser: GetUser): void {
  /** GET ?outcome=&spam=1&numberId=&from=&to=&q=&page=&limit= → { calls: [...], total, page } */
  app.get("/api/crm/voice/calls", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "paged voice_calls list with filters");
  });

  /** GET → VoiceCallRow + { customer, escalations } */
  app.get("/api/crm/voice/calls/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "one call with transcript, slots, events, linked customer and escalations");
  });

  /** GET → audio/wav streamed from R2 (recording_key); 404 when none. */
  app.get("/api/crm/voice/calls/:id/recording", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "stream the recording from R2 (getFromR2)");
  });

  /** GET → { entries: VoiceSpamRow[] } ; POST /:id/unblock → { unblocked: true } ; POST /block { phoneNumber } */
  app.get("/api/crm/voice/spam", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "the org's spam ledger");
  });
  app.post("/api/crm/voice/spam/:id/unblock", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "unblock a number (unblocked_at, strikes reset)");
  });
  app.post("/api/crm/voice/spam/block", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "block a number by hand (blocked_by = member id)");
  });

  /** GET ?open=1 → { escalations: VoiceEscalationRow[] } ; POST /:id/close → closed by hand */
  app.get("/api/crm/voice/escalations", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "escalations with reminder state");
  });
  app.post("/api/crm/voice/escalations/:id/close", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "close an escalation by hand");
  });
}
