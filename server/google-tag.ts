/**
 * The Google tag (gtag.js) on the marketing site — Google Ads conversion
 * tracking and GA4. Runtime configuration, so the ids are set in the live .env
 * and a restart applies them (no rebuild):
 *
 *   GOOGLE_TAG_IDS                    "AW-1234567890" or "AW-1234567890,G-ABCDEF1234"
 *   GOOGLE_ADS_CONVERSION_SIGNUP      "AW-1234567890/AbCdEfGhIjK"   (a new account)
 *   GOOGLE_ADS_CONVERSION_PURCHASE    "AW-1234567890/LmNoPqRsTuV"   (a platform plan bought)
 *   GOOGLE_ADS_CONVERSION_CRM         "AW-1234567890/WxYz..."       (a CRM plan bought)
 *
 * With no GOOGLE_TAG_IDS nothing is added to the page. The CRM app and the
 * client portal never carry the tag (server/static.ts adds it on the marketing
 * hosts only). The client fires conversions through client/src/lib/gtag.ts,
 * which reads window.__CH_GTAG set here.
 */
const TAG_ID = /^(AW|G|GT|DC)-[A-Z0-9]{4,20}$/;
const SEND_TO = /^AW-[0-9]{6,20}\/[A-Za-z0-9_-]{4,60}$/;

export function googleTagIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return String(env.GOOGLE_TAG_IDS || "").split(",").map((s) => s.trim()).filter((s) => TAG_ID.test(s));
}

function conversion(value: string | undefined): string | null {
  const v = String(value || "").trim();
  return SEND_TO.test(v) ? v : null;
}

/** The <script> block for <head>, or "" when no tag id is configured. Ids are validated, so nothing is escaped. */
export function googleTagSnippet(env: NodeJS.ProcessEnv = process.env): string {
  const ids = googleTagIds(env);
  if (!ids.length) return "";
  const config = {
    ids,
    conversions: {
      signup: conversion(env.GOOGLE_ADS_CONVERSION_SIGNUP),
      purchase: conversion(env.GOOGLE_ADS_CONVERSION_PURCHASE),
      crm_purchase: conversion(env.GOOGLE_ADS_CONVERSION_CRM),
    },
  };
  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${ids[0]}"></script>`,
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());` +
      ids.map((id) => `gtag('config','${id}');`).join("") +
      `window.__CH_GTAG=${JSON.stringify(config)};</script>`,
  ].join("\n    ");
}

/** `html` with the Google tag before </head> (unchanged when not configured or already tagged). */
export function withGoogleTag(html: string, env: NodeJS.ProcessEnv = process.env): string {
  const snippet = googleTagSnippet(env);
  if (!snippet || html.includes("googletagmanager.com/gtag/js")) return html;
  return html.replace(/<\/head>/i, () => `    ${snippet}\n  </head>`);
}
