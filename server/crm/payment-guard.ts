/**
 * The payments firewall — a thin, deterministic layer in front of every route
 * that moves or records money (owner request 2026-10-18: "add a layer of
 * firewall and security" to the payment section).
 *
 * What it does, and why each piece exists:
 *   - **Rate limits** per caller on money writes and on the public pay
 *     endpoints: a scripted burst (or a stuck retry loop) cannot open dozens
 *     of Checkout sessions or record dozens of payments. Keys are the signed-in
 *     user when there is one, else the client IP; budgets are per 15 minutes
 *     (the window the client-auth limiter already uses).
 *   - **JSON-only bodies** on money writes: a cross-site HTML form post
 *     (content-type x-www-form-urlencoded, which browsers send without a
 *     preflight) is refused before any handler runs — CSRF defence in depth
 *     on top of the session cookie's own SameSite policy. Any request that
 *     carries a body (a length or a chunked transfer) must be JSON.
 *   - **Idempotency** for recording a payment: the dialog sends an
 *     `Idempotency-Key` per form. The key is CLAIMED before the handler
 *     runs, so two requests in flight at once cannot both record — the second
 *     is told the first is still being processed (409) — and a later retry
 *     with the same key replays the first answer. Keys are per org + route,
 *     kept 15 minutes, in memory (one process serves the CRM; a restart
 *     forgets them, which only allows a genuine retry — the invoice row lock
 *     and balance check still stand behind it).
 *   - **An audit line** on every refusal (`[payments-guard] …`) so a probe is
 *     visible in the journal, never silent.
 *
 * Nothing here replaces the existing checks — session, org tenancy,
 * permissions (takePayment / manageInvoices / manageSettings / seePrices),
 * zod schemas, row locks, the open-session guard and Stripe signature
 * verification all still run after it.
 */
import type { Request, Response, NextFunction } from "express";
import { allow } from "./client-auth";

/** The caller's IP as Express resolved it (trust-proxy aware), never a raw header. */
const clientIp = (req: Request): string => String(req.ip || req.socket?.remoteAddress || "unknown");

/** Budgets per 15-minute window. */
export const PAYMENT_LIMITS = {
  /** Public pay / pay-info: per IP + document token. */
  publicPay: 20,
  /** Recording, linking, reversing payments and answering prompts: per member (or IP). Sized for a bookkeeper
   *  batch-entering a stack of checks (16 a minute sustained), far above anything a human does by hand. */
  write: 240,
  /** Payment settings changes: per member. */
  settings: 20,
} as const;

function callerKey(req: Request): string {
  const u = (req as any).user;
  return u?.id ? `u:${u.id}` : `ip:${clientIp(req)}`;
}

/** True when the request carries a body at all (a declared length or a chunked transfer). */
function hasBody(req: Request): boolean {
  if (req.headers["transfer-encoding"]) return true;
  const len = Number(req.headers["content-length"] ?? 0);
  return Number.isFinite(len) && len > 0;
}

function refuse(res: Response, req: Request, why: string, status = 429) {
  console.warn(`[payments-guard] ${status} ${req.method} ${req.path} ${why} ip=${clientIp(req)} user=${(req as any).user?.id ?? "-"}`);
  res.status(status).json({ message: status === 429
    ? "Too many payment requests in a short time — wait a few minutes and try again."
    : status === 409
      ? "That payment is already being recorded — give it a moment, then refresh."
      : "This request was refused by the payments guard." });
}

/** Money writes from the CRM: per-member budget + JSON-only body. */
export function paymentWriteLimit(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD" && hasBody(req) && !req.is("application/json")) {
    return refuse(res, req, "non-JSON body on a money write", 415);
  }
  if (!allow(`pay-write:${callerKey(req)}`, PAYMENT_LIMITS.write)) return refuse(res, req, "write budget exhausted");
  next();
}

/** Payment settings (fees, rails, prompts, receipts): a smaller per-member budget. */
export function paymentSettingsLimit(req: Request, res: Response, next: NextFunction): void {
  if (!req.is("application/json")) return refuse(res, req, "non-JSON body on settings", 415);
  if (!allow(`pay-settings:${callerKey(req)}`, PAYMENT_LIMITS.settings)) return refuse(res, req, "settings budget exhausted");
  next();
}

