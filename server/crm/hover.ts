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
import { crmCustomers, crmMeasurements, crmOrgs , crmMembers } from "@shared/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { allow as rateAllow } from "./client-auth";
import { storeGeneratedPdf } from "./attachments";
import { oauthBaseUrl } from "../site-context";

type GetUser = (req: any, res: any) => any;

// ── Endpoint configuration ──────────────────────────────────────────────────

function hoverBases(): { oauthBase: string; apiBase: string } {
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
  Boolean(process.env.HOVER_CLIENT_ID && process.env.HOVER_CLIENT_SECRET);

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
  created: number;
  ambiguous: number;
  duplicates: number;
  errors: string[];
  at: string;
}

export interface HoverConn {
  refreshTokenEnc: string;
  scopes?: string | null;
  connectedAt: string;
  connectedByMemberId?: string | null;
  webhook?: HoverWebhookState | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  lastSyncReport?: HoverSyncReport | null;
}

async function readHoverConn(orgId: string): Promise<HoverConn | null> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  const conn = (org?.customFields as any)?.hover;
  return conn && typeof conn.refreshTokenEnc === "string" ? (conn as HoverConn) : null;
}

/** Merge a patch into custom_fields->'hover' (null deletes the whole block). */
async function writeHoverConn(orgId: string, patch: Partial<HoverConn> | null): Promise<void> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  if (!org) return;
  const base = { ...((org.customFields as Record<string, unknown> | null) ?? {}) };
  if (patch === null) delete base.hover;
  else base.hover = { ...((base.hover as object | undefined) ?? {}), ...patch };
  await db.update(crmOrgs).set({ customFields: base, updatedAt: new Date() }).where(eq(crmOrgs.id, orgId));
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

// ── Access tokens (2h, in-memory cache; refresh tokens rotate) ──────────────

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Drop the cached access token for an org (tests + disconnect). */
export function clearHoverTokenCache(orgId?: string): void {
  if (orgId) tokenCache.delete(orgId);
  else tokenCache.clear();
}

type FetchFn = typeof fetch;

/**
 * A valid access token for the org. Refreshes when the cache is stale and
 * ALWAYS persists a rotated refresh token before returning — HOVER invalidates
 * the previous refresh token on each use.
 */
