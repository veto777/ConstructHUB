/**
 * Who may do what with the Hub (pure; no DB).
 *
 * originOk: a state-changing Hub request (POST) must carry an Origin that is
 *   one of our hosts (site-context allowlist) or exactly this request's own
 *   host (local dev and test lanes). Browsers always send Origin on POST, so a
 *   cross-site form or fetch is refused before any budget is touched.
 * isBuilder: signed in with a verified email — login already requires one —
 *   or the local dev bypass user, never in production.
 */
import type { Request } from "express";
import { isKnownHost } from "../site-context";
import { testAuthEnabled } from "../test-auth";

export function originOk(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return false;
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (isKnownHost(url.hostname)) return true;
  const host = req.get("host");
  return !!host && url.host.toLowerCase() === host.toLowerCase();
}

export function isBuilder(req: Request): boolean {
  const user = req.user as { emailVerified?: boolean } | undefined;
  if (!user) return false;
  if (user.emailVerified === true) return true;
  return process.env.NODE_ENV !== "production" && testAuthEnabled();
}
