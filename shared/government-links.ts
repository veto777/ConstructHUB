import { hasJurisdictionAdapter, isScrapablePlatform } from "./scrapable-platforms";

/** Recognize challenge destinations by host, never by a URL embedded in the query. */
export function isChallengeUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return ['perfdrive.com', 'captcha-delivery.com', 'datadome.co', 'datadome.com',
      'shieldsquare.com', 'challenges.cloudflare.com'].some(domain => host === domain || host.endsWith(`.${domain}`)) ||
      /\/(?:bot[-_]?check|captcha)(?:\/|$)|\/cdn-cgi\/challenge-platform(?:\/|$)/i.test(url.pathname);
  } catch { return false; }
}

/** Source-listed links remain usable when automated verification is inconclusive. */
export function governmentLinksAvailable(row: { isActive: boolean; linkStatus?: string | null }): boolean {
  return row.isActive && ['live', 'verified', 'unconfirmed'].includes(row.linkStatus || '');
}

export function governmentLinksForDisplay<T extends { isActive: boolean; linkStatus?: string | null; portalUrl: string | null; searchUrl: string | null }>(row: T): T {
  const challenge = isChallengeUrl(row.portalUrl) || isChallengeUrl(row.searchUrl);
  const display = challenge ? { ...row, linkStatus: 'unconfirmed' } : row;
  return governmentLinksAvailable(row) ? display : { ...display, portalUrl: null, searchUrl: null };
}

/** Portal availability does not imply that an automated records adapter exists.
 * The answer comes from the adapter registry (server/scrapers/registry.ts) via the generated
 * shared/scrapable-platforms.ts: a platform label/alias with an adapter, or a jurisdiction with its own
 * open-data adapter. Keep the row's jurisdiction in the call when you have it.
 */
export function canScrapeGovernmentPortal(row: { platform: string | null; searchUrl: string | null; portalUrl: string | null; jurisdiction?: string | null }): boolean {
  const value = row.searchUrl || row.portalUrl;
  if (!value) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (hasJurisdictionAdapter(row.jurisdiction)) return true;
  if (!row.platform) return false;
  // eTRAKiT: the current adapter is multi-tenant — it derives the application root
  // from the target URL (/eTRAKiT/, /etrakit3/, /etrakit_prod/, /community-etrakit/ or
  // a web-root install) and verifies the response is an eTRAKiT permit-search form before
  // searching (server/scrapers/etrakit.ts; etrakit.REPORT.md 2026-10-10, verified on
  // Hillsborough/Shasta/Hanover). Nothing is hard-wired to one tenant, so eTRAKiT falls
  // through to isScrapablePlatform below like any other verified-link adapter platform.
  if (['Skagit County', 'Custom / GovPlatform'].includes(row.platform)) {
    // Skagit's adapter is single-tenant (skagitcounty.net only); do not label another
    // host's records as searchable until it accepts and verifies a target URL.
    return ['skagitcounty.net', 'www.skagitcounty.net'].includes(url.hostname);
  }
  return isScrapablePlatform(row.platform);
}

/** The permit catalog verifies portal URLs, not the legacy hardcoded contacts.
 * Keep stored values intact for source review, but do not present them as verified.
 */
export function governmentPermitForDisplay<T extends {
  isActive: boolean; linkStatus?: string | null; portalUrl: string | null; searchUrl: string | null;
  phone: string | null; email: string | null; address: string | null;
}>(row: T): T {
  return { ...governmentLinksForDisplay(row), phone: null, email: null, address: null };
}

/** Dates describe actual checks, never the boot/seed time. */
// The calendar date in the visitor's own time zone, so "Last checked" agrees
// with the browser-local "Last scraped" dates shown beside it (a UTC date can
// sit one day ahead for US visitors).
const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function governmentLinkNotice(row: { linkStatus?: string | null; lastVerifiedAt?: string | Date | null }): string | null {
  if (row.linkStatus !== 'unconfirmed') return null;
  const date = row.lastVerifiedAt ? new Date(row.lastVerifiedAt) : null;
  return `Official site · not auto-verified · ${date && !Number.isNaN(date.getTime()) ? `Last checked ${localDay(date)}` : 'Check date unavailable'}`;
}
