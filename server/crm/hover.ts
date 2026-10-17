import { objectPolicy } from "./object-access";
/**
 * HOVER integration — native, per-org, zero-touch after one click.
 *
 *   1. Connect: GET …/hover/connect 302s to HOVER's OAuth authorize page with
 *      OUR callback as redirect_uri; the callback exchanges the code and stores
 *      the refresh token ENCRYPTED (AES-256-GCM secret box keyed off
 *      SESSION_SECRET — crmPaymentAccounts.refresh_token is the closest
 *      existing pattern, but a HOVER refresh token is indefinite and rotates,
 *      so plaintext-at-rest is not good enough for it).
 *   2. Webhook: registration uses the NESTED schema
 *      {"webhook": {"url", "content_type": "json"}} — the flat body the old
 *      hover-worker sent is the 422. There is NO events field; a webhook
 *      subscribes to all org events. One URL may be registered at most twice
 *      (a 3rd 422s), so we LIST first: reuse a verified registration we hold
 *      the hmac_secret for, delete stale/unverified ones, then register.
 *      HOVER answers registration by POSTing a webhook-verification-code event
 *      to the URL; we activate with PUT /api/v2/webhooks/{code}/verify.
 *   3. Receiver: public (no session). Every event is HMAC-verified against the
 *      stored per-webhook hmac_secret before anything is trusted — the
 *      canonical string is "content-type,md5(body),request.path,date" and the
 *      signature arrives as
 *        Hover-Signature-256: sha256=<webhookId>:<base64 hmac-sha256>
 *        Hover-Signature:     sha1=<webhookId>:<base64 hmac-sha1>   (legacy)
 *      (developers.hover.to/docs/webhook-signature-verification — sha256
 *      preferred, sha1 accepted). Unsigned or mis-signed traffic gets a 401.
 *   4. Ingest: job-state-changed-v2 with state "completed" → GET /api/v3/jobs/<id>
 *      → attach to the org's customer by NORMALIZED service address first (line1 stripped +
 *      5-digit zip, same normalization both sides; exactly one customer at the
 *      address attaches, 2+ creates a flagged customer instead of guessing),
 *      else create the customer from the job. Then create the crm_measurements
 *      row (provider "hover", status "ready", externalId "hover:<jobId>" so
 *      redelivery never
 *      duplicates), store the measurement PDF as a gated crm_attachments row
 *      (kind "measurement"), and record the embeddable 3D viewer URL
 *      (machete_blob.OptInFeature.designProUrl, of the form
 *      https://hover.to/3d/<jobId>) as rawPayload.model3dUrl.
 *
 *   5. Projects + homeowner 3D (server/crm/hover-share.ts): after address → email → phone, a unique full-name
 *      match attaches too; the measurement is linked to the customer's project at the job's address (else their
 *      single open project), and the job's HOVER share link (https://hover.to/shared/<token>, the only 3D link a
 *      homeowner can open) is stored as rawPayload.share — found via GET /api/v1/job_shares per org user on every
 *      sync, or pasted by the contractor. hover.to/3d/<jobId> needs a HOVER login and is never sent to a client.
 *
 * Tokens: access tokens live 2h and are cached in memory per org; refresh
 * tokens are indefinite but ROTATE on every refresh — the new one is always
 * persisted before the access token is used.
 *
 * Secrets: HOVER_CLIENT_ID / HOVER_CLIENT_SECRET come from the environment
 * only. They are never logged, never returned in an API response, and never
 * sent anywhere except hover.to's own token endpoint.
 *
 * Test seam: HOVER_OAUTH_BASE / HOVER_API_BASE env vars override the real
 * endpoints; in non-production a tmp/hover-stub.json {"oauthBase","apiBase"}
 * file (written by the test suites) wins next, so e2e/vitest can point the
 * integration at a local stub without touching production config. The stub
 * file is never consulted in production.
 */
import type { Express } from "express";
import fs from "fs";
import path from "path";
import {
  createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual,
} from "crypto";
import { db } from "../db";
import { crmCustomers, crmMeasurements, crmAttachments, crmOrgs , crmMembers } from "@shared/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { allow as rateAllow } from "./client-auth";
import { storeGeneratedPdf, storeGeneratedFile } from "./attachments";
import { queueCrmEvent, customerEventPayload } from "./integrations";
import { oauthBaseUrl } from "../site-context";
import { recordFailure } from "../ops/issues";
import { providerFixture, type HoverFixture } from "../tutorials/fixtures";
import { workerInterval } from "../workers";
import {
  normalizeHoverAddress, normalizePersonName, customerNameKeys, pickJobShare, mergeShare, parseHoverShareUrl,
  linkMeasurementToProject, backfillHoverProjectLinks, hoverMeasurementsForCustomer, rankHoverMeasurements,
  projectAddressKey, shareIsLive, type HoverShare,
} from "./hover-share";
import { crmEstimates, crmProjects } from "@shared/schema";

export { normalizeHoverAddress, normalizePersonName } from "./hover-share";

type GetUser = (req: any, res: any) => any;

// ── Endpoint configuration ──────────────────────────────────────────────────

// Tutorial recording slots only (null everywhere else — server/tutorials/fixtures/gate.ts): a
// stand-in HOVER API on this machine, so the token refresh, sync and ingest below run for real.
const hoverFx = () => providerFixture<HoverFixture>("hover");
const hoverClientId = () => hoverFx()?.clientId ?? process.env.HOVER_CLIENT_ID;
const hoverClientSecret = () => hoverFx()?.clientSecret ?? process.env.HOVER_CLIENT_SECRET;

function hoverBases(): { oauthBase: string; apiBase: string } {
  const fx = hoverFx();
  if (fx) return { oauthBase: fx.oauthBase, apiBase: fx.apiBase };
  let oauthBase = (process.env.HOVER_OAUTH_BASE || "https://hover.to").replace(/\/+$/, "");
  let apiBase = (process.env.HOVER_API_BASE || "https://hover.to/api").replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") {
    try {
      const j = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "tmp", "hover-stub.json"), "utf8"),
      );
      if (typeof j.oauthBase === "string" && j.oauthBase) oauthBase = j.oauthBase.replace(/\/+$/, "");
      if (typeof j.apiBase === "string" && j.apiBase) apiBase = j.apiBase.replace(/\/+$/, "");
    } catch {
      // No stub file — the real endpoints stand.
    }
  }
  return { oauthBase, apiBase };
}

const hoverConfigured = () =>
  Boolean(hoverClientId() && hoverClientSecret());

// ── Secret box (AES-256-GCM, keyed off SESSION_SECRET) ──────────────────────

const boxKey = () =>
  createHash("sha256")
    .update(`hover-secret-box:${process.env.SESSION_SECRET || "dev-only-insecure-session-secret"}`)
    .digest();

export function encryptHoverSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", boxKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
}

