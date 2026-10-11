// Run against the sample-data development server: PORT=<lane port> node verify-r5.mjs.
// Optional VOICE_STORAGE_STATE points to an authenticated Playwright storage state.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const port = Number(process.env.PORT || 8125);
assert(port !== 5433 && port > 1024, 'Use the development HTTP lane port');
assert(process.env.NODE_ENV !== 'production', 'Development only');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState: process.env.VOICE_STORAGE_STATE || undefined });
  const page = await context.newPage();
  const out = new URL('./r5-screenshots/', import.meta.url).pathname;
  await mkdir(out, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/call-assistant?tab=calls`);
    await page.getByTestId('table-calls').waitFor();
    const rowCount = await page.locator('[data-testid^="button-open-call-"]').count();
    assert(rowCount > 0, 'Expected the authorized sample account calls');
    const stamp = await page.getByTestId('calls-log-updated-text').innerText();
    await page.screenshot({ path: `${out}calls-${width}.png`, fullPage: true });
    await page.locator('[data-testid^="button-open-call-"]').first().click();
    await page.getByTestId('sheet-call-detail').waitFor();
    await page.getByTestId('section-call-delivery').waitFor();
    await page.screenshot({ path: `${out}delivery-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.route('**/api/crm/voice/calls?*', route => route.fulfill({ status: 503, body: 'Refresh unavailable' }));
    await page.getByTestId('calls-log-updated-refresh').click();
    await page.getByRole('alert').filter({ hasText: 'Showing saved data' }).waitFor({ timeout: 45000 });
    assert.equal(await page.locator('[data-testid^="button-open-call-"]').count(), rowCount);
    assert.equal(await page.getByTestId('calls-log-updated-text').innerText(), stamp);
    await page.getByRole('button', { name: 'Retry', exact: true }).focus();
    assert(await page.getByRole('button', { name: 'Retry', exact: true }).evaluate(el => el === document.activeElement));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}saved-calls-${width}.png`, fullPage: true });
    await page.unroute('**/api/crm/voice/calls?*');
    await page.getByTestId('button-calls-view-escalations').click();
    await page.getByTestId('list-escalations').waitFor();
    const escalations = await page.locator('[data-testid^="row-escalation-"]').count();
    await page.route('**/api/crm/voice/escalations*', route => route.fulfill({ status: 503, body: 'Refresh unavailable' }));
    await page.getByTestId('escalations-updated-refresh').click();
    await page.getByRole('alert').filter({ hasText: 'Showing saved data' }).waitFor({ timeout: 45000 });
    assert.equal(await page.locator('[data-testid^="row-escalation-"]').count(), escalations);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}saved-escalations-${width}.png`, fullPage: true });
    await page.unroute('**/api/crm/voice/escalations*');
  }
} finally { await browser.close(); }
