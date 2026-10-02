/**
 * Agent Studio backend (studio-backend lane), against the lane's development DB:
 *
 *  1. the store — seed from the CRM org, draft validation, publish → versions
 *     (serialized), diff summary + author, restore, pause/resume, the engine's
 *     number/caller lookups;
 *  2. counties — the DB rows and the region shortcuts (the owner's WA and FL
 *     regions must resolve completely);
 *  3. HTTP end to end on a child server started from THIS worktree on a free
 *     port in 8200–8230: the CRM routes behind the add-on gate and the
 *     manageSettings permission, the setup wizard, the internal profile route
 *     with its bearer, and the Simulator against a stub OpenAI-compatible
 *     provider (no real model call, no real phone number).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as netServer } from "node:net";
import { createWriteStream, mkdirSync } from "node:fs";
import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { pool } from "../db";
import { defaultVoiceProfile, parseVoiceProfile, type VoiceProfile } from "@shared/voice-profile";
import {
  seedProfileFromOrg, getOrCreateProfile, saveDraft, publishProfile, previewDraft, setProfileStatus, listVersions, getVersion,
  restoreVersion, publishedState, lookupNumber, callerStatus, normalizeE164, diffSummary, getProfileRow,
} from "./profile-store";
import { countiesForState, verifyCountyRefs, REGION_SHORTCUTS, listCounties } from "./counties";
import { applyWizard } from "./profile";
import { takeSimTurn, SIM_TURNS_PER_HOUR, resetSimulatorSessions } from "./simulator";
import { personaList, resetPersonaCache } from "./personas";

const orgsToDrop: string[] = [];
const numbersToDrop: string[] = [];
const fakeOrg = (over: Record<string, unknown> = {}) => {
  const id = randomUUID();
  orgsToDrop.push(id);
  return { id, name: "Vitest Voice Siding", timezone: "America/Los_Angeles", phone: "(360) 555-0142", website: "", state: "wa", licenseNumber: null, licenseState: null, description: null, industry: "Siding & Windows", ...over } as any;
};
/** A test-only number in the 555-01xx fictional range, unique per run. */
const testNumber = () => `+1360555${String(randomInt(0, 10000)).padStart(4, "0")}`;

async function dropOrgRows(ids: string[]) {
  if (!ids.length) return;
  for (const t of ["voice_profile_versions", "voice_profiles", "voice_numbers", "voice_spam", "crm_customers", "crm_members"]) {
    await pool.query(`delete from ${t} where org_id = any($1::text[])`, [ids]);
  }
  await pool.query("delete from crm_orgs where id = any($1::text[])", [ids]);
}

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) throw new Error("Requires a local ConstructHUB development lane DB");
});
afterAll(async () => {
  await pool.query("delete from voice_numbers where phone_number = any($1::text[])", [numbersToDrop]);
  await dropOrgRows(orgsToDrop);
});

// ── 1. Store ─────────────────────────────────────────────────────────────────