export function decryptHoverSecret(enc: string): string | null {
  try {
    const [v, iv, tag, ct] = enc.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", boxKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Connection state (org custom_fields->'hover') ───────────────────────────

export interface HoverWebhookState {
  id: string;
  url: string;
  hmacSecretEnc: string;
  verified: boolean;
  registeredAt: string;
  verifiedAt?: string | null;
}

/** What a sync-now run did, persisted for the settings card. */
export interface HoverSyncReport {
  scanned: number;
  attachedByEmail: number;
  attachedByPhone: number;
  attachedByAddress: number;
  /** Attached by the contact's full name (exactly one non-staff customer had it). */
  attachedByName: number;
  created: number;
  ambiguous: number;
  duplicates: number;
  errors: string[];
  /** True when the 80-page cap cut the jobs walk short — older jobs were NOT scanned. */
  truncated: boolean;
  /** HOVER share links stored this run, and HOVER measurements newly linked to a project. */
  sharesFound?: number;
  sharesError?: string | null;
  projectsLinked?: number;
  /** HOVER 429s that paused the run, and completed jobs left for the next run (not errors). */
  rateLimitPauses?: number;
  deferred?: number;
  at: string;
}

export interface HoverConn {
  refreshTokenEnc: string;
  scopes?: string | null;
  connectedAt: string;
  connectedByMemberId?: string | null;
  webhook?: HoverWebhookState | null;
  lastSyncAt?: string | null;
  /** Last auto-sync attempt, success or not — a failing org waits a full cadence too. */
  lastSyncAttemptAt?: string | null;
  lastError?: string | null;
  /** HOVER refused the stored sign-in (refresh answered 400/401). Only reconnecting fixes it, so auto-sync stops
   *  trying and the card asks for a reconnect. Cleared by a new connection or a refresh that works. */
  needsReconnect?: boolean;
  lastSyncReport?: HoverSyncReport | null;
  /** Auto-sync cadence in hours (default 6). */
  syncEveryHours?: number | null;
}

async function readHoverConn(orgId: string): Promise<HoverConn | null> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  const conn = (org?.customFields as any)?.hover;
  return conn && typeof conn.refreshTokenEnc === "string" ? (conn as HoverConn) : null;
}

/**
 * Merge a patch into custom_fields->'hover' (null deletes the whole block) as ONE atomic jsonb merge, never
 * read-modify-write: a rotated refresh token must not be overwritten by a concurrent write that read the org a
 * moment earlier (that would put the already-used, now-invalid refresh token back and break the connection for
 * good). Same idiom as backups.ts stampBackup.
 */
async function writeHoverConn(orgId: string, patch: Partial<HoverConn> | null): Promise<void> {
  if (patch === null) {
    await db.update(crmOrgs).set({
      customFields: sql`coalesce(${crmOrgs.customFields}, '{}'::jsonb) - 'hover'`,
      updatedAt: new Date(),
    }).where(eq(crmOrgs.id, orgId));
    return;
  }
  await db.update(crmOrgs).set({
    customFields: sql`jsonb_set(
      coalesce(${crmOrgs.customFields}, '{}'::jsonb),
      '{hover}',
      coalesce(${crmOrgs.customFields} -> 'hover', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
    )`,
    updatedAt: new Date(),
  }).where(eq(crmOrgs.id, orgId));
}

// ── OAuth state grant (CSRF), same idiom as the portal-preview grant ────────

const STATE_TTL_MS = 15 * 60 * 1000;
const stateSecret = () => process.env.SESSION_SECRET || "dev-only-insecure-session-secret";

export function mintHoverState(orgId: string): string {
  const exp = Date.now() + STATE_TTL_MS;
  const sig = createHmac("sha256", stateSecret())
    .update(`hover-connect:${orgId}:${exp}`).digest("hex").slice(0, 32);
  return `${orgId}.${exp}.${sig}`;
}

export function verifyHoverState(state: string): string | null {
  const m = /^([0-9a-fA-F-]{36})\.(\d{10,16})\.([0-9a-f]{32})$/.exec(state);
  if (!m) return null;
  const [, orgId, expS, sig] = m;
  if (Number(expS) < Date.now()) return null;
  const expected = createHmac("sha256", stateSecret())
    .update(`hover-connect:${orgId}:${expS}`).digest("hex").slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? orgId : null;
}

// ── Webhook URL key ─────────────────────────────────────────────────────────
//
// HOVER signs webhook events only for integrations it has enrolled (its docs
// call signature verification best-effort, opt-in by email), so in practice
// events arrive UNSIGNED — the live handshake on 2026-10-17 did. The URL we
// register therefore carries a per-org key (?k=<orgId>.<hmac>): an event with
// a valid key is from whoever holds our registered URL, i.e. HOVER. It names
// the org, and the body is only ever a trigger — ingest re-fetches the job
// from HOVER with that org's own token, so nothing in it is trusted.

export function mintHoverWebhookKey(orgId: string): string {
  const sig = createHmac("sha256", stateSecret()).update(`hover-webhook:${orgId}`).digest("hex").slice(0, 32);
  return `${orgId}.${sig}`;
}

export function verifyHoverWebhookKey(key: string): string | null {
  const m = /^([0-9a-fA-F-]{36})\.([0-9a-f]{32})$/.exec(key);
  if (!m) return null;
  const a = Buffer.from(key);
  const b = Buffer.from(mintHoverWebhookKey(m[1]));
  return a.length === b.length && timingSafeEqual(a, b) ? m[1] : null;
}

// ── Access tokens (2h, in-memory cache; refresh tokens rotate) ──────────────

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Drop the cached access token for an org (tests + disconnect). */
export function clearHoverTokenCache(orgId?: string): void {
  if (orgId) tokenCache.delete(orgId);
  else tokenCache.clear();
}

type FetchFn = typeof fetch;

/** What the card shows when HOVER refuses the stored sign-in. */
export const HOVER_RECONNECT_MESSAGE = "HOVER sign-in expired. Reconnect HOVER to resume syncing.";

/** A refresh answered 400 (invalid_grant) or 401: the stored sign-in is no longer valid. */
export const hoverSignInExpired = (status: number) => status === 400 || status === 401;

/**
 * Is this connection waiting for a reconnect? True for the flag, and for a connection whose recorded error already
 * says the refresh was refused (the production org had "…HOVER token refresh failed: 400" stored before the flag
 * existed) — so the card and the scheduler are right immediately, with no data fix.
 */
export function hoverConnNeedsReconnect(conn: { needsReconnect?: boolean; lastError?: string | null } | null | undefined): boolean {
  if (!conn) return false;
  if (conn.needsReconnect === true) return true;
  if (conn.needsReconnect === false) return false; // a refresh worked, or the customer just reconnected
  return /token refresh failed\W+40[01]\b/.test(String(conn.lastError ?? ""));
}

/** Thrown when HOVER refuses the stored sign-in — a customer action (reconnect), not an incident. */
export class HoverReconnectError extends Error {
  constructor(public status: number) {
    super(`HOVER token refresh failed: ${status}`);
    this.name = "HoverReconnectError";
  }
}

/**
 * A valid access token for the org. Refreshes when the cache is stale and
 * ALWAYS persists a rotated refresh token before returning — HOVER invalidates
 * the previous refresh token on each use.
 */
export async function getHoverAccessToken(orgId: string, fetchFn: FetchFn = fetch): Promise<string> {
  const cached = tokenCache.get(orgId);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  // One refresh per org at a time. HOVER rotates the refresh token on every use, so two callers refreshing at once
  // (the webhook, the auto-sync and the Sync button all land here) would both send the SAME refresh token: the
  // loser gets 400 invalid_grant, which flagged the connection "reconnect needed" although the winner had just
  // stored a good token (and a provider with refresh-token reuse detection revokes the whole grant on that replay).
  // Everyone waiting shares the one in-flight refresh instead.
  const inFlight = refreshInFlight.get(orgId);
  if (inFlight) return inFlight;
  const run = refreshHoverAccessToken(orgId, fetchFn);
  refreshInFlight.set(orgId, run);
  try {
    return await run;
  } finally {
    if (refreshInFlight.get(orgId) === run) refreshInFlight.delete(orgId);
  }
}

const refreshInFlight = new Map<string, Promise<string>>();

async function refreshHoverAccessToken(orgId: string, fetchFn: FetchFn, retried = false): Promise<string> {
  const cached = tokenCache.get(orgId);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const conn = await readHoverConn(orgId);
  if (!conn) throw new Error("HOVER is not connected for this organization");
  const refresh = decryptHoverSecret(conn.refreshTokenEnc);
  if (!refresh) throw new Error("Stored HOVER refresh token is unreadable — reconnect HOVER");

  const { oauthBase } = hoverBases();
  const res = await fetchFn(`${oauthBase}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: hoverClientId(),
      client_secret: hoverClientSecret(),
    }),
  });
  if (!res.ok) {
    if (hoverSignInExpired(res.status) && !retried) {
      // Another process (a second app instance) may have rotated the token while we were asking. If the stored
      // token is no longer the one we sent, try once more with it before declaring the sign-in dead.
      const latest = await readHoverConn(orgId);
      if (latest && latest.refreshTokenEnc !== conn.refreshTokenEnc) return refreshHoverAccessToken(orgId, fetchFn, true);
    }
    if (hoverSignInExpired(res.status)) {
      // HOVER no longer accepts this sign-in (first confirmed in production 2026-10-07: 400 on every refresh since
      // 2026-08-11). Nothing we retry can change that — record it once and stop until the customer reconnects.
      await writeHoverConn(orgId, { needsReconnect: true, lastError: HOVER_RECONNECT_MESSAGE }).catch(() => {});
      throw new HoverReconnectError(res.status);
    }
    // Anything else (HOVER down, 5xx) may pass on its own; say so on the card and let the cadence retry.
    await writeHoverConn(orgId, { lastError: `token refresh failed (${res.status})` }).catch(() => {});
    throw new Error(`HOVER token refresh failed: ${res.status}`);
  }
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  if (tok.refresh_token && tok.refresh_token !== refresh) {
    await writeHoverConn(orgId, { refreshTokenEnc: encryptHoverSecret(tok.refresh_token), lastError: null, needsReconnect: false });
  }
  tokenCache.set(orgId, {
    token: tok.access_token,
    expiresAt: Date.now() + (tok.expires_in ?? 7200) * 1000,
  });
  return tok.access_token;
}

// ── Webhook signature verification ──────────────────────────────────────────

const md5b64 = (buf: Buffer) => createHash("md5").update(buf).digest("base64");

/** "content-type,md5(body),request.path,date" — HOVER's canonical string. */
export function hoverCanonicalString(contentType: string, rawBody: Buffer, reqPath: string, date: string): string {
  return [contentType, md5b64(rawBody), reqPath, date].join(",");
}

const eqSafe = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Verify an inbound event against the stored hmac_secret. The header carries
 * the webhook id ("sha256=12345:<sig>") — that id selects WHICH org's secret
 * verifies the payload. sha256 is preferred; the legacy sha1 header is a
 * accepted fallback (HOVER sends both).
 *
 * HOVER's reference implementation (Ruby) signs request.content_type, which is
 * the bare media type ("application/json", parameters stripped), and the docs
 * say Content-MD5 is the header value or blank when absent while the sample
 * code hashes the body itself. A receiver that only tries one reading 401s the
 * real thing (live 2026-10-17: the verification event was refused), so every
 * documented reading is tried. Each one still needs the per-webhook secret.
 */
export function verifyHoverSignature(args: {
  signature256: string | null;
  signatureSha1: string | null;
  contentType: string;
  contentMd5?: string | null;
  rawBody: Buffer;
  path: string;
  date: string;
  webhookId: string;
  hmacSecret: string;
}): boolean {
  const types = [...new Set([args.contentType, args.contentType.split(";")[0].trim()])];
  const md5s = [...new Set([args.contentMd5 ?? null, md5b64(args.rawBody), ""].filter((m): m is string => m !== null))];
  for (const type of types) {
    for (const md5 of md5s) {
      const canonical = [type, md5, args.path, args.date].join(",");
      if (args.signature256) {
        const expected = `sha256=${args.webhookId}:${createHmac("sha256", args.hmacSecret).update(canonical).digest("base64")}`;
        if (eqSafe(args.signature256, expected)) return true;
      }
      if (args.signatureSha1) {
        const expected = `sha1=${args.webhookId}:${createHmac("sha1", args.hmacSecret).update(canonical).digest("base64")}`;
        if (eqSafe(args.signatureSha1, expected)) return true;
      }
    }
  }
  return false;
}

/** The webhook id out of either signature header, or null. */
export function hoverWebhookIdFromHeaders(sig256: unknown, sig1: unknown): string | null {
  for (const h of [sig256, sig1]) {
    const m = /^sha(?:256|1)=(\d+):/.exec(String(h || ""));
    if (m) return m[1];
  }
  return null;
}

// ── HOVER API helpers ───────────────────────────────────────────────────────

// ── Rate limits (HOVER answers 429) ─────────────────────────────────────────

/** HOVER kept answering 429 after our in-call retries — the caller should pause, not count a failure. */
export class HoverRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`HOVER rate limit (429) — retry in ${Math.round(retryAfterMs / 1000)}s`);
    this.name = "HoverRateLimitError";
  }
}

const RETRY_AFTER_DEFAULT_MS = 10_000;
const RETRY_AFTER_MAX_MS = 120_000;

/** Retry-After as milliseconds: delta-seconds or an HTTP date; default 10 s; clamped to 1 s–2 min. */
export function hoverRetryAfterMs(header: string | null | undefined, now: number = Date.now()): number {
  const h = String(header ?? "").trim();
  let ms = RETRY_AFTER_DEFAULT_MS;
  if (/^\d+(\.\d+)?$/.test(h)) ms = Number(h) * 1000;
  else if (h) {
    const t = Date.parse(h);
    if (Number.isFinite(t)) ms = t - now;
  }
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(1000, ms));
}

/** Test seam: how the backoff waits (tests swap in a no-op). */
let backoffSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function setHoverBackoffSleep(fn: ((ms: number) => Promise<void>) | null): void {
  backoffSleep = fn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
}

/**
 * fetch() that honours HOVER's 429: wait Retry-After and try again, up to `retries` times. Still 429 after that →
 * the 429 response is returned (callers that need it raise HoverRateLimitError).
 */
export async function hoverFetchWithBackoff(
  fetchFn: FetchFn, url: string, init: RequestInit, retries = 3,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, init);
    if (res.status !== 429 || attempt >= retries) return res;
    await backoffSleep(hoverRetryAfterMs(res.headers?.get?.("retry-after")));
  }
}

async function hoverApi(
  orgId: string, method: string, apiPath: string, body?: unknown, fetchFn: FetchFn = fetch,
): Promise<{ status: number; json: any }> {
  const token = await getHoverAccessToken(orgId, fetchFn);
  const { apiBase } = hoverBases();
  const res = await hoverFetchWithBackoff(fetchFn, `${apiBase}${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/**
 * Register (or reuse) the org's HOVER webhook.
 *
 * HOVER allows ONE url at most twice, so we list first: a verified
 * registration we already hold the hmac_secret for is reused; anything else
 * for the same URL (unverified leftovers, or a verified one whose secret we
 * lost) is deleted before registering fresh. The POST body MUST be nested
 * under "webhook" with content_type "json" — a flat body 422s.
 */
export async function ensureHoverWebhook(
  orgId: string, url: string, accessToken?: string, fetchFn: FetchFn = fetch,
): Promise<{ state: "verified" | "registered" | "error"; status?: number; webhookId?: string }> {
  const { apiBase } = hoverBases();
  const token = accessToken ?? (await getHoverAccessToken(orgId, fetchFn));
  const auth = { authorization: `Bearer ${token}` };

  let list: any[] = [];
  try {
    const r = await fetchFn(`${apiBase}/v2/webhooks`, { headers: auth });
    const j = await r.json().catch(() => null);
    list = Array.isArray(j) ? j : (j?.results ?? j?.webhooks ?? []);
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }

  const conn = await readHoverConn(orgId);
  const endpoint = (u: unknown) => String(u ?? "").split("?")[0];
  for (const w of list.filter((w) => w && endpoint(w.url) === endpoint(url))) {
    const wId = String(w.id);
    if (w.url !== url) {
      // Our own endpoint registered under an older URL (before the ?k= key) —
      // replace it. Another integration's URL never matches the endpoint.
      await fetchFn(`${apiBase}/v2/webhooks/${w.id}`, { method: "DELETE", headers: auth }).catch(() => {});
      continue;
    }
    const held = conn?.webhook?.id === wId ? conn.webhook : null;
    if (w.verified_at && held?.hmacSecretEnc) {
      // Already live and we hold its secret — nothing to do.
      await writeHoverConn(orgId, {
        webhook: { ...held, verified: true, verifiedAt: held.verifiedAt ?? new Date().toISOString() },
        lastError: null,
      });
      return { state: "verified", webhookId: wId };
    }
    // Stale: unverified, or verified but we no longer hold its hmac_secret
    // (a previous connect was wiped) — signature verification would fail, so
    // delete and re-register to get a fresh secret.
    await fetchFn(`${apiBase}/v2/webhooks/${w.id}`, { method: "DELETE", headers: auth }).catch(() => {});
  }

  const r = await fetchFn(`${apiBase}/v2/webhooks`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ webhook: { url, content_type: "json" } }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    await writeHoverConn(orgId, { lastError: `webhook registration failed (${r.status})` }).catch(() => {});
    return { state: "error", status: r.status };
  }
  const wh = j?.webhook ?? j ?? {};
  if (!wh.id || !wh.hmac_secret) {
    await writeHoverConn(orgId, { lastError: "webhook registration returned no hmac_secret" }).catch(() => {});
    return { state: "error", status: r.status };
  }
  await writeHoverConn(orgId, {
    webhook: {
      id: String(wh.id),
      url,
      hmacSecretEnc: encryptHoverSecret(String(wh.hmac_secret)),
      verified: false,
      registeredAt: new Date().toISOString(),
      verifiedAt: null,
    },
    lastError: null,
  });
  return { state: "registered", webhookId: String(wh.id) };
}

// ── Job parsing ─────────────────────────────────────────────────────────────

/** First non-empty string found at any of the dotted paths. */
function pick(obj: any, paths: string[]): string | null {
  for (const p of paths) {
    let cur = obj;
    for (const k of p.split(".")) {
      cur = cur?.[k];
      if (cur === null || cur === undefined) break;
    }
    if (typeof cur === "string" && cur.trim()) return cur.trim();
    if (typeof cur === "number" && Number.isFinite(cur)) return String(cur);
  }
  return null;
}

/** Every http(s) URL anywhere in the payload (artifact links live deep). */
function collectUrls(node: unknown, out: Set<string>): void {
  if (node == null) return;
  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node)) out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectUrls(v, out);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node)) collectUrls(v, out);
  }
}

