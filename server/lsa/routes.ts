/**
 * LSA HTTP API — every route is scoped to req.user.id for full tenant isolation.
 * The only unauthenticated route is the Telegram webhook, which is authorized by
 * a secret-token header instead of a session.
 */
import type { Express } from "express";
import { randomUUID, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "../db";
import { lsaConnections, lsaAccounts, lsaLeads, LSA_DISPUTE_REASONS } from "@shared/schema";
import { and, eq, desc, count, ilike, or, sql } from "drizzle-orm";
import {
  isConfigured,
  buildAuthUrl,
  exchangeCode,
  getRedirectUri,
  clearAccessToken,
} from "./client";
import { getConnectionByUserId } from "./store";
import { syncConnection, discoverAccounts, runRotatingSync } from "./sync";
import {
  enqueueDisputes,
  scheduleDisputes,
  unscheduleDisputes,
  provideLeadFeedback,
  promoteDueScheduledDisputes,
  resumeDisputeQueue,
} from "./disputes";
import {
  telegramConfigured,
  getBotUsername,
  ensureWebhook,
  webhookSecretToken,
  handleWebhookUpdate,
} from "./telegram";

type GetUser = (req: any, res: any) => any;

const reasonSchema = z.enum(LSA_DISPUTE_REASONS as unknown as [string, ...string[]]);

/** Get-or-create the caller's single connection row. */
async function ensureConnection(userId: number) {
  let conn = await getConnectionByUserId(userId);
  if (!conn) {
    const [row] = await db.insert(lsaConnections).values({ userId }).returning();
    conn = row;
  }
  return conn;
}

// Per-user manual-sync lock so a double-click can't run two full syncs at once.
const syncingUsers = new Set<number>();

export function registerLsaRoutes(app: Express, getDevUser: GetUser): void {
  // ── Status ────────────────────────────────────────────────────────────────
  app.get("/api/lsa/status", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const conn = await getConnectionByUserId(user.id);
    const botUsername = await getBotUsername();
    res.json({
      configured: isConfigured(),
      connected: Boolean(conn?.refreshToken),
      telegramConfigured: telegramConfigured(),
      botUsername,
      redirectUri: getRedirectUri(),
      connection: conn
        ? {
            connectedEmail: conn.connectedEmail,
            telegramLinked: Boolean(conn.telegramChatId),
            telegramUsername: conn.telegramUsername,
            telegramLinkToken: conn.telegramLinkToken,
            lastSyncAt: conn.lastSyncAt,
            lastSyncError: conn.lastSyncError,
            lastSyncCount: conn.lastSyncCount,
            lastCostTotal: conn.lastCostTotal,
            lastDiscoveryAt: conn.lastDiscoveryAt,
          }
        : null,
    });
  });

  // ── OAuth ─────────────────────────────────────────────────────────────────
  app.get("/api/lsa/oauth/start", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    if (!isConfigured()) {
      return res.status(400).json({ message: "Google Ads isn't configured yet (missing app credentials)." });
    }
    const nonce = randomBytes(16).toString("hex");
    (req.session as any).lsaOauthState = nonce;
    const redirectUri = getRedirectUri();
    res.redirect(buildAuthUrl(redirectUri, nonce));
  });

  app.get("/api/lsa/oauth/callback", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const { code, state } = req.query as { code?: string; state?: string };
    const expected = (req.session as any).lsaOauthState;
    delete (req.session as any).lsaOauthState;
    if (!code || !state || !expected || state !== expected) {
      return res.redirect("/lsa-leads?connect=error");
    }
    try {
      const redirectUri = getRedirectUri();
      const tokens = await exchangeCode(code, redirectUri);
      if (!tokens.refresh_token) {
        return res.redirect("/lsa-leads?connect=norefresh");
      }
      const conn = await ensureConnection(user.id);
      clearAccessToken(conn.refreshToken);
      await db
        .update(lsaConnections)
        .set({ refreshToken: tokens.refresh_token, lastSyncError: null, updatedAt: new Date() })
        .where(eq(lsaConnections.id, conn.id));

      // Kick off discovery + first sync in the background (don't block redirect).
      void (async () => {
        try {
          const fresh = await getConnectionByUserId(user.id);
          if (fresh?.refreshToken) await syncConnection(fresh, { discover: true });
        } catch (e) {
          console.error("LSA post-connect sync failed:", e);
        }
      })();

      res.redirect("/lsa-leads?connect=ok");
    } catch (e: any) {
      console.error("LSA OAuth callback error:", e?.message || e);
      res.redirect("/lsa-leads?connect=error");
    }
  });

  app.post("/api/lsa/disconnect", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const conn = await getConnectionByUserId(user.id);
    if (conn) {
      clearAccessToken(conn.refreshToken);
      await db
        .update(lsaConnections)
        .set({ refreshToken: null, connectedEmail: null, updatedAt: new Date() })
        .where(eq(lsaConnections.id, conn.id));
    }
    res.json({ ok: true });
  });

  // ── Manual sync ─────────────────────────────────────────────────────────────
  app.post("/api/lsa/sync", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const conn = await getConnectionByUserId(user.id);
    if (!conn?.refreshToken) return res.status(400).json({ message: "Connect Google Ads first." });
    if (syncingUsers.has(user.id)) return res.status(409).json({ message: "A sync is already running." });
    syncingUsers.add(user.id);
    try {
      const result = await syncConnection(conn, { discover: true });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Sync failed." });
    } finally {
      syncingUsers.delete(user.id);
    }
  });

  app.post("/api/lsa/discover", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const conn = await getConnectionByUserId(user.id);
    if (!conn?.refreshToken) return res.status(400).json({ message: "Connect Google Ads first." });
    try {
      const result = await discoverAccounts(conn);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Discovery failed." });
    }
  });

  // ── Accounts ────────────────────────────────────────────────────────────────
  app.get("/api/lsa/accounts", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, parseInt(String(req.query.page || "1")) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || "25")) || 25));

    const where = q
      ? and(
          eq(lsaAccounts.userId, user.id),
          or(ilike(lsaAccounts.descriptiveName, `%${q}%`), ilike(lsaAccounts.customerId, `%${q}%`)),
        )
      : eq(lsaAccounts.userId, user.id);

    const [{ c: total }] = await db.select({ c: count() }).from(lsaAccounts).where(where);
    const accounts = await db
      .select()
      .from(lsaAccounts)
      .where(where)
      .orderBy(
        sql`(CASE WHEN ${lsaAccounts.lsaEnrolled} IS TRUE THEN 0 WHEN ${lsaAccounts.lsaEnrolled} IS NULL THEN 1 ELSE 2 END)`,
        desc(lsaAccounts.leadCount),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    res.json({ accounts, total, page, pageSize });
  });

  app.patch("/api/lsa/accounts/:id", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "enabled (boolean) required." });
    const updated = await db
      .update(lsaAccounts)
      .set({ enabled: parsed.data.enabled, updatedAt: new Date() })
      .where(and(eq(lsaAccounts.id, req.params.id), eq(lsaAccounts.userId, user.id)))
      .returning();
    if (updated.length === 0) return res.status(404).json({ message: "Account not found." });
    res.json(updated[0]);
  });

  // ── Leads ─────────────────────────────────────────────────────────────────
  app.get("/api/lsa/leads", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const customerId = String(req.query.customerId || "").replace(/\D/g, "");
    const page = Math.max(1, parseInt(String(req.query.page || "1")) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || "50")) || 50));
    const filter = String(req.query.filter || "all");

    const conds = [eq(lsaLeads.userId, user.id)];
    if (customerId) conds.push(eq(lsaLeads.customerId, customerId));
    if (filter === "charged") conds.push(eq(lsaLeads.leadCharged, true));
    if (filter === "disputed") conds.push(eq(lsaLeads.disputeStatus, "disputed"));
    const where = and(...conds);

    const [{ c: total }] = await db.select({ c: count() }).from(lsaLeads).where(where);
    const leads = await db
      .select()
      .from(lsaLeads)
      .where(where)
      .orderBy(desc(lsaLeads.leadCreationTime))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    res.json({ leads, total, page, pageSize });
  });

  // Mark a lead as a GOOD lead (clears any local dispute state).
  app.post("/api/lsa/leads/:leadId/good", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    try {
      await provideLeadFeedback(user.id, req.params.leadId, "SATISFIED");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ message: e?.message || "Couldn't submit feedback." });
    }
  });

  // ── Disputes (manual) ───────────────────────────────────────────────────────
  const disputeItems = z.object({
    items: z.array(z.object({ leadId: z.string().min(1), reason: reasonSchema })).min(1),
  });

  app.post("/api/lsa/disputes", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const parsed = disputeItems.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Pick at least one lead and a valid reason." });
    try {
      const result = await enqueueDisputes(user.id, parsed.data.items);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e?.message || "Couldn't queue disputes." });
    }
  });

  app.post("/api/lsa/disputes/schedule", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const schema = z.object({
      items: z.array(z.object({ leadId: z.string().min(1), reason: reasonSchema, runAt: z.number().int().positive() })).min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Pick leads, reasons, and a valid time." });
    try {
      const result = await scheduleDisputes(user.id, parsed.data.items);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e?.message || "Couldn't schedule disputes." });
    }
  });

  app.post("/api/lsa/disputes/unschedule", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const parsed = z.object({ leadIds: z.array(z.string().min(1)).min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "No leads selected." });
    try {
      const result = await unscheduleDisputes(user.id, parsed.data.leadIds);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e?.message || "Couldn't cancel scheduled disputes." });
    }
  });

  // ── Telegram linking ─────────────────────────────────────────────────────────
  app.post("/api/lsa/telegram/link", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const username = String(req.body?.username || "").replace(/^@/, "").trim();
    const conn = await ensureConnection(user.id);
    const token = randomUUID().replace(/-/g, "");
    await db
      .update(lsaConnections)
      .set({ telegramUsername: username || null, telegramLinkToken: token, updatedAt: new Date() })
      .where(eq(lsaConnections.id, conn.id));
    const botUsername = await getBotUsername();
    res.json({
      ok: true,
      token,
      botUsername,
      deepLink: botUsername ? `https://t.me/${botUsername}?start=${token}` : null,
    });
  });

  app.post("/api/lsa/telegram/unlink", async (req, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const conn = await getConnectionByUserId(user.id);
    if (conn) {
      await db
        .update(lsaConnections)
        .set({ telegramChatId: null, telegramLinkToken: null, telegramUsername: null, updatedAt: new Date() })
        .where(eq(lsaConnections.id, conn.id));
    }
    res.json({ ok: true });
  });

  // ── Telegram webhook (public, authorized by secret header) ───────────────────
  app.post("/api/lsa/telegram/webhook", async (req, res) => {
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (!telegramConfigured() || secret !== webhookSecretToken()) {
      return res.status(401).end();
    }
    // Acknowledge immediately; process async so Telegram never retries on slowness.
    res.status(200).json({ ok: true });
    void handleWebhookUpdate(req.body);
  });
}

// ── Boot timers ───────────────────────────────────────────────────────────────
let timersStarted = false;
export function startLsaTimers(): void {
  if (timersStarted) return;
  timersStarted = true;

  // Re-queue anything left mid-flight by a restart.
  void resumeDisputeQueue();

  // Promote due scheduled disputes every minute.
  setInterval(() => void promoteDueScheduledDisputes(), 60_000).unref();

  // Rotating incremental sync every minute (no-op until accounts exist).
  setInterval(() => void runRotatingSync(), 60_000).unref();

  // Register the Telegram webhook in production only.
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT) {
    void ensureWebhook("https://constructhub.us");
  }
}
