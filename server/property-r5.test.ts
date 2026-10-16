import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import appraisers from './data/appraisers.json';
import { governmentLinksForDisplay, isChallengeUrl } from '../shared/government-links';
const state = vi.hoisted(() => ({ query: {} as any }));
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: () => state.query }));
import PropertyPage from '../client/src/pages/property';
import { propertyCheckedNotice, propertyJurisdictionLabel, propertyOfficeForDisplay } from '../client/src/pages/property-display';
const office = { id: 1, countyId: 12, name: 'Test office', isActive: true, portalUrl: 'https://validate.perfdrive.com/', searchUrl: 'https://county.gov/records', linkStatus: 'verified', county: { name: 'Test', state: 'Test', stateCode: 'TS' } };
beforeEach(() => {
  state.query = { data: [office], isLoading: false, refetch: vi.fn() };
  vi.stubGlobal('location', { pathname: '/property', search: '' });
  vi.stubGlobal('navigator', { userAgent: '' });
  vi.stubGlobal('window', { location: { search: '', pathname: '/property' } });
});
it('preserves the usable search action when the portal is a challenge, and vice versa', () => {
  for (const row of [office, { ...office, portalUrl: office.searchUrl, searchUrl: office.portalUrl }]) {
    state.query.data = [row];
    const html = renderToStaticMarkup(createElement(PropertyPage));
    expect(html).toContain('href="https://county.gov/records"');
    expect(html).not.toContain('href="https://validate.perfdrive.com');
    expect(html).toContain('Find property records');
  }
});
it('retains offices on refresh failure with a saved-data notice and retry', () => {
  state.query.error = new Error('503: offline');
  const html = renderToStaticMarkup(createElement(PropertyPage));
  expect(html).toContain('showing saved property offices');
  expect(html).toContain('Test office');
  expect(html).toContain('Retry');
});
it.each([401, 402, 403])('does not retain protected offices after access failure %s', code => {
  state.query.error = new Error(`${code}: denied`);
  expect(renderToStaticMarkup(createElement(PropertyPage))).not.toContain('Test office');
});
it('recovers Roseau only from the archived challenge URL and leaves verification pending', () => {
  const roseau = appraisers.find(row => row.stateCode === 'MN' && row.county === 'Roseau')!;
  expect(roseau.portalUrl).toBe(new URL(roseau.candidateUrl!).searchParams.get('ssc'));
  expect(new URL(roseau.portalUrl!).hostname).toBe('www.co.roseau.mn.us');
  expect(isChallengeUrl(roseau.portalUrl)).toBe(false);
  expect(governmentLinksForDisplay({ ...roseau, isActive: true, searchUrl: null }).linkStatus).toBe('unconfirmed');
});

it('omits seed-default search capabilities and describes records as held on office sites', () => {
  state.query.data = [{ ...office, searchableFields: ['Address', 'Owner', 'Parcel'] }];
  const html = renderToStaticMarkup(createElement(PropertyPage));
  // An element carrying the chip class (the page wrapper's phone tap-size rule mentions g-chip inside a selector).
  expect(html).not.toMatch(/class="(?:[^"]*\s)?g-chip(?:\s|")/);
  expect(html).toContain('Their own sites hold ownership');
});

it('uses the same last-check calendar date for both link statuses', () => {
  const lastVerifiedAt = new Date(2026, 8, 28, 12);
  for (const linkStatus of ['verified', 'unconfirmed']) {
    expect(propertyCheckedNotice({ linkStatus, lastVerifiedAt })).toContain('Last checked 2026-09-28');
    expect(propertyCheckedNotice({ linkStatus, lastVerifiedAt: 'invalid' })).toContain('Check date unavailable');
    expect(propertyCheckedNotice({ linkStatus, lastVerifiedAt: null })).not.toContain('Last checked');
  }
});

it('preserves Alaska jurisdiction names and gives unnamed offices place-qualified labels', () => {
  for (const name of ['Anchorage', 'Aleutians East Borough', 'Bethel Census Area']) {
    const county = { name, stateCode: 'AK', state: 'Alaska' };
    expect(propertyJurisdictionLabel(county)).toBe(name);
    for (const officeName of ['', 'Assessor', `${name} property records`]) {
      const row = propertyOfficeForDisplay({ ...office, name: officeName, county });
      expect(row.name).toBe(`${name} Assessor`);
      state.query.data = [row];
      const html = renderToStaticMarkup(createElement(PropertyPage));
      expect(html).toContain(`${name}, Alaska`);
      expect(html).not.toContain(`${name} County`);
    }
  }
  expect(propertyJurisdictionLabel({ name: 'Orange', stateCode: 'FL' })).toBe('Orange County');
});