/** The designProUrl key wherever HOVER buried it (machete_blob.OptInFeature). */
function findDesignProUrl(node: unknown): string | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const v of node) {
      const f = findDesignProUrl(v);
      if (f) return f;
    }
    return null;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "designProUrl" && typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  for (const v of Object.values(node)) {
    const f = findDesignProUrl(v);
    if (f) return f;
  }
  return null;
}

/**
 * Per-job cap on imported capture photos. The advertised list (photoUrls) and
 * the actual import share this one cap so photoCount never promises more than
 * the import will store.
 */
export const HOVER_PHOTO_CAP = 20;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export interface HoverSummary {
  roofSqft: number | null;
  sidingSqft: number | null;
  windowsCount: number | null;
  stories: number | null;
  pitch: string | null;
  wasteBps: number | null;
}

/**
 * The numbers estimating actually consumes, out of HOVER's full_json
 * measurements (the rich variant behind ?version=full_json). Every field is
 * independently optional and looked up at several plausible paths — the
 * full_json document is large and versioned, so extraction is tolerant by
 * design and the raw document is kept (trimmed) for re-derivation.
 */
export function summarizeHoverMeasurements(fullJson: any): HoverSummary {
  const j = fullJson ?? {};
  const roofSqft =
    num(pick(j, ["roof.total_roof_area_sqft", "roof.total_area_sqft", "summary.roof_area_sqft", "roof_area_sqft", "areas.roof_facets_sqft"])) ??
    null;
  const sidingSqft =
    num(pick(j, ["siding.total_siding_area_sqft", "siding.total_area_sqft", "summary.siding_area_sqft", "siding_area_sqft", "areas.walls_sqft"])) ??
    null;
  const windowsCount =
    num(pick(j, ["openings.windows", "windows.count", "summary.windows", "windows_count", "openings.windows_count"])) ??
    null;
  const stories =
    num(pick(j, ["property.stories", "summary.stories", "stories", "building.stories"])) ?? null;
  const pitch = pick(j, ["roof.predominant_pitch", "predominant_pitch", "roof.pitch", "pitch"]);
  const wastePct =
    num(pick(j, ["waste.suggested_percent", "waste.percent", "waste_factor", "roof.waste_percent", "wastePercent"])) ??
    null;
  return {
    roofSqft,
    sidingSqft,
    windowsCount: windowsCount === null ? null : Math.round(windowsCount),
    stories: stories === null ? null : Math.round(stories),
    pitch: pitch ? pitch.replace(/\s+/g, "") : null,
    wasteBps: wastePct === null ? null : Math.round(wastePct * 100),
  };
}

export interface ParsedHoverJob {
  contact: {
    name: string | null; email: string | null; phone: string | null;
    addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null;
  };
  model3dUrl: string | null;
  measurementsJsonUrl: string | null;
  pdfUrl: string | null;
  photoUrls: string[];
  /** The job LABEL ("Karmy", "123 Pine remodel") — in practice usually the
   *  client's name; used as a display-name fallback, never for matching. */
  jobName: string | null;
}

export function parseHoverJob(job: any): ParsedHoverJob {
  const urls = new Set<string>();
  collectUrls(job, urls);
  const all = [...urls];

  const measurementsJsonUrl =
    all.find((u) => /measurements\.json/i.test(u)) ?? null;
  const pdfUrl =
    all.find((u) => /measurements?[^\s"']*\.pdf(\?|$)/i.test(u)) ??
    all.find((u) => /\.pdf(\?|$)/i.test(u)) ??
    null;
  const photoUrls = all.filter((u) => /\.(jpe?g|png|heic|webp)(\?|$)/i.test(u)).slice(0, HOVER_PHOTO_CAP);

  const jobId = pick(job, ["id", "job_id"]);
  const model3dUrl =
    findDesignProUrl(job) ??
    all.find((u) => /^https:\/\/hover\.to\/3d\//.test(u)) ??
    // The viewer URL is deterministic (hover.to/3d/<jobId>) — construct it
    // when the payload doesn't carry designProUrl.
    (jobId ? `https://hover.to/3d/${jobId}` : null);

  return {
    contact: {
      // Contact fields only — the job-level "name" is the job LABEL ("123
      // Pine remodel"), not a person, so it never seeds a customer record.
      name: pick(job, ["contact.name", "contact_name", "homeowner.name", "customer.name"]),
      // Some HOVER payloads carry "mailto:" prefixes copied out of email
      // clients — strip them or they become the client's visible name.
      email: pick(job, ["contact.email", "contact_email", "homeowner.email", "customer.email", "email", "deliverable_email"])
        ?.replace(/^mailto:/i, "").trim() || null,
      phone: pick(job, ["contact.phone", "contact_phone", "homeowner.phone", "customer.phone", "phone"]),
      // The job's address is the SERVICE address (where the roof is).
      // v3 shape (probed 2026-08-03): address.location_line_1 / city /
      // region / postal_code. Older aliases kept as fallbacks; plain
      // "address" removed — it's an OBJECT in v3 and stringified to junk.
      addressLine1: pick(job, ["address.location_line_1", "location.address_line_1", "address_line_1", "address.line1"]),
      city: pick(job, ["address.city", "location.city", "city"]),
      state: pick(job, ["address.region", "address.state", "location.state", "state"]),
      postalCode: pick(job, ["address.postal_code", "location.zip", "location.postal_code", "zip", "postal_code", "address.zip"]),
    },
    model3dUrl,
    measurementsJsonUrl,
    pdfUrl,
    photoUrls,
    jobName: pick(job, ["name", "job.name", "job_name"]),
  };
}

// ── Ingest ──────────────────────────────────────────────────────────────────

const digits = (s: string) => s.replace(/\D/g, "");
const milli = (v?: number | null) => (v === null || v === undefined ? null : Math.round(v * 1000));
/** The full_json document rides in raw_payload for audit/re-derivation, trimmed. */
const FULL_JSON_CAP = 250_000;

function trimJson(value: unknown): unknown {
  try {
    const s = JSON.stringify(value);
    if (s.length <= FULL_JSON_CAP) return value;
    return { trimmed: true, bytes: s.length };
  } catch {
    return null;
  }
}

/**
 * Address fallback after email/phone dedupe fails. Candidates are narrowed in
 * SQL by 5-digit zip, then compared with the exact normalized key in JS.
 * Confidence rules: exactly one customer at the address → attach; two or
 * more → ambiguous (the caller creates a NEW customer and flags it, never
 * guesses); zero → no match (the caller creates from the job).
 */
async function matchHoverCustomerByAddress(
  orgId: string, addressLine1?: string | null, postalCode?: string | null,
) {
  const key = normalizeHoverAddress(addressLine1, postalCode);
  if (!key) return { matches: [] as (typeof crmCustomers.$inferSelect)[] };
  const zip5 = key.split("|")[1];
  const candidates = await db
    .select()
    .from(crmCustomers)
    .where(and(
      eq(crmCustomers.orgId, orgId),
      isNull(crmCustomers.archivedAt),
      sql`left(regexp_replace(coalesce(${crmCustomers.postalCode}, ''), '[^0-9]', '', 'g'), 5) = ${zip5}`,
    ));
  return { matches: candidates.filter((c) => normalizeHoverAddress(c.addressLine1, c.postalCode) === key) };
}

/**
 * Dedupe-match a customer the same way POST /api/crm/customers does — email
 * first, then digit-normalized phone — reporting WHICH key matched so the
 * sync report can attribute the attach.
 */
async function matchHoverCustomer(
  orgId: string, email?: string | null, phone?: string | null,
): Promise<{ customer: typeof crmCustomers.$inferSelect; via: "email" | "phone" } | null> {
  if (email) {
    const [hit] = await db
      .select()
      .from(crmCustomers)
      .where(and(
        eq(crmCustomers.orgId, orgId),
        isNull(crmCustomers.archivedAt),
        sql`lower(${crmCustomers.email}) = ${email.toLowerCase()}`,
      ))
      .limit(1);
    if (hit) return { customer: hit, via: "email" };
  }
  if (phone && digits(phone).length >= 7) {
    const [hit] = await db
      .select()
      .from(crmCustomers)
      .where(and(
        eq(crmCustomers.orgId, orgId),
        isNull(crmCustomers.archivedAt),
        sql`regexp_replace(${crmCustomers.phone}, '[^0-9]', '', 'g') = ${digits(phone)}`,
      ))
      .limit(1);
    if (hit) return { customer: hit, via: "phone" };
  }
  return null;
}

/**
 * Last-resort match by the contact's FULL name (first + last, case/accents/punctuation/spacing ignored), after
 * address → email → phone found nothing. Attaches only when EXACTLY ONE non-archived, non-staff customer carries
 * that name; two or more is ambiguous and falls through to the existing create path. A contact whose name is an
 * active org member's never matches (a capture ordered by staff carries the staff member's name).
 */
export async function matchHoverCustomerByName(
  orgId: string, name?: string | null,
): Promise<typeof crmCustomers.$inferSelect | null> {
  const key = normalizePersonName(name);
  if (!key) return null;
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.status, "active")));
  if (members.some((m) => normalizePersonName(m.displayName) === key)) return null;
  const staffEmails = new Set(members.map((m) => (m.email ?? "").trim().toLowerCase()).filter(Boolean));
  const staffPhones = new Set(members.map((m) => digits(String(m.phone ?? ""))).filter((p) => p.length >= 7));
  // Narrow in SQL by the last word (only [a-z0-9] after normalization, so it is safe inside ILIKE), then compare
  // the exact key in JS against both the display name and first + last.
  const lastWord = key.split(" ").pop()!;
  const like = `%${lastWord}%`;
  const candidates = await db.select().from(crmCustomers)
    .where(and(
      eq(crmCustomers.orgId, orgId),
      isNull(crmCustomers.archivedAt),
      // Punctuation stripped on the SQL side too, so "O'Brien" is found by "obrien".
      sql`(regexp_replace(lower(coalesce(${crmCustomers.displayName}, '')), '[^a-z0-9]', '', 'g') like ${like}
        or regexp_replace(lower(coalesce(${crmCustomers.lastName}, '')), '[^a-z0-9]', '', 'g') like ${like})`,
    ))
    .limit(500);
  const hits = candidates.filter((c) =>
    customerNameKeys(c).has(key)
    && !staffEmails.has((c.email ?? "").trim().toLowerCase())
    && !staffPhones.has(digits(String(c.phone ?? ""))));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Pull a completed HOVER job into the CRM. Idempotent on externalId
 * "hover:<jobId>" — a redelivered event (HOVER retries up to 25 times) or a
 * sync-now re-pull updates nothing and reports the existing row.
 *
 * Customer attach order: normalized service address → email → phone (and a
 * contact belonging to org STAFF never attaches). Matching runs BEFORE any
 * customer is created, and never guesses: exactly one customer at the address
 * attaches; two or more creates a NEW customer flagged
 * customFields.hoverAmbiguous; zero creates from the job as before.
 */
/** True when the job's contact is one of the org's own people — a capture
 *  ordered by staff must never attach the property to the staff member. */
async function isOrgMemberContact(
  orgId: string, email?: string | null, phone?: string | null,
): Promise<boolean> {
  const f = await matchOrgMemberContactFields(orgId, email, phone);
  return f.email || f.phone;
}

/**
 * WHICH of the job's contact fields belong to an active org member, tracked
 * independently — a capture ordered by staff often carries the staff member's
 * email but the homeowner's real phone (or vice versa), and only the fields
 * that actually match staff may be scrubbed from the created customer.
 */
async function matchOrgMemberContactFields(
  orgId: string, email?: string | null, phone?: string | null,
): Promise<{ email: boolean; phone: boolean }> {
  const em = (email ?? "").trim().toLowerCase();
  const ph = String(phone ?? "").replace(/\D/g, "");
  const result = { email: false, phone: false };
  if (!em && !ph) return result;
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.status, "active")));
  for (const m of members) {
    if (em && (m.email ?? "").toLowerCase() === em) result.email = true;
    if (ph && ph.length >= 7 && String(m.phone ?? "").replace(/\D/g, "") === ph) result.phone = true;
  }
  return result;
}
/**
 * Pull the job's capture photos ("before" photos) onto the client's profile:
 * kind "photo" / refId customer — exactly where a client's own uploads land,
 * so the contractor's Client 360 AND the client portal show them with zero
 * extra plumbing. Idempotent per HOVER image id; capped per job.
 *
 * Reports { stored, expected, complete }: `complete` is false when any
 * attempted photo could not be fetched/stored, so callers only stamp
 * photosSyncedAt on a complete import — a partial failure must be retried by
 * a later sync instead of being marked synced for 7 days.
 */
