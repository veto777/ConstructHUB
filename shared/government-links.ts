/** Only a verified, active office may expose an outbound records link. */
export function governmentLinksAvailable(row: { isActive: boolean; linkStatus?: string | null }): boolean {
  return row.isActive && row.linkStatus === 'live';
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