describe("profile store", () => {
  it("seeds a new org's draft from the CRM's own fields, normalized, nothing invented", () => {
    const p = seedProfileFromOrg(fakeOrg({ licenseNumber: "CASCAEL123", licenseState: "wa" }));
    expect(p.company).toMatchObject({ name: "Vitest Voice Siding", officePhone: "+13605550142", trade: "Siding & Windows", timezone: "America/Los_Angeles", services: [] });
    expect(p.serviceArea.defaultStateCode).toBe("WA");
    expect(p.credibility.licenses).toEqual(["WA license CASCAEL123"]);
    expect(p.intake.questions.map((q) => q.key)).toEqual(["need", "address", "first_name", "phone", "email", "best_time"]);
    // A number without an area code, a full state name and no industry are dropped, not guessed.
    const thin = seedProfileFromOrg(fakeOrg({ phone: "555-0142", state: "Washington", industry: null }));
    expect(thin.company.officePhone).toBe("");
    expect(thin.serviceArea.defaultStateCode).toBe("");
    expect(thin.company.trade).toBe("");
    expect(normalizeE164("(813) 555-0100")).toBe("+18135550100");
    expect(normalizeE164("1-813-555-0100")).toBe("+18135550100");
    expect(normalizeE164("555-0100")).toBeNull();
  });

  it("creates the row once, validates every draft save, and publishes numbered versions with a diff and an author", async () => {
    const org = fakeOrg();
    const row = await getOrCreateProfile(org);
    expect(row).toMatchObject({ orgId: org.id, status: "draft", publishedVersion: null });
    expect((await getOrCreateProfile(org)).id).toBe(row.id);
    expect(publishedState(row)).toEqual({ state: "unpublished" });
    expect(await setProfileStatus(org.id, "paused", null)).toEqual({ error: "unpublished" });

    const draft = parseVoiceProfile(row.profile);
    await expect(saveDraft(org.id, { ...draft, company: { ...draft.company, name: "" } })).rejects.toBeInstanceOf(ZodError);

    // A member row so the version shows its author.
    const memberId = (await pool.query("insert into crm_members(org_id, email, role, status, display_name) values ($1, 'studio@example.invalid', 'owner', 'active', 'Studio Owner') returning id", [org.id])).rows[0].id;
    const v1 = await publishProfile(org.id, memberId, "  first  ");
    expect(v1.version).toBe(1);
    expect(v1.row).toMatchObject({ status: "live", publishedVersion: 1 });
    expect(v1.compiled.version).toBe(1);
    const st = publishedState(v1.row);
    expect(st.state).toBe("live");

    await saveDraft(org.id, { ...draft, faq: [{ question: "Do you pull permits?", answer: "Yes." }] }, memberId);
    const preview = await previewDraft(org.id);
    expect(preview?.version).toBe(2);
    expect(preview?.compiled.systemPrompt).toContain("Do you pull permits?");
    // Preview does not publish: the engine still runs version 1.
    expect((await getProfileRow(org.id))?.publishedVersion).toBe(1);

    const v2 = await publishProfile(org.id, memberId, null);
    expect(v2.version).toBe(2);
    const versions = await listVersions(org.id);
    expect(versions.map((v) => [v.version, v.note, v.published, v.first])).toEqual([[2, null, true, false], [1, "first", false, true]]);
    expect(versions[0]).toMatchObject({ changed: ["faq"], changedPaths: 1, author: "Studio Owner", createdBy: memberId });

    // Restore v1 into the draft; it does not publish.
    const restored = await restoreVersion(org.id, 1, memberId);
    expect(restored?.profile).toEqual((await getVersion(org.id, 1))?.profile);
    expect(restored?.publishedVersion).toBe(2);
    expect(await restoreVersion(org.id, 99, memberId)).toBeNull();

    // Pause / resume.
    expect(await setProfileStatus(org.id, "paused", memberId)).toMatchObject({ status: "paused" });
    expect(publishedState(await getProfileRow(org.id))).toEqual({ state: "paused" });
    expect(await setProfileStatus(org.id, "live", memberId)).toMatchObject({ status: "live" });
  });

  it("serializes concurrent publishes: every version number is used exactly once", async () => {
    const org = fakeOrg();
    await getOrCreateProfile(org);
    const results = await Promise.all([1, 2, 3, 4].map(() => publishProfile(org.id, null, null)));
    expect(results.map((r) => r.version).sort()).toEqual([1, 2, 3, 4]);
    expect((await getProfileRow(org.id))?.publishedVersion).toBe(4);
  });

  it("diffSummary names the top-level sections that changed", () => {
    const a = defaultVoiceProfile({ name: "A" });
    const b = { ...a, company: { ...a.company, name: "B" }, advanced: { ...a.advanced, maxTurns: 20 } };
    expect(diffSummary(a, b)).toEqual({ changed: ["company", "advanced"], changedPaths: 2 });
    expect(diffSummary(a, structuredClone(a))).toEqual({ changed: [], changedPaths: 0 });
  });

  it("finds the org behind an active inbound number and the caller's block status + CRM match (raw stored phones)", async () => {
    const org = fakeOrg();
    await pool.query("insert into crm_orgs(id, name, owner_user_id) values ($1, 'Vitest Voice Lookup', 1)", [org.id]);
    const to = testNumber();
    numbersToDrop.push(to);
    await pool.query("insert into voice_numbers(org_id, phone_number, label, status, is_test) values ($1, $2, 'Main', 'active', true)", [org.id, to]);
    const found = await lookupNumber(to);
    expect(found).toMatchObject({ number: { phoneNumber: to, label: "Main", isTest: true }, org: { id: org.id }, profile: null });
    expect(await lookupNumber("+19995550100")).toBeNull();

    await pool.query("insert into crm_customers(org_id, display_name, first_name, email, phone, portal_token) values ($1, 'Pat Example', 'Pat', 'pat@example.invalid', '(813) 555-0177', $2)", [org.id, randomUUID()]);
    expect(await callerStatus(org.id, "+18135550177")).toEqual({ blocked: false, strikes: 0, customer: { id: expect.any(String), firstName: "Pat", email: "pat@example.invalid" } });
    expect(await callerStatus(org.id, null)).toEqual({ blocked: false, strikes: 0, customer: null });

    await pool.query("insert into voice_spam(org_id, phone_number, strikes, calls, blocked_at, blocked_by) values ($1, '+18135550666', 2, 2, now(), 'auto')", [org.id]);
    expect(await callerStatus(org.id, "+18135550666")).toMatchObject({ blocked: true, strikes: 2, customer: null });
    await pool.query("update voice_spam set unblocked_at = now() + interval '1 second' where org_id = $1", [org.id]);
    expect(await callerStatus(org.id, "+18135550666")).toMatchObject({ blocked: false, strikes: 2 });
  });
});

