/**
 * GET /api/files/:folder/:subfolder/:filename[/download] serves an allowlist of public prefixes only.
 *
 *   1. Pure: publicFileKey() accepts the public shapes and refuses every private prefix and any
 *      segment carrying a slash, backslash or "..".
 *   2. HTTP (in-process, fake R2 that HOLDS every object, so a 404 is the allowlist, not a miss):
 *      every private prefix — voice, jobcam, ytvideo, issue-reports, backups, … — is a 404 on both
 *      routes, raw and with %2F / %5C / %2E%2E smuggling; allowlisted keys answer 200; a non-media
 *      content type is never rendered inline.
 *   3. The Call Assistant recording's own route (GET /api/crm/voice/calls/:id/recording) against a
 *      real database (DATABASE_URL — the scratch DB): a member of the call's org streams it, another
 *      org gets 404, no session 401. Skipped when the database is unavailable.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import pg from "pg";
import { PassThrough, Readable } from "stream";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";
process.env.VOICE_ESCALATION_WORKER_ENABLED = "false";

// The bucket: every object the app writes, public and private alike.
const bucket = new Map<string, { body: Buffer; contentType: string }>();
vi.mock("../r2", () => ({
  getFromR2: async (key: string) => {
    const o = bucket.get(key);
    if (!o) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    return { body: Readable.from([o.body]), contentType: o.contentType, contentLength: o.body.length };
  },
  putToR2Key: async () => { throw new Error("not in this test"); },
  r2Configured: () => true,
}));
// The member side of the voice routes: the org comes from a test header (the real voiceContext is
// session + org membership + add-on, covered by server/voice/calls.test.ts).
vi.mock("../voice/context", () => ({
  voiceContext: async (req: any, res: any) => {
    const org = req.headers["x-test-org"];
    if (!org) { res.status(401).json({ message: "Login required" }); return null; }
    return { user: { id: 1 }, ctx: { org: { id: String(org) } }, ent: {}, allowance: {}, paused: false };
  },
}));

const { publicFileKey, registerPublicFileRoutes } = await import("./public-files");
const { getFromR2 } = await import("../r2");

const U = () => randomUUID();
const PUBLIC: Record<string, string> = {
  [`logos/company/${U()}.png`]: "image/png",
  [`logos/gmb/${U()}.jpg`]: "image/jpeg",
  [`photos/reviews/${U()}.jpeg`]: "image/jpeg",
  [`media/${U()}/acme-roofing-tampa-1.jpg`]: "image/jpeg",
  // Two-segment keys (avatars, media-library uploads) on GET /api/files/:folder/:filename (2026-10-16).
  [`avatars/${U()}.png`]: "image/png",
  [`media/${U()}.jpg`]: "image/jpeg",
  [`social/${randomUUID().replace(/-/g, "")}/media.mp4`]: "video/mp4",
};
const ORG = `org-${U().slice(0, 8)}`;
const PRIVATE: string[] = [
  `voice/${ORG}/recordings/CA${U().replace(/-/g, "")}.wav`,  // Call Assistant recording (four segments)
  `voice/${ORG}/CA0123456789.wav`,                           // SPEC's original three-segment layout
  `jobcam/${ORG}/${U()}/original.jpg`,
  `jobcam-dev1/${ORG}/${U()}/thumb.jpg`,
  `ytvideo/42/${U()}/original.mp4`,
  `issue-reports/${U()}.png`,
  `backups/db/constructhub-2026-10-15.dump`,
  `crm/attachments/estimate-1001.pdf`,
  `support/recordings/RE123.mp3`,
  `press/inbox/${U()}.pdf`,
  `research/reports/${U()}.pdf`,
  `logos/company/not-a-uuid.png`,
  `tutorials/getting-started.abcd1234.mp4`,
];
for (const [k, t] of Object.entries(PUBLIC)) bucket.set(k, { body: Buffer.from(`public:${k}`), contentType: t });
for (const k of PRIVATE) bucket.set(k, { body: Buffer.from(`SECRET:${k}`), contentType: "audio/wav" });

const k3 = (folder: unknown, subfolder: unknown, filename: unknown) => ({ folder, subfolder, filename });

describe("publicFileKey — pure", () => {
  it("accepts every public-by-design shape", () => {
    for (const k of Object.keys(PUBLIC)) {
      const parts = k.split("/");
      const params = parts.length === 2 ? { folder: parts[0], filename: parts[1] } : { folder: parts[0], subfolder: parts[1], filename: parts[2] };
      expect(publicFileKey(params), k).toBe(k);
    }
  });
  it("refuses private prefixes and smuggled separators", () => {
    expect(publicFileKey(k3("voice", ORG, "recordings/CA1.wav"))).toBeNull();
    expect(publicFileKey(k3("voice/x", "recordings", "CA1.wav"))).toBeNull();
    expect(publicFileKey(k3("jobcam", "o", "original.jpg"))).toBeNull();
    expect(publicFileKey(k3("logos", "company/../../voice", `${U()}.png`))).toBeNull();
    expect(publicFileKey(k3("logos", "company", `..\\${U()}.png`))).toBeNull();
    expect(publicFileKey(k3("logos", "..", `${U()}.png`))).toBeNull();
    expect(publicFileKey(k3("Logos", "company", `${U()}.png`))).toBeNull();
    expect(publicFileKey(k3("logos", "company", `${U()}.png/x`))).toBeNull();
    expect(publicFileKey(k3("social", "abc", "media.jpg"))).toBeNull();
    expect(publicFileKey(k3("social", "a".repeat(32), "secret.pdf"))).toBeNull();
    expect(publicFileKey(k3(undefined, "company", "x"))).toBeNull();
    expect(publicFileKey(null)).toBeNull();
  });
});

describe("/api/files over HTTP — allowlist", () => {
  let server: http.Server; let port = 0;
  beforeAll(async () => {
    const app = express();
    registerPublicFileRoutes(app, { read: getFromR2 as any });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Raw request: no URL normalisation, so "%2E%2E" and "%2F" reach Express as written.
  const get = (rawPath: string) => new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: rawPath }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
    }).on("error", reject);
  });

  /** Every way to spell a key as the route's three params (plus encoded variants). */
  function spellings(key: string): string[] {
    const parts = key.split("/");
    const out = new Set<string>();
    const enc = (s: string) => s.replace(/\//g, "%2F");
    const encLower = (s: string) => s.replace(/\//g, "%2f");
    for (let i = 1; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const segs = [parts.slice(0, i).join("/"), parts.slice(i, j).join("/"), parts.slice(j).join("/")];
      out.add(segs.map(enc).join("/"));
      out.add(segs.map(encLower).join("/"));
      out.add(segs.map((s) => s.replace(/\//g, "%5C")).join("/"));
    }
    if (parts.length === 2) { // two-segment keys: pad with an empty-ish or dot segment
      out.add(`${parts[0]}/.%2F/${parts[1]}`);
      out.add(`${parts[0]}/%2E/${parts[1]}`);
    }
    // Climb out of a public folder.
    out.add(`logos/company/..%2F..%2F${enc(key)}`);
    out.add(`logos/%2E%2E/..%2F${enc(key)}`);
    out.add(`logos/company%2F..%2F..%2F${enc(parts[0])}/${enc(parts.slice(1).join("/"))}`);
    return [...out];
  }

  it("every private key is a 404 on both routes, in every spelling", async () => {
    for (const key of PRIVATE) {
      for (const s of spellings(key)) {
        for (const suffix of ["", "/download"]) {
          const r = await get(`/api/files/${s}${suffix}`);
          expect([400, 404], `${s}${suffix}`).toContain(r.status);
          expect(r.body, `${s}${suffix}`).not.toContain("SECRET");
        }
      }
    }
  });

  it("allowlisted public keys still answer 200 (view inline, download as attachment)", async () => {
    for (const [key, type] of Object.entries(PUBLIC)) {
      const v = await get(`/api/files/${key}`);
      expect(v.status, key).toBe(200);
      expect(v.body).toBe(`public:${key}`);
      expect(v.headers["content-type"]).toContain(type);
      const d = await get(`/api/files/${key}/download?name=${encodeURIComponent('my "photo".jpg')}`);
      expect(d.status, key).toBe(200);
      expect(d.headers["content-disposition"]).toBe('attachment; filename="my _photo_.jpg"');
    }
  });

  it("an allowlisted key that does not exist is a 404", async () => {
    expect((await get(`/api/files/logos/company/${U()}.png`)).status).toBe(404);
  });

  it("a public key holding a non-media type is never rendered inline", async () => {
    const key = `photos/reviews/${U()}.html`;
    bucket.set(key, { body: Buffer.from("<script>alert(1)</script>"), contentType: "text/html" });
    const r = await get(`/api/files/${key}`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("application/octet-stream");
    expect(r.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
});

// ── The R2 body is always released (incident 2026-10-15, as server/tutorials/media-r2.test.ts) ──

describe("/api/files: the R2 body is always released; a slow R2 is a 504", () => {
  const KEY = `logos/company/${U()}.png`;
  let reader: (key: string, o: { abortSignal: AbortSignal }) => Promise<any> = async () => { throw new Error("unset"); };
  let server: http.Server; let base = "";
  beforeAll(async () => {
    const app = express();
    registerPublicFileRoutes(app, { read: (k, o) => reader(k, o), timeoutMs: 200 });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/files/`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const request = (path: string, method = "GET") => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const r = http.request(base + path, { method }, (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    r.on("error", reject);
    r.setTimeout(3000, () => { r.destroy(); reject(new Error("HUNG: no answer")); });
    r.end();
  });
  const dropAfter = (path: string, ms: number) => new Promise<void>((resolve) => {
    const r = http.request(base + path, (res) => { res.destroy(); resolve(); });
    r.on("error", () => resolve()); r.end();
    setTimeout(() => { r.destroy(); resolve(); }, ms);
  });
  const waitFor = async (cond: () => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (!cond()) { if (Date.now() > end) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 10)); }
  };
  const fakeBody = (content = "x".repeat(64)) => {
    const body = new PassThrough(); const destroy = vi.spyOn(body, "destroy"); body.end(content);
    return { body, destroy, length: content.length };
  };

  it("a viewer who leaves while R2 is answering: the abort reaches the read and the late body is destroyed", async () => {
    const { body, destroy, length } = fakeBody();
    let signal: AbortSignal | undefined; let answer!: (v: unknown) => void;
    reader = (_k, o) => { signal = o.abortSignal; return new Promise((r) => { answer = r; }); };
    await dropAfter(KEY, 50);
    await waitFor(() => !!signal?.aborted);
    answer({ body, contentType: "image/png", contentLength: length });
    await waitFor(() => destroy.mock.calls.length > 0);
  });

  it("HEAD answers the headers and destroys the body", async () => {
    const { body, destroy, length } = fakeBody();
    reader = async () => ({ body, contentType: "image/png", contentLength: length });
    const r = await request(KEY, "HEAD");
    expect(r.status).toBe(200);
    expect(r.headers["content-length"]).toBe(String(length));
    expect(destroy).toHaveBeenCalled();
  });

  it("a viewer who closes mid-stream destroys the body (download route too)", async () => {
    for (const suffix of ["", "/download"]) {
      const body = new PassThrough(); const destroy = vi.spyOn(body, "destroy");
      reader = async () => ({ body, contentType: "image/png", contentLength: 1_000_000 });
      body.write("x".repeat(1000));
      await dropAfter(KEY + suffix, 100);
      await waitFor(() => destroy.mock.calls.length > 0);
    }
  });

  it("a body that fails mid-stream is destroyed and the response is cut", async () => {
    const body = new PassThrough(); const destroy = vi.spyOn(body, "destroy");
    reader = async () => ({ body, contentType: "image/png", contentLength: 1000 });
    body.write("x".repeat(10));
    const cut = await new Promise<boolean>((resolve) => {
      const r = http.get(base + KEY, (res) => {
        res.on("data", () => body.emit("error", new Error("R2 reset")));
        res.on("end", () => resolve(false)); res.on("error", () => resolve(true));
      });
      r.on("error", () => resolve(true));
      r.setTimeout(3000, () => { r.destroy(); resolve(false); });
    });
    expect(cut).toBe(true);
    expect(destroy).toHaveBeenCalled();
  });

  it("404 from R2 is a 404; other errors 500; SDK timeouts 504", async () => {
    const fail = (e: object) => { reader = async () => { throw e; }; };
    fail({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    expect((await request(KEY)).status).toBe(404);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fail(new Error("boom"));
    expect((await request(KEY)).status).toBe(500);
    err.mockRestore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fail(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    expect((await request(KEY)).status).toBe(504);
    warn.mockRestore();
  });

  it("a read that never settles hits the deadline: 504, and the abort reaches the read", async () => {
    let signal: AbortSignal | undefined;
    reader = (_k, o) => { signal = o.abortSignal; return new Promise(() => {}); };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await request(`${KEY}/download`);
    expect(r.status).toBe(504);
    expect(signal?.aborted).toBe(true);
    warn.mockRestore();
  });

  it("a refused key never reaches R2", async () => {
    const read = vi.fn(async () => ({ body: fakeBody().body, contentType: "audio/wav" }));
    reader = read;
    expect((await request(`voice%2Fo%2Frecordings/CA1.wav`)).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
});

// ── The recording's own, authenticated route ────────────────────────────────

const DB_URL = process.env.DATABASE_URL!;
let dbReady = false;
{
  const probe = new pg.Pool({ connectionString: DB_URL, connectionTimeoutMillis: 3000 });
  dbReady = await probe.query(`select count(*)::int as n from information_schema.tables where table_name = 'voice_calls'`)
    .then((r) => r.rows[0].n === 1, () => false);
  await probe.end().catch(() => {});
}

describe.skipIf(!dbReady)("GET /api/crm/voice/calls/:id/recording — org members only", () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const orgA = `vt-rec-a-${U().slice(0, 12)}`, orgB = `vt-rec-b-${U().slice(0, 12)}`;
  const callSid = `CA${U().replace(/-/g, "")}`;
  const recordingKey = `voice/${orgA}/recordings/${callSid}.wav`;
  let callId = ""; let server: http.Server; let base = "";

  beforeAll(async () => {
    bucket.set(recordingKey, { body: Buffer.from("RIFF....WAVEfmt fake-recording"), contentType: "audio/wav" });
    callId = (await pool.query(`insert into voice_calls(org_id, call_sid, recording_key) values ($1,$2,$3) returning id`, [orgA, callSid, recordingKey])).rows[0].id;
    const { registerVoiceCallRoutes } = await import("../voice/calls");
    const app = express();
    registerVoiceCallRoutes(app, (() => ({ id: 1 })) as any);
    registerPublicFileRoutes(app, { read: getFromR2 as any });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await pool.query(`delete from voice_calls where org_id in ($1,$2)`, [orgA, orgB]);
    await pool.end();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const rec = (org?: string) => fetch(`${base}/api/crm/voice/calls/${callId}/recording`, { headers: org ? { "x-test-org": org } : {} });

  it("a member of the call's org streams it, privately", async () => {
    const r = await rec(orgA);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("audio/wav");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.text()).toContain("fake-recording");
  });

  it("another org gets 404; no session gets 401", async () => {
    expect((await rec(orgB)).status).toBe(404);
    expect((await rec()).status).toBe(401);
  });

  it("the same object is a 404 through /api/files", async () => {
    for (const p of [`voice%2F${orgA}/recordings/${callSid}.wav`, `voice/${orgA}%2Frecordings/${callSid}.wav`, `voice/${orgA}/recordings%2F${callSid}.wav`]) {
      expect((await fetch(`${base}/api/files/${p}`)).status, p).toBe(404);
      expect((await fetch(`${base}/api/files/${p}/download`)).status, p).toBe(404);
    }
  });
});
