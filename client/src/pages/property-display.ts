import { isChallengeUrl } from '@shared/government-links';
/** Display-only safeguards; source corrections belong to the government-link pipeline. */
export function propertyOfficeForDisplay<T extends { name: string; portalUrl: string | null; searchUrl: string | null; linkStatus: string | null }>(row: T): T {
  const safe = (value: string | null) => {
    if (!value) return null;
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? value : null; } catch { return null; }
  };
  const portalUrl = safe(row.portalUrl), searchUrl = safe(row.searchUrl);
  const challenge = isChallengeUrl(portalUrl) || isChallengeUrl(searchUrl);
  return { ...row, portalUrl, searchUrl,
    name: / property records$/i.test(row.name) ? 'County records (office name unavailable)' : row.name,
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
