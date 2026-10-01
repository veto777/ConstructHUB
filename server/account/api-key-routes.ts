/**
 * Session endpoints for the account's public-API keys and their usage
 * (Account settings → API keys / API usage).
 *
 *   GET    /api/account/api-keys           keys (never a secret) + the plan's API allowance
 *   POST   /api/account/api-keys           mint a key; needs recent step-up auth (403 {reauth:true})
 *   PATCH  /api/account/api-keys/:id       rename / change the per-key monthly unit limit
 *   DELETE /api/account/api-keys/:id       revoke (the row stays, so usage history keeps its key)
 *   GET    /api/account/api-usage?days=30  units + requests per day, by key
 *
 * The keys authenticate only the public API router (server/public-api); this
 * file never verifies a bearer. Creating and revoking a key is a security
 * event: Activity log + notification + email (security kinds cannot be muted).
 * The secret is returned exactly once, written past res.json so the request
 * logger's JSON capture never sees it.
 *
 * Lane 1 owns the tables (account_api_keys, account_api_usage) and the
 * createApiKey / verifyApiKey helpers (server/account/api-keys.ts): the secret
 * format and its hash live there, so createApiKey is injected here.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { requireRecentAuth } from "../account-security";
import { logActivity, notifyUser } from "../account-events";
import { NOTIFICATION_KINDS, type NotificationKind } from "../notification-kinds";
import { sendWithFallback } from "../email";
import { rateLimit } from "../growth-limits";
import { getEntitlements, sendLimitReached, sendPlanRequired, type Entitlements } from "../entitlements";
import { PLANS, PLAN_KEYS, type PlanKey, type PlanLimits } from "@shared/plans";
import type { ApiKeyNotificationKind } from "./api-key-notification-kinds";

export type ApiKeyScope = "read" | "write";
export const API_KEY_SCOPES: readonly ApiKeyScope[] = ["read", "write"];
/** Active (unrevoked) keys one account may hold. */
export const MAX_API_KEYS = 25;
export const MAX_KEY_NAME = 80;
export const MAX_EXPIRES_DAYS = 3650;
/** The widest usage window the usage endpoint serves. */
export const MAX_USAGE_DAYS = 365;
export const DEFAULT_USAGE_DAYS = 30;
/** The most a per-key monthly limit can be set to (the plan's allowance still caps it). */
export const MAX_KEY_UNIT_LIMIT = 1_000_000_000;
/** Where the settings UI shows API keys (the link in notifications). */
export const API_KEYS_PATH = "/settings?tab=api-keys";

/** The contract's API allowance per plan, used until shared/plans.ts publishes apiUnitsPerMonth. */
const CONTRACT_API_UNITS: Record<PlanKey, number> = { starter: 0, pro: 10_000, growth: 50_000, agency: 250_000 };
const CONTRACT_API_RATE_PER_MINUTE = 60;
type ApiLimits = PlanLimits & { apiUnitsPerMonth?: number; apiRatePerMinute?: number };

/** A plan's monthly API units: the published limit when shared/plans.ts has it, else the contract table. 0 = API disabled, -1 = unlimited. */
export function apiUnitsForPlan(plan: PlanKey, limits: PlanLimits | null = PLANS[plan].limits): number {
  const published = (limits as ApiLimits | null)?.apiUnitsPerMonth;
  return typeof published === "number" && Number.isFinite(published) ? published : CONTRACT_API_UNITS[plan];
}

export type ApiPlanAllowance = { apiEnabled: boolean; unitsPerMonth: number; ratePerMinute: number };
/** What the account's plan (plus add-ons, or the admin's top plan) allows the API. */
export function apiAllowance(ent: Pick<Entitlements, "accessPlan" | "allowances">): ApiPlanAllowance {
  if (!ent.accessPlan || !ent.allowances) return { apiEnabled: false, unitsPerMonth: 0, ratePerMinute: 0 };
  const unitsPerMonth = apiUnitsForPlan(ent.accessPlan, ent.allowances);
  const rate = (ent.allowances as ApiLimits).apiRatePerMinute;
  return {
    apiEnabled: unitsPerMonth !== 0,
    unitsPerMonth,
    ratePerMinute: typeof rate === "number" && Number.isFinite(rate) ? rate : CONTRACT_API_RATE_PER_MINUTE,
  };
}
/** The cheapest plan with API access (for the 402). */
export function cheapestApiPlan(): PlanKey {
  return PLAN_KEYS.find((k) => apiUnitsForPlan(k) !== 0) ?? PLAN_KEYS[PLAN_KEYS.length - 1];
}