export async function importHoverJobPhotos(
  orgId: string, jobId: string, customerId: string, job: any,
  auth: Record<string, string>, fetchFn: FetchFn = fetch,
): Promise<{ stored: number; expected: number; complete: boolean }> {
  const models: any[] = job?.job?.models ?? job?.models ?? [];
  const images: { id: string; url: string }[] = [];
  for (const m of models) {
    for (const img of m?.images ?? []) {
      const url = img?.image?.url ?? img?.url;
      const id = img?.id;
      if (id != null && typeof url === "string") images.push({ id: String(id), url });
    }
  }
  const wanted = images.slice(0, HOVER_PHOTO_CAP);
  if (!wanted.length) return { stored: 0, expected: 0, complete: true };

  const existing = await db.select({ fileName: crmAttachments.fileName }).from(crmAttachments)
    .where(and(
      eq(crmAttachments.orgId, orgId),
      eq(crmAttachments.kind, "photo"),
      eq(crmAttachments.refId, customerId),
    ));
  const have = new Set(existing.map((a) => a.fileName));

  let stored = 0;
  let failed = 0;
  for (const img of wanted) {
    const fileName = `hover-${jobId}-${img.id}.jpg`;
    // Re-checked per image inside the (serialized) ingest so a photo stored
    // by an earlier ingest of the same job is never duplicated.
    if (have.has(fileName)) continue;
    try {
      const r = await fetchFn(img.url, { headers: auth });
      if (!r.ok) { failed++; continue; }
      const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
      if (!/^image\//.test(mime)) { failed++; continue; }
      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length || buffer.length > 15 * 1024 * 1024) { failed++; continue; }
      await storeGeneratedFile({
        orgId, kind: "photo", refId: customerId, fileName, buffer,
        mime, ext: mime === "image/png" ? "png" : "jpg",
      });
      have.add(fileName);
      stored++;
    } catch (e: any) {
      failed++;
      console.error(`[hover] photo ${img.id} for job ${jobId} failed:`, String(e?.message || e).slice(0, 120));
    }
  }
  if (stored) console.log(`[hover] imported ${stored} photos for job ${jobId} -> customer ${customerId}`);
  return { stored, expected: wanted.length, complete: failed === 0 };
}

/**
 * Attach the job to an existing client or CREATE one so the contractor never
 * opens the portal to an empty book. Match: address → contact (staff never
 * matches). Create: from the homeowner's contact when it's a real homeowner;
 * a capture ordered by STAFF gets the job label + address only — the staff
 * member's own name/email must never become the client record. Display name
 * preference: contact name → job label → street address.
 */
async function linkOrCreateHoverCustomer(
  orgId: string,
  jobId: string,
  c: ParsedHoverJob["contact"],
  jobName: string | null,
): Promise<{
  customer: typeof crmCustomers.$inferSelect | null;
  matchedVia: HoverMatchedVia;
  ambiguous: boolean;
  customerCreated: boolean;
}> {
  let customer: typeof crmCustomers.$inferSelect | null = null;
  let matchedVia: HoverMatchedVia = null;
  let ambiguous = false;
  const byAddress = await matchHoverCustomerByAddress(orgId, c.addressLine1, c.postalCode);
  if (byAddress.matches.length === 1) {
    customer = byAddress.matches[0];
    matchedVia = "address";
  } else if (byAddress.matches.length > 1) {
    // Two+ customers at the same address: never guess — a new customer is
    // created below, flagged so a human can merge deliberately.
    ambiguous = true;
  } else {
    const byContact = await matchHoverCustomer(orgId, c.email, c.phone);
    if (byContact && !(await isOrgMemberContact(orgId, c.email, c.phone))) {
      customer = byContact.customer;
      matchedVia = byContact.via;
    } else if (!byContact) {
      const byName = await matchHoverCustomerByName(orgId, c.name);
      if (byName) {
        customer = byName;
        matchedVia = "name";
      }
    }
  }

  let customerCreated = false;
  if (!customer && (c.name || c.email || c.phone || c.addressLine1 || jobName)) {
    // Scrub ONLY the fields that actually match staff contacts: a capture
    // ordered with a staff email but the homeowner's phone keeps the phone.
    // The name goes whenever any field matched — it belongs to the same
    // contact block as the staff identity.
    const staffFields = await matchOrgMemberContactFields(orgId, c.email, c.phone);
    const staffContact = staffFields.email || staffFields.phone;
    const name = staffContact ? null : c.name?.trim() || null;
    const email = staffFields.email ? null : c.email ?? null;
    const phone = staffFields.phone ? null : c.phone ?? null;
    const displayName =
      name || jobName?.trim() || c.addressLine1?.trim() || email || phone || "HOVER import";
    const nameParts = name?.split(/\s+/) ?? [];
    [customer] = await db
      .insert(crmCustomers)
      .values({
        orgId,
        displayName,
        firstName: nameParts.length > 1 ? nameParts[0] : null,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        email,
        phone,
        addressLine1: c.addressLine1 ?? null,
        city: c.city ?? null,
        state: c.state ?? null,
        postalCode: c.postalCode ?? null,
        portalToken: randomBytes(24).toString("hex"),
        notes: `Created from HOVER job ${jobId}.${staffContact ? " Capture was ordered by your own team — add the homeowner's contact info." : ""}`,
        customFields: {
          hoverAutoCreated: true,
          ...(ambiguous ? { hoverAmbiguous: true } : {}),
          ...(!name ? { hoverNeedsContact: true } : {}),
        },
      } as any)
      .returning();
    customerCreated = true;
    queueCrmEvent(orgId, "customer.created", { ...customerEventPayload(customer), source: "hover" });
  }
  return { customer, matchedVia, ambiguous, customerCreated };
}

export type HoverMatchedVia = "email" | "phone" | "address" | "name" | null;

export interface HoverIngestResult {
  measurementId: string; customerId: string | null; created: boolean; duplicate?: boolean;
  matchedVia: HoverMatchedVia; ambiguous: boolean; customerCreated: boolean;
  projectId?: string | null;
}

// ── Per-job ingest serialization ────────────────────────────────────────────
// Ingest is read-then-write throughout (measurement lookup by externalId,
// customer match/create, photo dedupe by fileName) and the
// (provider, external_id) index is NON-unique, so two concurrent deliveries
// of the same job (a HOVER retry racing sync-now, or the manual sync racing
// the webhook) would duplicate customers, measurements and photo attachments.
// This Map<org:job, Promise> chain serializes same-job ingests in-process,
// the same single-instance idiom as hoverSyncRunning. CAVEAT: a multi-instance
// deployment would need a DB unique constraint or advisory lock instead.
const ingestChains = new Map<string, Promise<unknown>>();

export function ingestHoverJob(
  orgId: string, jobId: string, fetchFn: FetchFn = fetch,
): Promise<HoverIngestResult> {
  const key = `${orgId}:${jobId}`;
  const run = (ingestChains.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => ingestHoverJobInner(orgId, jobId, fetchFn));
  ingestChains.set(key, run);
  // Drop the chain link once settled so the map can't grow unbounded.
  void run.then(
    () => { if (ingestChains.get(key) === run) ingestChains.delete(key); },
    () => { if (ingestChains.get(key) === run) ingestChains.delete(key); },
  );
  return run;
}