// ── 2. Counties ──────────────────────────────────────────────────────────────

describe("counties and region shortcuts", () => {
  it("resolves the owner's regions completely from the counties table", async () => {
    const wa = await countiesForState("WA");
    expect(wa.counties.length).toBeGreaterThanOrEqual(39);
    const border = wa.regions.find((r) => r.id === "wa-border-to-tacoma")!;
    expect(border.counties.map((c) => c.name)).toEqual(["Whatcom", "San Juan", "Skagit", "Island", "Snohomish", "King", "Pierce"]);
    expect(border.missing).toEqual([]);
    expect(wa.regions.at(-1)).toMatchObject({ id: "all-wa", name: "All counties in WA", counties: wa.counties });

    const fl = await countiesForState("FL");
    expect(fl.regions.find((r) => r.id === "fl-tampa-bay")!.counties.map((c) => c.name)).toEqual(["Pinellas", "Hillsborough", "Manatee", "Sarasota"]);
    expect(fl.regions.find((r) => r.id === "fl-orlando")!.counties.map((c) => c.name)).toEqual(["Orange", "Seminole", "Osceola"]);
  });

  it("every static shortcut names only counties that exist in its state", async () => {
    for (const r of REGION_SHORTCUTS) {
      const resolved = (await countiesForState(r.stateCode)).regions.find((x) => x.id === r.id)!;
      expect(resolved.missing, r.id).toEqual([]);
    }
    expect(await listCounties("wa")).toEqual([]);
  });

  it("rejects county refs whose id or state does not match the table", async () => {
    const [king] = (await listCounties("WA")).filter((c) => c.name === "King");
    expect(await verifyCountyRefs([king])).toEqual({ ok: [king], unknown: [] });
    const wrongState = { ...king, stateCode: "FL" };
    const bogus = { id: 987654321, name: "Atlantis", stateCode: "WA" };
    expect(await verifyCountyRefs([wrongState, bogus])).toEqual({ ok: [], unknown: [wrongState, bogus] });
  });

  it("the setup wizard turns regions + ids into real county refs, services into tiers, contacts into escalation rules", async () => {
    const pierce = (await listCounties("WA")).find((c) => c.name === "Pierce")!;
    const thurston = (await listCounties("WA")).find((c) => c.name === "Thurston")!;
    const draft = defaultVoiceProfile({ name: "Old Name" });
    const p = await applyWizard(draft, {
      company: { name: "Cascade Exteriors", services: ["siding replacement"], secondaryServices: ["gutters"], declines: [{ what: "roofing", referral: "a roofer" }], materials: [] },
      serviceArea: { countyIds: [thurston.id, pierce.id], regionIds: ["wa-border-to-tacoma", "xx-nowhere"], spokenAreas: [] },
      credibility: { yearsInBusiness: 12, insured: true },
      policies: { repairs: "replacements_only" },
      offers: { financing: true, financingDetails: "on approved credit" },
      persona: { presetId: "gabe" },
      escalations: { urgentSms: "+13605550199", urgentName: "Dan", officeEmail: "office@example.invalid" },
      leadDelivery: { smsRecipients: ["+13605550198"] },
      publish: false,
    });
    expect(p.company.name).toBe("Cascade Exteriors");
    expect(p.company.services).toEqual([{ name: "siding replacement", details: "", tier: "primary" }, { name: "gutters", details: "", tier: "secondary" }]);
    expect(p.serviceArea.counties.map((c) => c.name)).toEqual(["Thurston", "Pierce", "Whatcom", "San Juan", "Skagit", "Island", "Snohomish", "King"]);
    expect(p.serviceArea.defaultStateCode).toBe("WA");
    expect(p.credibility).toMatchObject({ yearsInBusiness: 12, insured: true });
    expect(p.policies.repairs).toBe("replacements_only");
    expect(p.offers.financing).toEqual({ available: true, details: "on approved credit" });
    expect(p.persona.presetId).toBe("gabe");
    expect(p.escalations.rules.map((r) => [r.id, r.channel, r.recipient, r.kinds.includes("urgent")])).toEqual([
      ["wizard-urgent", "sms", "+13605550199", true], ["wizard-office", "email", "office@example.invalid", false],
    ]);
    expect(p.leadDelivery.sms).toEqual({ enabled: true, recipients: ["+13605550198"] });
    // Re-running the wizard updates its own rules instead of stacking duplicates.
    const again = await applyWizard(p, { company: { name: "Cascade Exteriors", services: [], secondaryServices: [], declines: [], materials: [] }, serviceArea: { countyIds: [], regionIds: [], spokenAreas: [] }, credibility: {}, policies: {}, offers: {}, persona: {}, escalations: { urgentSms: "+13605550100" }, leadDelivery: {}, publish: false });
    expect(again.escalations.rules.map((r) => [r.id, r.recipient])).toEqual([["wizard-urgent", "+13605550100"], ["wizard-office", "office@example.invalid"]]);
    expect(again.company.services).toHaveLength(2);
    expect(again.serviceArea.counties).toHaveLength(8);
  });
});

