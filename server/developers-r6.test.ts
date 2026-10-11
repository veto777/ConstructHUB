import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SITE_ORIGIN } from '../shared/seo';

vi.mock('@tanstack/react-query', async original => ({
  ...await original<any>(),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === '/api/v1/openapi.json' ? {
      paths: { '/api/v1/account': { get: { summary: 'Read account', responses: { '200': { description: 'Account' } } } } },
    } : null,
    isLoading: false,
  }),
}));
import DevelopersPage from '../client/src/pages/developers';

beforeEach(() => {
  vi.stubGlobal('navigator', { userAgent: '' });
  vi.stubGlobal('location', { pathname: '/developers', search: '' });
});

it.each(['http://localhost:8346', 'https://preview.example.invalid'])('uses the canonical public API origin when viewed on %s', origin => {
  vi.stubGlobal('window', { location: { origin, hostname: new URL(origin).hostname, pathname: '/developers', search: '', hash: '' } });
  const html = renderToStaticMarkup(createElement(DevelopersPage));
  expect(html).toContain(`${SITE_ORIGIN}/api/v1/openapi.json`);
  expect(html).toContain(`${SITE_ORIGIN}/api/v1/account`);
  expect(html).not.toContain(`${origin}/api/v1`);
});
