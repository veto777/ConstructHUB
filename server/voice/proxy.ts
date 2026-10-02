/**
 * /voice/* → the engine (SPEC.md § Proxy). OWNER: infra lane (LANES.md).
 *
 * Contract (fixed decision):
 *   - Mounted in server/index.ts BEFORE every body parser, so SignalWire's
 *     form-encoded webhooks reach the engine untouched (raw bytes streamed).
 *   - HTTP: /voice/<rest> → `${VOICE_ENGINE_URL}/<rest>` (the /voice prefix is
 *     stripped; the engine's routes are unprefixed, like Alpine's). Method,
 *     headers, query and body stream through; X-Forwarded-For/Proto/Host are
 *     added; hop-by-hop headers dropped. Response streams back as-is.
 *   - WebSocket: an `upgrade` on /voice/<rest> (SignalWire uses /voice/media)
 *     is tunneled to the engine's /<rest>: a raw TCP socket to the engine, the
 *     upgrade request replayed with the prefix stripped, both directions piped.
 *     No ws framing is touched, so the 8 kHz mu-law stream is byte-exact.
 *   - Default VOICE_ENGINE_URL = http://100.90.145.13:8152 (the tower over the
 *     tailnet; vb11 has no GPU). Engine down / timed out → 503 JSON with no
 *     detail leak (`voice_engine_unavailable`), 504 when it accepted the request
 *     but sent no response headers within VOICE_PROXY_TIMEOUT_MS (default 30 s —
 *     SignalWire gives a webhook ~15 s, the simulator's model turn can take 12 s).
 *     The media WS gets the same budget for the TCP connect and again for the
 *     engine's handshake answer; after the 101 there is no idle timeout.
 *   - Never proxies anything but /voice/*: the mount is the only entry point and
 *     an `/voice/api…` rest is refused (404) so the engine never sees it either.
 *     The engine enforces the bearer on its own /sim, /tts and /personas routes,
 *     so forwarding them is harmless.
 */
import type { Express, Request, Response } from "express";
import http from "http";
import https from "https";
import net from "net";
import tls from "tls";
import type { Server, IncomingMessage } from "http";
import type { Duplex } from "stream";

export const VOICE_PROXY_PREFIX = "/voice";

/** Headers that describe this hop, never forwarded (RFC 7230 §6.1). `upgrade` is kept for the WS tunnel only. */
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
]);

/** Where the engine lives; read at call time. */
export function voiceEngineUrl(): string {
  return (process.env.VOICE_ENGINE_URL || "http://100.90.145.13:8152").replace(/\/+$/, "");
}

/** The public base SignalWire is pointed at (voice webhook / media WS / status callbacks). */
export function voicePublicBase(): string {
  return (process.env.VOICE_PUBLIC_BASE || "https://constructhub.us/voice").replace(/\/+$/, "");
}

export function voiceWebhookUrls(): { voiceUrl: string; statusCallbackUrl: string; mediaUrl: string } {
  const base = voicePublicBase();
  return {
    voiceUrl: `${base}/signalwire/voice`,
    statusCallbackUrl: `${base}/signalwire/status`,
    mediaUrl: `${base.replace(/^http/, "ws")}/media`,
  };
}