// ── Small pure pieces of the routes ──────────────────────────────────────────

describe("simulator guard and personas", () => {
  beforeEach(() => resetSimulatorSessions());
  it("caps simulated turns per org per hour", () => {
    const now = Date.now();
    for (let i = 0; i < SIM_TURNS_PER_HOUR; i++) expect(takeSimTurn("org-a", now)).toBe(true);
    expect(takeSimTurn("org-a", now)).toBe(false);
    expect(takeSimTurn("org-b", now)).toBe(true);
    expect(takeSimTurn("org-a", now + 3_600_001)).toBe(true);
  });
  it("lists the six personas and offers a sample only when the file exists", () => {
    resetPersonaCache();
    const list = personaList();
    expect(list.map((p) => [p.id, p.voice])).toEqual([["janice", "af_heart"], ["gabe", "am_michael"], ["sofia", "af_bella"], ["maya", "af_sarah"], ["marcus", "am_adam"], ["ethan", "am_eric"]]);
    for (const p of list) expect(p.sampleUrl === null || p.sampleUrl === `/voice/samples/${p.id}.mp3` || p.sampleUrl === `/voice/samples/${p.id}.wav`).toBe(true);
  });
});

// ── 3. HTTP, end to end on a child server ────────────────────────────────────

async function freePort(from = 8200, to = 8230): Promise<number> {
  for (let p = from; p <= to; p++) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = netServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
      s.listen(p, "0.0.0.0");
    });
    if (ok) return p;
  }
  throw new Error("no free port in 8200–8230");
}

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("Agent Studio over HTTP (child server from this worktree)", () => {
  const sessionSecret = `voice-studio-${randomUUID()}`;
  const internalSecret = randomBytes(24).toString("hex");
  const testIp = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;
  const users: number[] = [], sids: string[] = [];
  const aiQueue: string[] = [];
  const aiSeen: any[] = [];
  let base = "", child: ChildProcess, stub: Server;
  let owner: { id: number; cookie: string }, field: { id: number; cookie: string }, noAddon: { id: number; cookie: string };
  let orgId = "";
  const inbound = testNumber();

  async function account(addons: Record<string, number> | null): Promise<{ id: number; cookie: string }> {
    const { rows: [u] } = await pool.query("insert into users(email, display_name, email_verified) values ($1, 'Voice Studio Test', true) returning id", [`voice-studio-${randomUUID()}@example.invalid`]);
    users.push(u.id);
    if (addons) await pool.query("insert into subscriptions(user_id, plan, status, stripe_subscription_id, addons) values ($1, 'pro', 'active', $2, $3)", [u.id, `sub_vs_${randomUUID()}`, JSON.stringify(addons)]);
    const sid = randomUUID(); sids.push(sid);
    await pool.query("insert into session(sid, sess, expire) values ($1, $2, now() + interval '1 hour')", [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: u.id } })]);
    const sig = createHmac("sha256", sessionSecret).update(sid).digest("base64").replace(/=+$/, "");
    return { id: u.id, cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}` };
  }
  async function api(path: string, who: { cookie: string } | null, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    const r = await fetch(base + path, { method, headers: { cookie: who?.cookie ?? "", "content-type": "application/json", "x-forwarded-for": testIp, ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body: json };
  }
  const internal = (path: string, bearer: string | null = internalSecret) => api(path, null, "GET", undefined, bearer ? { authorization: `Bearer ${bearer}` } : {});

  beforeAll(async () => {
    stub = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        aiSeen.push(JSON.parse(raw || "{}"));
        const content = aiQueue.shift() ?? JSON.stringify({ say: "Unexpected extra AI call from the test.", action: "continue" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "chatcmpl-fixture", object: "chat.completion", created: 0, model: "fixture", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false",
        SESSION_SECRET: sessionSecret, EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "",
        SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true", GBP_CONTENT_WORKER_ENABLED: "false",
        AI_INTEGRATIONS_OPENAI_BASE_URL: `http://127.0.0.1:${(stub.address() as any).port}`, AI_INTEGRATIONS_OPENAI_API_KEY: "fixture-key",
        AI_MODEL: "fixture-model", AI_TIMEOUT_MS: "15000",
        VOICE_INTERNAL_SECRET: internalSecret, VOICE_SIM_BACKEND: "app", VOICE_ENGINE_URL: "http://127.0.0.1:9", VOICE_ESCALATION_WORKER_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/voice-studio-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    let ready = false;
    for (let i = 0; i < 180; i++) {
      if (child.exitCode !== null) throw new Error("voice studio test server exited — see tmp/voice-studio-*.log");
      try { if ((await fetch(base + "/api/auth/me")).status < 500) { ready = true; break; } } catch { /* booting */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("voice studio test server did not start");

    owner = await account({ call_assistant: 1 });
    field = await account(null);
    noAddon = await account({});
    orgId = (await pool.query("insert into crm_orgs(name, owner_user_id, phone, state, industry) values ('Vitest Voice HTTP', $1, '(360) 555-0142', 'WA', 'Siding') returning id", [owner.id])).rows[0].id;
    orgsToDrop.push(orgId);
    await pool.query("insert into crm_members(org_id, user_id, email, role, status, display_name) values ($1, $2, 'owner@example.invalid', 'owner', 'active', 'Owner Person'), ($1, $3, 'field@example.invalid', 'field', 'active', 'Field Person')", [orgId, owner.id, field.id]);
    numbersToDrop.push(inbound);
    await pool.query("insert into voice_numbers(org_id, phone_number, label, location, status, is_test) values ($1, $2, 'Main line', 'Bellingham', 'active', true)", [orgId, inbound]);
  }, 120_000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } }
    await new Promise((r) => stub?.close(r));
    const noAddonOrgs = (await pool.query("select id from crm_orgs where owner_user_id = any($1::int[])", [users])).rows.map((r) => r.id);
    await dropOrgRows(noAddonOrgs);
    await pool.query("delete from subscriptions where user_id = any($1::int[])", [users]);
    await pool.query("delete from session where sid = any($1::text[])", [sids]);
    await pool.query("delete from users where id = any($1::int[])", [users]);
  });

  beforeEach(() => { aiQueue.length = 0; aiSeen.length = 0; });

  it("gates every Studio route: 401 signed out, 402 without the add-on, reads for members, edits need manageSettings", async () => {
    expect((await api("/api/crm/voice/profile", null)).status).toBe(401);
    const r402 = await api("/api/crm/voice/profile", noAddon);
    expect(r402.status).toBe(402);
    expect(r402.body).toMatchObject({ code: "plan_required", addon: "call_assistant" });
    // A field member of the paying org reads (the owner's add-on pays) but cannot edit.
    expect((await api("/api/crm/voice/profile", field)).status).toBe(200);
    expect((await api("/api/crm/voice/profile", field, "PUT", { profile: {} })).status).toBe(403);
    expect((await api("/api/crm/voice/profile/publish", field, "POST", {})).status).toBe(403);
  });

  it("serves the seeded draft, validates PUTs (zod issues, real county ids) and previews without publishing", async () => {
    const g = await api("/api/crm/voice/profile", owner);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ status: "draft", publishedVersion: null, compiled: null, dirty: true });
    expect(g.body.profile.company).toMatchObject({ name: "Vitest Voice HTTP", officePhone: "+13605550142", trade: "Siding" });
    const profile: VoiceProfile = g.body.profile;

    const bad = await api("/api/crm/voice/profile", owner, "PUT", { profile: { ...profile, intake: { questions: [] } } });
    expect(bad.status).toBe(400);
    expect(bad.body.issues[0]).toMatchObject({ path: "intake.questions" });

    const fake = await api("/api/crm/voice/profile", owner, "PUT", { profile: { ...profile, serviceArea: { ...profile.serviceArea, counties: [{ id: 987654321, name: "Atlantis", stateCode: "WA" }] } } });
    expect(fake.status).toBe(400);
    expect(fake.body.issues[0].message).toContain("Unknown county Atlantis");

    const counties = await api("/api/crm/voice/counties?state=wa", owner);
    expect(counties.status).toBe(200);
    const king = counties.body.counties.find((c: any) => c.name === "King");
    expect(counties.body.regions.map((r: any) => r.id)).toEqual(expect.arrayContaining(["wa-border-to-tacoma", "wa-puget-sound", "all-wa"]));
    expect((await api("/api/crm/voice/counties?state=Washington", owner)).status).toBe(400);

    const ok = await api("/api/crm/voice/profile", owner, "PUT", { profile: { ...profile, serviceArea: { ...profile.serviceArea, counties: [king] }, faq: [{ question: "Do you pull permits?", answer: "Yes." }] } });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.serviceArea.counties).toEqual([king]);

    const preview = await api("/api/crm/voice/profile/preview", owner);
    expect(preview.status).toBe(200);
    expect(preview.body.version).toBe(1);
    expect(preview.body.compiled.systemPrompt).toContain("Washington: King County");
    expect((await api("/api/crm/voice/profile", owner)).body.publishedVersion).toBeNull();

    const personas = await api("/api/crm/voice/personas", owner);
    expect(personas.body.personas).toHaveLength(6);
  });

  it("the engine gets 423 unpublished, then the published profile once the owner publishes; pause and resume", async () => {
    expect((await internal(`/api/voice-internal/profile?to=${encodeURIComponent(inbound)}`, null)).status).toBe(401);
    expect((await internal(`/api/voice-internal/profile?to=${encodeURIComponent(inbound)}`, "wrong-secret-wrong-secret")).status).toBe(401);
    expect((await internal("/api/voice-internal/health")).body).toEqual({ ok: true, app: "constructhub" });
    const before = await internal(`/api/voice-internal/profile?to=${encodeURIComponent(inbound)}`);
    expect(before.status).toBe(423);
    expect(before.body.code).toBe("unpublished");
    expect(before.body.say).toMatch(/isn't set up yet/);
    expect((await internal("/api/voice-internal/profile?to=%2B19995550100")).status).toBe(404);
    expect((await internal("/api/voice-internal/profile?to=nope")).status).toBe(400);

    const pub = await api("/api/crm/voice/profile/publish", owner, "POST", { note: "go live" });
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ version: 1, status: "live", publishedVersion: 1, setupCompletedAt: expect.any(String) });

    const live = await internal(`/api/voice-internal/profile?to=${encodeURIComponent(inbound)}&from=%2B18135550111&callSid=CAfixture`);
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({
      org: { id: orgId, name: "Vitest Voice HTTP", timezone: "America/Los_Angeles" },
      number: { label: "Main line", location: "Bellingham", isTest: true, phoneNumber: inbound },
      status: "live", version: 1,
      caller: { number: "+18135550111", blocked: false, strikes: 0, customer: null },
    });
    expect(live.body.compiled).toMatchObject({ version: 1, persona: { id: "janice", voice: "af_heart" } });
    expect(live.body.compiled.systemPrompt).toContain("{{now}}");

    expect((await api("/api/crm/voice/profile/pause", owner, "POST")).body).toEqual({ status: "paused" });
    const paused = await internal(`/api/voice-internal/profile?to=${encodeURIComponent(inbound)}`);
    expect(paused.status).toBe(423);
    expect(paused.body.code).toBe("paused");
    expect((await api("/api/crm/voice/profile/resume", owner, "POST")).body).toEqual({ status: "live" });
    expect((await internal(`/api/voice-internal/profile?to=${encodeURIComponent(inbound)}`)).status).toBe(200);
  });

  it("the setup wizard merges, marks setup complete and publishes; versions list, read and restore", async () => {
    const w = await api("/api/crm/voice/profile/setup", owner, "POST", {
      company: { name: "Vitest Voice HTTP", services: ["siding replacement"] },
      serviceArea: { regionIds: ["wa-border-to-tacoma"] },
      persona: { presetId: "gabe" },
      publish: true,
    });
    expect(w.status).toBe(200);
    expect(w.body.published).toEqual({ version: 2 });
    expect(w.body.setupCompletedAt).toEqual(expect.any(String));
    expect(w.body.profile.serviceArea.counties.map((c: any) => c.name)).toEqual(["Whatcom", "San Juan", "Skagit", "Island", "Snohomish", "King", "Pierce"]);
    expect((await api("/api/crm/voice/profile/setup", owner, "POST", { company: {} })).status).toBe(400);

    const list = await api("/api/crm/voice/profile/versions", owner);
    expect(list.body.versions.map((v: any) => [v.version, v.note, v.published, v.author])).toEqual([[2, "Setup wizard", true, "Owner Person"], [1, "go live", false, "Owner Person"]]);
    expect(list.body.versions[0].changed).toEqual(expect.arrayContaining(["company", "serviceArea", "persona"]));

    const v1 = await api("/api/crm/voice/profile/versions/1", owner);
    expect(v1.body).toMatchObject({ version: 1, note: "go live", compiled: { version: 1 } });
    expect((await api("/api/crm/voice/profile/versions/0", owner)).status).toBe(400);
    expect((await api("/api/crm/voice/profile/versions/42", owner)).status).toBe(404);

    const restored = await api("/api/crm/voice/profile/versions/1/restore", owner, "POST");
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ restoredFrom: 1, publishedVersion: 2, dirty: true });
    expect(restored.body.profile.persona.presetId).toBe("janice");
    // The engine still runs version 2 (gabe) until the next publish.
    expect((await internal(`/api/voice-internal/profile?to=${encodeURIComponent(inbound)}`)).body.compiled.persona.id).toBe("gabe");
  });

  it("the Simulator runs the draft through the same decision protocol against the provider (stubbed here)", async () => {
    const s = await api("/api/crm/voice/simulator/session", owner, "POST", { useDraft: true, callerNumber: "+18135550111" });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ backend: "app", draft: true, compiledVersion: 3, persona: { id: "janice" } });
    expect(s.body.greeting).toMatch(/^Thank you for calling Vitest Voice HTTP, this is Janice/);

    aiQueue.push("<think>need the address</think>" + JSON.stringify({ say: "What's the street address and city?", action: "continue", slots: { need: "siding" } }));
    const t1 = await api("/api/crm/voice/simulator/turn", owner, "POST", { sessionId: s.body.sessionId, text: "I need new siding" });
    expect(t1.status).toBe(200);
    expect(t1.body).toMatchObject({ say: "What's the street address and city?", action: "continue", slots: { need: "siding" }, ended: false, fallback: false, turn: 1 });
    expect(aiSeen[0].model).toBe("fixture-model");
    expect(aiSeen[0].messages[0].content).toContain("Caller ID: 813 555 0111 (never read it aloud).");

    aiQueue.push("not json", "still not json");
    const t2 = await api("/api/crm/voice/simulator/turn", owner, "POST", { sessionId: s.body.sessionId, text: "12 Main St, Bellingham" });
    expect(t2.body).toMatchObject({ fallback: true, action: "continue" });
    expect(t2.body.say).toMatch(/say that one more time/);

    aiQueue.push(JSON.stringify({ say: "Thanks, goodbye!", action: "end_call", outcome: "info", slots: { address: "12 Main St, Bellingham" } }));
    const t3 = await api("/api/crm/voice/simulator/turn", owner, "POST", { sessionId: s.body.sessionId, text: "ok bye" });
    expect(t3.body).toMatchObject({ ended: true, outcome: "lead_submitted" });
    expect((await api("/api/crm/voice/simulator/turn", owner, "POST", { sessionId: s.body.sessionId, text: "hello?" })).status).toBe(409);

    const report = await api(`/api/crm/voice/simulator/session/${s.body.sessionId}`, owner);
    expect(report.body).toMatchObject({ ended: true, submitted: true, outcome: "lead_submitted", slots: { need: "siding", address: "12 Main St, Bellingham" } });
    // Another org cannot read or drive this session.
    expect((await api(`/api/crm/voice/simulator/session/${s.body.sessionId}`, noAddon)).status).toBe(402);
    const del = await api(`/api/crm/voice/simulator/session/${s.body.sessionId}`, owner, "DELETE");
    expect(del.body).toMatchObject({ ended: true, summary: "Ended: lead_submitted." });
    expect((await api("/api/crm/voice/simulator/turn", owner, "POST", { sessionId: s.body.sessionId, text: "hi" })).status).toBe(404);
    expect((await api("/api/crm/voice/simulator/turn", owner, "POST", { sessionId: "", text: "hi" })).status).toBe(400);

    // The published copy can be simulated too.
    const pubSession = await api("/api/crm/voice/simulator/session", owner, "POST", { useDraft: false });
    expect(pubSession.body).toMatchObject({ draft: false, compiledVersion: 2, persona: { id: "gabe" } });
  });
});
