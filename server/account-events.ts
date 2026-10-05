/**
 * Growth-platform (non-CRM) user notifications and the account activity log.
 *
 *   notifyUser(userId, kind, msg)  — in-app row (+ iPhone push) + optional email, per the user's per-kind preferences
 *   logActivity(req|null, userId, kind, detail) — who / when / from where, for the Activity log
 *
 * Every emitted kind belongs to the shared registry; KIND_DEFAULTS supplies channels until
 * the user configures them. Security kinds default to email ON so an intruder cannot act silently.
 */
import type { Express } from "express";
import { pool } from "./db";
import { sendWithFallback } from "./email";
import { pushSoon } from "./apns";

import { NOTIFICATION_KINDS, type NotificationDefaults, type NotificationKind } from "./notification-kinds";
export const KIND_DEFAULTS: Record<NotificationKind, NotificationDefaults> = NOTIFICATION_KINDS;
/** The bell shows recent activity only; older rows stay out of the feed and the unread count. */
export const NOTIFICATION_DAYS = 30;
const fallback = { label: "Account notification", inApp: true, email: false };

export async function ensureAccountEventsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL, title text NOT NULL, body text, link text, severity text NOT NULL DEFAULT 'info',
      read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS user_notifications_user_idx ON user_notifications(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS user_notification_prefs (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind text NOT NULL,
      in_app boolean NOT NULL, email boolean NOT NULL, PRIMARY KEY(user_id, kind)
    );
    CREATE TABLE IF NOT EXISTS account_activity (
      id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, ip text, user_agent text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS account_activity_user_idx ON account_activity(user_id, created_at DESC);
  `);
}

export async function channelsFor(userId: number, kind: NotificationKind) {
  const d = KIND_DEFAULTS[kind] ?? fallback;
  const { rows: [p] } = await pool.query("SELECT in_app, email FROM user_notification_prefs WHERE user_id=$1 AND kind=$2", [userId, kind]);
  // Security alerts can be muted in-app but always reach email: that is the point of them.
  return { inApp: p ? p.in_app : d.inApp, email: d.security ? true : p ? p.email : d.email };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function notifyUser(userId: number, kind: NotificationKind,
  msg: { title: string; body?: string; link?: string; severity?: "info" | "warning" | "critical"; actionLabel?: string; actionUrl?: string }) {
  const ch = await channelsFor(userId, kind);
  if (ch.inApp) {
    await pool.query("INSERT INTO user_notifications(user_id,kind,title,body,link,severity) VALUES($1,$2,$3,$4,$5,$6)",
      [userId, kind, msg.title, msg.body ?? null, msg.link ?? null, msg.severity ?? "info"]);
    // The bell's twin on the iPhone app (when the user turned notifications on there): same switch, same link.
    pushSoon(userId, "platform", { title: msg.title, body: msg.body, link: msg.link });
  }
  if (ch.email) {
    const { rows: [u] } = await pool.query("SELECT email FROM users WHERE id=$1", [userId]);
    if (u?.email) {
      const base = process.env.APP_URL || "https://constructhub.us";
      const action = msg.actionUrl ? `<p><a href="${esc(base + msg.actionUrl)}" style="display:inline-block;background:#e0782f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(msg.actionLabel || "Review in ConstructHUB")}</a></p>` : "";
      await sendWithFallback({
        to: u.email, subject: `ConstructHUB: ${msg.title}`,
        text: `${msg.title}\n\n${msg.body ?? ""}${msg.actionUrl ? `\n\n${msg.actionLabel || "Review"}: ${base}${msg.actionUrl}` : ""}\n\nManage notifications: ${base}/settings?tab=notifications`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px"><h2 style="font-size:18px">${esc(msg.title)}</h2>${msg.body ? `<p>${esc(msg.body).replace(/\n/g, "<br>")}</p>` : ""}${action}<p style="color:#6b7280;font-size:12px">Manage notifications: <a href="${esc(base)}/settings?tab=notifications">${esc(base)}/settings</a></p></div>`,
      }).catch((e: any) => console.error("[notify] email failed:", e?.message));
    }
  }
}

