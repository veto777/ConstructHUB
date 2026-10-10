import { load } from "cheerio";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { PortalAdapter } from "./types";

/** Only installation-bearing CitizenServe URLs are verified. No tenant guessing. */
export function citizenserveSearchUrl(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || !/^(?:www\d*\.)?citizenserve\.com$/i.test(url.hostname) ||
      !/^\/Portal\/(?:PortalController)?$/i.test(url.pathname)) {
    throw new Error("Unsupported CitizenServe portal URL");
  }
  const id = [...url.searchParams].find(([key]) => key.toLowerCase() === "installationid")?.[1];
  if (!id || !/^\d+$/.test(id)) throw new Error("CitizenServe portal lacks a numeric installationID");
  url.protocol = "https:";
  url.pathname = "/Portal/PortalController";
  url.search = new URLSearchParams({ Action: "showSearchPage", ctzPagePrefix: "Portal_", installationID: id, type: "Permit" }).toString();
  url.hash = "";
  return url.href;
}

export function inspectCitizenserveSearch(html: string, url: string): never {
  const $ = load(html);
  if (/grecaptcha\s*\.\s*execute\s*\(/i.test(html) ||
      $('iframe[src*="recaptcha"], .g-recaptcha, .h-captcha').length ||
      /verify you are human|cf-chl-|challenge-platform/i.test(html)) {
    throw new PortalBlockedError(url, 403, "CitizenServe public search requires CAPTCHA; no search was submitted");
  }
  if (!$('form#frm_PortalSearch').length && $('input[type="password"]').length) {
    throw new PortalBlockedError(url, 401, "CitizenServe public search redirected to a login wall");
  }
  // Do not mistake a changed layout or a search landing page for an empty result.
  throw new Error("CitizenServe search layout is not verified for unattended access; no search was submitted");
}

const adapter: PortalAdapter = {
  platform: "CitizenServe",
  aliases: ["Citizenserve", "Citizenserve portal", "Citizenserve (Building Permit Portal)"],
  // All three surveyed search forms require reCAPTCHA v3 at submission.
  capabilities: { search: [], listRecent: false, detail: false },
  async search(ctx, q) {
    const url = citizenserveSearchUrl(ctx.searchUrl);
    if (!q.value?.trim()) throw new Error("CitizenServe query must not be empty");
    const response = await politeFetch(url, { redirect: "manual" }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
    if ([401, 403, 429].includes(response.status)) throw new PortalBlockedError(url, response.status);
    if (!response.ok) throw new Error(`CitizenServe HTTP ${response.status}; redirected or unavailable portal`);
    return inspectCitizenserveSearch(await response.text(), url);
  },
  async listRecent(ctx) {
    citizenserveSearchUrl(ctx.searchUrl);
    ctx.log("CitizenServe date listing is unavailable to this adapter: public search requires CAPTCHA");
    return [];
  },
};
export default adapter;