/** How long the engine may take to answer with response headers (or accept a tunnel). */
export function voiceProxyTimeoutMs(): number {
  const n = Number(process.env.VOICE_PROXY_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

const agents = { http: new http.Agent({ keepAlive: true, maxSockets: 64 }), https: new https.Agent({ keepAlive: true, maxSockets: 64 }) };

type Target = { secure: boolean; host: string; port: number; hostHeader: string; basePath: string };

export function parseEngineTarget(engineUrl = voiceEngineUrl()): Target {
  const u = new URL(engineUrl);
  const secure = u.protocol === "https:";
  const port = u.port ? Number(u.port) : secure ? 443 : 80;
  return { secure, host: u.hostname, port, hostHeader: u.host, basePath: u.pathname.replace(/\/+$/, "") };
}

/** `/voice/signalwire/voice?x=1` → `/signalwire/voice?x=1`; `/voice` → `/`. null when it is not under the prefix. */
export function stripVoicePrefix(url: string): string | null {
  if (url === VOICE_PROXY_PREFIX) return "/";
  if (url.startsWith(`${VOICE_PROXY_PREFIX}/`)) return url.slice(VOICE_PROXY_PREFIX.length);
  if (url.startsWith(`${VOICE_PROXY_PREFIX}?`)) return `/${url.slice(VOICE_PROXY_PREFIX.length)}`;
  return null;
}

/** A rest path the engine must never receive through the public proxy. */
function refusedRest(rest: string): boolean {
  return /^\/api(?:\/|$|\?)/i.test(rest);
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress || "";
}

/** Copy the inbound headers for the engine: hop-by-hop dropped, host rewritten, X-Forwarded-* added. */
export function forwardHeaders(req: IncomingMessage, target: Target, opts: { upgrade?: boolean } = {}): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (key === "host") continue;
    if (HOP_BY_HOP.has(key) && !(opts.upgrade && (key === "upgrade" || key === "connection"))) continue;
    // Express/node already decoded content-length; a chunked request body is re-chunked by http.request.
    out[key] = v;
  }
  out.host = target.hostHeader;
  const prior = req.headers["x-forwarded-for"];
  const ip = clientIp(req);
  out["x-forwarded-for"] = prior ? `${Array.isArray(prior) ? prior.join(", ") : prior}, ${ip}` : ip;
  out["x-forwarded-proto"] = (req.headers["x-forwarded-proto"] as string | undefined) || ((req.socket as tls.TLSSocket).encrypted ? "https" : "http");
  if (req.headers.host) out["x-forwarded-host"] = req.headers.host;
  out["x-forwarded-prefix"] = VOICE_PROXY_PREFIX;
  return out;
}

function unavailable(res: Response, code: "voice_engine_unavailable" | "voice_engine_timeout" = "voice_engine_unavailable") {
  if (res.headersSent) { res.destroy(); return; }
  res.setHeader("Cache-Control", "no-store");
  res.status(code === "voice_engine_timeout" ? 504 : 503).json({
    code,
    message: code === "voice_engine_timeout" ? "The Call Assistant engine did not answer in time." : "The Call Assistant engine is unavailable.",
  });
}

function proxyHttp(req: Request, res: Response) {
  const rest = stripVoicePrefix(req.originalUrl);
  if (rest === null) { res.status(404).json({ code: "not_found" }); return; }
  if (refusedRest(rest)) { res.status(404).json({ code: "not_found" }); return; }
  const target = parseEngineTarget();
  const timeoutMs = voiceProxyTimeoutMs();
  const upstream = (target.secure ? https : http).request({
    host: target.host,
    port: target.port,
    method: req.method,
    path: `${target.basePath}${rest}`,
    headers: forwardHeaders(req, target),
    agent: target.secure ? agents.https : agents.http,
    timeout: timeoutMs,
  });
  let answered = false;
  upstream.on("response", (up) => {
    answered = true;
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(up.headers)) {
      if (v === undefined || HOP_BY_HOP.has(k.toLowerCase())) continue;
      headers[k] = v;
    }
    res.writeHead(up.statusCode || 502, up.statusMessage, headers);
    up.pipe(res);
    up.on("error", () => res.destroy());
  });
  upstream.on("timeout", () => {
    if (!answered) { upstream.destroy(new Error("engine timeout")); unavailable(res, "voice_engine_timeout"); }
  });
  upstream.on("error", (err: NodeJS.ErrnoException) => {
    if (answered) { res.destroy(); return; }
    if (err.message === "engine timeout") return; // already answered 504
    console.warn(`[voice-proxy] ${req.method} ${rest} → ${target.hostHeader}: ${err.code || err.message}`);
    unavailable(res);
  });
  // Caller went away: stop the upstream request too (a webhook retry will follow).
  res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
  req.on("error", () => upstream.destroy());
  req.pipe(upstream);
}

/**
 * Replay the upgrade request against the engine over a raw socket and pipe both ways.
 * Two timeouts, both VOICE_PROXY_TIMEOUT_MS: the TCP connect, and the engine's first byte
 * after the replayed request (an engine that accepts the socket but never answers the
 * handshake would otherwise hang SignalWire's stream forever). Once bytes flow, the tunnel
 * has no idle timeout — a call may be silent — but TCP keep-alive on both legs notices a
 * dead tailnet path.
 */