export async function logActivity(req: any | null, userId: number, kind: string, detail: Record<string, unknown> = {}) {
  const ip = req ? String(req.headers?.["cf-connecting-ip"] || req.ip || "").slice(0, 64) || null : null;
  const ua = req ? String(req.headers?.["user-agent"] || "").slice(0, 300) || null : null;
  await pool.query("INSERT INTO account_activity(user_id,kind,detail,ip,user_agent) VALUES($1,$2,$3,$4,$5)", [userId, kind, JSON.stringify(detail), ip, ua]);
}

export function registerAccountEventRoutes(app: Express, auth: (req: any, res: any) => any) {
  // The top-bar bell (NotificationBell): this account's in-app notifications from the last 30 days
  // (newest first, 100 max) plus the unread count for the badge.
  app.get("/api/notifications", async (req, res) => {
    const u = auth(req, res); if (!u) return;
    const { rows } = await pool.query(`SELECT id,kind,title,body,link,severity,read_at,created_at FROM user_notifications WHERE user_id=$1 AND created_at > now() - interval '${NOTIFICATION_DAYS} days' ORDER BY created_at DESC LIMIT 100`, [u.id]);
    const { rows: [c] } = await pool.query(`SELECT count(*)::int n FROM user_notifications WHERE user_id=$1 AND read_at IS NULL AND created_at > now() - interval '${NOTIFICATION_DAYS} days'`, [u.id]);
    res.json({ unread: c.n, notifications: rows });
  });
  // The bell's "Mark read" / "Mark all read": stamps read_at on the given ids (or every unread row
  // for the account when no ids are sent).
  app.post("/api/notifications/read", async (req, res) => {
    const u = auth(req, res); if (!u) return;
    if (req.body?.ids !== undefined && (!Array.isArray(req.body.ids) || req.body.ids.length > 500 || req.body.ids.some((id: unknown) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0))) return res.status(400).json({ message: 'Invalid notification IDs' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite).slice(0, 500) : null;
    await pool.query(`UPDATE user_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL ${ids ? "AND id=ANY($2)" : ""}`, ids ? [u.id, ids] : [u.id]);
    res.json({ ok: true });
  });
  // Me → Notifications: every notification kind with its channels — the user's
  // user_notification_prefs row when present, otherwise the registry defaults; security kinds
  // always report email on.
  app.get("/api/notification-prefs", async (req, res) => {
    const u = auth(req, res); if (!u) return;
    const prefs = await Promise.all((Object.entries(KIND_DEFAULTS) as [NotificationKind, NotificationDefaults][]).map(async ([kind, d]) => ({ kind, label: d.label, security: !!d.security, ...(await channelsFor(u.id, kind)) })));
    res.json({ prefs });
  });
  // The Notifications toggles: upserts one kind's in_app/email row per entry; unknown kinds and
  // non-boolean values are refused. Security email stays forced-on at send time regardless.
  app.put("/api/notification-prefs", async (req, res) => {
    const u = auth(req, res); if (!u) return;
    if (!Array.isArray(req.body?.prefs) || req.body.prefs.length > Object.keys(KIND_DEFAULTS).length || req.body.prefs.some((p: any) => !p || !Object.hasOwn(KIND_DEFAULTS,p.kind) || typeof p.inApp !== 'boolean' || typeof p.email !== 'boolean')) return res.status(400).json({ message: 'Invalid notification preferences' });
    const list = req.body.prefs as { kind: NotificationKind; inApp: boolean; email: boolean }[];
    for (const p of list) {
      if (!KIND_DEFAULTS[p?.kind]) continue;
      await pool.query(`INSERT INTO user_notification_prefs(user_id,kind,in_app,email) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id,kind) DO UPDATE SET in_app=$3,email=$4`, [u.id, p.kind, !!p.inApp, !!p.email]);
    }
    res.json({ ok: true });
  });
  // Me → Password & security "Account activity" and Workspace → Audit log: the newest 200
  // account_activity rows for this user (nothing older is ever deleted — the limit is display-only).
  app.get("/api/account-activity", async (req, res) => {
    const u = auth(req, res); if (!u) return;
    const { rows } = await pool.query("SELECT id,kind,detail,ip,user_agent,created_at FROM account_activity WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200", [u.id]);
    res.json({ activity: rows });
  });
}
