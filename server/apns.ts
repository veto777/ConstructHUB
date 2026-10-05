/**
 * Apple push for the iPhone apps — the sending half of server/app-push.ts (which stores each phone's token).
 *
 *   pushToUser(userId, "platform" | "crm", { title, body, link })
 *
 * Token auth: an ES256 JWT from the Construct Hub LLC team's APNs key (renewed every 50 min, Apple allows 20–60),
 * HTTP/2 to api.push.apple.com, apns-topic = the app's bundle ID. The phone opens `url` when the alert is tapped
 * (ios/Shared/AppDelegate.swift, constructhub.us hosts only). A token Apple reports dead (410 Unregistered,
 * BadDeviceToken, DeviceTokenNotForTopic) is deleted. Best-effort: a push never breaks the event that caused it.
 * Off unless APNS_KEY_FILE + APNS_KEY_ID + APNS_TEAM_ID are set (prod: keys/ios/apns-<id>.p8).
 */
import http2 from "http2";
import { createSign } from "crypto";
import { readFileSync } from "fs";
import { pool } from "./db";
import { pushTokensFor } from "./app-push";

export type PushApp = "platform" | "crm";
export type PushMessage = { title: string; body?: string | null; link?: string | null };

export const TOPICS: Record<PushApp, string> = { platform: "us.constructhub.app", crm: "us.constructhub.crm" };
const DEAD = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"]);

const origin = (app: PushApp) =>
  ((app === "crm" ? process.env.PORTAL_URL || "https://portal.constructhub.us" : process.env.APP_URL || "https://constructhub.us")
    .trim().replace(/\/+$/, ""));

/** The tap target: an in-app path joined to the app's origin; anything else opens the app's home. */
export function pushUrl(app: PushApp, link?: string | null): string {
  return link && link.startsWith("/") && !link.startsWith("//") ? origin(app) + link : origin(app) + "/";
}

/** The APNs body: alert + the tap URL, trimmed well under Apple's 4 KB limit. */
export function pushPayload(app: PushApp, msg: PushMessage) {
  const title = msg.title.trim().slice(0, 120);
  const body = msg.body ? String(msg.body).replace(/\s+/g, " ").trim().slice(0, 400) : undefined;
  return { aps: { alert: body ? { title, body } : { title }, sound: "default" }, url: pushUrl(app, msg.link) };
}

export const pushConfigured = () => !!(process.env.APNS_KEY_FILE && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);

let jwt: { at: number; token: string } | null = null;
function providerToken(): string {
  if (jwt && Date.now() - jwt.at < 50 * 60_000) return jwt.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64({ alg: "ES256", kid: process.env.APNS_KEY_ID })}.${b64({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
  const sig = createSign("SHA256").update(data)
    .sign({ key: readFileSync(process.env.APNS_KEY_FILE!, "utf8"), dsaEncoding: "ieee-p1363" }).toString("base64url");
  jwt = { at: Date.now(), token: `${data}.${sig}` };
  return jwt.token;
}

// One HTTP/2 connection, reused (Apple asks providers to keep it open), dropped after 10 idle minutes.
let session: http2.ClientHttp2Session | null = null;
function connection(): http2.ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  const s = http2.connect(process.env.APNS_HOST || "https://api.push.apple.com");
  s.on("error", (e) => { console.warn(`[apns] connection: ${e.message}`); if (session === s) session = null; });
  s.on("close", () => { if (session === s) session = null; });
  s.setTimeout(10 * 60_000, () => s.close());
  s.unref();
  return (session = s);
}

function send(token: string, topic: string, payload: object): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve) => {
    let req: http2.ClientHttp2Stream;
    try {
      req = connection().request({
        ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${providerToken()}`,
        "apns-topic": topic, "apns-push-type": "alert", "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 3600),
      });
    } catch (e: any) { return resolve({ status: 0, reason: e?.message ?? String(e) }); }
    let status = 0, text = "";
    req.setTimeout(10_000, () => { req.close(http2.constants.NGHTTP2_CANCEL); });
    req.on("response", (h) => { status = Number(h[":status"]); });
    req.on("data", (d) => { text += d; });
    req.on("error", (e) => resolve({ status: 0, reason: e.message }));
    req.on("close", () => {
      let reason: string | undefined;
      try { reason = text ? JSON.parse(text).reason : undefined; } catch { reason = text.slice(0, 100); }
      resolve({ status, reason: status ? reason : reason ?? "no response" });
    });
    req.end(JSON.stringify(payload));
  });
}

/** Alert every signed-in iPhone this user has for that app. Returns how many Apple accepted. */
export async function pushToUser(userId: number, app: PushApp, msg: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  try {
    const tokens = await pushTokensFor(userId, app);
    if (!tokens.length) return 0;
    const payload = pushPayload(app, msg);
    let sent = 0;
    for (const token of tokens) {
      const r = await send(token, TOPICS[app], payload);
      if (r.status === 200) { sent++; continue; }
      if (r.status === 410 || (r.status === 400 && DEAD.has(r.reason ?? ""))) {
        await pool.query("DELETE FROM app_push_tokens WHERE token=$1", [token]);
      } else console.warn(`[apns] user ${userId} ${app}: ${r.status} ${r.reason ?? ""}`);
    }
    return sent;
  } catch (e: any) {
    console.warn(`[apns] user ${userId} ${app} failed: ${e?.message ?? e}`);
    return 0;
  }
}

/** Which app a CRM-side notification belongs to: Call Assistant pages live on constructhub.us, the rest in the CRM. */
export const appForLink = (link?: string | null): PushApp => (link?.startsWith("/call-assistant") ? "platform" : "crm");

/** Fire-and-forget form for notification paths: never awaited, never throws. */
export function pushSoon(userId: number, app: PushApp, msg: PushMessage): void {
  if (pushConfigured()) void pushToUser(userId, app, msg);
}