/** account_api_keys as stored (the contract's columns). */
export type ApiKeyRow = {
  id: string; user_id: number; name: string; prefix: string; suffix: string; scopes: string[];
  monthly_unit_limit: number | null; expires_at: Date | string | null; last_used_at: Date | string | null;
  revoked_at: Date | string | null; created_at: Date | string;
};
export type CreateApiKeyInput = { name: string; scopes: ApiKeyScope[]; monthlyUnitLimit: number | null; expiresInDays: number | null };
/** Lane 1's helper (server/account/api-keys.ts): mints the secret, stores its hash, returns both. */
export type ApiKeyDeps = {
  createApiKey(userId: number, input: CreateApiKeyInput): Promise<{ secret: string; row: ApiKeyRow }>;
};

const iso = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).toISOString());
/** The list/PATCH item: everything but the hash. */
export function keyItem(row: ApiKeyRow, unitsThisMonth = 0) {
  return {
    id: row.id, name: row.name, prefix: row.prefix, suffix: row.suffix, scopes: row.scopes,
    monthlyUnitLimit: row.monthly_unit_limit, unitsThisMonth,
    createdAt: iso(row.created_at), lastUsedAt: iso(row.last_used_at), expiresAt: iso(row.expires_at),
  };
}
/** The bearer the user pastes: lane 1 may return the full "chub_<prefix>_<secret>" or just the secret part. */
export function bearerFor(secret: string, prefix: string): string {
  return secret.startsWith("chub_") ? secret : `chub_${prefix}_${secret}`;
}

// ── input parsing (false = invalid) ─────────────────────────────────────────
export function parseKeyName(v: unknown): string | false {
  if (typeof v !== "string") return false;
  const name = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= MAX_KEY_NAME ? name : false;
}
export function parseScopes(v: unknown): ApiKeyScope[] | false {
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) return false;
  if (!v.every((s) => (API_KEY_SCOPES as readonly unknown[]).includes(s))) return false;
  return API_KEY_SCOPES.filter((s) => v.includes(s));
}
/** null clears the limit; a positive integer sets it. */
export function parseUnitLimit(v: unknown): number | null | false {
  if (v === undefined || v === null || v === "") return null;
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_KEY_UNIT_LIMIT ? (v as number) : false;
}
export function parseExpiresInDays(v: unknown): number | null | false {
  if (v === undefined || v === null || v === "") return null;
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_EXPIRES_DAYS ? (v as number) : false;
}
export function parseUsageDays(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_USAGE_DAYS;
  return Math.min(n, MAX_USAGE_DAYS);
}
const KEY_ID = /^key_[A-Za-z0-9_-]{1,120}$/;
const keyIdParam = (v: unknown): string | null => (typeof v === "string" && KEY_ID.test(v) ? v : null);

// ── usage ───────────────────────────────────────────────────────────────────
/** Units metered this calendar month (UTC, the pool's clock), per key and in total; revoked keys still count. */
export async function unitsThisMonth(userId: number): Promise<{ total: number; byKey: Map<string, number> }> {
  const { rows } = await pool.query<{ key_id: string; units: number }>(
    "SELECT key_id, COALESCE(SUM(units),0)::int units FROM account_api_usage WHERE user_id=$1 AND day >= date_trunc('month', CURRENT_DATE)::date GROUP BY key_id",
    [userId]);
  const byKey = new Map(rows.map((r) => [r.key_id, r.units]));
  return { total: rows.reduce((n, r) => n + r.units, 0), byKey };
}

export type UsageDay = { date: string; units: number; requests: number; byKey: Record<string, number> };
/** One entry per calendar day in the window (zero-filled), oldest first, plus totals. */
export async function usageSeries(userId: number, days: number): Promise<{ days: UsageDay[]; totals: { units: number; requests: number } }> {
  const { rows } = await pool.query<{ date: string; units: number; requests: number; by_key: Record<string, number> }>(
    `SELECT to_char(d.day,'YYYY-MM-DD') AS date, COALESCE(SUM(u.units),0)::int AS units, COALESCE(SUM(u.requests),0)::int AS requests,
            COALESCE(jsonb_object_agg(u.key_id, u.units) FILTER (WHERE u.key_id IS NOT NULL), '{}'::jsonb) AS by_key
       FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS d(day)
       LEFT JOIN account_api_usage u ON u.user_id=$1 AND u.day=d.day::date
      GROUP BY d.day ORDER BY d.day`, [userId, days]);
  const series = rows.map((r) => ({ date: r.date, units: r.units, requests: r.requests, byKey: r.by_key ?? {} }));
  return {
    days: series,
    totals: { units: series.reduce((n, d) => n + d.units, 0), requests: series.reduce((n, d) => n + d.requests, 0) },
  };
}