export async function getHoverAccessToken(orgId: string, fetchFn: FetchFn = fetch): Promise<string> {
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
      client_id: process.env.HOVER_CLIENT_ID,
      client_secret: process.env.HOVER_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    // A dead refresh token means the connection is broken; say so on the card.
    await writeHoverConn(orgId, { lastError: `token refresh failed (${res.status})` }).catch(() => {});
    throw new Error(`HOVER token refresh failed: ${res.status}`);
  }
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  if (tok.refresh_token && tok.refresh_token !== refresh) {
    await writeHoverConn(orgId, { refreshTokenEnc: encryptHoverSecret(tok.refresh_token), lastError: null });
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
 */
export function verifyHoverSignature(args: {
  signature256: string | null;
  signatureSha1: string | null;
  contentType: string;
  rawBody: Buffer;
  path: string;
  date: string;
  webhookId: string;
  hmacSecret: string;
}): boolean {
  const canonical = hoverCanonicalString(args.contentType, args.rawBody, args.path, args.date);
  if (args.signature256) {
    const expected = `sha256=${args.webhookId}:${createHmac("sha256", args.hmacSecret).update(canonical).digest("base64")}`;
    if (eqSafe(args.signature256, expected)) return true;
  }
  if (args.signatureSha1) {
    const expected = `sha1=${args.webhookId}:${createHmac("sha1", args.hmacSecret).update(canonical).digest("base64")}`;
    if (eqSafe(args.signatureSha1, expected)) return true;
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

async function hoverApi(
  orgId: string, method: string, apiPath: string, body?: unknown, fetchFn: FetchFn = fetch,
): Promise<{ status: number; json: any }> {
  const token = await getHoverAccessToken(orgId, fetchFn);
  const { apiBase } = hoverBases();
  const res = await fetchFn(`${apiBase}${apiPath}`, {
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
  for (const w of list.filter((w) => w && w.url === url)) {
    const wId = String(w.id);
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
  const photoUrls = all.filter((u) => /\.(jpe?g|png|heic|webp)(\?|$)/i.test(u)).slice(0, 50);

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
      email: pick(job, ["contact.email", "contact_email", "homeowner.email", "customer.email", "email", "deliverable_email"]),
      phone: pick(job, ["contact.phone", "contact_phone", "homeowner.phone", "customer.phone", "phone"]),
      // The job's address is the SERVICE address (where the roof is).
      addressLine1: pick(job, ["location.address_line_1", "location.address", "address_line_1", "address.line1", "address"]),
      city: pick(job, ["location.city", "city", "address.city"]),
      state: pick(job, ["location.state", "state", "address.state"]),
      postalCode: pick(job, ["location.zip", "location.postal_code", "zip", "postal_code", "address.zip"]),
    },
    model3dUrl,
    measurementsJsonUrl,
    pdfUrl,
    photoUrls,
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
 * Canonical service-address key: lowercase line1 with punctuation and extra
 * whitespace stripped, plus the 5-digit zip. The SAME normalization runs on
 * the job's address and on each candidate customer's address, so formatting
 * differences ("123 PINE st." / "123 Pine St", "98101-1234" / "98101") never
 * decide a match. Null when either side is too thin to trust.
 */
export function normalizeHoverAddress(line1?: string | null, zip?: string | null): string | null {
  const line = String(line1 ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const zip5 = String(zip ?? "").replace(/\D/g, "").slice(0, 5);
  if (!line || zip5.length !== 5) return null;
  return `${line}|${zip5}`;
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
  const em = (email ?? "").trim().toLowerCase();
  const ph = String(phone ?? "").replace(/\D/g, "");
  if (!em && !ph) return false;
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.status, "active")));
  return members.some((m) =>
    (em && (m.email ?? "").toLowerCase() === em) ||
    (ph && ph.length >= 7 && String(m.phone ?? "").replace(/\D/g, "") === ph));
}
export async function ingestHoverJob(
  orgId: string, jobId: string, fetchFn: FetchFn = fetch,
): Promise<{
  measurementId: string; customerId: string | null; created: boolean; duplicate?: boolean;
  matchedVia: "email" | "phone" | "address" | null; ambiguous: boolean; customerCreated: boolean;
}> {
  const externalId = `hover:${jobId}`;
  const [existing] = await db
    .select()
    .from(crmMeasurements)
    .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.externalId, externalId)))
    .limit(1);
  if (existing) {
    return {
      measurementId: existing.id, customerId: existing.customerId, created: false, duplicate: true,
      matchedVia: null, ambiguous: false, customerCreated: false,
    };
  }

  const token = await getHoverAccessToken(orgId, fetchFn);
  const { apiBase } = hoverBases();
  const auth = { authorization: `Bearer ${token}` };

  const det = await fetchFn(`${apiBase}/v3/jobs/${encodeURIComponent(jobId)}`, { headers: auth });
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
  let customer: typeof crmCustomers.$inferSelect | null = null;
  let matchedVia: "email" | "phone" | "address" | null = null;
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
    }
  }
  let customerCreated = false;
  if (!customer && (c.name || c.email || c.phone)) {
    const nameParts = c.name?.trim().split(/\s+/) ?? [];
    [customer] = await db
      .insert(crmCustomers)
      .values({
        orgId,
        displayName: c.name?.trim() || c.email || c.phone || "HOVER import",
        firstName: nameParts.length > 1 ? nameParts[0] : null,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        addressLine1: c.addressLine1 ?? null,
        city: c.city ?? null,
        state: c.state ?? null,
        postalCode: c.postalCode ?? null,
        portalToken: randomBytes(24).toString("hex"),
        notes: `Created from HOVER job ${jobId}.`,
        ...(ambiguous ? { customFields: { hoverAmbiguous: true } } : {}),
      } as any)
      .returning();
    customerCreated = true;
  }

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
          await db
            .update(crmMeasurements)
            .set({
              rawPayload: { ...(row.rawPayload as object), pdfAttachmentId: att.id } as any,
              updatedAt: new Date(),
            })
            .where(eq(crmMeasurements.id, row.id));
        }
      }
    } catch (e: any) {
      // The PDF is a nice-to-have; the measurement row already stands.
      console.error(`[hover] PDF fetch for job ${jobId} failed:`, String(e?.message || e).slice(0, 200));
    }
  }

  return {
    measurementId: row.id, customerId: customer?.id ?? null, created: true, duplicate: false,
    matchedVia, ambiguous, customerCreated,
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

const webhookPath = (req: any) => `${oauthBaseUrl(req)}/api/crm/integrations/hover/webhook`;
const callbackUrl = (req: any) => `${oauthBaseUrl(req)}/api/crm/integrations/hover/oauth/callback`;

const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0].trim().slice(0, 60);

