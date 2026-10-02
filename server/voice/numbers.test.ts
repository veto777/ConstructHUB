/**
 * Call Assistant numbers (numbers+billing lane).
 *
 * Part 1 drives the SignalWire LaML client against a local stub carrier (an
 * http server that records every request and answers canned JSON): the exact
 * query/form fields SignalWire expects, basic auth, error mapping and the
 * 404-on-release rule. Nothing ever leaves the box.
 *
 * Part 2 boots a child server from THIS checkout on a free port 8200–8230
 * (sms-meter.test.ts pattern) with SIGNALWIRE_SPACE_URL pointed at the stub:
 * 402 without the add-on, the buy-by-state flow, the allowance 403 that names
 * call_number, the 14-day release rule and the Overview status.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createHmac, randomUUID, randomInt } from "node:crypto";
import http from "node:http";
import net from "node:net";
import pg from "pg";
import { ADDONS, CALL_NUMBER_MIN_DAYS } from "@shared/plans";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

// ── The stub carrier ────────────────────────────────────────────────────────

type Hit = { method: string; path: string; query: URLSearchParams; form: URLSearchParams; auth: string | null };
type Stub = { server: http.Server; base: string; hits: Hit[]; nextStatus: number | null; nextBody: unknown; exchange: string; close: () => Promise<void> };

function canned(hit: Hit, ex = "555") {
  if (hit.method === "GET" && hit.path.endsWith("/AvailablePhoneNumbers/US/Local.json")) {
    const region = hit.query.get("InRegion") ?? "WA";
    const code = hit.query.get("AreaCode") ?? "360";
    const n = Number(hit.query.get("PageSize") ?? 10);
    return { available_phone_numbers: Array.from({ length: n }, (_, i) => ({ phone_number: `+1${code}${ex}${String(100 + i).padStart(4, "0")}`, friendly_name: `(${code}) ${ex}-0${100 + i}`, locality: hit.query.get("InLocality") ?? "Bellingham", region, capabilities: { voice: true, SMS: true, MMS: false } })) };
  }
  if (hit.method === "POST" && hit.path.endsWith("/IncomingPhoneNumbers.json")) {
    return { sid: `PN${hit.form.get("PhoneNumber")!.slice(2)}`, phone_number: hit.form.get("PhoneNumber"), friendly_name: hit.form.get("FriendlyName"), voice_url: hit.form.get("VoiceUrl"), status_callback: hit.form.get("StatusCallback"), date_created: "Thu, 02 Oct 2026 00:00:00 +0000" };
  }
  if (hit.method === "GET" && hit.path.endsWith("/IncomingPhoneNumbers.json")) return { incoming_phone_numbers: [] };
  if (hit.method === "DELETE") return null;
  return { message: "not stubbed" };
}

async function startStub(): Promise<Stub> {
  const stub: Stub = { server: null as any, base: "", hits: [], nextStatus: null, nextBody: undefined, exchange: "555", close: async () => {} };
  stub.server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://stub");
      const hit: Hit = { method: req.method!, path: u.pathname, query: u.searchParams, form: new URLSearchParams(raw), auth: req.headers.authorization ?? null };
      stub.hits.push(hit);
      const status = stub.nextStatus ?? (hit.method === "DELETE" ? 204 : hit.method === "POST" ? 201 : 200);
      const body = stub.nextStatus !== null ? stub.nextBody : canned(hit, stub.exchange);
      stub.nextStatus = null; stub.nextBody = undefined;
      if (status === 204 || body === null) { res.writeHead(204); return res.end(); }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => stub.server.listen(0, "127.0.0.1", r));
  stub.base = `http://127.0.0.1:${(stub.server.address() as net.AddressInfo).port}`;
  stub.close = () => new Promise((r) => stub.server.close(() => r()));
  return stub;
}

const CFG = { SIGNALWIRE_PROJECT_ID: "proj-vitest", SIGNALWIRE_API_TOKEN: "tok-vitest" };
const expectedAuth = `Basic ${Buffer.from(`${CFG.SIGNALWIRE_PROJECT_ID}:${CFG.SIGNALWIRE_API_TOKEN}`).toString("base64")}`;

// ── Part 1: the client ──────────────────────────────────────────────────────

describe("SignalWire numbers client (stub carrier)", () => {
  let stub: Stub;
  let mod: typeof import("./numbers-signalwire");
  let routes: typeof import("./numbers");
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    stub = await startStub();
    for (const k of ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "VOICE_NUMBERS_MOCK"]) saved[k] = process.env[k];
    process.env.SIGNALWIRE_SPACE_URL = stub.base;
    Object.assign(process.env, CFG);
    delete process.env.VOICE_NUMBERS_MOCK;
    mod = await import("./numbers-signalwire");
    routes = await import("./numbers");
  });
  afterAll(async () => {
    await stub.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  beforeEach(() => { stub.hits.length = 0; });

  it("reads the texting integration's env and keeps an explicit http scheme for a local stub", () => {
    expect(mod.signalwireConfigured()).toBe(true);
    expect(mod.signalwireConfig()).toEqual({ baseUrl: stub.base, project: CFG.SIGNALWIRE_PROJECT_ID, token: CFG.SIGNALWIRE_API_TOKEN });
    process.env.SIGNALWIRE_SPACE_URL = "example.signalwire.com/";
    expect(mod.signalwireConfig()?.baseUrl).toBe("https://example.signalwire.com");
    process.env.SIGNALWIRE_SPACE_URL = stub.base;
    const token = process.env.SIGNALWIRE_API_TOKEN;
    delete process.env.SIGNALWIRE_API_TOKEN;
    expect(mod.signalwireConfigured()).toBe(false);
    expect(() => mod.signalwireNumbers()).toThrow(mod.SignalWireNotConfiguredError);
    process.env.SIGNALWIRE_API_TOKEN = token;
  });

  it("normalizes US numbers to E.164 and rejects the rest", () => {
    expect(mod.toE164("(360) 555-0100")).toBe("+13605550100");
    expect(mod.toE164("1 360 555 0100")).toBe("+13605550100");
    expect(mod.toE164("+13605550100")).toBe("+13605550100");
    expect(mod.toE164("555-0100")).toBeNull();
    expect(mod.toE164("+44 20 7946 0958")).toBeNull();
    expect(mod.areaCodeOf("+13605550100")).toBe("360");
    expect(mod.US_STATE_CODES).toHaveLength(51);
    expect(mod.isUsStateCode("wa")).toBe(true);
    expect(mod.isUsStateCode("PR")).toBe(false);
  });

  it("searches Local numbers by InRegion with the optional AreaCode / InLocality / Contains, under basic auth", async () => {
    const sw = mod.signalwireNumbers();
    const found = await sw.searchAvailable({ state: "wa", areaCode: "360", city: "Bellingham", contains: "55", limit: 3 });
    expect(found).toHaveLength(3);
    expect(found[0]).toEqual({ phoneNumber: "+13605550100", friendlyName: "(360) 555-0100", locality: "Bellingham", region: "WA", areaCode: "360", capabilities: { voice: true, sms: true, mms: false } });
    const [hit] = stub.hits;
    expect(hit.method).toBe("GET");
    expect(hit.path).toBe(`/api/laml/2010-04-01/Accounts/${CFG.SIGNALWIRE_PROJECT_ID}/AvailablePhoneNumbers/US/Local.json`);
    expect(Object.fromEntries(hit.query)).toEqual({ InRegion: "WA", AreaCode: "360", InLocality: "Bellingham", Contains: "55", PageSize: "3" });
    expect(hit.auth).toBe(expectedAuth);
    // Without the optional filters nothing is sent for them; the page size is capped at 20.
    await sw.searchAvailable({ state: "FL", limit: 99 });
    expect(Object.fromEntries(stub.hits[1].query)).toEqual({ InRegion: "FL", PageSize: "20" });
    await expect(sw.searchAvailable({ state: "ZZ" })).rejects.toThrow(/US state/);
    await expect(sw.searchAvailable({ state: "WA", areaCode: "36" })).rejects.toThrow(/three digits/);
  });

  it("buys with the voice webhook, status callback and the org's friendly name, as a form POST", async () => {
    const sw = mod.signalwireNumbers();
    const bought = await sw.purchase({ phoneNumber: "+13605550100", friendlyName: "Alpine Siding Co", voiceUrl: "https://constructhub.us/voice/signalwire/voice", statusCallbackUrl: "https://constructhub.us/voice/signalwire/status" });
    expect(bought).toMatchObject({ sid: "PN3605550100", phoneNumber: "+13605550100", friendlyName: "Alpine Siding Co", voiceUrl: "https://constructhub.us/voice/signalwire/voice", statusCallback: "https://constructhub.us/voice/signalwire/status" });
    const [hit] = stub.hits;
    expect(hit.method).toBe("POST");
    expect(hit.path).toBe(`/api/laml/2010-04-01/Accounts/${CFG.SIGNALWIRE_PROJECT_ID}/IncomingPhoneNumbers.json`);
    expect(Object.fromEntries(hit.form)).toEqual({
      PhoneNumber: "+13605550100", FriendlyName: "Alpine Siding Co",
      VoiceUrl: "https://constructhub.us/voice/signalwire/voice", VoiceMethod: "POST",
      StatusCallback: "https://constructhub.us/voice/signalwire/status", StatusCallbackMethod: "POST",
    });
  });

  it("releases by SID; a 404 counts as released, any other refusal is reported with SignalWire's message", async () => {
    const sw = mod.signalwireNumbers();
    expect(await sw.release("PN123")).toEqual({ released: true, alreadyGone: false });
    expect(stub.hits[0]).toMatchObject({ method: "DELETE", path: `/api/laml/2010-04-01/Accounts/${CFG.SIGNALWIRE_PROJECT_ID}/IncomingPhoneNumbers/PN123.json` });
    stub.nextStatus = 404; stub.nextBody = { message: "The requested resource was not found", code: 20404 };
    expect(await sw.release("PN404")).toEqual({ released: true, alreadyGone: true });
    stub.nextStatus = 400; stub.nextBody = { message: "Number is within its minimum term", code: 21452 };
    await expect(sw.release("PN400")).rejects.toMatchObject({ name: "SignalWireError", status: 400, message: "Number is within its minimum term", swCode: 21452 });
    stub.nextStatus = 500; stub.nextBody = "oops";
    await expect(sw.purchase({ phoneNumber: "+13605550100", friendlyName: "x", voiceUrl: "u", statusCallbackUrl: "s" })).rejects.toMatchObject({ status: 500, message: "SignalWire HTTP 500" });
    // An unreachable space is a 502 with no credential in the message.
    const dead = new mod.SignalWireNumbersClient({ baseUrl: "http://127.0.0.1:9", project: "p", token: "secret-token" });
    await expect(dead.listOwned()).rejects.toMatchObject({ status: 502 });
    await expect(dead.listOwned()).rejects.not.toThrow(/secret-token/);
  });

  it("the dev mock carrier never calls out and labels itself; the 14-day rule and the per-number price are pure", async () => {
    const mock = routes.mockCarrier();
    const found = await mock.search({ state: "WA", limit: 2 });
    expect(found.map((n) => n.phoneNumber)).toEqual(["+13605550100", "+12065550101"]);
    expect((await mock.purchase({ phoneNumber: "+13605550100", friendlyName: "f", voiceUrl: "v", statusCallbackUrl: "s" })).sid).toBe("PNmock3605550100");
    expect(stub.hits).toHaveLength(0);
    expect(routes.numbersMockEnabled()).toBe(false);
    process.env.VOICE_NUMBERS_MOCK = "true";
    expect(routes.carrier().mock).toBe(true);
    delete process.env.VOICE_NUMBERS_MOCK;
    expect(routes.carrier().mock).toBe(false);

    // A real number releases through SignalWire even while the dev mock is switched on.
    process.env.VOICE_NUMBERS_MOCK = "true";
    expect(await routes.carrierForRow({ provider: "signalwire" }).release("PNreal")).toEqual({ released: true, alreadyGone: false });
    expect(stub.hits.at(-1)).toMatchObject({ method: "DELETE", path: expect.stringMatching(/IncomingPhoneNumbers\/PNreal\.json$/) });
    delete process.env.VOICE_NUMBERS_MOCK;
    expect(routes.purchaseOutcomeUnknown(new mod.SignalWireError(502, "x"))).toBe(true);
    expect(routes.purchaseOutcomeUnknown(new mod.SignalWireError(400, "x"))).toBe(false);

    const bought = new Date("2026-10-02T12:00:00Z");
    expect(routes.releaseEligibleAt(bought).toISOString()).toBe(new Date(bought.getTime() + CALL_NUMBER_MIN_DAYS * 86_400_000).toISOString());
    const ctx = (call_assistant: number, call_number: number) => ({
      allowance: { numbers: call_assistant + call_number, minutes: 500 * call_assistant },
      ent: { addons: { call_assistant, call_number }, accessPlan: "pro" },
    }) as any;
    expect(routes.nextNumberMonthlyCents(ctx(1, 0), 0)).toBe(0);
    expect(routes.nextNumberMonthlyCents(ctx(1, 1), 1)).toBe(ADDONS.call_number.monthlyCents);
    expect(routes.nextNumberMonthlyCents(ctx(2, 1), 1)).toBe(0);
    expect(routes.numberAllowance(ctx(1, 2), 1)).toEqual({ numbers: 3, used: 1, remaining: 2, includedNumbers: 1, extraNumberMonthlyCents: ADDONS.call_number.monthlyCents });
    expect(routes.FORWARDING_CARRIERS.map((c) => c.id)).toContain("callrail");
    expect(routes.FORWARDING_CARRIERS.find((c) => c.id === "callrail")!.steps.join(" ")).toMatch(/whisper/i);
  });
});

// ── Part 2: the routes, on a child server from this checkout ────────────────

async function freePort(): Promise<number> {
  for (let p = 8200 + randomInt(0, 31); ; p = 8200 + ((p - 8200 + 1) % 31)) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
}

type Account = { id: number; cookie: string; org?: string };

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("number routes (auxiliary child server + stub carrier)", () => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const users: number[] = [], sids: string[] = [], orgs: string[] = [];
  const secret = "voice-numbers-session-secret";
  const testIp = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;
  let child: ChildProcess, stub: Stub, base = "";
  let noAddon: Account, pro: Account;
  // A per-run exchange: the lane DB is shared with other lanes' suites, and phone_number is unique table-wide.
  const EX = String(randomInt(200, 999)).replace(/^555$/, "556");
  const num = (last: string) => `+1360${EX}${last}`;

  async function api(path: string, who: Account | null, method = "GET", body?: any) {
    const r = await fetch(base + path, { method, headers: { cookie: who?.cookie ?? "", "content-type": "application/json", "x-forwarded-for": testIp }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json };
  }
  async function account(plan: string, addons: Record<string, number> = {}): Promise<Account> {
    const { rows: [user] } = await db.query("insert into users(email,display_name,email_verified) values($1,'P-Voice numbers',true) returning id", [`p-voice-numbers-${randomUUID()}@example.invalid`]);
    users.push(user.id);
    await db.query("insert into subscriptions(user_id,plan,status,stripe_subscription_id,addons) values($1,$2,'active',$3,$4)", [user.id, plan, `sub_p_${randomUUID()}`, JSON.stringify(addons)]);
    const sid = randomUUID(); sids.push(sid);
    await db.query("insert into session(sid,sess,expire) values($1,$2,now()+interval '1 hour')", [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: user.id } })]);
    const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
    const who: Account = { id: user.id, cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}` };
    expect((await api("/api/crm/me", who)).status).toBe(200);
    who.org = (await db.query("select id from crm_orgs where owner_user_id=$1", [user.id])).rows[0].id;
    orgs.push(who.org!);
    return who;
  }
  const setAddons = (who: Account, addons: Record<string, number>) => db.query("update subscriptions set addons=$2 where user_id=$1", [who.id, JSON.stringify(addons)]);

  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    stub = await startStub();
    stub.exchange = EX;
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", SESSION_SECRET: secret,
        EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true",
        // The stub carrier, under the texting integration's env names; the texting side never sends in these tests.
        SIGNALWIRE_SPACE_URL: stub.base, SIGNALWIRE_PROJECT_ID: CFG.SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN: CFG.SIGNALWIRE_API_TOKEN, SIGNALWIRE_FROM_NUMBER: "+15550100000",
        VOICE_NUMBERS_MOCK: "", VOICE_PUBLIC_BASE: "https://constructhub.us/voice", VOICE_ESCALATION_WORKER_ENABLED: "false",
        VOICE_ENGINE_URL: "http://127.0.0.1:9",   // no engine: the Overview must say so
      },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/voice-numbers-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Voice numbers test server exited");
      try { if ((await fetch(base + "/api/auth/me")).ok) { ready = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Voice numbers test server did not start");
    noAddon = await account("pro");
    pro = await account("pro", { call_assistant: 1 });
  }, 90_000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await stub?.close();
    await db.query("delete from voice_numbers where org_id=any($1::text[])", [orgs]);
    await db.query("delete from voice_usage where org_id=any($1::text[])", [orgs]);
    await db.query("delete from crm_members where org_id=any($1::text[])", [orgs]);
    await db.query("delete from crm_orgs where id=any($1::text[])", [orgs]);
    await db.query("delete from subscriptions where user_id=any($1::int[])", [users]);
    await db.query("delete from users where id=any($1::int[])", [users]);
    await db.query("delete from session where sid=any($1::text[])", [sids]);
    await db.end();
  });
  beforeEach(() => { stub.hits.length = 0; });

  it("every numbers route answers the standard 402 with the add-on named until the owner buys it; status still answers", async () => {
    for (const [method, path, body] of [["GET", "/api/crm/voice/numbers"], ["GET", "/api/crm/voice/numbers/search?state=WA"], ["POST", "/api/crm/voice/numbers", { phoneNumber: num("0100") }], ["DELETE", "/api/crm/voice/numbers/x"], ["GET", "/api/crm/voice/usage"]] as const) {
      const r = await api(path, noAddon, method, body);
      expect(r.status, `${method} ${path}`).toBe(402);
      expect(r.body).toMatchObject({ code: "plan_required", requiredPlan: "pro", addon: "call_assistant" });
    }
    expect((await api("/api/crm/voice/numbers", null)).status).toBe(401);
    const status = await api("/api/crm/voice/status", noAddon);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enabled: false, addon: { key: "call_assistant", preview: true }, allowance: { numbers: 0, minutes: 0 }, numbers: [], usage: null });
    expect(stub.hits).toHaveLength(0);
  });

  it("lists an empty workspace with the allowance, forwarding copy and the webhook URLs SignalWire will be pointed at", async () => {
    const r = await api("/api/crm/voice/numbers", pro);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      numbers: [], allowance: { numbers: 1, used: 0, remaining: 1, includedNumbers: 1 }, nextNumberMonthlyCents: 0, minDays: CALL_NUMBER_MIN_DAYS,
      webhooks: { voiceUrl: "https://constructhub.us/voice/signalwire/voice", statusCallbackUrl: "https://constructhub.us/voice/signalwire/status", mediaUrl: "wss://constructhub.us/voice/media" },
      configured: true, mock: false, canManage: true,
    });
    expect(r.body.forwarding.carriers.map((c: any) => c.id)).toEqual(expect.arrayContaining(["att", "verizon", "tmobile", "callrail", "tollfree"]));
    expect(r.body.forwarding.advice.length).toBeGreaterThan(0);
  });

  it("searches by state (validated) through the carrier and prices the candidate for this org", async () => {
    expect((await api("/api/crm/voice/numbers/search", pro)).status).toBe(400);
    expect((await api("/api/crm/voice/numbers/search?state=WA&areaCode=36", pro)).status).toBe(400);
    const r = await api("/api/crm/voice/numbers/search?state=wa&areaCode=360&city=Bellingham&limit=5", pro);
    expect(r.status).toBe(200);
    expect(r.body.numbers).toHaveLength(5);
    expect(r.body.numbers[0]).toMatchObject({ phoneNumber: num("0100"), locality: "Bellingham", region: "WA", areaCode: "360" });
    expect(r.body).toMatchObject({ monthlyCents: 0, mock: false, allowance: { numbers: 1, used: 0 } });
    expect(stub.hits).toHaveLength(1);
    expect(Object.fromEntries(stub.hits[0].query)).toEqual({ InRegion: "WA", AreaCode: "360", InLocality: "Bellingham", PageSize: "5" });
  });

  it("buys a number with the webhooks + org name, then refuses a second above the allowance naming call_number", async () => {
    const bad = await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: "555-0100" });
    expect(bad.status).toBe(400);
    const r = await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: `(360) ${EX}-0100`, label: "Main office", location: "Bellingham, WA", state: "wa", forwardingFrom: `360-${EX}-0199` });
    expect(r.status).toBe(201);
    expect(r.body.mock).toBe(false);
    expect(r.body.number).toMatchObject({
      phoneNumber: num("0100"), label: "Main office", location: "Bellingham, WA", state: "WA", areaCode: "360", provider: "signalwire", providerSid: `PN360${EX}0100`,
      status: "active", isTest: false, forwardingFrom: num("0199"), monthlyCents: 0, releasable: false,
      voiceUrl: "https://constructhub.us/voice/signalwire/voice", statusCallbackUrl: "https://constructhub.us/voice/signalwire/status",
    });
    expect(new Date(r.body.number.releaseEligibleAt).getTime() - new Date(r.body.number.purchasedAt).getTime()).toBe(CALL_NUMBER_MIN_DAYS * 86_400_000);
    const orgName = (await db.query("select name from crm_orgs where id=$1", [pro.org])).rows[0].name;
    expect(stub.hits).toHaveLength(1);
    expect(Object.fromEntries(stub.hits[0].form)).toMatchObject({ PhoneNumber: num("0100"), FriendlyName: orgName, VoiceUrl: "https://constructhub.us/voice/signalwire/voice", VoiceMethod: "POST", StatusCallback: "https://constructhub.us/voice/signalwire/status" });

    const second = await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: num("0101") });
    expect(second.status).toBe(403);
    expect(second.body).toMatchObject({ code: "limit_reached", feature: "voiceNumbers", limit: 1, used: 1, addon: "call_number", upgradePlan: null });
    expect(second.body.message).toContain(ADDONS.call_number.name);
    expect(stub.hits).toHaveLength(1);
    expect((await db.query("select count(*)::int n from voice_numbers where org_id=$1", [pro.org])).rows[0].n).toBe(1);

    // The same number can't be bought twice by anyone.
    const dup = await api("/api/crm/voice/numbers", noAddon, "POST", { phoneNumber: num("0100") });
    expect(dup.status).toBe(402);
    await setAddons(pro, { call_assistant: 1, call_number: 1 });
    const dup2 = await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: num("0100") });
    expect(dup2.status).toBe(409);
    expect(dup2.body.code).toBe("number_taken");
  });

  it("an extra-number unit allows one more at the extra-number price; a carrier refusal buys nothing and frees the slot", async () => {
    const search = await api("/api/crm/voice/numbers/search?state=WA", pro);
    expect(search.body).toMatchObject({ monthlyCents: ADDONS.call_number.monthlyCents, allowance: { numbers: 2, used: 1, remaining: 1 } });
    stub.nextStatus = 400; stub.nextBody = { message: "Phone number is not available", code: 21422 };
    const refused = await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: num("0102"), label: "Second line" });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: "signalwire_error", message: "Phone number is not available" });
    expect((await db.query("select count(*)::int n from voice_numbers where org_id=$1", [pro.org])).rows[0].n).toBe(1);
    const ok = await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: num("0102"), label: "Second line" });
    expect(ok.status).toBe(201);
    expect(ok.body.number).toMatchObject({ phoneNumber: num("0102"), label: "Second line", monthlyCents: ADDONS.call_number.monthlyCents });
    const list = await api("/api/crm/voice/numbers", pro);
    expect(list.body.numbers.map((n: any) => n.phoneNumber)).toEqual([num("0100"), num("0102")]);
    expect(list.body.allowance).toEqual({ numbers: 2, used: 2, remaining: 0, includedNumbers: 1, extraNumberMonthlyCents: ADDONS.call_number.monthlyCents });
  });

  it("relabels a number and refuses the reserved test label", async () => {
    const id = (await api("/api/crm/voice/numbers", pro)).body.numbers[1].id;
    const r = await api(`/api/crm/voice/numbers/${id}`, pro, "PATCH", { label: "Tracking line", location: "Mount Vernon", forwardingFrom: "" });
    expect(r.status).toBe(200);
    expect(r.body.number).toMatchObject({ id, label: "Tracking line", location: "Mount Vernon", forwardingFrom: null });
    expect((await api(`/api/crm/voice/numbers/${id}`, pro, "PATCH", { label: "constructhub-test" })).status).toBe(400);
    // …and a customer can't buy under it either (platform staff only), before any carrier call.
    const hits = stub.hits.length;
    const reserved = await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: num("0177"), label: "constructhub-test", state: "WA" });
    expect(reserved.status).toBe(400);
    expect(reserved.body.message).toMatch(/reserved/);
    expect(stub.hits).toHaveLength(hits);
    expect((await api(`/api/crm/voice/numbers/${randomUUID()}`, pro, "PATCH", { label: "x" })).status).toBe(404);
    // Another org can't touch it.
    await setAddons(noAddon, { call_assistant: 1 });
    expect((await api(`/api/crm/voice/numbers/${id}`, noAddon, "PATCH", { label: "mine now" })).status).toBe(404);
    expect((await api(`/api/crm/voice/numbers/${id}`, noAddon, "DELETE")).status).toBe(404);
    await setAddons(noAddon, {});
  });

  it("release honours SignalWire's 14-day minimum, then releases through the carrier and frees the allowance", async () => {
    const [first, second] = (await api("/api/crm/voice/numbers", pro)).body.numbers;
    const early = await api(`/api/crm/voice/numbers/${second.id}`, pro, "DELETE");
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: "too_early", releaseEligibleAt: second.releaseEligibleAt });
    expect(early.body.message).toMatch(/14 days/);
    expect(stub.hits).toHaveLength(0);
    // Pretend the number is 15 days old.
    await db.query("update voice_numbers set purchased_at=now()-interval '15 days', release_eligible_at=now()-interval '1 day' where id=$1", [second.id]);
    // (it now sorts first: the list is oldest purchase first)
    expect((await api("/api/crm/voice/numbers", pro)).body.numbers.find((n: any) => n.id === second.id).releasable).toBe(true);
    stub.nextStatus = 500; stub.nextBody = { message: "try later" };
    const failed = await api(`/api/crm/voice/numbers/${second.id}`, pro, "DELETE");
    expect(failed.status).toBe(502);
    expect((await db.query("select status,last_error from voice_numbers where id=$1", [second.id])).rows[0]).toMatchObject({ status: "active", last_error: "try later" });
    const r = await api(`/api/crm/voice/numbers/${second.id}`, pro, "DELETE");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ released: true, number: { id: second.id, status: "released" } });
    expect(stub.hits.at(-1)).toMatchObject({ method: "DELETE", path: `/api/laml/2010-04-01/Accounts/${CFG.SIGNALWIRE_PROJECT_ID}/IncomingPhoneNumbers/PN360${EX}0102.json` });
    expect((await api(`/api/crm/voice/numbers/${second.id}`, pro, "DELETE")).body).toMatchObject({ released: true });
    const list = await api("/api/crm/voice/numbers", pro);
    expect(list.body.allowance).toMatchObject({ numbers: 2, used: 1, remaining: 1 });
    expect(list.body.numbers.find((n: any) => n.id === first.id).status).toBe("active");
  });

  it("a purchase SignalWire never confirmed is kept as failed (slot freed, reason shown) and can be dismissed without the carrier", async () => {
    stub.nextStatus = 503; stub.nextBody = { message: "upstream timeout" };
    const r = await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: num("0103"), label: "Flaky", state: "WA" });
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ code: "signalwire_error" });
    const row = (await db.query("select id,status,last_error,state from voice_numbers where phone_number=$1", [num("0103")])).rows[0];
    expect(row).toMatchObject({ status: "failed", state: "WA" });
    expect(row.last_error).toMatch(/not confirmed/);
    const list = await api("/api/crm/voice/numbers", pro);
    expect(list.body.allowance).toMatchObject({ used: 1, remaining: 1 });
    stub.hits.length = 0;
    const gone = await api(`/api/crm/voice/numbers/${row.id}`, pro, "DELETE");
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ released: false, dismissed: true });
    expect(stub.hits).toHaveLength(0);
    expect((await db.query("select count(*)::int n from voice_numbers where id=$1", [row.id])).rows[0].n).toBe(0);
    expect((await api("/api/crm/voice/numbers", pro, "POST", { phoneNumber: num("0104"), state: "Washington" })).status).toBe(400);
  });

  it("the Overview status and the usage route carry the numbers and this month's minutes", async () => {
    const status = await api("/api/crm/voice/status", pro);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enabled: true, allowance: { numbers: 2, minutes: 2000 }, units: { callAssistant: 1, tier: "solo", callNumber: 1 }, tier: { key: "solo", addon: "call_assistant", name: "Solo" }, numberAllowance: { used: 1 }, profile: null, numbersProvider: { configured: true, mock: false } });
    expect(status.body.tiers.map((t: any) => [t.key, t.includedMinutes, t.includedNumbers, t.overageCentsPerMinute])).toEqual([["lite", 1000, 1, 10], ["solo", 2000, 1, 10], ["crew", 5000, 5, 5], ["fleet", 12000, 20, 5]]);
    expect(status.body.pricing).toMatchObject({ includedMinutes: 2000, overageCentsPerMinute: 10, freeSpamCalls: 500 });
    // The engine is probed, not assumed; its internal address never reaches the browser.
    expect(status.body.engine).toMatchObject({ reachable: false, models: false });
    expect(status.body.engine).not.toHaveProperty("url");
    expect(status.body.engine).not.toHaveProperty("publicBase");
    expect(status.body.numbers.map((n: any) => n.status)).toEqual(["active"]);
    const month = new Date().toISOString().slice(0, 7);
    expect(status.body.usage).toMatchObject({ month, calls: 0, minutes: 0, includedMinutes: 2000, remainingMinutes: 2000, overageMinutes: 0, overageCentsPerMinute: 10, spamCallsThisMonth: 0, freeSpamCallsLimit: 500 });
    await db.query("insert into voice_usage(org_id,account_user_id,month,calls,minutes,included_minutes,overage_minutes,spam_calls,blocked_calls,spam_free_calls,spam_free_minutes) values($1,$2,$3,4,2020,2000,20,2,1,2,3)", [pro.org, pro.id, month]);
    const usage = await api("/api/crm/voice/usage", pro);
    expect(usage.status).toBe(200);
    expect(usage.body).toMatchObject({ month, calls: 4, minutes: 2020, includedMinutes: 2000, remainingMinutes: 0, overageMinutes: 20, overageCents: 200, allowance: { minutes: 2000 }, spamCallsThisMonth: 3, freeSpamCalls: 2, freeSpamMinutes: 3 });
    expect(usage.body.history).toHaveLength(1);
    // A month that switched tiers: each rate bucket at its own rate (10 min at 10¢ + 10 min at 5¢), not 20 × the current rate.
    await db.query(`update voice_usage set overage_rate_minutes = '{"10": 10, "5": 10}'::jsonb where org_id = $1 and month = $2`, [pro.org, month]);
    expect((await api("/api/crm/voice/usage", pro)).body).toMatchObject({ overageMinutes: 20, overageCents: 150, overageByRate: [{ centsPerMinute: 10, minutes: 10 }, { centsPerMinute: 5, minutes: 10 }] });
    expect((await api("/api/crm/voice/usage?month=2026-13", pro)).status).toBe(400);
    expect((await api("/api/crm/voice/usage?month=2025-01", pro)).body).toMatchObject({ month: "2025-01", minutes: 0 });
  });
});
