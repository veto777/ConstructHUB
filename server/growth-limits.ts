import type { Request, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { pool } from "./db";
import { z } from "zod";

export const chatInput = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) })).min(1).max(10),
  captchaToken: z.string().max(4096).optional(),
});
export const ipKey = (req: Request) => createHash("sha256").update(req.ip || req.socket.remoteAddress || "unknown").digest("hex");
export const actorKey = (req: Request) => req.user ? `user:${req.user.id}` : `ip:${ipKey(req)}`;

// Atomic reservations persist across restarts and are shared by worker processes.
export async function takeBudget(key: string, limit: number, amount = 1, windowMs = 600_000): Promise<boolean> {
  if (limit === -1) return true;
  if (!Number.isInteger(amount) || amount < 1 || amount > limit) return false;
  const period = Math.floor(Date.now() / windowMs);
  const result = await pool.query(`INSERT INTO growth_budgets(key,period,used) VALUES($1,$2,$3)
    ON CONFLICT(key,period) DO UPDATE SET used=growth_budgets.used+EXCLUDED.used
    WHERE growth_budgets.used+EXCLUDED.used <= $4 RETURNING used`, [key, String(period), amount, limit]);
  return result.rowCount === 1;
}
/** Read-only: how much of a budget the current window has used (0 when untouched). */
export async function budgetUsed(key: string, windowMs = 600_000): Promise<number> {
  const period = Math.floor(Date.now() / windowMs);
  const result = await pool.query(`SELECT used FROM growth_budgets WHERE key=$1 AND period=$2`, [key, String(period)]);
  return Number(result.rows[0]?.used ?? 0);
}
export function rateLimit(name: string, perUser = 20, perIp = 50, windowMs = 600_000): RequestHandler {
  return async (req, res, next) => {
    try {
      const ipAllowed = await takeBudget(`${name}:ip:${ipKey(req)}`, perIp, 1, windowMs);
      const userAllowed = !req.user || await takeBudget(`${name}:user:${req.user.id}`, perUser, 1, windowMs);
      if (!ipAllowed || !userAllowed) {
        res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
        return void res.status(429).json({ message: "Request limit reached. Please try again later." });
      }
      next();
    } catch (error) { next(error); }
  };
}

export async function siteChatGate(req: Request): Promise<"ok" | "captcha" | "unconfigured" | "invalid"> {
  const ipFree = await takeBudget(`site-free:ip:${ipKey(req)}`, 3, 1, 86400_000);
  const sessionFree = await takeBudget(`site-free:session:${req.sessionID}`, 3, 1, 86400_000);
  if (ipFree && sessionFree) return "ok";
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret || secret.startsWith("6LeIxAcT")) return process.env.NODE_ENV === "production" ? "unconfigured" : "ok";
  if (!req.body.captchaToken) return "captcha";
  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST", body: new URLSearchParams({ secret, response: req.body.captchaToken }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return response.ok && data.success === true ? "ok" : "invalid";
  } catch { return "invalid"; }
}