/** Merge a patch into a measurement's raw_payload, re-reading the CURRENT
 *  value first so concurrent blocks (PDF attach, photo stamp, adoption)
 *  never clobber each other's keys with a stale insert-time snapshot. */
async function mergeMeasurementRaw(measurementId: string, patch: Record<string, unknown>): Promise<void> {
  const [cur] = await db.select({ rawPayload: crmMeasurements.rawPayload }).from(crmMeasurements)
    .where(eq(crmMeasurements.id, measurementId)).limit(1);
  await db.update(crmMeasurements).set({
    rawPayload: { ...((cur?.rawPayload as object) ?? {}), ...patch } as any,
    updatedAt: new Date(),
  }).where(eq(crmMeasurements.id, measurementId));
}

async function ingestHoverJobInner(
  orgId: string, jobId: string, fetchFn: FetchFn = fetch,
): Promise<HoverIngestResult> {
  const externalId = `hover:${jobId}`;
  const [existing] = await db
    .select()
    .from(crmMeasurements)
    .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.externalId, externalId)))
    .limit(1);
  if (existing) {
    // Two catch-up jobs on already-ingested measurements:
    //  - ADOPT: a row that never linked to a client gets one now (match or
    //    create) — the contractor should never open the portal to a hole.
    //  - PHOTOS: top up capture photos; a stamp keeps the 6-hourly sync from
    //    re-fetching every job's detail payload forever.
    let adoptedCustomerId = existing.customerId;
    let adoptedCreated = false;
    const photosSyncedAt = (existing.rawPayload as any)?.photosSyncedAt;
    const fresh = photosSyncedAt && Date.now() - new Date(photosSyncedAt).getTime() < 7 * 24 * 3600_000;
    if (!existing.customerId || !fresh) {
      try {
        const token0 = await getHoverAccessToken(orgId, fetchFn);
        const { apiBase: base0 } = hoverBases();
        const auth0 = { authorization: `Bearer ${token0}` };
        const det0 = await hoverFetchWithBackoff(fetchFn, `${base0}/v3/jobs/${encodeURIComponent(jobId)}`, { headers: auth0 });
        if (det0.status === 429) throw new HoverRateLimitError(hoverRetryAfterMs(det0.headers?.get?.("retry-after")));
        if (det0.ok) {
          const job0 = (await det0.json()) as any;
          if (!adoptedCustomerId) {
            const parsed0 = parseHoverJob(job0);
            const linked0 = await linkOrCreateHoverCustomer(orgId, jobId, parsed0.contact, parsed0.jobName);
            if (linked0.customer) {
              adoptedCustomerId = linked0.customer.id;
              adoptedCreated = linked0.customerCreated;
              await db.update(crmMeasurements).set({
                customerId: adoptedCustomerId,
                rawPayload: {
                  ...((existing.rawPayload as object) ?? {}),
                  adoptedVia: linked0.matchedVia ?? (linked0.customerCreated ? "created" : null),
                  adoptedAt: new Date().toISOString(),
                } as any,
                updatedAt: new Date(),
              }).where(eq(crmMeasurements.id, existing.id));
            }
          }
          if (adoptedCustomerId) {
            const photos = await importHoverJobPhotos(orgId, jobId, adoptedCustomerId, job0, auth0, fetchFn);
            // Stamp only a COMPLETE import — a partial one retries next sync.
            if (photos.complete) {
              await mergeMeasurementRaw(existing.id, { photosSyncedAt: new Date().toISOString() });
            }
          }
        }
      } catch (e: any) {
        // A rate limit goes up to the sync loop (it pauses); anything else only skips this catch-up.
        if (e instanceof HoverRateLimitError) throw e;
        console.error(`[hover] catch-up for job ${jobId} failed:`, String(e?.message || e).slice(0, 120));
      }
    }
    // A row that has a client but no project yet gets one (address match, else the client's single open project).
    let projectId = existing.projectId ?? null;
    if (!projectId && adoptedCustomerId) {
      projectId = await linkMeasurementToProject(orgId, existing.id).catch(() => null);
    }
    return {
      measurementId: existing.id, customerId: adoptedCustomerId, created: false, duplicate: true,
      matchedVia: null, ambiguous: false, customerCreated: adoptedCreated, projectId,
    };
  }

  const token = await getHoverAccessToken(orgId, fetchFn);
  const { apiBase } = hoverBases();
  const auth = { authorization: `Bearer ${token}` };

  const det = await hoverFetchWithBackoff(fetchFn, `${apiBase}/v3/jobs/${encodeURIComponent(jobId)}`, { headers: auth });
  if (det.status === 429) throw new HoverRateLimitError(hoverRetryAfterMs(det.headers?.get?.("retry-after")));
  if (!det.ok) throw new Error(`HOVER job ${jobId} fetch failed: ${det.status}`);
  const job = (await det.json()) as any;
  const parsed = parseHoverJob(job);

  // The rich measurements variant (roof/siding sqft, openings, waste factors).
  let fullJson: any = null;
  if (parsed.measurementsJsonUrl) {
    const sep = parsed.measurementsJsonUrl.includes("?") ? "&" : "?";
    const m = await fetchFn(`${parsed.measurementsJsonUrl}${sep}version=full_json`, { headers: auth }).catch(() => null);
    if (m?.ok) fullJson = await m.json().catch(() => null);
  }
  const summary = summarizeHoverMeasurements(fullJson);

  // Customer attach: the SERVICE ADDRESS is ground truth and runs FIRST —
  // HOVER captures are usually ordered by the contractor's own crew, so the
  // job's contact email/phone is often a STAFF member, and contact-first
  // matching attached homeowners' properties to employees (2026-08-02: 706
  // measurements piled onto 13 records, 3 of them staff). Contact matching
  // is the fallback, and never attaches to an org member's identity.
  const c = parsed.contact;
  const linked = await linkOrCreateHoverCustomer(orgId, jobId, c, parsed.jobName);
  const customer = linked.customer;
  const matchedVia = linked.matchedVia;
  const ambiguous = linked.ambiguous;
  const customerCreated = linked.customerCreated;

  const [row] = await db
    .insert(crmMeasurements)
    .values({
      orgId,
      customerId: customer?.id ?? null,
      provider: "hover",
      status: "ready",
      externalId,
      addressLine1: c.addressLine1 ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      postalCode: c.postalCode ?? null,
      squaresMilli: summary.roofSqft === null ? null : milli(summary.roofSqft / 100),
      roofAreaSfMilli: milli(summary.roofSqft),
      wallAreaSfMilli: milli(summary.sidingSqft),
      predominantPitch: summary.pitch ?? null,
      stories: summary.stories ?? null,
      wasteSuggestionBps: summary.wasteBps ?? null,
      reportUrl: parsed.model3dUrl ?? parsed.pdfUrl ?? null,
      rawPayload: {
        importSource: "hover",
        hoverJobId: jobId,
        model3dUrl: parsed.model3dUrl,
        matchedVia,
        ...(ambiguous ? { hoverAmbiguous: true } : {}),
        summary,
        photoCount: parsed.photoUrls.length,
        fullJson: trimJson(fullJson),
      },
      completedAt: new Date(),
    } as any)
    .returning();

  // The measurement PDF lands in the same gated storage as every other file
  // (kind "measurement", refId = customer id) — downloads go through the
  // session-gated attachment routes, never a public URL.
  if (parsed.pdfUrl) {
    try {
      // Bearer only for HOVER API urls; presigned/CDN links carry their own auth.
      const needsAuth = parsed.pdfUrl.startsWith(apiBase) || /hover\.to\/api\//i.test(parsed.pdfUrl);
      const pdfRes = await fetchFn(parsed.pdfUrl, needsAuth ? { headers: auth } : {});
      if (pdfRes.ok) {
        const buffer = Buffer.from(await pdfRes.arrayBuffer());
        if (buffer.length > 0 && buffer.length <= 25 * 1024 * 1024) {
          const att = await storeGeneratedPdf({
            orgId,
            kind: "measurement",
            refId: customer?.id ?? null,
            fileName: `hover-measurements-${jobId}.pdf`,
            buffer,
          });
          await mergeMeasurementRaw(row.id, { pdfAttachmentId: att.id });
        }
      }
    } catch (e: any) {
      // The PDF is a nice-to-have; the measurement row already stands.
      console.error(`[hover] PDF fetch for job ${jobId} failed:`, String(e?.message || e).slice(0, 200));
    }
  }

  // The project this capture belongs to, and the homeowner share link if one already exists at HOVER.
  let projectId: string | null = null;
  if (customer?.id) projectId = await linkMeasurementToProject(orgId, row.id).catch(() => null);
  try {
    const idx = await cachedHoverShareIndex(orgId, fetchFn);
    const share = pickJobShare(idx.shares, jobId);
    if (share) await setMeasurementShare(row.id, share);
  } catch (e: any) {
    console.error(`[hover] share lookup for job ${jobId} failed:`, String(e?.message || e).slice(0, 120));
  }

  if (customer?.id) {
    try {
      const photos = await importHoverJobPhotos(orgId, jobId, customer.id, job, auth, fetchFn);
      // Merge onto the CURRENT rawPayload (the PDF block may already have
      // written pdfAttachmentId) and stamp only a COMPLETE import, so a job
      // whose photo fetches failed is retried by a later sync instead of
      // being marked synced for 7 days.
      if (photos.complete) {
        await mergeMeasurementRaw(row.id, { photosSyncedAt: new Date().toISOString() });
      }
    } catch (e: any) {
      console.error(`[hover] photos for job ${jobId} failed:`, String(e?.message || e).slice(0, 120));
    }
  }

  return {
    measurementId: row.id, customerId: customer?.id ?? null, created: true, duplicate: false,
    matchedVia, ambiguous, customerCreated, projectId,
  };
}

// ── HOVER share links (homeowner-openable 3D) ───────────────────────────────

/** Every job share HOVER lists for the org's users, and whether the listing was complete. */
export interface HoverShareIndex { shares: any[]; complete: boolean; error: string | null }

const HOVER_USERS_PAGE_CAP = 10;
const HOVER_SHARES_PAGE_CAP = 20;

const listOf = (j: any, ...keys: string[]): any[] => {
  if (Array.isArray(j)) return j;
  for (const k of keys) if (Array.isArray(j?.[k])) return j[k];
  return [];
};

/**
 * List the org's job shares. HOVER scopes the list to ONE user (current_user_id is required —
 * developers.hover.to/reference/list-job-share-links), so we list the org's users (GET /api/v2/users,
 * reference/list-users) and then each user's shares. Read-only: nothing is created at HOVER (creating a share by
 * API is documented for INTERIOR jobs only, so exterior shares come from the HOVER app's Share button).
 */
