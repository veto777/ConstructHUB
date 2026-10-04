/** Source-listed links remain usable when automated verification is inconclusive. */
export function governmentLinksAvailable(row: { isActive: boolean; linkStatus?: string | null }): boolean {
  return row.isActive && ['live', 'verified', 'unconfirmed'].includes(row.linkStatus || '');
}

export function governmentLinksForDisplay<T extends { isActive: boolean; linkStatus?: string | null; portalUrl: string | null; searchUrl: string | null }>(row: T): T {
  return governmentLinksAvailable(row) ? row : { ...row, portalUrl: null, searchUrl: null };
}

/** Portal availability does not imply that an automated records adapter exists. */
export function canScrapeGovernmentPortal(row: { platform: string | null; searchUrl: string | null; portalUrl: string | null }): boolean {
  const value = row.searchUrl || row.portalUrl;
  if (!value || !row.platform) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (row.platform === 'eTRAKiT') {
    // The current adapter is specific to Bellingham. Do not label its records
    // as another city's until the adapter accepts and verifies a target URL.
    return url.hostname === 'permits.cob.org' && /^\/etrakit\//i.test(url.pathname);
  }
  if (['Skagit County', 'Custom / GovPlatform'].includes(row.platform)) {
    return ['skagitcounty.net', 'www.skagitcounty.net'].includes(url.hostname);
  }
  return ['SmartGov', 'Tyler EnerGov', 'Tyler Technologies', 'Accela', 'Click2Gov', 'FTG Portal'].includes(row.platform);
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
