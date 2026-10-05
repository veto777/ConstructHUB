import type { Express } from "express";
import { z } from "zod";
import { pool } from "./db";
import { rateLimit } from "./growth-limits";

const token = z.string().min(1).max(200).regex(/^[a-fA-F0-9]+$/).transform(s => s.toLowerCase());
const registration = z.object({ token, app: z.enum(["platform", "crm"]), platform: z.literal("ios") }).strict();
const removal = z.object({ token }).strict();

export async function ensureAppPushSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_push_tokens (
    token text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app text NOT NULL CHECK (app IN ('platform','crm')), platform text NOT NULL CHECK (platform='ios'),
    session_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  ); CREATE INDEX IF NOT EXISTS app_push_tokens_owner ON app_push_tokens(user_id,app);`);
}

/** APNs delivery seam. A logged-out, revoked or expired session cannot receive pushes.
 * The native shell registers again after navigation/login, refreshing token ownership.
 * No APNs network calls are made here. */
export async function pushTokensFor(userId: number, app: "platform" | "crm"): Promise<string[]> {
  const { rows } = await pool.query(`SELECT t.token FROM app_push_tokens t JOIN session s ON s.sid=t.session_id
    WHERE t.user_id=$1 AND t.app=$2 AND s.expire>now() AND s.sess->'passport'->>'user'=$1::text`, [userId,app]);
  return rows.map(r => r.token);
}

export function registerAppPushRoutes(app: Express) {
  app.use("/api/app/push-token", rateLimit("app-push", 60, 120));
  app.post("/api/app/push-token", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    const input = registration.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: "Invalid push token registration" });
    const { token, app, platform } = input.data;
    await pool.query(`INSERT INTO app_push_tokens(token,user_id,app,platform,session_id) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(token) DO UPDATE SET user_id=$2,app=$3,platform=$4,session_id=$5,updated_at=now()`,
      [token,req.user.id,app,platform,req.sessionID]);
    res.sendStatus(204);
  });
  app.delete("/api/app/push-token", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    const input = removal.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: "Invalid push token" });
    await pool.query("DELETE FROM app_push_tokens WHERE token=$1 AND user_id=$2", [input.data.token,req.user.id]);
    res.sendStatus(204);
  });
}