export async function loadHoverJobShares(orgId: string, fetchFn: FetchFn = fetch): Promise<HoverShareIndex> {
  const userIds: string[] = [];
  let complete = true;
  for (let page = 1; page <= HOVER_USERS_PAGE_CAP; page++) {
    const r = await hoverApi(orgId, "GET", `/v2/users?page=${page}&per_page=100`, undefined, fetchFn);
    if (r.status !== 200) {
      if (page === 1) return { shares: [], complete: false, error: `users list failed (${r.status})` };
      complete = false;
      break;
    }
    const users = listOf(r.json, "results", "users");
    for (const u of users) if (u?.id != null) userIds.push(String(u.id));
    const total = Number(r.json?.pagination?.total_pages);
    const more = Number.isFinite(total) && total > 0 ? page < total : users.length >= 100;
    if (!users.length || !more) break;
    if (page === HOVER_USERS_PAGE_CAP) complete = false;
  }
  const shares: any[] = [];
  let error: string | null = null;
  for (const uid of [...new Set(userIds)]) {
    for (let page = 1; page <= HOVER_SHARES_PAGE_CAP; page++) {
      const r = await hoverApi(orgId, "GET",
        `/v1/job_shares?current_user_id=${encodeURIComponent(uid)}${page > 1 ? `&page=${page}` : ""}`, undefined, fetchFn);
      if (r.status !== 200) {
        complete = false;
        error ??= `job shares list failed (${r.status})`;
        break;
      }
      shares.push(...listOf(r.json, "job_shares", "results"));
      const next = Number(r.json?.meta?.pagination?.next_page ?? r.json?.pagination?.next_page);
      if (!Number.isFinite(next) || next <= page) break;
      if (page === HOVER_SHARES_PAGE_CAP) complete = false;
    }
  }
  return { shares, complete, error };
}

/** The share index, cached per org for a few minutes so a burst of webhook ingests lists HOVER's shares once. */
const shareIndexCache = new Map<string, { at: number; promise: Promise<HoverShareIndex> }>();
const SHARE_INDEX_TTL_MS = 10 * 60 * 1000;

export function cachedHoverShareIndex(orgId: string, fetchFn: FetchFn = fetch, fresh = false): Promise<HoverShareIndex> {
  const hit = shareIndexCache.get(orgId);
  if (!fresh && hit && Date.now() - hit.at < SHARE_INDEX_TTL_MS) return hit.promise;
  const promise = loadHoverJobShares(orgId, fetchFn);
  shareIndexCache.set(orgId, { at: Date.now(), promise });
  promise.catch(() => { if (shareIndexCache.get(orgId)?.promise === promise) shareIndexCache.delete(orgId); });
  return promise;
}

/** Drop the cached share index (tests, and after a manual paste so the next sync re-reads HOVER). */
export function clearHoverShareCache(orgId?: string): void {
  if (orgId) shareIndexCache.delete(orgId);
  else shareIndexCache.clear();
}

/** Write (or with null remove) raw_payload.share atomically — never a stale whole-payload rewrite. */
export async function setMeasurementShare(measurementId: string, share: HoverShare | null): Promise<void> {
  await db.update(crmMeasurements).set({
    rawPayload: share
      ? sql`jsonb_set(coalesce(${crmMeasurements.rawPayload}, '{}'::jsonb), '{share}', ${JSON.stringify(share)}::jsonb)`
      : sql`coalesce(${crmMeasurements.rawPayload}, '{}'::jsonb) - 'share'`,
    updatedAt: new Date(),
  }).where(eq(crmMeasurements.id, measurementId));
}

/**
 * Re-read HOVER's shares and store the best one on every HOVER measurement of the org. A live pasted link is kept;
 * a stored API share HOVER no longer lists is removed only when the listing came back complete.
 * Returns how many measurements now carry a live share.
 */
export async function refreshHoverShares(orgId: string, fetchFn: FetchFn = fetch): Promise<{ live: number; error: string | null }> {
  const idx = await cachedHoverShareIndex(orgId, fetchFn, true);
  if (!idx.complete && !idx.shares.length) return { live: 0, error: idx.error };
  const rows = await db.select({
    id: crmMeasurements.id,
    externalId: crmMeasurements.externalId,
    share: sql<HoverShare | null>`${crmMeasurements.rawPayload} -> 'share'`,
  }).from(crmMeasurements)
    .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.provider, "hover")));
  let live = 0;
  for (const r of rows) {
    const jobId = /^hover:(.+)$/.exec(r.externalId ?? "")?.[1];
    if (!jobId) continue;
    const listed = pickJobShare(idx.shares, jobId);
    const stored = r.share && typeof r.share === "object" ? r.share : null;
    const next = listed || idx.complete ? mergeShare(stored, listed) : stored;
    const same = (next?.url ?? null) === (stored?.url ?? null)
      && (next?.expiresAt ?? null) === (stored?.expiresAt ?? null)
      && (next?.imageUrl ?? null) === (stored?.imageUrl ?? null);
    if (!same) await setMeasurementShare(r.id, next);
    if (shareIsLive(next)) live++;
  }
  return { live, error: idx.error };
}

// ── Sync (manual button + auto-schedule) ────────────────────────────────────

export type HoverSyncRunReport = {
  scanned: number; attachedByEmail: number; attachedByPhone: number; attachedByAddress: number;
  attachedByName: number;
  created: number; ambiguous: number; duplicates: number; errors: string[];
  /** True when the 80-page cap cut the jobs walk short — older jobs were NOT scanned. */
  truncated: boolean;
  /** Measurements carrying a live homeowner share link after this run, and why the share listing fell short. */
  sharesFound?: number;
  sharesError?: string | null;
  /** HOVER measurements newly linked to a project by the back-fill. */
  projectsLinked?: number;
  /** Times HOVER rate-limited the run (each one paused it), and completed jobs left for the next run when the
   *  limit outlasted the pauses. Neither is an error. */
  rateLimitPauses?: number;
  deferred?: number;
};

/** HOVER paginates the jobs list 25/page (per_page is ignored). */
export const HOVER_JOBS_PAGE_SIZE = 25;
/** How many rate-limit pauses one sync run takes before leaving the rest for the next run. */
export const HOVER_SYNC_MAX_RATE_PAUSES = 6;
/** Hard cap on the page walk so a huge job history can't hang a sync. */
export const HOVER_SYNC_MAX_PAGES = 80;

export type HoverJobsWalk = {
  jobs: any[];
  /** True when the walk stopped at HOVER_SYNC_MAX_PAGES with more pages left. */
  truncated: boolean;
  /** HTTP status of a failed page-1 fetch (0 = network); null when page 1 loaded. */
  firstPageError: number | null;
};

/** The page-walk policy, split from transport so tests can drive it with a stub:
 *  - walk every page up to the reported pagination.total_pages;
 *  - when a page omits total_pages, keep going while pages come back FULL
 *    (a short page is always the last);
 *  - never pass HOVER_SYNC_MAX_PAGES, and SAY when the cap truncated the walk. */
export async function walkHoverJobsPages(
  fetchPage: (page: number) => Promise<{ status: number; json: any }>,
): Promise<HoverJobsWalk> {
  const jobs: any[] = [];
  let totalPages: number | null = null; // unknown until a page reports it
  let truncated = false;
  for (let page = 1; page <= HOVER_SYNC_MAX_PAGES; page++) {
    if (totalPages !== null && page > totalPages) break;
    const { status, json } = await fetchPage(page);
    if (status !== 200) {
      if (page === 1) return { jobs, truncated, firstPageError: status };
      break; // keep what we have — a late page failing shouldn't void the run
    }
    const batch: any[] = Array.isArray(json) ? json : (json?.results ?? json?.jobs ?? []);
    jobs.push(...batch);
    const reported = Number(json?.pagination?.total_pages);
    if (Number.isFinite(reported) && reported > 0) totalPages = reported;
    if (!batch.length) break;
    const morePages = totalPages !== null ? page < totalPages : batch.length >= HOVER_JOBS_PAGE_SIZE;
    if (!morePages) break;
    if (page === HOVER_SYNC_MAX_PAGES) truncated = true;
  }
  return { jobs, truncated, firstPageError: null };
}

/** Why page 1 failed, for the settings card: the HTTP status, or the thrown
 *  error (a dead refresh token surfaces here as "HOVER token refresh failed: 401")
 *  rather than a bare "network". */
export function hoverListFailureReason(status: number, thrown: string | null): string {
  if (status) return String(status);
  return thrown || "network";
}

/** Auto-sync is due once a full cadence has passed since the last success AND
 *  the last attempt — a failing connection is retried at the cadence, not on
 *  every 10-minute tick. */
export function hoverSyncDue(
  hover: { syncEveryHours?: unknown; lastSyncAt?: string | null; lastSyncAttemptAt?: string | null },
  now: Date,
): boolean {
  const hours = Number(hover.syncEveryHours) || 6;
  const at = (s: string | null | undefined) => (s ? new Date(s).getTime() || 0 : 0);
  const last = Math.max(at(hover.lastSyncAt), at(hover.lastSyncAttemptAt));
  return now.getTime() - last >= hours * 3600_000;
}

/** One full sync pass: list completed HOVER jobs, ingest each (idempotent —
 *  existing jobs just top up photos). Used by the Sync button AND the
 *  scheduler. */
export async function runHoverSync(orgId: string): Promise<HoverSyncRunReport> {
  let firstThrown: string | null = null;
  const walk = await walkHoverJobsPages((page) =>
    hoverApi(orgId, "GET", `/v2/jobs?page=${page}`).catch((e: any) => {
      firstThrown ??= String(e?.message || e).slice(0, 160);
      return { status: 0, json: { error: String(e?.message || e) } } as any;
    }));
  if (walk.firstPageError !== null) {
    const reason = hoverListFailureReason(walk.firstPageError, firstThrown);
    await writeHoverConn(orgId, { lastError: `jobs list failed (${reason})` }).catch(() => {});
    throw new Error(`Could not list HOVER jobs: ${reason}`);
  }
  const { jobs } = walk;
  const report: HoverSyncRunReport = {
    scanned: jobs.length,
    attachedByEmail: 0, attachedByPhone: 0, attachedByAddress: 0, attachedByName: 0,
    created: 0, ambiguous: 0, duplicates: 0, errors: [],
    truncated: walk.truncated,
  };
  report.rateLimitPauses = 0;
  report.deferred = 0;
  const completed = jobs.filter((j) => (j?.id ?? j?.job_id)
    && String(j?.state ?? j?.status ?? "").toLowerCase().startsWith("complete"));
  let pausesLeft = HOVER_SYNC_MAX_RATE_PAUSES;
  for (let i = 0; i < completed.length; i++) {
    const j = completed[i];
    const id = j?.id ?? j?.job_id;
    try {
      const r = await ingestHoverJob(orgId, String(id));
      if (r.duplicate) report.duplicates++;
      else if (r.ambiguous) report.ambiguous++;
      else if (r.matchedVia === "email") report.attachedByEmail++;
      else if (r.matchedVia === "phone") report.attachedByPhone++;
      else if (r.matchedVia === "address") report.attachedByAddress++;
      else if (r.matchedVia === "name") report.attachedByName++;
      else if (r.customerCreated) report.created++;
    } catch (e: any) {
      if (e instanceof HoverRateLimitError) {
        // HOVER asked us to slow down: pause for what it said, then resume with the SAME job. When the limit
        // outlasts our pauses, stop here — the remaining jobs are picked up by the next run, not failed.
        if (pausesLeft > 0) {
          pausesLeft--;
          report.rateLimitPauses++;
          console.log(`[hover] sync org ${orgId}: rate-limited at job ${id}, pausing ${Math.round(e.retryAfterMs / 1000)}s`);
          await backoffSleep(e.retryAfterMs);
          i--;
          continue;
        }
        report.deferred = completed.length - i;
        console.log(`[hover] sync org ${orgId}: still rate-limited, ${report.deferred} jobs left for the next run`);
        break;
      }
      report.errors.push(`job ${id}: ${String(e?.message || e).slice(0, 120)}`);
      console.error(`[hover] sync ingest job ${id} failed:`, String(e?.message || e).slice(0, 200));
    }
  }
  // Homeowner share links, then the project back-fill (idempotent; rows with no fitting project stay unlinked).
  // Neither may fail the sync: the jobs themselves already landed.
  try {
    const shares = await refreshHoverShares(orgId);
    report.sharesFound = shares.live;
    report.sharesError = shares.error;
  } catch (e: any) {
    report.sharesError = String(e?.message || e).slice(0, 160);
  }
  try {
    report.projectsLinked = (await backfillHoverProjectLinks(orgId)).linked;
  } catch (e: any) {
    console.error(`[hover] project back-fill for org ${orgId} failed:`, String(e?.message || e).slice(0, 160));
  }
  const lastSyncReport: HoverSyncReport = { ...report, at: new Date().toISOString() };
  await writeHoverConn(orgId, {
    lastSyncAt: lastSyncReport.at,
    lastError: report.errors.length ? report.errors[0] : null,
    lastSyncReport,
  }).catch(() => {});
  return report;
}

