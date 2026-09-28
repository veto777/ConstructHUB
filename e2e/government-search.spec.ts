import { test, expect } from '@playwright/test';

test('search property lookup uses the result county instead of hardcoded Florida portals', async ({ page }) => {
  await page.route('**/api/search', route => route.fulfill({ json: { results: [
    { id: 99301, countyId: 99999, address: 'Fixture address', countyName: 'Fixture county', permitNumber: 'AUDIT-ONLY', status: 'Issued' },
  ], searchId: "audit-fixture" } }));
  await page.route('**/api/search/live/audit-fixture', route => route.fulfill({ status: 404, json: {} }));
  await page.goto('/search');
  await page.getByTestId('input-search-value').fill('Fixture address');
  await page.getByTestId('button-search').click();
  await expect(page.getByTestId('button-property-lookup-99301')).toHaveAttribute('href', '/property?countyId=99999');
});

test('property deep link filters by county ID', async ({ page }) => {
  await page.route('**/api/property-appraisers', route => route.fulfill({ json: [
    { id: 99401, name: 'Requested office', countyId: 11, portalUrl: null, searchUrl: null, isActive: false, linkStatus: 'none', county: { id: 11, name: 'Requested county', state: 'Washington', stateCode: 'WA' } },
    { id: 99402, name: 'Different office', countyId: 22, portalUrl: null, searchUrl: null, isActive: false, linkStatus: 'none', county: { id: 22, name: 'Different county', state: 'Washington', stateCode: 'WA' } },
  ] }));
  await page.goto('/property?countyId=11');
  await expect(page.getByText('Requested office', {exact:true})).toBeVisible();
  await expect(page.getByText('Different office', {exact:true})).toHaveCount(0);
});