function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const rest = stripVoicePrefix(req.url || "");
  if (rest === null || refusedRest(rest)) {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  const target = parseEngineTarget();
  const timeoutMs = voiceProxyTimeoutMs();
  let failed = false;
  let answered = false;
  const fail = (status: 503 | 504) => {
    if (failed || answered) return;
    failed = true;
    if (!socket.destroyed) {
      const body = JSON.stringify({ code: status === 504 ? "voice_engine_timeout" : "voice_engine_unavailable" });
      socket.end(`HTTP/1.1 ${status} ${status === 504 ? "Gateway Timeout" : "Service Unavailable"}\r\nConnection: close\r\n` +
        `Content-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    }
    upstream.destroy();
  };
  const upstream: Duplex = target.secure
    ? tls.connect({ host: target.host, port: target.port, servername: target.host })
    : net.connect({ host: target.host, port: target.port });
  let timer = setTimeout(() => fail(504), timeoutMs);
  let connected = false;
  upstream.on(target.secure ? "secureConnect" : "connect", () => {
    connected = true;
    clearTimeout(timer);
    for (const s of [upstream, socket] as net.Socket[]) {
      s.setNoDelay?.(true);
      s.setKeepAlive?.(true, 30_000);
    }
    const headers = forwardHeaders(req, target, { upgrade: true });
    const lines = [`${req.method} ${target.basePath}${rest} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined) continue;
      for (const one of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${one}`);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) upstream.write(head);
    timer = setTimeout(() => fail(504), timeoutMs);
    // Pipe the engine → caller leg only once the engine has answered: piping earlier would forward
    // an engine EOF as our EOF and the caller would see a bare hang-up instead of the 503.
    upstream.once("data", (first: Buffer) => {
      answered = true;
      clearTimeout(timer);
      socket.write(first);
      upstream.pipe(socket);
    });
    socket.pipe(upstream);
  });
  upstream.on("error", (err: NodeJS.ErrnoException) => {
    clearTimeout(timer);
    if (failed) return;
    if (connected && answered) { socket.destroy(); return; }
    console.warn(`[voice-proxy] upgrade ${rest} → ${target.hostHeader}: ${err.code || err.message}`);
    fail(503);
  });
  upstream.on("close", () => {
    clearTimeout(timer);
    if (failed) return; // fail() is flushing its answer with socket.end()
    if (!answered) { fail(503); return; } // engine hung up before answering the handshake
    socket.destroy();
  });
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => { clearTimeout(timer); upstream.destroy(); });
}

/** Is an upgrade request ours? Only /voice and /voice/… (Vite's HMR and anything else stays untouched). */
export function isVoiceUpgrade(url: string | undefined): boolean {
  return !!url && stripVoicePrefix(url) !== null;
}

/**
 * GET the engine's /health straight (not through the proxy), for the CRM status
 * panel. Resolves null when the engine is down or slow; never throws.
 */
export async function fetchEngineHealth(timeoutMs = 3000): Promise<Record<string, unknown> | null> {
  const target = parseEngineTarget();
  return new Promise((resolve) => {
    const r = (target.secure ? https : http).get(
      { host: target.host, port: target.port, path: `${target.basePath}/health`, headers: { host: target.hostHeader }, timeout: timeoutMs },
      (up) => {
        const chunks: Buffer[] = [];
        up.on("data", (c: Buffer) => chunks.push(c));
        up.on("end", () => {
          if ((up.statusCode || 500) >= 400) return resolve(null);
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve(null); }
        });
        up.on("error", () => resolve(null));
      },
    );
    r.on("timeout", () => r.destroy());
    r.on("error", () => resolve(null));
  });
}

/** Registers the HTTP proxy on the app and the WebSocket tunnel on the server. */
export function registerVoiceProxy(app: Express, httpServer: Server): void {
  app.use(VOICE_PROXY_PREFIX, proxyHttp);
  httpServer.on("upgrade", (req, socket, head) => {
    if (!isVoiceUpgrade(req.url)) return;
    proxyUpgrade(req, socket, head);
  });
}
