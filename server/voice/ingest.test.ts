/**
 * External call ingest (server/voice/ingest.ts): Alpine's Janice pushes finished calls into the call log.
 * Needs a development lane DB (voice_calls); runs its own tiny express app on a random port.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { pool } from "../db";
import { registerVoiceIngestRoutes, normalizeTurn, toRow, ingestCallSchema, externalReceptionist } from "./ingest";
import { ensureVoiceSchema } from "./schema";

const SECRET = "ingest-test-secret-0123456789abcdef";
const ORG = `test-ingest-${randomUUID().slice(0, 8)}`;
const OTHER_ORG = `test-ingest-other-${randomUUID().slice(0, 8)}`;
const RUN = randomUUID().slice(0, 8);
const sid = (n: string) => `ing-${RUN}-${n}`;
let server: Server;
let base = "";

async function http(method: string, path: string, opts: { body?: unknown; raw?: Buffer; type?: string; headers?: Record<string, string>; auth?: string | null } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.auth !== null) headers.authorization = `Bearer ${opts.auth ?? SECRET}`;
  let body: any;
  if (opts.raw) { body = opts.raw; headers["content-type"] = opts.type ?? "audio/wav"; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  const r = await fetch(base + path, { method, headers, body });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json };
}

const call = (n: string, over: Record<string, unknown> = {}) => ({
  call_sid: sid(n), site: "FL", from: "+18135550111", to: "+18335550100",
  started_at: "2026-10-02T19:58:00Z", duration_s: 46, outcome: "declined_repair",
  caller_name: "Mihai", summary: "Mihai asked about a repair estimate; we only do full replacements.",
  transcript: [
    { role: "JANICE (AI receptionist)", text: "Thank you for calling Alpine, this is Janice." },
    { role: "CALLER", text: "Bye." },
    { role: "CALLER", text: "[not answered: a lone goodbye this early is usually a misheard hello] Bye." },
    { role: "caller", text: "I need an estimate for repairs, is that something you do?" },
  ],
  lead_id: null, escalation: { kind: "other", to: "Mike", text: "Repair estimate request" },
  ...over,
});

const rowFor = async (callSid: string) => (await pool.query(`SELECT * FROM voice_calls WHERE call_sid = $1`, [callSid])).rows[0];

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
  await ensureVoiceSchema();   // call numbers (call_no + trigger) on a dev DB that predates them
  process.env.VOICE_INGEST_SECRET = SECRET;
  process.env.VOICE_INGEST_ORG_ID = ORG;
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  registerVoiceIngestRoutes(app);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await pool.query(`DELETE FROM voice_calls WHERE call_sid LIKE $1`, [`ing-${RUN}-%`]);
  delete process.env.VOICE_INGEST_SECRET;
  delete process.env.VOICE_INGEST_ORG_ID;
});

describe("auth: tailnet + bearer only", () => {
  it("answers 404 through the Cloudflare edge, 401 on a bad or missing bearer", async () => {
    expect((await http("POST", "/api/voice-ingest/calls", { body: call("a"), headers: { "cf-connecting-ip": "1.2.3.4" } })).status).toBe(404);
    expect((await http("POST", "/api/voice-ingest/calls", { body: call("a"), auth: "wrong-wrong-wrong-wrong-wrong" })).status).toBe(401);
    expect((await http("POST", "/api/voice-ingest/calls", { body: call("a"), auth: null })).status).toBe(401);
    expect(await rowFor(sid("a"))).toBeUndefined();
  });

  it("is closed (503), never open, without a secret or org", async () => {
    const saved = process.env.VOICE_INGEST_ORG_ID;
    delete process.env.VOICE_INGEST_ORG_ID;
    expect((await http("POST", "/api/voice-ingest/calls", { body: call("a") })).status).toBe(503);
    process.env.VOICE_INGEST_ORG_ID = saved;
  });
});

describe("storing a call", () => {
  it("stores the call under the configured org as an external record, with mapped outcome and roles", async () => {
    const r = await http("POST", "/api/voice-ingest/calls", { body: call("one") });
    expect(r.status).toBe(201);
    const row = await rowFor(sid("one"));
    expect(row).toMatchObject({ org_id: ORG, engine: "external", persona: "janice", outcome: "declined", caller_name: "Mihai", duration_seconds: 46, from_number: "+18135550111" });
    expect(row.transcript.map((t: any) => t.role)).toEqual(["assistant", "caller", "system", "caller"]);
    expect(row.flags.ingest).toEqual({ source: "alpine-janice", market: "FL", outcome: "declined_repair", leadId: null, escalation: { kind: "other", to: "Mike", text: "Repair estimate request" } });
    expect(row.billed_minutes).toBeNull();
  });

  it("is idempotent: the same call_sid again updates the row (200), never duplicates it", async () => {
    const r = await http("POST", "/api/voice-ingest/calls", { body: call("one", { outcome: "request_submitted", lead_id: 4821 }) });
    expect(r).toMatchObject({ status: 200, body: { created: false } });
    const rows = (await pool.query(`SELECT outcome, flags FROM voice_calls WHERE call_sid = $1`, [sid("one")])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("lead_submitted");
    expect(rows[0].flags.ingest.leadId).toBe("4821");
  });

  it("never overwrites a call the engine answered, or another org's call (409)", async () => {
    await pool.query(`INSERT INTO voice_calls (org_id, call_sid, engine, outcome) VALUES ($1, $2, 'constructhub', 'info')`, [OTHER_ORG, sid("theirs")]);
    const r = await http("POST", "/api/voice-ingest/calls", { body: call("theirs") });
    expect(r.status).toBe(409);
    expect(await rowFor(sid("theirs"))).toMatchObject({ org_id: OTHER_ORG, engine: "constructhub", outcome: "info" });
  });

  it("takes a backfill batch with per-call results, and rejects bad calls without storing them", async () => {
    const r = await http("POST", "/api/voice-ingest/calls", { body: { calls: [call("b1"), call("b2", { outcome: "spam" }), { call_sid: "x", started_at: "nope" }] } });
    expect(r.status).toBe(200);
    expect(r.body.stored).toBe(2);
    expect(r.body.failed).toBe(1);
    expect(r.body.results[2].error).toMatch(/call_sid|started_at/);
    expect((await rowFor(sid("b2"))).outcome).toBe("spam");
    expect((await http("POST", "/api/voice-ingest/calls", { body: { calls: [] } })).status).toBe(400);
    expect((await http("POST", "/api/voice-ingest/calls", { body: { call_sid: sid("bad"), started_at: "2026-10-02T19:58:00Z" } })).status).toBe(400);
  });
});

describe("call numbers (owner 2026-10-02: every call has an ID)", () => {
  it("numbers each org's calls 1, 2, 3…, keeps a call's number when it is pushed again, and counts orgs separately", async () => {
    const first = await rowFor(sid("one"));
    expect(first.call_no).toBe(1);   // the first call this test org ever stored
    const again = await http("POST", "/api/voice-ingest/calls", { body: call("one", { summary: "updated" }) });
    expect(again.body).toMatchObject({ callNo: 1, created: false });
    const next = await http("POST", "/api/voice-ingest/calls", { body: call("numbered") });
    expect(next).toMatchObject({ status: 201 });
    expect(next.body.callNo).toBeGreaterThan(1);
    const nums = (await pool.query(`SELECT call_no FROM voice_calls WHERE org_id = $1 ORDER BY call_no`, [ORG])).rows.map((r) => r.call_no);
    expect(new Set(nums).size).toBe(nums.length);   // unique within the org
    expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
    // another org's numbering is its own (the engine row inserted above is that org's call #1)
    expect((await rowFor(sid("theirs"))).call_no).toBe(1);
  });
});

describe("recordings", () => {
  it("refuses anything that isn't a WAV, and a recording for a call that was never pushed", async () => {
    expect((await http("PUT", `/api/voice-ingest/calls/${sid("one")}/recording`, { raw: Buffer.from("not a wav file at all, just some bytes padding padding") })).status).toBe(415);
    const wav = Buffer.alloc(64); wav.write("RIFF", 0, "ascii"); wav.write("WAVE", 8, "ascii");
    expect((await http("PUT", `/api/voice-ingest/calls/${sid("never")}/recording`, { raw: wav })).status).toBe(404);
    expect((await http("PUT", `/api/voice-ingest/calls/${sid("theirs")}/recording`, { raw: wav })).status).toBe(404);
  });
});

describe("the outside receptionist on the status (owner 2026-10-04: \"we are using janice already but it still shows draft\")", () => {
  it("names her, her lines and her recent calls once she has pushed calls; nothing for an org without any", async () => {
    const ext = await externalReceptionist(ORG);
    expect(ext).toMatchObject({ name: "Janice", lines: ["FL"] });
    expect(ext!.callsLast30Days).toBeGreaterThan(0);
    expect(await externalReceptionist(`nobody-${RUN}`)).toBeNull();
  });
});

describe("mapping (pure)", () => {
  it("maps role words and keeps unknown outcomes as info", () => {
    expect(normalizeTurn({ role: "Janice", text: "Hi" }).role).toBe("assistant");
    expect(normalizeTurn({ role: "customer", text: "Hi" }).role).toBe("caller");
    expect(normalizeTurn({ role: "caller", text: "[not answered: repeat] hi" }).role).toBe("system");
    const c = ingestCallSchema.parse(call("pure", { outcome: "something_new" }));
    expect(toRow("org", c).outcome).toBe("info");
  });
});
