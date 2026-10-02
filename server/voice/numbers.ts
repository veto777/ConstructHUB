/**
 * Numbers: search / buy / list / release on SignalWire (SPEC.md § CRM API → Numbers).
 * OWNER: numbers+billing lane (LANES.md). Sibling files for that lane:
 * numbers-signalwire.ts (LaML REST client), numbers.test.ts.
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
 */
import type { Express } from "express";
import { voiceContext, notImplemented, type GetUser } from "./context";

const LANE = "numbers+billing";

export function registerVoiceNumberRoutes(app: Express, getDevUser: GetUser): void {
  /** GET ?state=WA&areaCode=360&city=Bellingham&limit=10 → { numbers: [{ phoneNumber, locality, region, areaCode, monthlyCents }] } */
  app.get("/api/crm/voice/numbers/search", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "SignalWire AvailablePhoneNumbers/US/Local search by InRegion (+ AreaCode / InLocality)");
  });

  /** GET → { numbers: VoiceNumberRow[], allowance: { numbers }, forwarding: { carriers: [...] } } */
  app.get("/api/crm/voice/numbers", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "list the org's voice_numbers with allowance and forwarding instructions");
  });

  /** POST { phoneNumber, label, location } → 201 VoiceNumberRow (purchase + webhook wiring) */
  app.post("/api/crm/voice/numbers", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "purchase IncomingPhoneNumbers with VoiceUrl/StatusCallback, within callAssistantAllowance");
  });

  /** PATCH { label?, location?, forwardingFrom? } → VoiceNumberRow */
  app.patch("/api/crm/voice/numbers/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "rename / relabel a number");
  });

  /** DELETE → { released: true } or 409 { code: "too_early", releaseEligibleAt } */
  app.delete("/api/crm/voice/numbers/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "release after CALL_NUMBER_MIN_DAYS; show the date when refused");
  });
}
