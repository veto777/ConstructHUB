/**
 * /voice/* → the engine (SPEC.md § Proxy). OWNER: infra lane (LANES.md).
 *
 * Contract (fixed decision):
 *   - Mounted in server/index.ts BEFORE every body parser, so SignalWire's
 *     form-encoded webhooks reach the engine untouched.
 *   - HTTP: /voice/<rest> → `${VOICE_ENGINE_URL}/<rest>` (the /voice prefix is
 *     stripped; the engine's routes are unprefixed, like Alpine's). Method,
 *     headers, query and body stream through; X-Forwarded-For/Proto/Host are
 *     added; hop-by-hop headers dropped. Response streams back as-is.
 *   - WebSocket: an `upgrade` on /voice/media is tunneled to the engine's
 *     /media (raw socket piping; no ws framing needed).
 *   - Default VOICE_ENGINE_URL = http://100.90.145.13:8152 (the tower over the
 *     tailnet; vb11 has no GPU). Engine down → 503 JSON with no detail leak.
 *   - Never proxies anything but /voice/*. The engine enforces the bearer on
 *     its own /sim, /tts and /personas routes, so forwarding them is harmless.
 *
 * This skeleton answers 503 and closes upgrades: nothing is forwarded yet.
 */
import type { Express, Request, Response } from "express";
import type { Server } from "http";
import type { Duplex } from "stream";

export const VOICE_PROXY_PREFIX = "/voice";

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

function proxyHttp(_req: Request, res: Response) {
  // TODO(infra): stream the request to `${voiceEngineUrl()}${req.originalUrl.slice(VOICE_PROXY_PREFIX.length)}`.
  res.setHeader("Cache-Control", "no-store");
  res.status(503).json({ code: "voice_engine_unavailable", message: "The Call Assistant engine proxy is not wired yet." });
}

function proxyUpgrade(_req: import("http").IncomingMessage, socket: Duplex) {
  // TODO(infra): open a TCP connection to the engine, replay the upgrade request, pipe both ways.
  socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
  socket.destroy();
}

/** Registers the HTTP proxy on the app and the WebSocket tunnel on the server. */
export function registerVoiceProxy(app: Express, httpServer: Server): void {
  app.use(VOICE_PROXY_PREFIX, proxyHttp);
  httpServer.on("upgrade", (req, socket, _head) => {
    if (!req.url || !(req.url === `${VOICE_PROXY_PREFIX}/media` || req.url.startsWith(`${VOICE_PROXY_PREFIX}/media?`))) return;
    proxyUpgrade(req, socket);
  });
}
