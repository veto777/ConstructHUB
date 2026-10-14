/**
 * The ConstructHUB email signature — logo, phone, website, email and the official social accounts.
 *
 * Used by every email ConstructHUB sends as itself (account/billing/support layouts, outreach and quote requests).
 * Never on emails a contractor sends to their own clients (CRM, review requests): those carry the contractor's brand.
 * Social accounts come from shared/social-links.ts (checked URLs only); the phone is the ConstructHUB support line.
 */
import { SOCIAL_LINKS } from "@shared/social-links";

export const SIGNATURE_SITE = "https://constructhub.us";
export const SIGNATURE_EMAIL = "support@constructhub.us";
export const SIGNATURE_PHONE = "+1 (832) 399-0560";
const PHONE_TEL = "+18323990560";
const LOGO_URL = `${SIGNATURE_SITE}/chub-logo-square-text.png`;

/** "https://www.youtube.com/@x/" → "youtube.com/@x": the address as people read it. */
export const displayUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain-text signature, starting with the "-- " delimiter mail apps recognise. */
export function signatureText(): string {
  return [
    "-- ",
    "The ConstructHUB Team",
    "Software for US contractors",
    `${SIGNATURE_PHONE} · ${SIGNATURE_EMAIL}`,
    SIGNATURE_SITE,
    ...SOCIAL_LINKS.map((link) => `${link.name}: ${link.url}`),
  ].join("\n");
}

/** HTML signature block: inline styles and a table layout so it renders in Gmail, Outlook and Apple Mail. */
export function signatureHtml(): string {
  const link = "color:#F97316;text-decoration:none;";
  // Each account's own address, shown in full (owner, 2026-10-14: "real links, not just words").
  const socials = SOCIAL_LINKS.map(
    (social) => `<div><span style="color:#888;">${escapeHtml(social.name)}:</span> <a href="${escapeHtml(social.url)}" style="${link}" aria-label="${escapeHtml(social.label)}">${escapeHtml(displayUrl(social.url))}</a></div>`,
  ).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid #eee;padding-top:16px;font-family:'Segoe UI',Arial,sans-serif;">
<tr>
<td style="vertical-align:top;padding:16px 14px 0 0;"><a href="${SIGNATURE_SITE}"><img src="${LOGO_URL}" alt="ConstructHUB" width="48" height="48" style="width:48px;height:48px;border-radius:10px;display:block;" /></a></td>
<td style="vertical-align:top;padding-top:16px;font-size:13px;line-height:1.55;color:#444;">
<div style="font-weight:700;color:#1a1a2e;">The ConstructHUB Team</div>
<div style="color:#888;">Software for US contractors</div>
<div><a href="tel:${PHONE_TEL}" style="${link}">${SIGNATURE_PHONE}</a> <span style="color:#ccc;">·</span> <a href="mailto:${SIGNATURE_EMAIL}" style="${link}">${SIGNATURE_EMAIL}</a></div>
<div><a href="${SIGNATURE_SITE}" style="${link}">constructhub.us</a></div>
<div style="margin-top:6px;">${socials}</div>
</td>
</tr>
</table>`;
}
