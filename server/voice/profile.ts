/**
 * Agent Studio backend: the org's VoiceProfile, versions, publish, counties
 * and personas (SPEC.md § CRM API → Agent Studio). OWNER: studio-backend lane.
 * Sibling files for that lane: prompt-compiler.ts (+ .test.ts with snapshots),
 * profile-store.ts, counties.ts, personas.ts, brain.ts, simulator.ts,
 * internal-profile.ts.
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
 *
 * Lane extension (LANE-NOTES-studio-backend.md): POST /profile/setup takes the
 * first-run wizard's short payload, resolves county/region ids against the DB,
 * merges it into the draft, marks setup complete and (optionally) publishes.
 */
import type { Express, Response } from "express";
import { ZodError, z } from "zod";
import { voiceContext, type GetUser } from "./context";
import { personaList } from "./personas";
import { countiesById, countiesForState, isStateCode, listCounties, resolveRegions, verifyCountyRefs, type CountyRef } from "./counties";
import {
  getOrCreateProfile, saveDraft, publishProfile, previewDraft, setProfileStatus, listVersions, getVersion, restoreVersion, publishedState,
} from "./profile-store";
import { parseVoiceProfile, voiceProfileSchema, DEFAULT_INTAKE_QUESTIONS, type VoiceProfile } from "@shared/voice-profile";
import { VOICE_PERSONA_IDS } from "@shared/voice-personas";
import type { VoiceProfileRow } from "@shared/schema";

function zodIssues(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code }));
}

function profileResponse(row: VoiceProfileRow) {
  const st = publishedState(row);
  return {
    profile: row.profile,
    status: row.status,
    publishedVersion: row.publishedVersion,
    publishedProfile: row.publishedProfile,
    compiled: st.state === "live" ? st.compiled : row.compiled ?? null,
    setupCompletedAt: row.setupCompletedAt ? row.setupCompletedAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    /** Draft differs from what the engine runs. */
    dirty: row.publishedProfile ? JSON.stringify(row.profile) !== JSON.stringify(row.publishedProfile) : true,
  };
}

/** PUT body: { profile } or the bare profile (both accepted; the Studio sends { profile }). */
function profileInput(body: any): unknown {
  return body && typeof body === "object" && "profile" in body ? body.profile : body;
}

/** Profiles reference counties by id: every id must be a real row in the right state. */
async function checkCounties(res: Response, profile: VoiceProfile): Promise<boolean> {
  const { unknown } = await verifyCountyRefs(profile.serviceArea.counties);
  if (!unknown.length) return true;
  res.status(400).json({ code: "bad_request", issues: unknown.map((c) => ({ path: "serviceArea.counties", message: `Unknown county ${c.name}, ${c.stateCode} (id ${c.id}) — pick it from the list`, code: "custom" })) });
  return false;
}

// ── Setup wizard payload (first run) ─────────────────────────────────────────

const wizardSchema = z.object({
  company: z.object({
    name: z.string().trim().min(1).max(200),
    spokenName: z.string().trim().max(200).optional(),
    trade: z.string().trim().max(200).optional(),
    /** Service names; details can be added in the editor later. */
    services: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
    secondaryServices: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
    declines: z.array(z.object({ what: z.string().trim().min(1).max(200), referral: z.string().trim().max(200).default("") })).max(40).default([]),
    materials: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
    timezone: z.string().min(1).optional(),
    officePhone: z.string().regex(/^\+[1-9]\d{6,14}$/).or(z.literal("")).optional(),
  }),
  serviceArea: z.object({
    stateCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    /** counties.id values the picker returned. */
    countyIds: z.array(z.number().int().positive()).max(400).default([]),
    /** Region shortcut ids from GET /counties (e.g. "wa-border-to-tacoma", "all-wa"). */
    regionIds: z.array(z.string().regex(/^[a-z]{2,3}-[a-z0-9-]{1,40}$/)).max(20).default([]),
    spokenAreas: z.array(z.string().trim().min(1).max(200)).max(60).default([]),
    outOfArea: z.enum(["decline", "take_lead_anyway"]).optional(),
  }).default({}),
  credibility: z.object({
    yearsInBusiness: z.number().int().min(0).max(200).nullable().optional(),
    licenses: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    insured: z.boolean().optional(),
    bonded: z.boolean().optional(),
    warranties: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    reviews: z.string().trim().max(200).optional(),
  }).default({}),
  policies: z.object({
    repairs: z.enum(["replacements_only", "repairs_and_replacements", "repairs_only"]).optional(),
    pricing: z.enum(["never", "ranges"]).optional(),
    emergencies: z.boolean().optional(),
  }).default({}),
  offers: z.object({ freeEstimate: z.boolean().optional(), financing: z.boolean().optional(), financingDetails: z.string().trim().max(2000).optional() }).default({}),
  persona: z.object({
    presetId: z.enum(VOICE_PERSONA_IDS).optional(),
    assistantName: z.string().trim().max(200).optional(),
    greeting: z.string().trim().max(200).optional(),
    recordingNotice: z.boolean().optional(),
  }).default({}),
  escalations: z.object({
    /** Who gets texted for emergencies and "I want a person"; E.164. */
    urgentSms: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
    urgentName: z.string().trim().max(200).optional(),
    /** Who gets the rest (existing customers, payments, scheduling…); email or E.164. */
    officeEmail: z.string().email().optional(),
    officeName: z.string().trim().max(200).optional(),
  }).default({}),
  leadDelivery: z.object({ email: z.boolean().optional(), extraRecipients: z.array(z.string().email()).max(10).optional(), smsRecipients: z.array(z.string().regex(/^\+[1-9]\d{6,14}$/)).max(10).optional() }).default({}),
  publish: z.boolean().default(false),
});
export type SetupWizardPayload = z.infer<typeof wizardSchema>;

