/** Run with node server/master-class/browser-tests/run.mjs. No DB or external services. */
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = process.cwd();
const out = '/tmp/r4-course-screens';
await fs.mkdir(out, { recursive: true });
const server = await createServer({
  configFile: false, root, cacheDir: '/tmp/r4-course-vite',
  optimizeDeps: { entries: ['server/master-class/browser-tests/index.html'] },
  resolve: { alias: { '@': path.join(root, 'client/src'), '@shared': path.join(root, 'shared') } },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 8144, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('https://fonts.**', (route) => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = 'http://127.0.0.1:8144/server/master-class/browser-tests/index.html';
  const checkbox = (id) => page.getByTestId(`checkbox-${id}-done`);
  const outline = () => page.getByTestId('lesson-outline');
  await page.goto(url);
  await expect(checkbox('setup')).toBeVisible();
  await checkbox('setup').click();
  await expect(outline()).toContainText('1 of 8 done');
  await page.reload();
  await expect(checkbox('setup')).toBeChecked();
  await page.getByRole('button', { name: 'Learner B', exact: true }).click();
  await expect(checkbox('setup')).not.toBeChecked();
  await checkbox('reviews').click();
  await page.getByRole('button', { name: 'Learner A', exact: true }).click();
  await expect(checkbox('setup')).toBeChecked();
  await expect(checkbox('reviews')).not.toBeChecked();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(checkbox('setup')).not.toBeChecked();
  await expect(outline()).toContainText('Saved for this visit only');
  await expect(outline()).toContainText('0 of 8 done');
  await page.getByRole('button', { name: 'Learner A', exact: true }).click();
  await page.getByRole('button', { name: 'Fail account', exact: true }).click();
  await expect(outline()).toContainText('Account unavailable');
  await expect(outline()).not.toContainText('0 of 8');
  await page.getByRole('button', { name: 'Learner A', exact: true }).click();
  await page.getByRole('button', { name: 'Fail lessons', exact: true }).click();
  await expect(page.getByTestId('lessons-error')).toBeVisible();
  await page.getByRole('button', { name: 'Restore lessons', exact: true }).click();
  await page.getByTestId('button-lessons-retry').click();
  await expect(checkbox('setup')).toBeVisible();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'QuotaExceededError'); }; });
  await checkbox('photos').click();
  await expect(checkbox('photos')).toBeChecked();
  await expect(outline()).toContainText('2 of 8 done');
  await expect(outline()).toContainText('Saved for this visit only');
  await page.getByRole('button', { name: 'Remount', exact: true }).click();
  await page.getByRole('button', { name: 'Remount', exact: true }).click();
  await expect(checkbox('photos')).toBeChecked();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${out}/desktop-blocked.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${out}/phone-blocked.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId('button-lessons-reset').click();
  await expect(outline()).toContainText('0 of 8 done');
  await expect(checkbox('photos')).not.toBeChecked();
  await page.getByRole('button', { name: 'licensing', exact: true }).click();
  await expect(checkbox('subcontractors')).toBeVisible();
  await page.getByTestId('lesson-branding').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/phone-branding.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'vetting', exact: true }).click();
  const first = page.getByTestId('checkbox-vetting-checklist-item-1');
  await first.click();
  await expect(first).toBeChecked();
  await expect(page.getByTestId('checklist-vetting-checklist')).toContainText('1 of 14 done');
  await expect(page.getByTestId('checklist-vetting-checklist')).toContainText('Saved for this visit only');
  await page.getByTestId('button-vetting-checklist-reset').click();
  await expect(first).not.toBeChecked();
  await page.getByRole('button', { name: 'gmb', exact: true }).click();
  await page.getByTestId('link-lesson-reviews').click();
  await expect(page.getByTestId('lesson-reviews')).toBeInViewport();
  await page.reload();
  await expect(page.getByTestId('lesson-reviews')).toBeInViewport();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement; const style = getComputedStyle(el);
    return { visible: el.matches(':focus-visible'), shadow: style.boxShadow, outline: style.outlineStyle };
  });
  expect(focus.visible).toBe(true);
  expect(focus.shadow !== 'none' || focus.outline !== 'none').toBe(true);
  await page.screenshot({ path: `${out}/phone-keyboard.png` });
  const blocked = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  const fresh = await blocked.newPage();
  await fresh.goto(url);
  await fresh.getByTestId('checkbox-setup-done').click();
  await fresh.getByTestId('checkbox-info-done').click();
  await expect(fresh.getByTestId('lesson-outline')).toContainText('2 of 8 done');
  await fresh.getByTestId('checkbox-setup-done').click();
  await expect(fresh.getByTestId('lesson-outline')).toContainText('1 of 8 done');
  await fresh.getByRole('button', { name: 'Learner B', exact: true }).click();
  await expect(fresh.getByTestId('lesson-outline')).toContainText('0 of 8 done');
  await fresh.getByRole('button', { name: 'Learner A', exact: true }).click();
  await expect(fresh.getByTestId('checkbox-info-done')).toBeChecked();
  await fresh.getByTestId('version-stable').check();
  await fresh.getByTestId('version-retired').check();
  await expect(fresh.getByTestId('version-count')).toHaveText('2 of 2 done');
  await fresh.getByRole('button', { name: 'Revise content', exact: true }).click();
  await expect(fresh.getByTestId('version-count')).toHaveText('1 of 2 done');
  await expect(fresh.getByTestId('version-stable')).toBeChecked();
  await expect(fresh.getByTestId('version-new')).not.toBeChecked();
  await fresh.getByRole('button', { name: 'Late anchor', exact: true }).click();
  await expect(fresh.locator('#lesson-late-test')).toBeInViewport();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ result: 'passed', screenshots: out, cases: ['persistence', 'account switching', 'signed out', 'account error', 'lesson error/retry', 'write failure', 'remount', 'reset', 'phone width', 'truthful branding', 'inline checklist', 'cold anchor', 'keyboard focus', 'blocked storage getter', 'content-version change', 'late anchor'] }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