export function registerCrmHoverRoutes(app: Express, getDevUser: GetUser): void {
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
    const ctx = await ctxFor(req, res);
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
      lastSyncReport: conn?.lastSyncReport ?? null,
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
    u.searchParams.set("client_id", process.env.HOVER_CLIENT_ID!);
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
        client_id: process.env.HOVER_CLIENT_ID,
        client_secret: process.env.HOVER_CLIENT_SECRET,
        redirect_uri: callbackUrl(req),
      }),
    }).catch(() => null);
    if (!tokRes || !tokRes.ok) return fail("exchange");
    const tok = (await tokRes.json().catch(() => null)) as any;
    if (!tok?.refresh_token || !tok?.access_token) return fail("exchange");

    clearHoverTokenCache(ctx.org.id);
    await writeHoverConn(ctx.org.id, {
      refreshTokenEnc: encryptHoverSecret(String(tok.refresh_token)),
      scopes: typeof tok.scope === "string" ? tok.scope : null,
      connectedAt: new Date().toISOString(),
      connectedByMemberId: ctx.member.id,
      webhook: null,
      lastError: null,
    });

    // Register with THIS exchange's access token — no refresh consumed.
    await ensureHoverWebhook(ctx.org.id, webhookPath(req), String(tok.access_token)).catch(
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
      const result = await ensureHoverWebhook(ctx.org.id, webhookPath(req));
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

    const { status, json } = await hoverApi(ctx.org.id, "GET", "/v2/jobs").catch((e: any) => {
      return { status: 0, json: { error: String(e?.message || e) } };
    });
    if (status !== 200) {
      await writeHoverConn(ctx.org.id, { lastError: `jobs list failed (${status || "network"})` }).catch(() => {});
      return res.status(502).json({ message: "Could not list HOVER jobs." });
    }
    const jobs: any[] = Array.isArray(json) ? json : (json?.results ?? json?.jobs ?? []);
    const report = {
      scanned: jobs.length,
      attachedByEmail: 0,
      attachedByPhone: 0,
      attachedByAddress: 0,
      created: 0,
      ambiguous: 0,
      duplicates: 0,
      errors: [] as string[],
    };
    for (const j of jobs) {
      const state = String(j?.state ?? j?.status ?? "").toLowerCase();
      const id = j?.id ?? j?.job_id;
      if (!id || !state.startsWith("complete")) continue;
      try {
        const r = await ingestHoverJob(ctx.org.id, String(id));
        if (r.duplicate) report.duplicates++;
        else if (r.ambiguous) report.ambiguous++;
        else if (r.matchedVia === "email") report.attachedByEmail++;
        else if (r.matchedVia === "phone") report.attachedByPhone++;
        else if (r.matchedVia === "address") report.attachedByAddress++;
        else if (r.customerCreated) report.created++;
      } catch (e: any) {
        report.errors.push(`job ${id}: ${String(e?.message || e).slice(0, 120)}`);
        console.error(`[hover] sync ingest job ${id} failed:`, String(e?.message || e).slice(0, 200));
      }
    }
    const lastSyncReport: HoverSyncReport = { ...report, at: new Date().toISOString() };
    await writeHoverConn(ctx.org.id, {
      lastSyncAt: lastSyncReport.at,
      lastError: report.errors.length ? report.errors[0] : null,
      lastSyncReport,
    }).catch(() => {});
    res.json({ ok: true, ...report });
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
    const webhookId = hoverWebhookIdFromHeaders(sig256, sig1);
    if (!webhookId) return res.status(401).json({ message: "Unsigned webhook" });

    // HOVER fires the verification-code event immediately on registration —
    // it can race our own persistence of the brand-new webhook row, so retry
    // the lookup briefly before declaring the webhook unknown.
    let org: typeof crmOrgs.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      [org] = await db
        .select()
        .from(crmOrgs)
        .where(sql`${crmOrgs.customFields} -> 'hover' -> 'webhook' ->> 'id' = ${webhookId}`)
        .limit(1);
      if (org) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const conn = (org?.customFields as any)?.hover as HoverConn | undefined;
    const hmacSecret = conn?.webhook?.hmacSecretEnc ? decryptHoverSecret(conn.webhook.hmacSecretEnc) : null;
    if (!org || !conn || !hmacSecret) return res.status(401).json({ message: "Unknown webhook" });

    const ok = verifyHoverSignature({
      signature256: sig256 ?? null,
      signatureSha1: sig1 ?? null,
      contentType: String(req.headers["content-type"] || ""),
      rawBody,
      path: req.path,
      date: String(req.headers.date || ""),
      webhookId,
      hmacSecret,
    });
    if (!ok) return res.status(401).json({ message: "Bad signature" });

    const evt = req.body ?? {};

    // 1) The verification handshake — activate the webhook at HOVER.
    if (evt.event === "webhook-verification-code" && evt.code) {
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
      measurements: rows.map((r) => {
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
          matchedVia: raw.matchedVia ?? null,
          model3dUrl: raw.model3dUrl ?? null,
          pdfUrl: raw.pdfAttachmentId ? `/api/crm/attachments/${raw.pdfAttachmentId}/file` : null,
        };
      }),
    });
  });
}
