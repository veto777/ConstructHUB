import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ query: {} as any, infinite: {} as any }));
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: () => state.query, useQueries: () => [], useInfiniteQuery: () => state.infinite }));
import DatabasesPage from '../../client/src/pages/databases';
import PropertyPage from '../../client/src/pages/property';
import PermitAlertsPage, { HitList, WatchForm } from '../../client/src/pages/permit-alerts';
import type { PermitWatchDto } from '@shared/permit-alerts';

beforeEach(() => {
  state.query = { data: undefined, isLoading: false, refetch: vi.fn() };
  state.infinite = { ...state.query };
  vi.stubGlobal('location', { pathname: '/property', search: '' });
  vi.stubGlobal('navigator', { userAgent: '' });
  vi.stubGlobal('window', { location: { search: '', pathname: '/property' } });
});
describe('property access and unavailable data', () => {
  it('preserves the complete county deep link through sign-in', () => {
    window.location.search = '?state=MN&countyId=12&q=Roseau&page=2';
    state.query.error = new Error('401: Unauthorized');
    const html = renderToStaticMarkup(createElement(PropertyPage));
    expect(html).toContain('/auth?next=%2Fproperty%3Fstate%3DMN%26countyId%3D12%26q%3DRoseau%26page%3D2');
  });
  it('makes web search the action for a recorded challenge destination', () => {
    state.query.data = [{ id: 1, countyId: 12, name: 'Test office', portalUrl: 'https://www.perfdrive.com/?id=test', linkStatus: 'verified', county: { name: 'Test', state: 'Test', stateCode: 'TS' } }];
    const html = renderToStaticMarkup(createElement(PropertyPage));
    expect(html).toContain('Find property records');
    expect(html).toContain('recorded link leads to a bot challenge');
    expect(html).not.toContain('href="https://www.perfdrive.com');
    expect(html).not.toContain('Open unconfirmed site');
  });
  it.each([401, 402, 500])('never presents %s as an empty directory', status => {
    state.query.error = new Error(`${status}: ${JSON.stringify({ code: 'plan_required', requiredPlan: 'pro', message: 'Eligible plan required' })}`);
    const html = renderToStaticMarkup(createElement(PropertyPage));
    expect(html).not.toContain('No offices on record');
    expect(html).toContain(status === 401 ? 'Sign in' : status === 402 ? 'plan-required-propertyRecords' : 'Retry');
  });
  it('reserves the empty state for a successful empty response', () => {
    state.query.data = [];
    expect(renderToStaticMarkup(createElement(PropertyPage))).toContain('No offices on record');
  });
});
describe('watch history and editing', () => {
  it.each([false, true])('retries the failed operation with cached data (next page: %s)', nextPageFailed => {
    const refetch = vi.fn(), fetchNextPage = vi.fn();
    state.infinite = {
      data: { pages: [{ hits: [{ id: 1, permit: {} }], total: 2, nextCursor: 1 }] },
      error: new Error('offline'), isFetchNextPageError: nextPageFailed, refetch, fetchNextPage,
    };
    // Inspect the actual callback produced by HitList; the query hook is mocked above.
    const buttons: any[] = [];
    const visit = (node: ReactNode) => Children.forEach(node, child => {
      if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) return;
      if (child.props.children === 'Retry') buttons.push(child);
      visit(child.props.children);
    });
    visit(HitList({ watchId: 1 }));
    expect(buttons).toHaveLength(1);
    buttons[0].props.onClick();
    expect(nextPageFailed ? fetchNextPage : refetch).toHaveBeenCalledOnce();
    expect(nextPageFailed ? refetch : fetchNextPage).not.toHaveBeenCalled();
  });
  it('keeps refresh available for a successful empty history', () => {
    state.infinite.data = { pages: [{ hits: [], total: 0, nextCursor: null }] };
    const html = renderToStaticMarkup(createElement(HitList, { watchId: 1 }));
    expect(html).toContain('Refresh matches');
    expect(html).toContain('No permits have matched');
  });
  it('a failed watch list has a retry and no false empty state', () => {
    state.query.error = new Error('503: Unavailable');
    const html = renderToStaticMarkup(createElement(PermitAlertsPage));
    expect(html).toContain('Retry'); expect(html).not.toContain('No watches yet');
  });
  it('a failed hit list is not no matches', () => {
    state.infinite.error = new Error('offline');
    const html = renderToStaticMarkup(createElement(HitList, { watchId: 1 }));
    expect(html).toContain('Retry'); expect(html).not.toContain('No permits have matched');
  });
  it('offers older matches with an accurate retained count', () => {
    state.infinite = { data: { pages: [{ hits: [{ id: 7, permit: { permitNumber: 'ABC' }, matchedAt: new Date().toISOString() }], nextCursor: 7, total: 237 }] }, hasNextPage: true };
    const html = renderToStaticMarkup(createElement(HitList, { watchId: 1 }));
    expect(html).toContain('Showing 1 of 237'); expect(html).toContain('Load more matches');
  });
  it('prefills watch criteria and delivery without losing the existing jurisdiction', () => {
    const initial = { id: 1, kind: 'contractor', name: 'Roofing watch', params: { contractorName: 'Existing contractor', contractorLicense: 'ABC123' }, channels: { email: false, sms: true, smsTo: '+15555550123', telegram: true }, jurisdictions: [{ databaseId: 42, name: 'Source office', jurisdiction: 'Source jurisdiction', alertsSupported: true }] } as PermitWatchDto;
    const html = renderToStaticMarkup(createElement(WatchForm, { initial, busy: false, geocoder: false, onCancel() {}, async onSave() {} }));
    for (const text of ['Edit watch', 'Existing contractor', 'ABC123', '+15555550123', 'Source jurisdiction', 'existing history is kept', 'CRM texting allowance']) expect(html).toContain(text);
  });
});

it('directory failures offer Retry rather than no databases', () => {
  state.query.error = new Error('offline');
  const html = renderToStaticMarkup(createElement(DatabasesPage));
  expect(html).toContain('Could not load the permit directory');
  expect(html).not.toContain('No databases match');
});
it('empty history explains unavailable portal data', () => {
  state.infinite.data = { pages: [{ hits: [], total: 0, nextCursor: null }] };
  const html = renderToStaticMarkup(createElement(HitList, { watchId: 1, unavailable: true }));
  expect(html).toContain('Portal data is unavailable or has not been checked');
});