/** Allowed auto-sync cadences, in hours. 6h is the default. */
export const HOVER_SYNC_HOURS = [1, 2, 4, 6, 12, 24, 168] as const;
const HOVER_TICK_MS = 10 * 60 * 1000;
let hoverSchedulerStarted = false;
const hoverSyncRunning = new Set<string>();

/** The sync failed because HOVER refused the sign-in (directly, or wrapped by the jobs-list error). */
export function hoverReconnectNeeded(e: unknown): boolean {
  return e instanceof HoverReconnectError || /HOVER token refresh failed: 40[01]\b/.test(String((e as any)?.message ?? e));
}

export async function runDueHoverSyncs(now: Date = new Date()): Promise<void> {
  const orgs = await db.select().from(crmOrgs)
    .where(sql`${crmOrgs.customFields} -> 'hover' ->> 'refreshTokenEnc' IS NOT NULL`);
  for (const org of orgs) {
    const hover = ((org.customFields as any) ?? {}).hover ?? {};
    if (hoverConnNeedsReconnect(hover)) continue; // waiting for the customer to reconnect; nothing to retry
    if (!hoverSyncDue(hover, now)) continue;
    if (hoverSyncRunning.has(org.id)) continue;
    hoverSyncRunning.add(org.id);
    try {
      await writeHoverConn(org.id, { lastSyncAttemptAt: now.toISOString() }).catch(() => {});
      const r = await runHoverSync(org.id);
      console.log(`[hover] auto-sync org ${org.id}: scanned ${r.scanned}, dup ${r.duplicates}, errors ${r.errors.length}`);
    } catch (e: any) {
      // Never crash the app over a sync; the card surfaces lastError.
      console.error(`[hover] auto-sync org ${org.id} failed:`, String(e?.message || e).slice(0, 200));
      // An expired sign-in is the customer's to fix (the card says so); everything else goes to the issue desk.
      if (!hoverReconnectNeeded(e)) void recordFailure("job", "HOVER auto-sync", e, { orgId: org.id }, "warning");
    } finally {
      hoverSyncRunning.delete(org.id);
    }
  }
}

export function startHoverScheduler(): void {
  if (hoverSchedulerStarted) return;
  hoverSchedulerStarted = true;
  workerInterval("HOVER sync scheduler", () =>
    runDueHoverSyncs().catch((e) => {
      console.error("[hover] scheduler tick failed:", e?.message || e);
      void recordFailure("job", "HOVER sync scheduler tick", e);
    }), HOVER_TICK_MS);
}

// ── Routes ──────────────────────────────────────────────────────────────────

const webhookPath = (req: any, orgId: string) =>
  `${oauthBaseUrl(req)}/api/crm/integrations/hover/webhook?k=${mintHoverWebhookKey(orgId)}`;
const callbackUrl = (req: any) => `${oauthBaseUrl(req)}/api/crm/integrations/hover/oauth/callback`;

const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0].trim().slice(0, 60);