// ── security events ─────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const requestIp = (req: Request) => String(req.headers["cf-connecting-ip"] || req.ip || "").slice(0, 64) || "an unknown address";

/**
 * Activity log + notification + email. Security kinds cannot be muted once
 * API_KEY_NOTIFICATION_KINDS is in the registry; until that spread lands,
 * notifyUser would fall back to in-app only, so the email is sent here.
 */
async function securityEvent(req: Request, userId: number, kind: ApiKeyNotificationKind, title: string, body: string, detail: Record<string, unknown>) {
  await logActivity(req, userId, kind, detail);
  await notifyUser(userId, kind as NotificationKind, { title, body, link: API_KEYS_PATH, severity: "warning", actionUrl: API_KEYS_PATH, actionLabel: "Review API keys" });
  if (Object.hasOwn(NOTIFICATION_KINDS, kind)) return;
  const { rows: [u] } = await pool.query("SELECT email FROM users WHERE id=$1", [userId]);
  if (!u?.email) return;
  const base = process.env.APP_URL || "https://constructhub.us";
  await sendWithFallback({
    to: u.email, subject: `ConstructHUB: ${title}`,
    text: `${title}\n\n${body}\n\nReview API keys: ${base}${API_KEYS_PATH}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px"><h2 style="font-size:18px">${esc(title)}</h2><p>${esc(body)}</p><p><a href="${esc(base + API_KEYS_PATH)}" style="display:inline-block;background:#e0782f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Review API keys</a></p></div>`,
  }).catch((e: any) => console.error("[api-keys] security email failed:", e?.message));
}

/** API keys are the account's own credentials: an agency member acting for the owner cannot mint or revoke them. */
function ownAccount(req: Request, res: Response, u: { id: number }): boolean {
  if (req.user && req.user.id === u.id) return true;
  res.status(403).json({ message: "Only the account owner can manage API keys." });
  return false;
}

/** The one response that carries a secret: written past res.json so the request logger's JSON capture never sees it. */
function sendSecret(res: Response, status: number, body: unknown) {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  res.type("application/json");
  res.send(JSON.stringify(body));
}