/** The client-facing pay routes: per IP and per document token, so one token cannot be hammered from many IPs either. */
export function publicPayLimit(req: Request, res: Response, next: NextFunction): void {
  const token = String((req.params as any)?.token || "").slice(0, 120);
  if (!allow(`pay-public-ip:${clientIp(req)}`, PAYMENT_LIMITS.publicPay)) return refuse(res, req, "public pay budget (ip)");
  if (token && !allow(`pay-public-tok:${token}`, PAYMENT_LIMITS.publicPay * 2)) return refuse(res, req, "public pay budget (token)");
  if (req.method === "POST" && hasBody(req) && !req.is("application/json")) {
    return refuse(res, req, "non-JSON body on public pay", 415);
  }
  next();
}

// ── Idempotency for recorded payments ───────────────────────────────────────

const IDEMPOTENCY_TTL_MS = 15 * 60 * 1000;
type Remembered = { at: number; status: number; body: unknown } | { at: number; inflight: true };
const remembered = new Map<string, Remembered>();

function idemKey(req: Request, orgId: string): string | null {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || typeof key !== "string" || key.length < 8 || key.length > 128) return null;
  return `${orgId}:${req.path}:${key}`;
}

function sweep(now: number) {
  if (remembered.size < 500) return;
  for (const [k, v] of remembered) if (now - v.at > IDEMPOTENCY_TTL_MS) remembered.delete(k);
}

export type IdempotencyClaim =
  | { kind: "none" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "inflight" }
  | { kind: "claimed" };

/**
 * Claim the request's key before doing the work. "replay" = answer with the
 * stored result; "inflight" = another request with this key is still running
 * (answer 409); "claimed" = proceed, then call rememberIdempotent (success)
 * or releaseIdempotent (failure); "none" = no key was sent.
 */
export function claimIdempotent(req: Request, orgId: string): IdempotencyClaim {
  const k = idemKey(req, orgId);
  if (!k) return { kind: "none" };
  const now = Date.now();
  const hit = remembered.get(k);
  if (hit && now - hit.at <= IDEMPOTENCY_TTL_MS) {
    if ("inflight" in hit) { console.warn(`[payments-guard] duplicate in-flight ${req.method} ${req.path} for org ${orgId}`); return { kind: "inflight" }; }
    console.warn(`[payments-guard] replayed idempotent ${req.method} ${req.path} for org ${orgId}`);
    return { kind: "replay", status: hit.status, body: hit.body };
  }
  sweep(now);
  remembered.set(k, { at: now, inflight: true });
  return { kind: "claimed" };
}

/** Answer an in-flight / replay claim on the response; true when the caller must stop. */
export function answerIdempotent(res: Response, req: Request, claim: IdempotencyClaim): boolean {
  if (claim.kind === "replay") { res.status(claim.status).json(claim.body); return true; }
  if (claim.kind === "inflight") { refuse(res, req, "duplicate in-flight idempotency key", 409); return true; }
  return false;
}

/** Remember a successful answer so a retry with the same key replays it. */
export function rememberIdempotent(req: Request, orgId: string, status: number, body: unknown): void {
  const k = idemKey(req, orgId);
  if (!k) return;
  remembered.set(k, { at: Date.now(), status, body });
}

/** The work failed or was refused: free the key so an honest retry can go through. */
export function releaseIdempotent(req: Request, orgId: string): void {
  const k = idemKey(req, orgId);
  if (k) remembered.delete(k);
}

/** The stored answer for this org + route + key, if the same request already went through (no claim). */
export function replayIdempotent(req: Request, orgId: string): { status: number; body: unknown } | null {
  const k = idemKey(req, orgId);
  if (!k) return null;
  const hit = remembered.get(k);
  if (!hit || "inflight" in hit) return null;
  if (Date.now() - hit.at > IDEMPOTENCY_TTL_MS) { remembered.delete(k); return null; }
  return { status: hit.status, body: hit.body };
}

/** Tests only. */
export function _resetIdempotency(): void { remembered.clear(); }
