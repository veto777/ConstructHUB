import { governmentLinkNotice, governmentLinksAvailable, isChallengeUrl } from '@shared/government-links';

/** Preserve the source's Alaska place name; never guess borough/census-area status. */
export function propertyJurisdictionLabel(place: { name: string; stateCode: string }): string {
  if (place.stateCode === 'AK' || /\b(county|parish|borough|census area|municipality)$/i.test(place.name)) return place.name;
  return `${place.name} ${place.stateCode === 'LA' ? 'Parish' : 'County'}`;
}

export function propertyCheckedNotice(row: { linkStatus?: string | null; lastVerifiedAt?: string | Date | null }): string {
  const notice = governmentLinkNotice({ ...row, linkStatus: 'unconfirmed' })!;
  if (row.linkStatus === 'unconfirmed') return notice;
  return notice.replace('Official site · not auto-verified · ', '') + ' · links can change';
}
/** Display-only safeguards; source corrections belong to the government-link pipeline. */
export function propertyOfficeForDisplay<T extends { name: string; county?: { name: string; stateCode: string }; portalUrl: string | null; searchUrl: string | null; linkStatus: string | null }>(row: T): T {
  const safe = (value: string | null) => {
    if (!value) return null;
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? value : null; } catch { return null; }
  };
  const portalUrl = safe(row.portalUrl), searchUrl = safe(row.searchUrl);
  const challenge = isChallengeUrl(portalUrl) || isChallengeUrl(searchUrl);
  return { ...row, portalUrl, searchUrl,
    name: !row.name.trim() || /^assessor$/i.test(row.name.trim()) || / property records$/i.test(row.name)
      ? `${row.county?.name || row.name.replace(/ property records$/i, '').trim() || 'Local'} Assessor` : row.name,
    linkStatus: challenge ? 'unconfirmed' : row.linkStatus };
}

export function resolvePropertyScope(rows: Array<{ countyId: number; county?: { stateCode: string } }>, state: string, county: string) {
  const requested = rows.find(row => String(row.countyId) === county)?.county;
  if (county !== 'all' && requested) return { state: requested.stateCode, county, notice: '' };
  const validState = state === 'all' || rows.some(row => row.county?.stateCode === state);
  return {
    state: validState ? state : 'all', county: 'all',
    notice: county !== 'all' || !validState ? 'The requested jurisdiction is unavailable. Showing ' + (validState && state !== 'all' ? 'other offices in this state.' : 'all states.') : '',
  };
}

/**
 * What one office row offers, decided once for the list row and the map (the map shades a county by
 * the same answer, so the colour can never promise a link the card does not show).
 */
export function propertyOfficeLinks(row: { isActive: boolean; linkStatus?: string | null; portalUrl: string | null; searchUrl: string | null; phone: string | null; lastVerifiedAt?: string | Date | null }) {
  const portalChallenge = isChallengeUrl(row.portalUrl);
  const searchChallenge = isChallengeUrl(row.searchUrl);
  const challenge = portalChallenge || searchChallenge;
  const linksOk = governmentLinksAvailable(row);
  const showPortal = linksOk && !!row.portalUrl && !portalChallenge;
  const showSearch = linksOk && !!row.searchUrl && !searchChallenge && row.searchUrl !== row.portalUrl;
  return {
    challenge, showPortal, showSearch,
    notice: challenge ? "The recorded link leads to a bot challenge. Find the official office below." : linksOk ? propertyCheckedNotice(row) : null,
    // No usable official link on record: an honest web search, never a fabricated portal.
    fallback: row.linkStatus === "unconfirmed" || !linksOk || (!row.portalUrl && !row.searchUrl),
    /** The map colour: a records site to open, only a phone, or neither. */
    shade: (showPortal || showSearch ? "site" : row.phone ? "phone" : "none") as "site" | "phone" | "none",
  };
}
