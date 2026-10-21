/**
 * The client's "Approve Estimate" email — ONE builder for both the real send
 * (POST /api/crm/estimates/:id/send, portal.ts) and the contractor's
 * "Send me a proof" (estimate-proof.ts), so the proof can never drift from
 * what the client actually receives. Pure: no DB, no mail, no side effects.
 */
import type { CrmEstimate, CrmOrg } from "@shared/schema";
import type { CompanyBranding } from "./divisions";
import { estimateDocText } from "./doc-defaults";
import { resolveOrgTheme } from "@shared/theme-colors";
import { WARRANTY_ANCHOR, bidHeadlineEmailHtml, normalizeBidHeadline } from "@shared/bid-headline";

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

export interface EstimateEmailInput {
  est: CrmEstimate;
  org: CrmOrg;
  branding: CompanyBranding;
  customerName: string | null | undefined;
  /** Absolute app base URL (getBaseUrl(req)). */
  base: string;
  /** The client portal home (clientPortalBaseUrl(req)). */
  portalUrl: string;
  /** The "View estimate" link. */
  link: string;
  /** Signature line — the sending member's name, else the org's. */
  from: string;
  /** The address the link verifies (the client's), shown in the footer. */
  verifiesEmail: string;
  expiresAt: Date;
  message?: string | null;
}

export function estimateEmailSubject(est: Pick<CrmEstimate, "number">, branding: Pick<CompanyBranding, "name">): string {
  return `Estimate from ${branding.name}${est.number ? ` — ${est.number}` : ""}`;
}

/** HCP-format email: contractor logo up top, "Approve Estimate #N" headline,
 *  personal note, one big View-estimate button, then the customer-portal
 *  link, contact block and a Terms & Conditions hyperlink. */
export function buildEstimateEmail(i: EstimateEmailInput): { subject: string; html: string } {
  const { est, org, branding, base, portalUrl, link, from, expiresAt } = i;
  const logoAbs = branding.logoUrl
    ? (branding.logoUrl.startsWith("http") ? branding.logoUrl : `${base}${branding.logoUrl}`)
    : null;
  const termsUrl = `${base}/e/${est.publicToken}?terms=1`;
  const addressLine = branding.addressLine1
    ? `${esc([branding.addressLine1, branding.addressLine2].filter(Boolean).join(", "))}${branding.city ? `<br>${esc(branding.city)}` : ""}${branding.state ? `, ${esc(branding.state)}` : ""}${branding.postalCode ? ` ${esc(branding.postalCode)}` : ""}`
    : "";
  // The estimate's bid headline opens the email too, right under the title.
  const headline = normalizeBidHeadline(est.bidHeadline);
  const headlineHtml = headline
    ? bidHeadlineEmailHtml(headline, {
        accentHex: resolveOrgTheme(org.customFields).hex,
        warrantyHref: estimateDocText(est, org).warrantyText ? `${link}#${WARRANTY_ANCHOR}` : null,
      })
    : "";
  const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;padding:28px 24px">
        ${logoAbs ? `<p style="text-align:center;margin:0 0 14px"><img src="${logoAbs}" alt="${esc(branding.name)}" style="max-height:64px;max-width:260px"></p>` : ""}
        <h1 style="text-align:center;font-size:26px;margin:6px 0 20px">
          Approve Estimate${est.number ? ` ${esc(est.number)}` : ""} from ${esc(branding.name)}
        </h1>
        ${headlineHtml}
        <p style="font-size:16px">Hi ${esc(i.customerName)},</p>
        <p style="font-size:16px">
          Please find estimate${est.number ? ` ${esc(est.number)}` : ""} from ${esc(branding.name)} below.
          Feel free to reach out with any questions or clarification.
        </p>
        ${i.message ? `<p style="font-size:16px;white-space:pre-wrap">${esc(i.message)}</p>` : ""}
        <p style="font-size:16px;margin:14px 0 0">Thank you,<br>-${esc(from)}${branding.phone ? `<br><a href="tel:${esc(branding.phone)}" style="color:#2563eb">${esc(branding.phone)}</a>` : ""}</p>
        <p style="text-align:center;margin:30px 0 18px">
          <a href="${link}" style="background:#2563eb;color:#fff;padding:14px 34px;border-radius:24px;
             text-decoration:none;font-weight:600;font-size:16px;display:inline-block">
            View estimate
          </a>
        </p>
        <p style="text-align:center;font-size:14px;margin:0 0 26px">
          <a href="${portalUrl}" style="color:#2563eb;text-decoration:none">View all estimates in your Customer Portal</a>
        </p>
        <p style="text-align:center;font-size:13px;color:#444;margin:0 0 4px">
          ${branding.phone ? `<a href="tel:${esc(branding.phone)}" style="color:#2563eb">${esc(branding.phone)}</a>` : ""}${branding.phone && branding.email ? " | " : ""}${branding.email ? `<a href="mailto:${esc(branding.email)}" style="color:#2563eb">${esc(branding.email)}</a>` : ""}
        </p>
        ${branding.website ? `<p style="text-align:center;font-size:13px;margin:0 0 4px"><a href="${esc(branding.website)}" style="color:#2563eb">${esc(branding.website)}</a></p>` : ""}
        ${addressLine ? `<p style="text-align:center;font-size:13px;color:#444;margin:10px 0 4px">${addressLine}</p>` : ""}
        ${branding.licenseNumber ? `<p style="text-align:center;font-size:12px;color:#666;margin:0 0 4px">License ${esc(branding.licenseNumber)}${branding.licenseState ? ` (${esc(branding.licenseState)})` : ""}</p>` : ""}
        <p style="text-align:center;font-size:14px;margin:14px 0 0">
          <a href="${termsUrl}" style="color:#2563eb">Terms &amp; Conditions</a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
        <p style="font-size:12px;color:#666">
          Only you can open the estimate link — it verifies ${esc(i.verifiesEmail)}. If it's forwarded to
          anyone else, they can't get in without access to your inbox.
          This estimate expires on ${expiresAt.toDateString()}.
        </p>
        <p style="font-size:12px;color:#999;word-break:break-all">If the button doesn't work, paste this into your browser: ${link}</p>
      </div>`;
  return { subject: estimateEmailSubject(est, branding), html };
}
