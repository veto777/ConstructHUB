/**
 * TikTok webhooks (docs/social-apps/tiktok.md §2.3), for accounts connected through ConstructHUB Direct.
 *
 *   POST /api/social/native/tiktok/webhook   (the Callback URL in the TikTok developer portal)
 *
 * Every request carries `TikTok-Signature: t=<unix seconds>,s=<hex>` where s = HMAC-SHA256(client secret,
 * `${t}.${raw body}`) (https://developers.tiktok.com/doc/webhooks-verification). The signature IS the authentication:
 * this route takes no session. Anything unsigned, signed with another secret, or older than 5 minutes is refused.
 *
 *   authorization.removed       the person removed ConstructHUB in TikTok: their TikTok accounts and tokens are deleted
 *   post.publish.*              a post moved on at TikTok: the worker reads its status now instead of in a minute
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { pool } from "../db";
import { removeTikTokOpenId } from "./native";

export const TIKTOK_WEBHOOK_TOLERANCE_SEC = 300;

/** Is this request really from TikTok, and recent? Pure (tested). */
export function tiktokSignatureValid(raw: Buffer | string | undefined, header: string | undefined, secret: string | undefined,
  nowMs = Date.now(), toleranceSec = TIKTOK_WEBHOOK_TOLERANCE_SEC): boolean {
  if (!raw || !header || !secret || secret.length < 16) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => { const i = p.indexOf("="); return i < 0 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  const t = parts.t, s = parts.s;
  if (!t || !/^\d{1,12}$/.test(t) || !s || !/^[a-f0-9]{64}$/i.test(s)) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSec) return false;
  const want = createHmac("sha256", secret).update(`${t}.`).update(raw).digest();
  const got = Buffer.from(s, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** What one verified event does. Exported for tests. */
export async function handleTikTokEvent(body: any): Promise<{ event: string; deleted?: number; nudged?: number }> {
  const event = String(body?.event ?? "");
  if (event === "authorization.removed") {
    const openId = String(body?.user_openid ?? "");
    const deleted = await removeTikTokOpenId(openId);
    console.log(`[social] tiktok authorization.removed: ${deleted} connected account(s) deleted`);
    return { event, deleted };
  }
  if (event.startsWith("post.publish.")) {
    let content: any = body?.content;
    if (typeof content === "string") { try { content = JSON.parse(content); } catch { content = null; } }
    const publishId = content?.publish_id;
    let nudged = 0;
    if (typeof publishId === "string" && /^[\w.-]{1,200}$/.test(publishId)) {
      const r = await pool.query(
        "UPDATE social_posts SET due_at=now(),updated_at=now() WHERE state='submitted' AND submission_id IN (SELECT id FROM social_native_submissions WHERE platform='tiktok' AND container_id=$1)",
        [publishId]).catch(() => ({ rowCount: 0 }));
      nudged = r.rowCount ?? 0;
    }
    console.log(`[social] tiktok ${event}${nudged ? `: ${nudged} post(s) re-checked` : ""}`);
    return { event, nudged };
  }
  console.log(`[social] tiktok webhook ${event || "(no event)"} ignored`);
  return { event };
}

/** Registered without session auth: the signature authenticates each request. */
export function registerTikTokWebhook(app: Express) {
  app.post("/api/social/native/tiktok/webhook", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const env = process.env;
    if (!tiktokSignatureValid((req as any).rawBody, req.get("tiktok-signature"), env.SOCIAL_TIKTOK_CLIENT_SECRET)) return res.status(401).json({ message: "Bad signature" });
    if (req.body?.client_key && env.SOCIAL_TIKTOK_CLIENT_KEY && req.body.client_key !== env.SOCIAL_TIKTOK_CLIENT_KEY) return res.status(401).json({ message: "Not our app" });
    try {
      await handleTikTokEvent(req.body);
    } catch (e) {
      // Still 200: TikTok retries otherwise, and the failure is ours to fix (logged).
      console.error("[social] tiktok webhook failed:", (e as Error)?.message);
    }
    res.json({ ok: true });
  });
}
