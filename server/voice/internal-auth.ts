/**
 * Engine ↔ app authentication for /api/voice-internal/* (SPEC.md § Internal API).
 *
 * One shared secret both ways: the engine sends `Authorization: Bearer
 * $VOICE_INTERNAL_SECRET` to the app, and the app sends the same header to the
 * engine's /sim, /tts and /personas routes. No secret configured → every
 * internal route answers 503 (never "open"). Comparison is constant-time.
 *
 * Architect-owned (LANES.md). Lanes import `requireVoiceInternal` and
 * `voiceInternalHeaders()`; they do not read the env var themselves.
 */
import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";

export const VOICE_INTERNAL_PATH = "/api/voice-internal";

/** The configured secret, or null. Read at call time so tests and restarts see the truth. */
export function voiceInternalSecret(): string | null {
  const s = process.env.VOICE_INTERNAL_SECRET?.trim();
  // A `chub_` prefix would collide with the public-API key guard (server/public-api/guard.ts).
  if (!s || s.length < 16 || s.startsWith("chub_")) return null;
  return s;
}

export function voiceInternalConfigured(): boolean {
  return voiceInternalSecret() !== null;
}

/** Headers the app sends when it calls the engine (simulator, TTS preview, personas). */
export function voiceInternalHeaders(): Record<string, string> {
  const s = voiceInternalSecret();
  return s ? { Authorization: `Bearer ${s}` } : {};
}

function bearerMatches(header: unknown, secret: string): boolean {
  if (typeof header !== "string") return false;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Express middleware: 503 without a configured secret, 401 on a bad bearer, next() otherwise. */
export function requireVoiceInternal(req: Request, res: Response, next: NextFunction) {
  const secret = voiceInternalSecret();
  if (!secret) return res.status(503).json({ code: "voice_internal_unconfigured", message: "VOICE_INTERNAL_SECRET is not set on this app." });
  if (!bearerMatches(req.headers.authorization, secret)) return res.status(401).json({ code: "unauthorized", message: "Bad internal bearer." });
  res.setHeader("Cache-Control", "no-store");
  return next();
}
