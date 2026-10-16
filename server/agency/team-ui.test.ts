import { beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ entitled: false, teamEntitled: true, queries: [] as any[], path: '/agency', listEmpty: false }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (opts: any) => { state.queries.push(opts); return { data: opts.queryKey[0] === '/api/agency/me' ? { owner: 1, actor: 1, role: 'owner', allClients: true, entitled: state.entitled, teamEntitled: state.teamEntitled, workspaces: [] } : opts.queryKey[0] === '/api/agency' && state.listEmpty ? { items: [], total: 0 } : undefined, refetch: vi.fn() }; } }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn(), apiErrorMessage: vi.fn(), queryClient: {} }));
vi.mock('@/hooks/use-url-param', () => ({ useUrlParam: () => [null, vi.fn()] }));
vi.mock('@/components/google', () => ({ GoogleSurface: ({ children }: any) => children, GoogleStat: ({ label, value }: any) => `${label}: ${value}`, GoogleStatGrid: ({ children }: any) => children, GoogleList: ({ children }: any) => children, GoogleListRow: ({ title, meta }: any) => `${title} ${Array.isArray(meta) ? meta.join(' ') : ''}`, GooglePill: ({ label }: any) => label, relativeTime: () => 'just now' }));
vi.mock('@/components/sample-preview', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/components/sample-preview')>()), SamplePreview: ({ children, what }: any) => React.createElement('section', { 'data-sample': 'true' }, `Sample data: ${what}`, children) }));
vi.mock('@/components/app-ui', () => ({ AppPage: ({ children }: any) => children, PageHeader: ({ title, helpKey }: any) => `${title} [help:${helpKey}]`, AppTabsList: ({ children }: any) => children, Section: ({ children }: any) => children }));
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({ children }: any) => children, TabsTrigger: ({ children }: any) => children }));
vi.mock('@/components/agency-workspace', () => ({ AgencyWorkspace: () => 'Agency locations', Pager: () => null, selectClass: '', useAgencyFilter: vi.fn() }));
vi.mock('@/components/plan-required', () => ({ PlanRequired: () => 'Agency plan required' }));
import AgencyPage from '@/pages/agency';
beforeEach(() => { state.entitled = false; state.teamEntitled = true; state.queries = []; state.path = '/agency'; state.listEmpty = false; });
it('renders team management for Team/Pro and never fetches client-workspace tools', () => {
  const html = renderToStaticMarkup(React.createElement(AgencyPage));
  expect(html).toContain('Save member');
  expect(html).not.toContain('Agency plan required');
  expect(html).not.toContain('Member client IDs');
  expect(state.queries.find(q => q.queryKey[1] === 'team')?.enabled).toBe(true);
  for (const prefix of ['/api/agency/google', '/api/agency/clients']) {
    expect(state.queries.find(q => q.queryKey[0].startsWith(prefix))?.enabled).toBe(false);
  }
});
it('retains the Agency client-workspace view', () => {
  state.entitled = true;
  expect(renderToStaticMarkup(React.createElement(AgencyPage))).toContain('Agency locations');
});
// The owner's program (2026-10-15): the "i" follows the open tab, and an empty list shows a clearly marked sample.
vi.mock('wouter', () => ({ useLocation: () => [state.path, vi.fn()] }));
it('mounts the section help entry of the open tab and a sample while the list is empty', async () => {
  const { helpEntry } = await import('@shared/help/registry');
  state.entitled = true;
  for (const [tab, key] of [['', 'agency'], ['clients', 'agency.clients'], ['team', 'agency.team'], ['onboarding', 'agency.onboarding'], ['jobs', 'agency.jobs'], ['settings', 'agency.settings']] as const) {
    state.path = tab ? `/agency/${tab}` : '/agency';
    const html = renderToStaticMarkup(React.createElement(AgencyPage));
    expect(html, tab).toContain(`[help:${key}]`);
    expect(helpEntry(key), `${key} is a help entry`).toBeTruthy();
    if (tab === 'settings') expect(html).toContain('How this works');
  }
  // An empty list (the mocked list query answers an empty page) shows the sample, badged as such, and never a real row.
  state.listEmpty = true;
  for (const tab of ['clients', 'team', 'onboarding', 'jobs']) {
    state.path = `/agency/${tab}`;
    const html = renderToStaticMarkup(React.createElement(AgencyPage));
    expect(html, tab).toContain('Sample data:');
    expect(html, tab).toContain('Sample Roofing Co.');
  }
});
