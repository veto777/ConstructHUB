import { beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ entitled: false, teamEntitled: true, queries: [] as any[] }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (opts: any) => { state.queries.push(opts); return { data: opts.queryKey[0] === '/api/agency/me' ? { owner: 1, actor: 1, role: 'owner', entitled: state.entitled, teamEntitled: state.teamEntitled, workspaces: [] } : undefined, refetch: vi.fn() }; } }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn(), apiErrorMessage: vi.fn(), queryClient: {} }));
vi.mock('@/hooks/use-url-param', () => ({ useUrlParam: () => [null, vi.fn()] }));
vi.mock('@/components/google', () => ({ GoogleSurface: ({ children }: any) => children }));
vi.mock('@/components/app-ui', () => ({ AppPage: ({ children }: any) => children, PageHeader: ({ title }: any) => title, AppTabsList: ({ children }: any) => children, Section: ({ children }: any) => children }));
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({ children }: any) => children, TabsTrigger: ({ children }: any) => children }));
vi.mock('@/components/agency-workspace', () => ({ AgencyWorkspace: () => 'Agency locations', Pager: () => null, selectClass: '', useAgencyFilter: vi.fn() }));
vi.mock('@/components/plan-required', () => ({ PlanRequired: () => 'Agency plan required' }));
import AgencyPage from '@/pages/agency';
beforeEach(() => { state.entitled = false; state.teamEntitled = true; state.queries = []; });
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
