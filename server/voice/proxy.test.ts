/**
 * The /voice/* proxy (infra lane): raw HTTP pass-through, the WebSocket tunnel,
 * 503 when the engine is down. A fake engine runs in-process on port 0; no DB,
 * no dev server, nothing listens on a fixed port.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http, { type IncomingMessage, type Server } from "http";
import net, { AddressInfo } from "net";
import { WebSocket, WebSocketServer } from "ws";
import {
  registerVoiceProxy, stripVoicePrefix, voiceWebhookUrls, voiceEngineUrl, voicePublicBase, fetchEngineHealth,
  parseEngineTarget, isVoiceUpgrade, voiceProxyTimeoutMs,
} from "./proxy";

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

const engine = { server: null as Server | null, port: 0, seen: [] as Seen[], wss: new WebSocketServer({ noServer: true }), slowMs: 0 };
const app = { server: null as Server | null, port: 0 };

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => { const c: Buffer[] = []; req.on("data", (b) => c.push(b)); req.on("end", () => resolve(Buffer.concat(c))); });
}

async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(`http://127.0.0.1:${app.port}${path}`, init);
  return { status: r.status, headers: r.headers, text: await r.text() };
}

beforeAll(async () => {
  // The fake engine: echoes what it saw as JSON, speaks WebSocket on /media, has /health.
  engine.server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    engine.seen.push({ method: req.method || "", url: req.url || "", headers: req.headers, body });
    if (engine.slowMs) await new Promise((r) => setTimeout(r, engine.slowMs));
    if (req.url === "/health") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, activeCalls: 0, engine: "fake" })); return; }
    if (req.url?.startsWith("/signalwire/voice")) {
      res.writeHead(200, { "content-type": "text/xml", "x-engine": "fake", "connection": "keep-alive", "transfer-encoding": "chunked" });
      res.write("<?xml version=\"1.0\"?><Response>");
      res.end("<Say>hi</Say></Response>");
      return;
    }
    if (req.url?.startsWith("/sim/turn")) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "unauthorized" })); return; }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(body);
  });
  engine.server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/media")) { socket.destroy(); return; }
    engine.seen.push({ method: req.method || "", url: req.url, headers: req.headers, body: Buffer.alloc(0) });
    engine.wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ event: "connected", path: req.url, from: req.headers["x-forwarded-for"] }));
      ws.on("message", (data, isBinary) => ws.send(isBinary ? Buffer.concat([Buffer.from([0xff]), data as Buffer]) : `echo:${data}`, { binary: isBinary }));
    });
  });
  engine.port = await listen(engine.server);
  process.env.VOICE_ENGINE_URL = `http://127.0.0.1:${engine.port}`;
  process.env.VOICE_PROXY_TIMEOUT_MS = "1500";

  const ex = express();
  ex.set("trust proxy", 1);
  app.server = http.createServer(ex);
  registerVoiceProxy(ex, app.server);
  // Everything the real app mounts AFTER the proxy: body parsers and an /api route that must stay local.
  ex.use(express.json());
  ex.use(express.urlencoded({ extended: false }));
  ex.get("/api/ping", (_req, res) => res.json({ local: true }));
  ex.post("/api/echo", (req, res) => res.json({ parsed: req.body }));
  app.port = await listen(app.server);
});

afterAll(async () => {
  // Keep-alive sockets (fetch's, the proxy's agent) and upgraded sockets (no longer tracked by the
  // servers) would hold both servers open: terminate what we can and bound the wait.
  for (const c of engine.wss.clients) c.terminate();
  engine.wss.close();
  app.server?.closeAllConnections();
  engine.server?.closeAllConnections();
  const closed = Promise.all([new Promise((r) => app.server?.close(r)), new Promise((r) => engine.server?.close(r))]);
  await Promise.race([closed, new Promise((r) => setTimeout(r, 1500))]);
  delete process.env.VOICE_ENGINE_URL;
  delete process.env.VOICE_PROXY_TIMEOUT_MS;
});

describe("helpers", () => {
  it("strip the /voice prefix and nothing else", () => {
    expect(stripVoicePrefix("/voice")).toBe("/");
    expect(stripVoicePrefix("/voice/media")).toBe("/media");
    expect(stripVoicePrefix("/voice/media?a=1")).toBe("/media?a=1");
    expect(stripVoicePrefix("/voice?x=1")).toBe("/?x=1");
    expect(stripVoicePrefix("/voicemail")).toBeNull();
    expect(stripVoicePrefix("/api/voice")).toBeNull();
    expect(isVoiceUpgrade("/voice/media")).toBe(true);
    expect(isVoiceUpgrade("/vite-hmr")).toBe(false);
    expect(isVoiceUpgrade(undefined)).toBe(false);
  });

  it("derive the public webhook URLs the numbers lane writes on every number", () => {
    const prev = process.env.VOICE_PUBLIC_BASE;
    delete process.env.VOICE_PUBLIC_BASE;
    expect(voicePublicBase()).toBe("https://constructhub.us/voice");
    expect(voiceWebhookUrls()).toEqual({
      voiceUrl: "https://constructhub.us/voice/signalwire/voice",
      statusCallbackUrl: "https://constructhub.us/voice/signalwire/status",
      mediaUrl: "wss://constructhub.us/voice/media",
    });
    process.env.VOICE_PUBLIC_BASE = "http://127.0.0.1:8201/voice/";
    expect(voiceWebhookUrls().mediaUrl).toBe("ws://127.0.0.1:8201/voice/media");
    if (prev === undefined) delete process.env.VOICE_PUBLIC_BASE; else process.env.VOICE_PUBLIC_BASE = prev;
  });

  it("parse the engine target with defaults and a base path", () => {
    expect(voiceEngineUrl()).toBe(`http://127.0.0.1:${engine.port}`);
    expect(parseEngineTarget("http://100.90.145.13:8152")).toEqual({ secure: false, host: "100.90.145.13", port: 8152, hostHeader: "100.90.145.13:8152", basePath: "" });
    expect(parseEngineTarget("https://engine.example/base/")).toMatchObject({ secure: true, port: 443, basePath: "/base" });
    expect(voiceProxyTimeoutMs()).toBe(1500);
  });
});

describe("HTTP proxy", () => {
  it("streams a SignalWire form post untouched, strips the prefix, keeps the query, adds X-Forwarded-*", async () => {
    engine.seen.length = 0;
    const form = "CallSid=CA123&From=%2B13605551212&To=%2B13605550000&CallStatus=ringing";
    const r = await call("/voice/signalwire/voice?AccountSid=abc", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-signalwire-signature": "sig==", "host": "constructhub.us" }, body: form,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/xml");
    expect(r.headers.get("x-engine")).toBe("fake");
    expect(r.text).toContain("<Say>hi</Say>");
    const seen = engine.seen[0];
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("/signalwire/voice?AccountSid=abc");
    expect(seen.body.toString()).toBe(form);
    expect(seen.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(seen.headers["content-length"]).toBe(String(form.length));
    expect(seen.headers["x-signalwire-signature"]).toBe("sig==");
    expect(seen.headers.host).toBe(`127.0.0.1:${engine.port}`);
    expect(seen.headers["x-forwarded-for"]).toBe("127.0.0.1");
    expect(seen.headers["x-forwarded-proto"]).toBe("http");
    // fetch() pins Host to the socket it opened; the proxy forwards whatever Host it received.
    expect(seen.headers["x-forwarded-host"]).toBe(`127.0.0.1:${app.port}`);
    expect(seen.headers["x-forwarded-prefix"]).toBe("/voice");
  });

  it("passes binary bodies and non-2xx answers through byte for byte", async () => {
    engine.seen.length = 0;
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
    const r = await fetch(`http://127.0.0.1:${app.port}/voice/recordings/x`, { method: "PUT", body: bytes, headers: { "content-type": "audio/wav" } });
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer()).equals(bytes)).toBe(true);
    expect(engine.seen[0].body.equals(bytes)).toBe(true);

    const denied = await call("/voice/sim/turn", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(denied.status).toBe(401);
    expect(JSON.parse(denied.text)).toEqual({ code: "unauthorized" });
  });

  it("maps /voice itself to the engine root and appends to an existing X-Forwarded-For", async () => {
    engine.seen.length = 0;
    const r = await call("/voice", { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(r.status).toBe(200);
    expect(engine.seen[0].url).toBe("/");
    expect(engine.seen[0].headers["x-forwarded-for"]).toBe("203.0.113.9, 127.0.0.1");
    const h = await call("/voice/health");
    expect(JSON.parse(h.text)).toMatchObject({ ok: true, engine: "fake" });
  });

  it("never proxies /api — local routes keep their parsers, and /voice/api is refused before the engine", async () => {
    engine.seen.length = 0;
    expect(JSON.parse((await call("/api/ping")).text)).toEqual({ local: true });
    const echoed = await call("/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
    expect(JSON.parse(echoed.text)).toEqual({ parsed: { a: 1 } });
    const refused = await call("/voice/api/voice-internal/health");
    expect(refused.status).toBe(404);
    expect(engine.seen).toHaveLength(0);
  });

  it("answers 503 JSON when the engine is down and 504 when it stalls, leaking nothing", async () => {
    const live = process.env.VOICE_ENGINE_URL;
    process.env.VOICE_ENGINE_URL = "http://127.0.0.1:1"; // nothing listens on port 1
    const down = await call("/voice/health");
    expect(down.status).toBe(503);
    expect(down.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(down.text)).toEqual({ code: "voice_engine_unavailable", message: "The Call Assistant engine is unavailable." });
    expect(down.text).not.toContain("ECONNREFUSED");
    process.env.VOICE_ENGINE_URL = live;

    engine.slowMs = 3000;
    try {
      const slow = await call("/voice/health");
      expect(slow.status).toBe(504);
      expect(JSON.parse(slow.text).code).toBe("voice_engine_timeout");
    } finally { engine.slowMs = 0; }
  });

  it("fetchEngineHealth reads the engine directly and is null when it is down", async () => {
    expect(await fetchEngineHealth()).toMatchObject({ ok: true, engine: "fake" });
    const live = process.env.VOICE_ENGINE_URL;
    process.env.VOICE_ENGINE_URL = "http://127.0.0.1:1";
    expect(await fetchEngineHealth(500)).toBeNull();
    process.env.VOICE_ENGINE_URL = live;
  });
});

describe("WebSocket tunnel", () => {
  function connect(path: string, headers: Record<string, string> = {}): Promise<{ ws: WebSocket; first: string }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}${path}`, { headers });
      ws.once("message", (data) => resolve({ ws, first: data.toString() }));
      ws.once("error", reject);
    });
  }

  it("tunnels /voice/media to the engine's /media and relays text + binary frames both ways", async () => {
    engine.seen.length = 0;
    const { ws, first } = await connect("/voice/media?callSid=CA1", { host: "constructhub.us" });
    expect(JSON.parse(first)).toEqual({ event: "connected", path: "/media?callSid=CA1", from: "127.0.0.1" });
    expect(engine.seen[0].headers["x-forwarded-host"]).toBe("constructhub.us");
    expect(engine.seen[0].headers.upgrade).toBe("websocket");

    const echoed = new Promise<string>((r) => ws.once("message", (d) => r(d.toString())));
    ws.send(JSON.stringify({ event: "media", media: { payload: "AAAA" } }));
    expect(await echoed).toBe(`echo:${JSON.stringify({ event: "media", media: { payload: "AAAA" } })}`);

    const mulaw = Buffer.from(Array.from({ length: 160 }, (_, i) => (i * 7) & 0xff));
    const bin = new Promise<Buffer>((r) => ws.once("message", (d) => r(d as Buffer)));
    ws.send(mulaw);
    const back = await bin;
    expect(back[0]).toBe(0xff);
    expect(back.subarray(1).equals(mulaw)).toBe(true);

    const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
    ws.close(1000, "bye");
    expect(await closed).toBe(1000);
  });

  it("closes the client when the engine drops the socket", async () => {
    const { ws } = await connect("/voice/media");
    const closed = new Promise<void>((r) => ws.once("close", () => r()));
    for (const c of engine.wss.clients) c.terminate();
    await closed;
  });

  it("refuses an upgrade with a 503 when the engine is down, and ignores upgrades outside /voice", async () => {
    const live = process.env.VOICE_ENGINE_URL;
    process.env.VOICE_ENGINE_URL = "http://127.0.0.1:1";
    try {
      const err = await new Promise<Error>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${app.port}/voice/media`);
        ws.once("error", resolve);
      });
      expect(err.message).toMatch(/503/);
    } finally { process.env.VOICE_ENGINE_URL = live; }
    // An engine that accepts the TCP socket but never answers the handshake → 504 after the timeout;
    // one that hangs up before answering → 503. Both leave no tunnel behind.
    const held: net.Socket[] = [];
    const mute = net.createServer((s) => { held.push(s); });
    const mutePort = await new Promise<number>((r) => mute.listen(0, "127.0.0.1", () => r((mute.address() as AddressInfo).port)));
    const rude = net.createServer((s) => s.once("data", () => s.destroy()));
    const rudePort = await new Promise<number>((r) => rude.listen(0, "127.0.0.1", () => r((rude.address() as AddressInfo).port)));
    const upgradeError = () => new Promise<Error>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}/voice/media`);
      ws.once("error", resolve);
    });
    try {
      process.env.VOICE_ENGINE_URL = `http://127.0.0.1:${mutePort}`;
      const t0 = Date.now();
      expect((await upgradeError()).message).toMatch(/504/);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
      process.env.VOICE_ENGINE_URL = `http://127.0.0.1:${rudePort}`;
      expect((await upgradeError()).message).toMatch(/503/);
    } finally {
      process.env.VOICE_ENGINE_URL = live;
      for (const s of held) s.destroy();
      mute.close(); rude.close();
    }
    // Not ours: the proxy leaves the upgrade alone for other listeners (Vite's HMR) — no answer
    // from us, and the engine never sees it.
    engine.seen.length = 0;
    const received = await new Promise<string>((resolve) => {
      const sock = net.connect(app.port, "127.0.0.1", () => {
        sock.write("GET /vite-hmr HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
      });
      let got = "";
      sock.on("data", (d) => { got += d.toString(); });
      setTimeout(() => { sock.destroy(); resolve(got); }, 400);
    });
    expect(received).toBe("");
    expect(engine.seen).toHaveLength(0);
  });
});

describe("Overview engine probe", () => {
  it("asks the engine's /health, caches the answer ~30 s, and reports an unreachable engine as down", async () => {
    const { probeEngine, resetEngineProbe } = await import("./billing");
    resetEngineProbe();
    engine.seen.length = 0;
    const t0 = Date.now();
    expect(await probeEngine(t0)).toMatchObject({ reachable: true, models: false });   // the fake engine reports no models flag
    expect(await probeEngine(t0 + 10_000)).toMatchObject({ reachable: true });
    expect(engine.seen.filter((s) => s.url === "/health")).toHaveLength(1);
    const saved = process.env.VOICE_ENGINE_URL;
    process.env.VOICE_ENGINE_URL = "http://127.0.0.1:9";
    try {
      expect(await probeEngine(t0 + 31_000)).toMatchObject({ reachable: false, models: false });
    } finally {
      process.env.VOICE_ENGINE_URL = saved;
      resetEngineProbe();
    }
  });
});
