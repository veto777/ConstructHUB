/**
 * The Meta (Facebook) pixel on the marketing site, and the Conversions API behind it — so a Facebook / Instagram ad
 * is judged by ConstructHUB sign-ups, not by form fills (owner, 2026-10-12: "we dont need leads we need signup!").
 *
 *   META_PIXEL_ID      the pixel (dataset) id on the ad account; nothing is added to the page without it
 *   META_USER_TOKEN    a token with ads_management, for the Conversions API (shared with the ads scripts on vb11)
 *
 * The browser pixel rides on the marketing hosts' pages only (server/static.ts, beside the Google tag), never the CRM
 * app or the client portal. A new account is reported twice under one event id — by the browser
 * (client/src/lib/gtag.ts) and by the server here — and Meta keeps one. What Meta gets: a SHA-256 of the lowercase
 * email, the IP address, the browser string and its own _fbp/_fbc cookies, as its API requires; nothing else about
 * the account. Privacy policy 1.3 says so.
 */
import { createHash, randomUUID } from "node:crypto";

const PIXEL = /^[0-9]{8,20}$/;
export const metaPixelId = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const v = String(env.META_PIXEL_ID || "").trim();
  return PIXEL.test(v) ? v : null;
};

/** The <script> block for <head>, or "" when no pixel is configured. The id is validated, so nothing is escaped. */
export function metaPixelSnippet(env: NodeJS.ProcessEnv = process.env): string {
  const id = metaPixelId(env);
  if (!id) return "";
  return `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');window.__CH_META_PIXEL='${id}';</script>`;
}

/** `html` with the pixel before </head> (unchanged when not configured or already tagged). */
export function withMetaPixel(html: string, env: NodeJS.ProcessEnv = process.env): string {
  const snippet = metaPixelSnippet(env);
  if (!snippet || html.includes("connect.facebook.net/en_US/fbevents.js")) return html;
  return html.replace(/<\/head>/i, () => `    ${snippet}\n  </head>`);
}

export const metaDeps = { http: fetch as typeof fetch, env: () => process.env, now: () => Date.now() };

/** The visitor's address as Cloudflare / the proxy reports it. */
export const requestIp = (req: { headers: Record<string, unknown>; ip?: string }): string =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim().slice(0, 60);

const cookieValue = (header: unknown, name: string): string | null => {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim().slice(0, 200) || null;
  }
  return null;
};
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export type MetaSignup = { email: string; ip?: string | null; userAgent?: string | null; cookie?: unknown; sourceUrl?: string | null; eventId?: string };

/**
 * Tells Meta a new account was created (CompleteRegistration). Returns the event id for the browser's copy, or null
 * when the pixel isn't configured. Never throws and never blocks a sign-up: a refusal is one warning in the log.
 */
export async function reportMetaSignup(s: MetaSignup): Promise<string | null> {
  const env = metaDeps.env();
  const id = metaPixelId(env), token = String(env.META_USER_TOKEN || "").trim();
  if (!id || !token) return null;
  const eventId = s.eventId ?? randomUUID();
  const user_data: Record<string, string> = { em: sha256(s.email.trim().toLowerCase()) };
  if (s.ip) user_data.client_ip_address = s.ip;
  if (s.userAgent) user_data.client_user_agent = String(s.userAgent).slice(0, 400);
  const fbp = cookieValue(s.cookie, "_fbp"), fbc = cookieValue(s.cookie, "_fbc");
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;
  const body = {
    data: [{ event_name: "CompleteRegistration", event_time: Math.floor(metaDeps.now() / 1000), event_id: eventId, action_source: "website",
      event_source_url: s.sourceUrl || "https://constructhub.us/auth", user_data }],
    access_token: token,
  };
  try {
    const r = await metaDeps.http(`https://graph.facebook.com/v25.0/${id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) console.warn("[meta] sign-up event refused:", r.status, (await r.text().catch(() => "")).slice(0, 200));
  } catch (err) {
    console.warn("[meta] sign-up event failed:", (err as Error)?.message);
  }
  return eventId;
}
