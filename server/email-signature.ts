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
/** Social icon look: "dark" (dark-gray tiles, the default since 2026-10-14) or "color" (each network's brand color). */
export const SIGNATURE_ICON_STYLE: "dark" | "color" = "dark";

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
  // Each account as its logo (owner, 2026-10-14: "logos/icons"), hosted on constructhub.us — mail apps block SVG and data: images.
  const socials = SOCIAL_LINKS.map(
    (social) => `<a href="${escapeHtml(social.url)}" style="display:inline-block;margin-right:8px;text-decoration:none;" aria-label="${escapeHtml(social.label)}"><img src="${SIGNATURE_SITE}/email/social-${escapeHtml(social.key)}${SIGNATURE_ICON_STYLE === "dark" ? "-dark" : ""}.png" alt="${escapeHtml(social.name)}" width="24" height="24" style="width:24px;height:24px;border:0;display:block;" /></a>`,
  ).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid #eee;padding-top:16px;font-family:'Segoe UI',Arial,sans-serif;">
<tr>
<td style="vertical-align:top;padding:16px 14px 0 0;"><a href="${SIGNATURE_SITE}"><img src="${LOGO_URL}" alt="ConstructHUB" width="48" height="48" style="width:48px;height:48px;border-radius:10px;display:block;" /></a></td>
<td style="vertical-align:top;padding-top:16px;font-size:13px;line-height:1.55;color:#444;">
<div style="font-weight:700;color:#1a1a2e;">The ConstructHUB Team</div>
<div style="color:#888;">Software for US contractors</div>
<div><a href="tel:${PHONE_TEL}" style="${link}">${SIGNATURE_PHONE}</a> <span style="color:#ccc;">·</span> <a href="mailto:${SIGNATURE_EMAIL}" style="${link}">${SIGNATURE_EMAIL}</a></div>
<div><a href="${SIGNATURE_SITE}" style="${link}">constructhub.us</a></div>
<div style="margin-top:8px;font-size:0;line-height:0;">${socials}</div>
</td>
</tr>
</table>`;
}
