/**
 * Agent Studio backend: the org's VoiceProfile, versions, publish, counties
 * and personas (SPEC.md § CRM API → Agent Studio). OWNER: studio-backend lane.
 * Sibling files for that lane: prompt-compiler.ts (+ .test.ts with snapshots),
 * profile-store.ts, counties.ts, personas.ts, internal-profile.ts.
 *
 * Fixed by the architect:
 *   - validation = shared/voice-profile.ts parseVoiceProfile (400 with zod issues);
 *   - a new org's profile = defaultVoiceProfile(org) (nothing invented);
 *   - PUT saves the DRAFT; POST /publish validates, compiles, writes
 *     voice_profile_versions (version = max+1), copies to published_profile
 *     + compiled, status 'live';
 *   - GET /preview returns the compiled prompt for the draft WITHOUT publishing;
 *   - counties come from the `counties` table (server/seed-all-counties.ts),
 *     never typed by hand; region shortcuts are a static list in counties.ts;
 *   - edits need manageSettings; reads need membership.
 */
import type { Express } from "express";
import { voiceContext, notImplemented, type GetUser } from "./context";
import { VOICE_PERSONA_LIST } from "@shared/voice-personas";

const LANE = "studio-backend";

export function registerVoiceProfileRoutes(app: Express, getDevUser: GetUser): void {
  /** GET → { profile (draft), publishedVersion, status, compiled: CompiledProfile|null, setupCompletedAt } */
  app.get("/api/crm/voice/profile", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "load or create (defaultVoiceProfile) the org's voice_profiles row");
  });

  /** PUT { profile: VoiceProfileInput } → { profile } (draft saved; 400 { issues } on a bad profile) */
  app.put("/api/crm/voice/profile", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "validate with parseVoiceProfile and save the draft");
  });

  /** POST { note? } → { version, compiled } */
  app.post("/api/crm/voice/profile/publish", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "compile, write voice_profile_versions, copy to published_profile/compiled, status live");
  });

  /** POST → { status: "paused" } / POST /resume → { status: "live" } */
  app.post("/api/crm/voice/profile/pause", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "pause: the engine answers with the paused line and hangs up");
  });
  app.post("/api/crm/voice/profile/resume", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "resume a paused profile");
  });

  /** GET → { compiled: CompiledProfile } for the current DRAFT (prompt preview). */
  app.get("/api/crm/voice/profile/preview", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "compileVoiceProfile(draft, publishedVersion + 1)");
  });

  /** GET → { versions: [{ version, note, createdAt, createdBy }] }; GET /:version → { profile, compiled } */
  app.get("/api/crm/voice/profile/versions", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "list voice_profile_versions");
  });
  app.get("/api/crm/voice/profile/versions/:version", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "one version with its compiled output");
  });
  /** POST /:version/restore → { profile } (copies the version into the draft; does not publish) */
  app.post("/api/crm/voice/profile/versions/:version/restore", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    return notImplemented(res, LANE, "restore a version into the draft");
  });

  /** GET ?state=WA → { counties: [{ id, name, stateCode }], regions: [{ id, name, stateCode, countyIds }] } */
  app.get("/api/crm/voice/counties", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return notImplemented(res, LANE, "counties by state from the counties table + static region shortcuts");
  });

  /** Personas with sample URLs — static today; the engine lane fills sampleUrl. */
  app.get("/api/crm/voice/personas", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    res.json({ personas: VOICE_PERSONA_LIST });
  });
}
