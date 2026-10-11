// Fixture-only fallback when the recording database is unavailable.
// Start Vite on R6_BASE_URL, then run with tsx. No requests reach a database.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { PLANS } from '../shared/plans';

const base = process.env.R6_BASE_URL || 'http://127.0.0.1:8346';
const output = process.env.R6_OUTPUT || '/tmp/r6-propapi-screens';
await mkdir(output, { recursive: true });
const fixtures = await readFile(new URL('./account-billing-api.spec.ts', import.meta.url), 'utf8');
const fixture = (name: string) => Function(`return (${fixtures.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n`))![1]})`)();
const source = JSON.parse(await readFile(new URL('../server/data/appraisers.json', import.meta.url), 'utf8'));
const offices = source.filter((r: any) => r.stateCode === 'AK').slice(0, 5).map((r: any, i: number) => ({
  ...r, id: i + 1, countyId: i + 1, isActive: true, searchUrl: r.portalUrl,
  county: { id: i + 1, name: r.county, stateCode: r.stateCode, state: 'Alaska' },
}));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('PAGE ERROR', e.stack));
  await page.context().addCookies([{ name: 'ch_consent', value: 'denied', url: base }]);
  let createCalls = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let json: unknown = null;
    if (path === '/api/auth/me') json = { id: 1, displayName: 'Sam Rivera', email: 'sample@example.invalid', emailVerified: true };
    else if (path === '/api/entitlements') json = { plan: 'pro', accessPlan: 'pro', planName: PLANS.pro.name, modules: PLANS.pro.modules, allowances: PLANS.pro.limits, addons: {} };
    else if (path === '/api/property-appraisers') json = offices;
    else if (path === '/api/counties') json = offices.map((o: any) => o.county);
    else if (path === '/api/databases/counts') return route.fulfill({ status: 503, json: { message: 'Fixture: directory counts unavailable' } });
    else if (path === '/api/account/api-keys') {
      if (route.request().method() === 'POST') { createCalls++; return route.fulfill({ status: 403, json: { reauth: true, message: 'Verify identity' } }); }
      json = { keys: [fixture('KEY_A'), fixture('KEY_B')], plan: fixture('PRO_API') };
    } else if (path === '/api/auth/reauth') json = { method: 'password', google: false };
    else if (path === '/api/v1/openapi.json') json = fixture('OPENAPI');
    return route.fulfill({ json });
  });
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/settings/api`);
    const card = page.getByTestId('card-api-key-key_a1');
    await expect(card).toBeVisible({ timeout: 60000 });
    await card.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(page.getByTestId('table-api-keys')).toBeHidden();
    for (const label of ['Units used', 'Limit', 'Added', 'Last used', 'Expires']) await expect(card.getByText(label, { exact: true })).toBeInViewport();
    await page.screenshot({ path: `${output}/keys-before-${width}.png`, fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId('button-key-menu-m-key_a1').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('menu-key-revoke')).toBeVisible();
    await page.screenshot({ path: `${output}/keys-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    if (width === 1024) {
      await page.getByTestId('button-generate-key').click();
      await page.getByTestId('input-key-name').fill('Cancelled key');
      await page.getByTestId('button-generate-submit').click();
      await expect(page.getByRole('dialog', { name: 'Verify your identity' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Verify your identity' })).toBeHidden();
      await expect(page.getByTestId('text-key-generation-status')).toContainText('No API key was created');
      expect(createCalls).toBe(1);
      await page.screenshot({ path: `${output}/cancelled.png`, fullPage: true, animations: 'disabled' });
    }
    await page.goto(`${base}/property`);
    await expect(page.getByTestId('list-appraisers')).toBeVisible();
    await expect(page.getByText('Directory totals', { exact: true })).toHaveCount(0);
    expect(await page.getByTestId('list-appraisers').innerText()).not.toContain('County');
    await page.screenshot({ path: `${output}/property-${width}.png`, fullPage: true });
    await page.goto(`${base}/developers`);
    const input = page.getByTestId('input-developers-search');
    await expect(input).toBeVisible();
    await input.scrollIntoViewIfNeeded();
    await input.focus();
    expect(await input.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(36);
    await expect(page.getByTestId('text-developers-curl')).toContainText('https://constructhub.us/api/v1');
    await page.screenshot({ path: `${output}/developers-${width}.png`, fullPage: true });
  }
  console.log(`Fixture visual checks passed; screenshots: ${output}`);
} finally { await browser.close(); }
