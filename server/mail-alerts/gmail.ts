import type { Express, NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { pool } from "../db";
import { requireRecentAuth } from "../account-security";
import { encryptToken, decryptToken } from "../gbp/token-crypto";
import { oauthBaseUrl } from "../site-context";
import { rateLimit, takeBudget } from "../growth-limits";
import { getEntitlements, requireModule } from "../entitlements";
import { logActivity } from "../account-events";
import { GMAIL_QUERY, classifyMail, parseMail } from "./classify";
import { storeMatched, purgeExpiredMail, hash } from "./service";
import { z } from "zod";
import { recordFailure } from "../ops/issues";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
declare module "express-session" {
  interface SessionData {
    mailOAuth?: {
      state: string;
      userId: number;
      redirect: string;
      expires: number;
    };
  }
}
/** Removing a saved Gmail connection (list + disconnect) never needs the plan: an account without the module
 * must still be able to delete the Google tokens it saved earlier. Both /api/mail-alerts gates use this. */
export const gmailRemovalRoute = (req: Request) => {
  const path = req.baseUrl + req.path;
  return (
    (req.method === "GET" &&
      path === "/api/mail-alerts/oauth/saved-connections") ||
    (req.method === "POST" && path === "/api/mail-alerts/oauth/disconnect")
  );
};
export const requireMailModule = () => {
  const gate = requireModule("domainsMailAlerts");
  return (req: Request, res: Response, next: NextFunction) =>
    gmailRemovalRoute(req) ? next() : gate(req, res, next);
};
export function registerGmailOAuth(
  app: Express,
  auth: (req: any, res: any) => any,
  http: typeof fetch = fetch,
) {
  // Gated here as well, so the OAuth routes never depend on registration order with registerMailAlertRoutes.
  app.use(
    "/api/mail-alerts/oauth",
    rateLimit("gmail-oauth", 10, 30),
    requireMailModule(),
  );
  // Only what identifies each saved Gmail account (for the plan_required card's Disconnect buttons).
  app.get("/api/mail-alerts/oauth/saved-connections", async (req, res) => {
    const u = auth(req, res);
    if (!u) return;
    const { rows } = await pool.query(
      "SELECT google_subject subject,email FROM mail_alert_grants WHERE user_id=$1 ORDER BY email LIMIT 100",
      [u.id],
    );
    res.json({ items: rows });
  });
  app.get("/api/mail-alerts/oauth/connect", async (req, res) => {
    const u = auth(req, res);
    if (!u) return;
    if (process.env.GMAIL_OAUTH_ENABLED !== "true")
      return void res.status(404).json({ message: "Gmail OAuth is disabled" });
    if (!requireRecentAuth(req, res)) return;
    const state = randomBytes(32).toString("hex"),
      redirect = `${oauthBaseUrl(req)}/api/mail-alerts/oauth/callback`;
    req.session.mailOAuth = {
      state,
      userId: u.id,
      redirect,
      expires: Date.now() + 600000,
    };
    res.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", redirect_uri: redirect, response_type: "code", scope: `openid email ${GMAIL_SCOPE}`, state, access_type: "offline", prompt: "consent select_account" })}`,
    );
  });
  app.get("/api/mail-alerts/oauth/callback", async (req, res) => {
    const u = auth(req, res);
    if (!u) return;
    const pending = req.session.mailOAuth;
    delete req.session.mailOAuth;
    if (
      process.env.GMAIL_OAUTH_ENABLED !== "true" ||
      !pending ||
      pending.userId !== u.id ||
      pending.expires < Date.now() ||
      pending.state !== req.query.state ||
      typeof req.query.code !== "string"
    )
      return void res.redirect("/mail-alerts?oauth=failed");
    try {
      const r = await http("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID || "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          code: req.query.code,
          redirect_uri: pending.redirect,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(15000),
      });
      const t = await r.json();
      if (
        !r.ok ||
        !t.access_token ||
        !String(t.scope || "")
          .split(" ")
          .includes(GMAIL_SCOPE)
      )
        throw new Error();
      const ir = await http(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${t.access_token}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      const who = await ir.json();
      if (!ir.ok || !who.sub || !who.email || !who.email_verified)
        throw new Error();
      await pool.query(
        `INSERT INTO mail_alert_grants(user_id,google_subject,email,access_token,refresh_token,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,google_subject) DO UPDATE SET email=$3,access_token=$4,refresh_token=COALESCE($5,mail_alert_grants.refresh_token),expires_at=$6,needs_reconnect=false,next_sync=now(),page_token=NULL,last_error=NULL`,
        [
          u.id,
          who.sub,
          who.email,
          encryptToken(t.access_token),
          encryptToken(t.refresh_token),
          new Date(Date.now() + Number(t.expires_in || 3600) * 1000),
        ],
      );
      await logActivity(req, u.id, "mail.connected", { email: who.email });
      res.redirect("/mail-alerts?oauth=connected");
    } catch {
      res.redirect("/mail-alerts?oauth=failed");
    }
  });
  app.post("/api/mail-alerts/oauth/disconnect", async (req, res) => {
    const u = auth(req, res);
    if (!u) return;
    if (!requireRecentAuth(req, res)) return;
    const parsed = z
      .object({ subject: z.string().min(1).max(255) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return void res.status(400).json({ message: "Invalid account" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "DELETE FROM mail_alert_grants WHERE user_id=$1 AND google_subject=$2",
        [u.id, parsed.data.subject],
      );
      await c.query(
        "DELETE FROM mail_alert_messages WHERE user_id=$1 AND source='gmail'",
        [u.id],
      );
      await c.query("COMMIT");
      res.json({
        ok: true,
        message:
          "Disconnected locally. Remove ConstructHUB Gmail access in your Google Account permissions.",
      });
    } catch {
      await c.query("ROLLBACK");
      res.status(500).json({ message: "Disconnect failed" });
    } finally {
      c.release();
    }
  });
}
export async function syncGmail(g: any, http: typeof fetch = fetch) {
  let token = decryptToken(g.access_token);
  if (!token || new Date(g.expires_at).getTime() < Date.now() + 60000) {
    if (!g.refresh_token) throw new Error("Reconnect");
    const r = await http("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        refresh_token: decryptToken(g.refresh_token)!,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const t = await r.json();
    if (
      !r.ok ||
      !t.access_token ||
      (t.scope && !String(t.scope).split(" ").includes(GMAIL_SCOPE))
    )
      throw new Error("Reconnect");
    token = t.access_token;
    await pool.query(
      "UPDATE mail_alert_grants SET access_token=$3,expires_at=$4 WHERE user_id=$1 AND google_subject=$2",
      [
        g.user_id,
        g.google_subject,
        encryptToken(token),
        new Date(Date.now() + Number(t.expires_in || 3600) * 1000),
      ],
    );
  }
  const get = async (path: string) => {
    if (!(await takeBudget("gmail-alert-api", 200, 1, 60000)))
      throw new Error("Quota");
    const r = await http(
      `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok)
      throw new Error(r.status === 401 ? "Reconnect" : "Gmail unavailable");
    return r.json();
  };
  const page = await get(
    `messages?${new URLSearchParams({ q: GMAIL_QUERY, maxResults: "20", ...(g.page_token ? { pageToken: g.page_token } : {}) })}`,
  );
  for (const m of page.messages || []) {
    if (!/^[a-zA-Z0-9_-]+$/.test(m.id)) continue;
    const existing = await pool.query(
      "SELECT 1 FROM mail_alert_messages WHERE user_id=$1 AND dedupe=$2",
      [g.user_id, hash(`gmail:${g.google_subject}:${m.id}`)],
    );
    if (existing.rowCount) continue;
    const meta = await get(
        `messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      ),
      headers = meta.payload?.headers || [];
    const from =
        headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "",
      subject =
        headers.find((h: any) => h.name.toLowerCase() === "subject")?.value ||
        "";
    if (!classifyMail({ from, subject, to: "", text: "" })) continue;
    const full = await get(`messages/${m.id}?format=full`);
    const parts = (p: any, mime: string): string =>
      p.mimeType === mime && p.body?.data
        ? Buffer.from(p.body.data, "base64url").toString("utf8")
        : (p.parts || []).map((part: any) => parts(part, mime)).join("\n");
    const parsed = await parseMail({
      from,
      subject,
      to: "",
      text: parts(full.payload || {}, "text/plain").slice(0, 64000),
      html: parts(full.payload || {}, "text/html").slice(0, 64000),
    });
    await storeMatched(
      g.user_id,
      {
        from,
        subject,
        to: "",
        text: parsed.text,
        messageId: `${g.google_subject}:${m.id}`,
      },
      "gmail",
      new Date(Number(full.internalDate)),
    );
  }
  await pool.query(
    "UPDATE mail_alert_grants SET page_token=$3,next_sync=now()+$4::interval,last_error=NULL WHERE user_id=$1 AND google_subject=$2",
    [
      g.user_id,
      g.google_subject,
      page.nextPageToken || null,
      page.nextPageToken ? "1 minute" : "15 minutes",
    ],
  );
}
/** `onlyUser` narrows the Gmail sync to one owner (tests on a shared database); expired mail is always purged. */
export async function runMailWorker(
  http: typeof fetch = fetch,
  onlyUser?: number,
) {
  await purgeExpiredMail();
  if (process.env.GMAIL_OAUTH_ENABLED !== "true") return;
  const c = await pool.connect();
  let locked = false;
  try {
    const {
      rows: [r],
    } = await c.query("SELECT pg_try_advisory_lock(8189,8) locked");
    locked = r.locked;
    if (!locked) return;
    // One Gmail sync per tick, for an owner whose plan still includes the module; others wait an hour.
    const { rows: due } = await c.query(
      "SELECT * FROM mail_alert_grants WHERE NOT needs_reconnect AND next_sync<=now() AND ($1::int IS NULL OR user_id=$1) ORDER BY next_sync LIMIT 10",
      [onlyUser ?? null],
    );
    let g: any;
    for (const row of due) {
      if ((await getEntitlements(row.user_id)).modules.domainsMailAlerts) {
        g = row;
        break;
      }
      await c.query(
        "UPDATE mail_alert_grants SET next_sync=now()+interval '1 hour' WHERE user_id=$1 AND google_subject=$2",
        [row.user_id, row.google_subject],
      );
    }
    if (!g) return;
    try {
      await syncGmail(g, http);
    } catch (e) {
      await c.query(
        "UPDATE mail_alert_grants SET needs_reconnect=$3,last_error=$4,next_sync=now()+interval '15 minutes' WHERE user_id=$1 AND google_subject=$2",
        [
          g.user_id,
          g.google_subject,
          e instanceof Error && e.message === "Reconnect",
          "Gmail sync failed. Check grant, quota and provider status.",
        ],
      );
    }
  } finally {
    if (locked) await c.query("SELECT pg_advisory_unlock(8189,8)");
    c.release();
  }
}
export function startMailWorker() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runMailWorker();
    } catch (e) {
      console.error("[mail-alerts] Cleanup/sync cycle failed");
      void recordFailure("job", "Mail Alerts cleanup/sync cycle", e);
    } finally {
      busy = false;
    }
  }, 60000);
  timer.unref();
}