export function registerCrmHoverRoutes(app: Express, getDevUser: GetUser): void {
  startHoverScheduler();
  async function ctxFor(req: any, res: any, perm?: any) {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  /** Status for the settings card. Never includes the token or hmac secret. */
  app.get("/api/crm/integrations/hover/status", async (req: any, res) => {
    // Webhook address, sync errors and the last sync report belong to the integrations card.
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const conn = await readHoverConn(ctx.org.id);
    res.json({
      configured: hoverConfigured(),
      connected: !!conn,
      connectedAt: conn?.connectedAt ?? null,
      scopes: conn?.scopes ?? null,
      webhook: conn?.webhook
        ? {
            id: conn.webhook.id,
            url: conn.webhook.url,
            verified: conn.webhook.verified === true,
            registeredAt: conn.webhook.registeredAt,
            verifiedAt: conn.webhook.verifiedAt ?? null,
          }
        : null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastError: conn?.lastError ?? null,
      needsReconnect: hoverConnNeedsReconnect(conn),
      lastSyncReport: conn?.lastSyncReport ?? null,
      syncEveryHours: Number(conn?.syncEveryHours) || 6,
    });
  });

  /** 302 to HOVER's authorize page. redirect_uri is always OUR callback. */
  app.get("/api/crm/integrations/hover/connect", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    if (!hoverConfigured()) {
      return res.status(503).json({ message: "HOVER is not configured on this deployment." });
    }
    const { oauthBase } = hoverBases();
    const u = new URL(`${oauthBase}/oauth/authorize`);
    u.searchParams.set("client_id", hoverClientId()!);
    u.searchParams.set("redirect_uri", callbackUrl(req));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", mintHoverState(ctx.org.id));
    res.redirect(302, u.toString());
  });

  /** OAuth callback: exchange, store the (encrypted) refresh token, register. */
  app.get("/api/crm/integrations/hover/oauth/callback", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const fail = (why: string) => res.redirect(302, `/crm/integrations?hover=error&why=${encodeURIComponent(why)}`);

    const stateOrg = verifyHoverState(String(req.query.state || ""));
    if (!stateOrg || stateOrg !== ctx.org.id) return fail("state");
    const code = String(req.query.code || "");
    if (!code) return fail("code");
    if (!hoverConfigured()) return fail("config");

    const { oauthBase } = hoverBases();
    const tokRes = await fetch(`${oauthBase}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: hoverClientId(),
        client_secret: hoverClientSecret(),
        redirect_uri: callbackUrl(req),
      }),
    }).catch(() => null);
    if (!tokRes || !tokRes.ok) return fail("exchange");
    const tok = (await tokRes.json().catch(() => null)) as any;
    if (!tok?.refresh_token || !tok?.access_token) return fail("exchange");

    clearHoverTokenCache(ctx.org.id);
    await writeHoverConn(ctx.org.id, {
      refreshTokenEnc: encryptHoverSecret(String(tok.refresh_token)),
      needsReconnect: false,
      scopes: typeof tok.scope === "string" ? tok.scope : null,
      connectedAt: new Date().toISOString(),
      connectedByMemberId: ctx.member.id,
      webhook: null,
      lastError: null,
    });

    // Register with THIS exchange's access token — no refresh consumed.
    await ensureHoverWebhook(ctx.org.id, webhookPath(req, ctx.org.id), String(tok.access_token)).catch(
      (e: any) => console.error("[hover] webhook registration failed:", String(e?.message || e).slice(0, 200)),
    );

    res.redirect(302, "/crm/integrations?hover=connected");
  });

  /** On-demand (re)registration from the integrations card. */
  app.post("/api/crm/integrations/hover/register-webhook", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const conn = await readHoverConn(ctx.org.id);
    if (!conn) return res.status(409).json({ message: "Connect HOVER first." });
    try {
      const result = await ensureHoverWebhook(ctx.org.id, webhookPath(req, ctx.org.id));
      res.json({ ok: result.state !== "error", ...result });
    } catch (e: any) {
      res.status(502).json({ message: `HOVER webhook registration failed: ${String(e?.message || e).slice(0, 200)}` });
    }
  });

  /**
   * Re-pull the jobs list and ingest anything completed we don't have yet —
   * the backfill path for jobs that predate the webhook. Returns (and
   * persists for the settings card) a per-run report: how each completed job
   * attached (email → phone → address), how many customers were created, how
   * many attaches were ambiguous (new flagged customer, never a guess), and
   * per-job errors. Buckets are disjoint: an ambiguous attach counts under
   * `ambiguous`, not `created`.
   */
  app.post("/api/crm/integrations/hover/sync", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const conn = await readHoverConn(ctx.org.id);
    if (!conn) return res.status(409).json({ message: "Connect HOVER first." });
    // One sync per org at a time — the auto-sync and a second click share HOVER's rotating sign-in.
    if (hoverSyncRunning.has(ctx.org.id)) return res.status(409).json({ message: "A HOVER sync is already running — try again in a minute." });
    hoverSyncRunning.add(ctx.org.id);
    try {
      const report = await runHoverSync(ctx.org.id);
      res.json({ ok: true, ...report });
    } catch {
      res.status(502).json({ message: "Could not list HOVER jobs." });
    } finally {
      hoverSyncRunning.delete(ctx.org.id);
    }
  });

  /** Auto-sync cadence — every 6h by default, 1h to weekly. */
  app.post("/api/crm/integrations/hover/schedule", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const hours = Number(req.body?.hours);
    if (!(HOVER_SYNC_HOURS as readonly number[]).includes(hours)) {
      return res.status(400).json({ message: "Pick a supported cadence." });
    }
    await writeHoverConn(ctx.org.id, { syncEveryHours: hours });
    res.json({ ok: true, syncEveryHours: hours });
  });

  /** Disconnect: delete the HOVER webhook (best effort) and wipe the tokens. */
  app.post("/api/crm/integrations/hover/disconnect", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageIntegrations");
    if (!ctx) return;
    const conn = await readHoverConn(ctx.org.id);
    if (conn?.webhook?.id) {
      try {
        const token = await getHoverAccessToken(ctx.org.id);
        const { apiBase } = hoverBases();
        await fetch(`${apiBase}/v2/webhooks/${conn.webhook.id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        });
      } catch (e: any) {
        // Local disconnect must succeed even when HOVER can't be reached.
        console.error("[hover] webhook delete on disconnect failed:", String(e?.message || e).slice(0, 200));
      }
    }
    clearHoverTokenCache(ctx.org.id);
    await writeHoverConn(ctx.org.id, null);
    res.json({ ok: true });
  });

  /**
   * The event receiver. PUBLIC — no session; the HMAC signature against the
   * per-webhook hmac_secret is the authentication. The webhook id in the
   * signature header selects the org. Unsigned or mis-signed traffic is a 401,
   * and the endpoint is rate-limited per IP.
   */
  app.post("/api/crm/integrations/hover/webhook", async (req: any, res) => {
    if (!rateAllow(`hoverwh:${clientIp(req)}`, 240)) {
      return res.status(429).json({ message: "Too many requests" });
    }
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body ?? {}));
    const sig256 = req.headers["hover-signature-256"] as string | undefined;
    const sig1 = req.headers["hover-signature"] as string | undefined;
    const evt = req.body ?? {};
    // The verification handshake is the one event that is safe to act on
    // unsigned: all it does is hand HOVER back a code with OUR token, and a
    // forged code verifies nothing. HOVER calls signatures best-effort, so the
    // handshake may arrive without one; its body names the webhook id.
    const isHandshake = evt.event === "webhook-verification-code" && Boolean(evt.code);
    const webhookId = hoverWebhookIdFromHeaders(sig256, sig1)
      ?? (isHandshake && /^\d+$/.test(String(evt.webhook_id ?? "")) ? String(evt.webhook_id) : null);
    const refuse = (message: string) => {
      // Header NAMES and shapes only — never values that could carry a signature.
      console.warn(`[hover] webhook ${message}: event=${String(evt.event ?? "").slice(0, 40)} id=${webhookId ?? "-"} ` +
        `sig256=${sig256 ? "yes" : "no"} sig1=${sig1 ? "yes" : "no"} md5=${req.headers["content-md5"] ? "yes" : "no"} ` +
        `date=${req.headers.date ? "yes" : "no"} type=${String(req.headers["content-type"] || "").slice(0, 60)}`);
      return res.status(401).json({ message });
    };
    const keyOrgId = verifyHoverWebhookKey(String(req.query?.k ?? ""));
    if (!webhookId && !keyOrgId) return refuse("Unsigned webhook");

    // HOVER fires the verification-code event immediately on registration —
    // it can race our own persistence of the brand-new webhook row, so retry
    // the lookup briefly before declaring the webhook unknown.
    let org: typeof crmOrgs.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      [org] = await db
        .select()
        .from(crmOrgs)
        .where(keyOrgId
          ? eq(crmOrgs.id, keyOrgId)
          : sql`${crmOrgs.customFields} -> 'hover' -> 'webhook' ->> 'id' = ${webhookId}`)
        .limit(1);
      if (org && (!isHandshake || !webhookId || (org.customFields as any)?.hover?.webhook?.id === webhookId)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const conn = (org?.customFields as any)?.hover as HoverConn | undefined;
    if (!org || !conn?.refreshTokenEnc) return refuse("Unknown webhook");
    const hmacSecret = conn.webhook?.hmacSecretEnc ? decryptHoverSecret(conn.webhook.hmacSecretEnc) : null;

    const signed = Boolean(webhookId && hmacSecret && (sig256 || sig1) && verifyHoverSignature({
      signature256: sig256 ?? null,
      signatureSha1: sig1 ?? null,
      contentType: String(req.headers["content-type"] || ""),
      contentMd5: req.headers["content-md5"] ? String(req.headers["content-md5"]) : null,
      rawBody,
      path: req.path,
      date: String(req.headers.date || ""),
      webhookId: webhookId!,
      hmacSecret: hmacSecret!,
    }));
    // A present-but-wrong signature is refused even with a valid key.
    if ((sig256 || sig1) && !signed && !isHandshake) return refuse("Bad signature");
    if (!signed && !keyOrgId && !isHandshake) return refuse("Bad signature");
    if (!signed && !keyOrgId) {
      console.warn(`[hover] webhook handshake for ${webhookId} arrived unsigned — verifying anyway`);
    }

    // 1) The verification handshake — activate the webhook at HOVER.
    if (isHandshake) {
      try {
        const { apiBase } = hoverBases();
        const token = await getHoverAccessToken(org.id);
        const v = await fetch(`${apiBase}/v2/webhooks/${encodeURIComponent(String(evt.code))}/verify`, {
          method: "PUT",
          headers: { authorization: `Bearer ${token}` },
        });
        if (v.ok) {
          await writeHoverConn(org.id, {
            webhook: { ...conn.webhook!, verified: true, verifiedAt: new Date().toISOString() },
            lastError: null,
          });
        } else {
          await writeHoverConn(org.id, { lastError: `webhook verify failed (${v.status})` }).catch(() => {});
        }
      } catch (e: any) {
        console.error("[hover] verify handshake failed:", String(e?.message || e).slice(0, 200));
      }
      return res.json({ ok: true });
    }

    // 2) A finished job — ingest its measurements. Ack 200 even on failure:
    //    HOVER treats 4xx/5xx as terminal (no retry), and sync-now is the
    //    recovery path for a missed job.
    if (evt.event === "job-state-changed-v2" && evt.state === "completed" && evt.job_id) {
      try {
        await ingestHoverJob(org.id, String(evt.job_id));
      } catch (e: any) {
        console.error(`[hover] ingest job ${evt.job_id} failed:`, String(e?.message || e).slice(0, 200));
        await writeHoverConn(org.id, {
          lastError: `ingest job ${evt.job_id} failed: ${String(e?.message || e).slice(0, 120)}`,
        }).catch(() => {});
      }
      return res.json({ ok: true });
    }

    // 3) Everything else (photo uploads, failures, …): ack and ignore.
    res.json({ ok: true, ignored: evt.event ?? null });
  });

  /**
   * Measurements for one customer — the client-detail page section. Any
   * provider (HOVER rows land here alongside manual/CladAI ones), scoped to
   * the caller's org like every other CRM route.
   */
  app.get("/api/crm/customers/:id/measurements", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [cust] = await db
      .select({ id: crmCustomers.id })
      .from(crmCustomers)
      .where(and(eq(crmCustomers.id, req.params.id), eq(crmCustomers.orgId, ctx.org.id)))
      .limit(1);
    if (!cust) return res.status(404).json({ message: "Customer not found" });

    const rows = await db
      .select()
      .from(crmMeasurements)
      .where(and(eq(crmMeasurements.customerId, cust.id), eq(crmMeasurements.orgId, ctx.org.id)))
      .orderBy(desc(crmMeasurements.createdAt))
      .limit(100);
    res.json({
      measurements: (await objectPolicy(ctx).filter("measurements", rows)).map((r) => {
        const raw = (r.rawPayload ?? {}) as any;
        return {
          id: r.id,
          provider: r.provider,
          status: r.status,
          date: r.completedAt ?? r.createdAt,
          addressLine1: r.addressLine1,
          city: r.city,
          state: r.state,
          postalCode: r.postalCode,
          squares: r.squaresMilli === null ? null : r.squaresMilli / 1000,
          roofAreaSf: r.roofAreaSfMilli === null ? null : r.roofAreaSfMilli / 1000,
          sidingSqft: r.wallAreaSfMilli === null ? null : r.wallAreaSfMilli / 1000,
          windowsCount: raw.summary?.windowsCount ?? null,
          stories: r.stories,
          pitch: r.predominantPitch,
          wastePercent: r.wasteSuggestionBps === null ? null : r.wasteSuggestionBps / 100,
          hoverJobId: raw.hoverJobId ?? null,
          matchedVia: raw.matchedVia ?? raw.adoptedVia ?? null,
          model3dUrl: raw.model3dUrl ?? null,
          projectId: r.projectId ?? null,
          share: presentShare(raw.share),
          pdfUrl: raw.pdfAttachmentId ? `/api/crm/attachments/${raw.pdfAttachmentId}/file` : null,
        };
      }),
    });
  });

  // ── 3D models on projects and estimates (contractor side) ─────────────────
  // /:id params on projects/estimates/measurements are visibility-checked by authorizeObjectRequest.

  /** One HOVER measurement as the Hover3DCard shows it to the contractor. */
  const presentModel = (m: typeof crmMeasurements.$inferSelect) => {
    const raw = (m.rawPayload ?? {}) as any;
    return {
      id: m.id,
      hoverJobId: raw.hoverJobId ?? null,
      date: m.completedAt ?? m.createdAt,
      addressLine1: m.addressLine1, city: m.city, state: m.state, postalCode: m.postalCode,
      customerId: m.customerId, projectId: m.projectId,
      matchedVia: raw.matchedVia ?? raw.adoptedVia ?? null,
      // The contractor's own HOVER viewer (needs their HOVER login) — never shown to a client.
      hoverAppUrl: typeof raw.model3dUrl === "string" && /^https:\/\/hover\.to\/3d\/\d+$/.test(raw.model3dUrl) ? raw.model3dUrl : null,
      share: presentShare(raw.share),
    };
  };

  app.get("/api/crm/projects/:id/hover-models", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [p] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, req.params.id))).limit(1);
    if (!p) return res.status(404).json({ message: "Project not found" });
    const [c] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, p.customerId))).limit(1);
    const rows = await hoverMeasurementsForCustomer(ctx.org.id, p.customerId);
    const visible = await objectPolicy(ctx).filter("measurements", rows);
    const ranked = rankHoverMeasurements(visible, { projectId: p.id, addressKey: projectAddressKey(p, c ?? null) });
    res.json({ models: ranked.map(presentModel) });
  });

  app.get("/api/crm/estimates/:id/hover-models", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    const [c] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, est.customerId))).limit(1);
    let addressKey = normalizeHoverAddress(c?.addressLine1, c?.postalCode);
    if (est.projectId) {
      const [p] = await db.select().from(crmProjects)
        .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, est.projectId))).limit(1);
      if (p) addressKey = projectAddressKey(p, c ?? null);
    }
    const rows = await hoverMeasurementsForCustomer(ctx.org.id, est.customerId);
    const visible = await objectPolicy(ctx).filter("measurements", rows);
    const ranked = rankHoverMeasurements(visible, { projectId: est.projectId ?? null, addressKey });
    res.json({ models: ranked.map(presentModel) });
  });

  /**
   * Paste the homeowner share link for a HOVER measurement. Only https://hover.to/shared/<token> is accepted
   * (parseHoverShareUrl: exact host, no other path or query) — and it is only stored, never fetched.
   */
  app.put("/api/crm/measurements/:id/hover-share", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = parseHoverShareUrl(req.body?.url);
    if (!parsed) {
      return res.status(400).json({ message: "Paste the share link from HOVER — it looks like https://hover.to/shared/…" });
    }
    const [m] = await db.select({ id: crmMeasurements.id }).from(crmMeasurements)
      .where(and(eq(crmMeasurements.orgId, ctx.org.id), eq(crmMeasurements.id, req.params.id), eq(crmMeasurements.provider, "hover")))
      .limit(1);
    if (!m) return res.status(404).json({ message: "HOVER measurement not found" });
    const share: HoverShare = {
      url: parsed.url, token: parsed.token, imageUrl: null, videoUrl: null,
      // HOVER shares expire (45 days by default) but a pasted link carries no date; the next sync fills it in when
      // HOVER lists this share.
      expiresAt: null, source: "manual", jobShareId: null, savedAt: new Date().toISOString(),
    };
    await setMeasurementShare(m.id, share);
    res.json({ ok: true, share: presentShare(share) });
  });

  app.delete("/api/crm/measurements/:id/hover-share", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const [m] = await db.select({ id: crmMeasurements.id }).from(crmMeasurements)
      .where(and(eq(crmMeasurements.orgId, ctx.org.id), eq(crmMeasurements.id, req.params.id), eq(crmMeasurements.provider, "hover")))
      .limit(1);
    if (!m) return res.status(404).json({ message: "HOVER measurement not found" });
    await setMeasurementShare(m.id, null);
    res.json({ ok: true });
  });
}

/** A stored share as the contractor UI sees it (null when none or malformed). */
function presentShare(share: any) {
  const parsed = parseHoverShareUrl(share?.url);
  if (!parsed) return null;
  return {
    url: parsed.url,
    imageUrl: typeof share.imageUrl === "string" ? share.imageUrl : null,
    expiresAt: share.expiresAt ?? null,
    source: share.source === "manual" ? "manual" : "hover-api",
    live: shareIsLive(share),
  };
}