export function registerApiKeyRoutes(app: Express, auth: (req: any, res: any) => any, deps: ApiKeyDeps) {
  const guard = rateLimit("account-api-keys", 30, 60, 10 * 60_000);
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

  app.get("/api/account/api-keys", wrap(async (req, res) => {
    const u = auth(req, res); if (!u) return;
    const [ent, { rows }, usage] = await Promise.all([
      getEntitlements(u.id),
      pool.query<ApiKeyRow>("SELECT * FROM account_api_keys WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC, id", [u.id]),
      unitsThisMonth(u.id),
    ]);
    const plan = apiAllowance(ent);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      keys: rows.map((r) => keyItem(r, usage.byKey.get(r.id) ?? 0)),
      plan: { apiEnabled: plan.apiEnabled, unitsPerMonth: plan.unitsPerMonth, usedThisMonth: usage.total, ratePerMinute: plan.ratePerMinute },
    });
  }));

  app.post("/api/account/api-keys", guard, wrap(async (req, res) => {
    const u = auth(req, res); if (!u) return;
    if (!ownAccount(req, res, u)) return;
    if (!requireRecentAuth(req, res)) return;
    const body = req.body ?? {};
    const name = parseKeyName(body.name);
    if (name === false) return void res.status(400).json({ message: `Give the key a name (1 to ${MAX_KEY_NAME} characters).` });
    const scopes = parseScopes(body.scopes);
    if (scopes === false) return void res.status(400).json({ message: 'Choose at least one scope: "read" or "write".' });
    const monthlyUnitLimit = parseUnitLimit(body.monthlyUnitLimit);
    if (monthlyUnitLimit === false) return void res.status(400).json({ message: "The monthly unit limit must be a whole number of 1 or more, or empty for no key limit." });
    const expiresInDays = parseExpiresInDays(body.expiresInDays);
    if (expiresInDays === false) return void res.status(400).json({ message: `Expiry must be 1 to ${MAX_EXPIRES_DAYS} days, or empty for a key that does not expire.` });

    const plan = apiAllowance(await getEntitlements(u.id));
    if (!plan.apiEnabled) {
      return void sendPlanRequired(res, cheapestApiPlan(), "API access", {
        message: `API keys are included with the ${PLANS[cheapestApiPlan()].name} plan and above. Upgrade in Pricing to create one.`,
      });
    }
    const { rows: [{ n: used }] } = await pool.query<{ n: number }>("SELECT count(*)::int n FROM account_api_keys WHERE user_id=$1 AND revoked_at IS NULL", [u.id]);
    if (used >= MAX_API_KEYS) {
      return void sendLimitReached(res, { limit: MAX_API_KEYS, used, feature: "api_keys", message: `An account can hold up to ${MAX_API_KEYS} active API keys. Revoke one you no longer use.` });
    }
    const { secret, row } = await deps.createApiKey(u.id, { name, scopes, monthlyUnitLimit, expiresInDays });
    const key = bearerFor(secret, row.prefix);
    await securityEvent(req, u.id, "security.api_key_created", `API key "${name}" was created`,
      `A new API key (${row.prefix}…${row.suffix}, ${scopes.join(" + ")}) was created from ${requestIp(req)}${row.expires_at ? `; it expires ${new Date(row.expires_at).toUTCString()}` : ""}. If this was not you, revoke it now and change your password.`,
      { keyId: row.id, name, prefix: row.prefix, suffix: row.suffix, scopes, monthlyUnitLimit, expiresAt: iso(row.expires_at) });
    sendSecret(res, 201, { key, item: keyItem(row) });
  }));

  app.patch("/api/account/api-keys/:id", guard, wrap(async (req, res) => {
    const u = auth(req, res); if (!u) return;
    if (!ownAccount(req, res, u)) return;
    const id = keyIdParam(req.params.id);
    if (!id) return void res.status(404).json({ message: "API key not found" });
    const body = req.body ?? {};
    const sets: string[] = [], values: unknown[] = [];
    if (body.name !== undefined) {
      const name = parseKeyName(body.name);
      if (name === false) return void res.status(400).json({ message: `Give the key a name (1 to ${MAX_KEY_NAME} characters).` });
      values.push(name); sets.push(`name=$${values.length}`);
    }
    if (body.monthlyUnitLimit !== undefined) {
      const limit = parseUnitLimit(body.monthlyUnitLimit);
      if (limit === false) return void res.status(400).json({ message: "The monthly unit limit must be a whole number of 1 or more, or null for no key limit." });
      values.push(limit); sets.push(`monthly_unit_limit=$${values.length}`);
    }
    if (!sets.length) return void res.status(400).json({ message: "Nothing to change: send name and/or monthlyUnitLimit." });
    values.push(id, u.id);
    const { rows: [row] } = await pool.query<ApiKeyRow>(
      `UPDATE account_api_keys SET ${sets.join(",")} WHERE id=$${values.length - 1} AND user_id=$${values.length} AND revoked_at IS NULL RETURNING *`, values);
    if (!row) return void res.status(404).json({ message: "API key not found" });
    await logActivity(req, u.id, "security.api_key_updated", { keyId: row.id, name: row.name, monthlyUnitLimit: row.monthly_unit_limit });
    const usage = await unitsThisMonth(u.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ item: keyItem(row, usage.byKey.get(row.id) ?? 0) });
  }));

  app.delete("/api/account/api-keys/:id", guard, wrap(async (req, res) => {
    const u = auth(req, res); if (!u) return;
    if (!ownAccount(req, res, u)) return;
    const id = keyIdParam(req.params.id);
    if (!id) return void res.status(404).json({ message: "API key not found" });
    const { rows: [row] } = await pool.query<ApiKeyRow>(
      "UPDATE account_api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING *", [id, u.id]);
    if (!row) return void res.status(404).json({ message: "API key not found" });
    await securityEvent(req, u.id, "security.api_key_revoked", `API key "${row.name}" was revoked`,
      `The API key ${row.prefix}…${row.suffix} was revoked from ${requestIp(req)} and no longer works. Anything using it will get 401 until it is replaced.`,
      { keyId: row.id, name: row.name, prefix: row.prefix, suffix: row.suffix });
    res.json({ ok: true });
  }));

  app.get("/api/account/api-usage", wrap(async (req, res) => {
    const u = auth(req, res); if (!u) return;
    const days = parseUsageDays(req.query.days);
    res.setHeader("Cache-Control", "no-store");
    res.json(await usageSeries(u.id, days));
  }));
}
