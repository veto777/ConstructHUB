/**
 * Tower → app authentication for /api/ops-internal/* (the issue desk's hand-off).
 *
 * `Authorization: Bearer $ISSUE_DESK_SECRET`, compared in constant time. No
 * secret configured (or one too short to trust) → 503, never "open". The
 * tower reaches the app over the tailnet (http://<vb11>:8110), so a request
 * that came through the Cloudflare edge (it carries cf-connecting-ip, which
 * the edge always sets) is answered 404: the internal API is not on the
 * public internet even if the secret leaked.
 */
import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";

export const OPS_INTERNAL_PATH = "/api/ops-internal";

export function issueDeskSecret(): string | null {
  const s = process.env.ISSUE_DESK_SECRET?.trim();
  // A `chub_` prefix would collide with the public-API key guard (server/public-api/guard.ts).
  if (!s || s.length < 24 || s.startsWith("chub_")) return null;
  return s;
}

export function bearerMatches(header: unknown, secret: string): boolean {
  if (typeof header !== "string") return false;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return false;
  // Digests: equal length always, so the compare leaks neither content nor length.
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export function requireIssueDesk(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers["cf-connecting-ip"]) return res.status(404).json({ message: "Not found" });
  const secret = issueDeskSecret();
  if (!secret) return res.status(503).json({ code: "issue_desk_unconfigured", message: "ISSUE_DESK_SECRET is not set on this app." });
  if (!bearerMatches(req.headers.authorization, secret)) return res.status(401).json({ code: "unauthorized", message: "Bad issue-desk bearer." });
  return next();
}
