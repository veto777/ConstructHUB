import { test, expect } from '@playwright/test';

test('property directory replaces null, dead and unverified links with honest search fallbacks', async ({ page }) => {
  await page.route('**/api/property-appraisers', route => route.fulfill({ json: [
    { id: 99101, name: 'Null test office', countyId: 1, portalUrl: null, searchUrl: null, isActive: false, linkStatus: 'none', county: { id: 1, name: 'Fixture', state: 'Washington', stateCode: 'WA' } },
    { id: 99102, name: 'Dead test office', countyId: 1, portalUrl: 'https://dead.invalid/', searchUrl: 'https://dead.invalid/', isActive: true, linkStatus: 'dead', county: { id: 1, name: 'Fixture', state: 'Washington', stateCode: 'WA' } },
    { id: 99103, name: 'Verified test office', countyId: 1, portalUrl: 'https://records.invalid/', searchUrl: 'https://records.invalid/', isActive: true, linkStatus: 'live', county: { id: 1, name: 'Fixture', state: 'Washington', stateCode: 'WA' } },
  ] }));
  await page.goto('/property');
  await expect(page.getByTestId('link-appraiser-fallback-99101')).toHaveAttribute('href', /google.com\/search/);
  await expect(page.getByTestId('link-appraiser-fallback-99102')).toBeVisible();
  await expect(page.getByTestId('button-visit-appraiser-99102')).toHaveCount(0);
  await expect(page.getByTestId('button-visit-appraiser-99103')).toHaveAttribute('href', 'https://records.invalid/');
});

test('permit directory hides a known dead URL even when the URL remains stored', async ({ page }) => {
  await page.route('**/api/databases?*', route => route.fulfill({ json: { total: 1, databases: [
    { id: 99201, name: 'Fixture permit office', jurisdiction: 'Fixture, WA', jurisdictionType: 'city', countyId: 1, portalUrl: 'https://dead.invalid/', searchUrl: 'https://dead.invalid/', isActive: true, linkStatus: 'dead' },
  ] } }));
  await page.goto('/databases');
  await expect(page.getByTestId('link-search-fallback-99201')).toBeVisible();
  await expect(page.getByTestId('link-portal-url-99201')).toHaveCount(0);
  await expect(page.getByTestId('link-search-url-99201')).toHaveCount(0);
  await expect(page.getByTestId('button-scrape-99201')).toHaveCount(0);
});

test('real lane directory APIs and pages load', async ({ page, request }) => {
  for (const path of ['/api/counties', '/api/databases/counts', '/api/databases?filtered=true&stateCode=WA&limit=25', '/api/property-appraisers']) {
    const res = await request.get(path); expect(res.ok()).toBeTruthy();
    expect(await res.json()).toBeTruthy();
  }
  for (const path of ['/property', '/databases', '/search']) {
    await page.goto(path);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
    await expect(page.locator('h1').first()).toBeVisible();
  }
});