/** Merges the wizard's answers over the current draft (unmentioned fields keep their values). */
export async function applyWizard(draft: VoiceProfile, w: SetupWizardPayload): Promise<VoiceProfile> {
  // Counties: ids + regions → real refs, deduplicated, in picker order.
  const refs: CountyRef[] = [];
  const seen = new Set<number>();
  const push = (c: CountyRef) => { if (!seen.has(c.id)) { seen.add(c.id); refs.push(c); } };
  if (w.serviceArea.countyIds.length) {
    // Unknown ids are dropped (the picker only offers real rows; a stale id is not guessed at).
    const real = await countiesById(w.serviceArea.countyIds);
    for (const id of w.serviceArea.countyIds) { const c = real.get(id); if (c) push(c); }
  }
  for (const rid of w.serviceArea.regionIds) {
    // "all-wa" → WA; "wa-border-to-tacoma" → WA.
    const st = (rid.startsWith("all-") ? rid.slice(4, 6) : rid.slice(0, 2)).toUpperCase();
    if (!isStateCode(st)) continue;
    const counties = await listCounties(st);
    const region = resolveRegions(st, counties).find((r) => r.id === rid);
    if (region) region.counties.forEach(push);
  }
  const services = [
    ...w.company.services.map((name) => ({ name, details: draft.company.services.find((s) => s.name === name)?.details ?? "", tier: "primary" as const })),
    ...w.company.secondaryServices.map((name) => ({ name, details: draft.company.services.find((s) => s.name === name)?.details ?? "", tier: "secondary" as const })),
  ];
  const rules = [...draft.escalations.rules];
  const upsertRule = (id: string, rule: Omit<VoiceProfile["escalations"]["rules"][number], "id" | "reminders" | "template" | "enabled">) => {
    const i = rules.findIndex((r) => r.id === id);
    const base = i >= 0 ? rules[i] : { id, template: "", reminders: { enabled: true, everyMinutes: 120, fromHour: 8, toHour: 20, maxDays: 14, followUpNextDay: true }, enabled: true };
    const next = { ...base, ...rule };
    if (i >= 0) rules[i] = next; else rules.push(next);
  };
  if (w.escalations.urgentSms) upsertRule("wizard-urgent", { kinds: ["urgent", "human"], channel: "sms", recipient: w.escalations.urgentSms, recipientName: w.escalations.urgentName || "On-call" });
  if (w.escalations.officeEmail) upsertRule("wizard-office", { kinds: ["existing_customer", "estimate_missing", "scheduling", "contract", "payment", "complaint", "vendor", "other"], channel: "email", recipient: w.escalations.officeEmail, recipientName: w.escalations.officeName || "Office" });

  const merged = {
    ...draft,
    company: {
      ...draft.company,
      name: w.company.name,
      spokenName: w.company.spokenName ?? draft.company.spokenName,
      trade: w.company.trade ?? draft.company.trade,
      services: services.length ? services : draft.company.services,
      declines: w.company.declines.length ? w.company.declines : draft.company.declines,
      materials: w.company.materials.length ? w.company.materials : draft.company.materials,
      timezone: w.company.timezone ?? draft.company.timezone,
      officePhone: w.company.officePhone ?? draft.company.officePhone,
    },
    serviceArea: {
      ...draft.serviceArea,
      counties: refs.length ? refs : draft.serviceArea.counties,
      defaultStateCode: w.serviceArea.stateCode ?? (refs[0]?.stateCode || draft.serviceArea.defaultStateCode),
      spokenAreas: w.serviceArea.spokenAreas.length ? w.serviceArea.spokenAreas : draft.serviceArea.spokenAreas,
      outOfArea: w.serviceArea.outOfArea ?? draft.serviceArea.outOfArea,
    },
    credibility: {
      ...draft.credibility,
      ...(w.credibility.yearsInBusiness !== undefined ? { yearsInBusiness: w.credibility.yearsInBusiness } : {}),
      ...(w.credibility.licenses ? { licenses: w.credibility.licenses } : {}),
      ...(w.credibility.insured !== undefined ? { insured: w.credibility.insured } : {}),
      ...(w.credibility.bonded !== undefined ? { bonded: w.credibility.bonded } : {}),
      ...(w.credibility.warranties ? { warranties: w.credibility.warranties } : {}),
      ...(w.credibility.reviews !== undefined ? { reviews: w.credibility.reviews } : {}),
    },
    policies: {
      ...draft.policies,
      ...(w.policies.repairs ? { repairs: w.policies.repairs } : {}),
      ...(w.policies.pricing ? { pricing: w.policies.pricing } : {}),
      emergencies: { ...draft.policies.emergencies, ...(w.policies.emergencies !== undefined ? { handle: w.policies.emergencies } : {}) },
    },
    offers: {
      ...draft.offers,
      ...(w.offers.freeEstimate !== undefined ? { freeEstimate: w.offers.freeEstimate } : {}),
      financing: { available: w.offers.financing ?? draft.offers.financing.available, details: w.offers.financingDetails ?? draft.offers.financing.details },
    },
    persona: {
      ...draft.persona,
      ...(w.persona.presetId ? { presetId: w.persona.presetId } : {}),
      ...(w.persona.assistantName !== undefined ? { assistantName: w.persona.assistantName } : {}),
      ...(w.persona.greeting !== undefined ? { greeting: w.persona.greeting } : {}),
      ...(w.persona.recordingNotice !== undefined ? { recordingNotice: w.persona.recordingNotice } : {}),
    },
    intake: draft.intake.questions.length ? draft.intake : { ...draft.intake, questions: DEFAULT_INTAKE_QUESTIONS },
    escalations: { ...draft.escalations, rules },
    leadDelivery: {
      ...draft.leadDelivery,
      email: { enabled: w.leadDelivery.email ?? draft.leadDelivery.email.enabled, extraRecipients: w.leadDelivery.extraRecipients ?? draft.leadDelivery.email.extraRecipients },
      sms: w.leadDelivery.smsRecipients ? { enabled: w.leadDelivery.smsRecipients.length > 0, recipients: w.leadDelivery.smsRecipients } : draft.leadDelivery.sms,
    },
  };
  return voiceProfileSchema.parse(merged);
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerVoiceProfileRoutes(app: Express, getDevUser: GetUser): void {
  /** GET → { profile (draft), publishedVersion, status, compiled, setupCompletedAt, dirty } */
  app.get("/api/crm/voice/profile", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const row = await getOrCreateProfile(v.ctx.org, v.ctx.member.id);
    return res.json(profileResponse(row));
  });

  /** PUT { profile: VoiceProfileInput, setupCompleted?: true } → { profile, … } (draft saved; 400 { issues } on a bad profile) */
  app.put("/api/crm/voice/profile", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    await getOrCreateProfile(v.ctx.org, v.ctx.member.id);
    let profile: VoiceProfile;
    try { profile = parseVoiceProfile(profileInput(req.body)); }
    catch (err) { if (err instanceof ZodError) return res.status(400).json({ code: "bad_request", issues: zodIssues(err) }); throw err; }
    if (!(await checkCounties(res, profile))) return;
    const row = await saveDraft(v.ctx.org.id, profile, v.ctx.member.id, { setupCompleted: req.body?.setupCompleted === true });
    return res.json(profileResponse(row));
  });

  /** POST wizard payload → { profile, …, published?: { version } } */
  app.post("/api/crm/voice/profile/setup", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const w = wizardSchema.safeParse(req.body ?? {});
    if (!w.success) return res.status(400).json({ code: "bad_request", issues: zodIssues(w.error) });
    const row = await getOrCreateProfile(v.ctx.org, v.ctx.member.id);
    let merged: VoiceProfile;
    try { merged = await applyWizard(parseVoiceProfile(row.profile), w.data); }
    catch (err) { if (err instanceof ZodError) return res.status(400).json({ code: "bad_request", issues: zodIssues(err) }); throw err; }
    let saved = await saveDraft(v.ctx.org.id, merged, v.ctx.member.id, { setupCompleted: true });
    let published: { version: number } | undefined;
    if (w.data.publish) {
      const p = await publishProfile(v.ctx.org.id, v.ctx.member.id, "Setup wizard");
      saved = p.row; published = { version: p.version };
    }
    return res.json({ ...profileResponse(saved), published });
  });

  /** POST { note?, setupCompleted? } → { version, compiled, status, publishedVersion, setupCompletedAt } (every publish stamps setup complete) */
  app.post("/api/crm/voice/profile/publish", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null;
    try {
      const row = await getOrCreateProfile(v.ctx.org, v.ctx.member.id);
      const profile = parseVoiceProfile(row.profile);
      if (!(await checkCounties(res, profile))) return;
      const p = await publishProfile(v.ctx.org.id, v.ctx.member.id, note);
      return res.json({ version: p.version, compiled: p.compiled, status: p.row.status, publishedVersion: p.row.publishedVersion, setupCompletedAt: p.row.setupCompletedAt?.toISOString() ?? null });
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ code: "bad_request", issues: zodIssues(err), message: "Fix the draft before publishing." });
      throw err;
    }
  });

  /** POST → { status: "paused" } / POST /resume → { status: "live" }; 409 unpublished when nothing was ever published. */
  for (const [path, status] of [["pause", "paused"], ["resume", "live"]] as const) {
    app.post(`/api/crm/voice/profile/${path}`, async (req: any, res) => {
      const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
      if (!v) return;
      await getOrCreateProfile(v.ctx.org, v.ctx.member.id);
      const r = await setProfileStatus(v.ctx.org.id, status, v.ctx.member.id);
      if ("error" in r) return res.status(409).json({ code: "unpublished", message: "Publish the assistant first." });
      return res.json({ status: r.status });
    });
  }

  /** GET → { compiled: CompiledProfile, version } for the current DRAFT (prompt preview). */
  app.get("/api/crm/voice/profile/preview", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    await getOrCreateProfile(v.ctx.org, v.ctx.member.id);
    try {
      const p = await previewDraft(v.ctx.org.id);
      return res.json(p);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ code: "bad_request", issues: zodIssues(err) });
      throw err;
    }
  });

  /** GET → { versions: [{ version, note, createdAt, createdBy, changed, changedPaths, published }] } */
  app.get("/api/crm/voice/profile/versions", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    return res.json({ versions: await listVersions(v.ctx.org.id) });
  });

  /** GET /:version → { version, profile, compiled, note, createdAt, createdBy } */
  app.get("/api/crm/voice/profile/versions/:version", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const n = Number(req.params.version);
    if (!Number.isInteger(n) || n < 1) return res.status(400).json({ code: "bad_request", message: "version must be a positive integer" });
    const row = await getVersion(v.ctx.org.id, n);
    if (!row) return res.status(404).json({ code: "not_found" });
    return res.json({ version: row.version, profile: row.profile, compiled: row.compiled, note: row.note, createdAt: row.createdAt?.toISOString() ?? null, createdBy: row.createdByMemberId });
  });

  /** POST /:version/restore → the draft response (copies the version into the draft; does not publish) */
  app.post("/api/crm/voice/profile/versions/:version/restore", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const n = Number(req.params.version);
    if (!Number.isInteger(n) || n < 1) return res.status(400).json({ code: "bad_request", message: "version must be a positive integer" });
    const row = await restoreVersion(v.ctx.org.id, n, v.ctx.member.id);
    if (!row) return res.status(404).json({ code: "not_found" });
    return res.json({ ...profileResponse(row), restoredFrom: n });
  });

  /** GET ?state=WA → { counties: [{ id, name, stateCode }], regions: [{ id, name, stateCode, description, counties, missing }] } */
  app.get("/api/crm/voice/counties", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const state = String(req.query.state ?? "").toUpperCase();
    if (!isStateCode(state)) return res.status(400).json({ code: "bad_request", message: "state must be a two-letter code, like WA" });
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.json({ state, ...(await countiesForState(state)) });
  });

  /** Personas with sample URLs (null until the engine lane renders the file). */
  app.get("/api/crm/voice/personas", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    res.json({ personas: personaList() });
  });
}
