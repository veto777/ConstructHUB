import { test, expect } from '@playwright/test';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { TOTP } from 'otpauth';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
let id:number,email:string;
const password='Security-fixture-password-27';
test.beforeAll(async()=>{
 const target=new URL(process.env.DATABASE_URL!);if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname)||!['127.0.0.1','localhost'].includes(target.hostname))throw new Error('a local development DB is required');
 email=`security-browser-${Date.now()}@example.invalid`;
 ({rows:[{id}]}=await pool.query('INSERT INTO users(email,password_hash,email_verified) VALUES($1,$2,true) RETURNING id',[email,await bcrypt.hash(password,4)]));
});
test.afterAll(async()=>{await pool.query('DELETE FROM session WHERE sess->\'passport\'->>\'user\'=$1',[String(id)]);await pool.query('DELETE FROM users WHERE id=$1',[id]);await pool.end();});
test('enrolls with QR, uses recovery sign-in, remembers/revokes device, and verifies sensitive actions',async({page})=>{
 await page.goto('/auth');
 await page.getByTestId('input-login-email').fill(email);await page.getByTestId('input-login-password').fill(password);await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/login')),page.getByTestId('button-login').click()]);
 await page.goto('/settings?tab=security');
 await page.getByTestId('button-enable-2fa').click();await expect(page.getByTestId('img-2fa-qr')).toBeVisible();
 const secret=(await page.getByTestId('text-2fa-secret').innerText()).trim();const totp=new TOTP({secret});
 await page.getByTestId('input-verify-2fa-code').fill(totp.generate());await page.getByTestId('button-verify-2fa').click();
 await expect(page.getByText('Save these recovery codes now.',{exact:false})).toBeVisible();
 const codes=(await page.locator('pre').innerText()).trim().split('\n');expect(codes).toHaveLength(10);
 await page.request.post('/api/auth/logout');await page.goto('/auth');
 await page.getByTestId('input-login-email').fill(email);await page.getByTestId('input-login-password').fill(password);await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/login')),page.getByTestId('button-login').click()]);
 await page.getByLabel('Authenticator or recovery code').fill(codes[0]);await page.getByLabel('Remember this device for 30 days').check();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/2fa/login')),page.getByRole('button',{name:'Verify sign-in'}).click()]);
 expect((await page.request.get('/api/gbp/connect?format=json')).status()).toBe(403);
 const otherBrowser=await page.context().browser()!.newContext();
 const firstFactor=await otherBrowser.request.post(`http://127.0.0.1:${process.env.E2E_PORT ?? '8129'}/api/auth/login`,{data:{email,password}});expect((await firstFactor.json()).requires2FA).toBe(true);
 expect((await otherBrowser.request.post(`http://127.0.0.1:${process.env.E2E_PORT ?? '8129'}/api/auth/2fa/login`,{data:{code:codes[0]}})).status()).toBe(401);
 expect((await otherBrowser.request.post(`http://127.0.0.1:${process.env.E2E_PORT ?? '8129'}/api/auth/2fa/login`,{data:{code:totp.generate()}})).status()).toBe(200);await otherBrowser.close();
 await page.goto('/settings?tab=security');await expect(page.getByRole('button',{name:'Revoke device'})).toBeVisible();
 // Expire only this fixture user's step-up verification; the modal must retry the original action.
 await pool.query(`UPDATE session SET sess=(sess::jsonb-'recentAuth')::json WHERE sess->'passport'->>'user'=$1`,[String(id)]);
 await page.getByRole('button',{name:'Generate new recovery codes'}).click();await expect(page.getByRole('heading',{name:'Verify your identity'})).toBeVisible();
 await page.getByLabel('Verification',{exact:true}).fill(totp.generate());await page.getByRole('button',{name:'Verify and continue'}).click();await expect(page.locator('pre')).toBeVisible();
 await page.getByRole('button',{name:'Revoke device'}).click();await expect(page.getByText('No remembered devices.')).toBeVisible();
 await expect(page.getByLabel('Activity type').getByRole('option', { name: 'security.device_revoked', exact: true })).toHaveCount(1);
 await page.getByLabel('Activity type').selectOption('security.device_revoked');
 await expect(page.locator('strong').filter({hasText:'security.device_revoked'})).toBeVisible();
 await page.getByLabel('Activity type').selectOption('');
 await page.getByTestId('button-settings-tab-notifications').click();const emailSwitch=page.getByRole('switch',{name:'A Google account was connected: Email',exact:true});await expect(emailSwitch).toBeDisabled();await expect(emailSwitch).toBeChecked();
 const inApp=page.getByRole('switch',{name:'A Google account was connected: In app',exact:true});await inApp.click();await expect(inApp).not.toBeChecked();await page.reload();await page.getByTestId('button-settings-tab-notifications').click();await expect(inApp).not.toBeChecked();
 await page.getByRole('button',{name:/Notifications \(/}).click();await expect(page.getByText('Two-factor sign-in was enabled',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Mark all read'}).click();await expect(page.getByRole('button',{name:'Notifications (0 unread)'})).toBeVisible();await page.keyboard.press('Escape');
 await page.goto('/settings?tab=security');await page.getByLabel('Activity type').selectOption('auth.login_success');await expect(page.getByText('IP:',{exact:false}).first()).toBeVisible();
 await page.getByTestId('button-disable-2fa').click();await page.getByTestId('input-disable-2fa-code').fill(totp.generate());await page.getByTestId('button-confirm-disable-2fa').click();await expect(page.getByTestId('button-enable-2fa')).toBeVisible();
});
test('Google security alert opens account remediation, step-up retries disconnect and connect',async({page})=>{
 await pool.query("INSERT INTO gbp_grants(user_id,google_subject,email,scopes) VALUES($1,'browser-fixture','google-fixture@example.invalid','{}')",[id]);
 await pool.query("INSERT INTO user_notifications(user_id,kind,title,body,link) VALUES($1,'google.connected','Google account connected','google-fixture@example.invalid','/settings?tab=security&google=browser-fixture')",[id]);
 await page.goto('/auth');await page.getByTestId('input-login-email').fill(email);await page.getByTestId('input-login-password').fill(password);
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/login')),page.getByTestId('button-login').click()]);await page.goto('/settings');
 await page.getByRole('button',{name:/Notifications \(/}).click();await page.getByRole('link',{name:'Google account connected',exact:true}).click();await expect(page.getByText("Wasn't you?",{exact:true})).toBeVisible();
 await pool.query(`UPDATE session SET sess=(sess::jsonb-'recentAuth')::json WHERE sess->'passport'->>'user'=$1`,[String(id)]);
 await page.getByRole('button',{name:'Disconnect account and secure sign-in'}).click();await expect(page.getByRole('heading',{name:'Verify your identity'})).toBeVisible();await page.getByLabel('Verification',{exact:true}).fill(password);await page.getByRole('button',{name:'Verify and continue'}).click();
 await expect(page.getByText('Account disconnected. Reset your ConstructHUB password below.',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'Reset password',exact:true})).toHaveAttribute('href','/auth?mode=forgot-password');
 const {rows:[alert]}=await pool.query("SELECT body FROM user_notifications WHERE user_id=$1 AND kind='google.disconnected'",[id]);expect(alert.body).toContain('google-fixture@example.invalid');expect(alert.body).toContain('IP:');expect(alert.body).toContain('Device:');
 await page.getByRole('link',{name:'Reset password',exact:true}).click();await expect(page.getByTestId('input-forgot-email')).toBeVisible();
 await pool.query(`UPDATE session SET sess=(sess::jsonb-'recentAuth')::json WHERE sess->'passport'->>'user'=$1`,[String(id)]);
 await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Mock Google consent</h1>'}));
 await page.goto('/locations');await page.getByRole('link',{name:'Connect Google Business Profile',exact:true}).click();await expect(page.getByRole('heading',{name:'Verify your identity'})).toBeVisible();await page.getByLabel('Verification',{exact:true}).fill(password);await page.getByRole('button',{name:'Verify and continue'}).click();await expect(page.getByRole('heading',{name:'Mock Google consent'})).toBeVisible();
});

test('mobile notification preferences expose every kind and the bell fits the viewport', async ({ page }) => {
 await page.setViewportSize({ width: 320, height: 740 });
 await page.goto('/auth');
 await page.getByTestId('input-login-email').fill(email);
 await page.getByTestId('input-login-password').fill(password);
 await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/auth/login')), page.getByTestId('button-login').click()]);
 await page.goto('/settings?tab=notifications');
 for (const label of ['A Google post or photo failed', 'Site Scan completed', 'Site Scan score dropped or new critical issue']) {
  const toggle = page.getByRole('switch', { name: `${label}: In app`, exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click(); await expect(toggle).not.toBeChecked();
 }
 await page.reload();
 await expect(page.getByRole('switch', { name: 'Site Scan completed: In app', exact: true })).not.toBeChecked();
 await page.getByRole('button', { name: /Notifications \(/ }).click();
 const panel = page.locator('[data-radix-popper-content-wrapper]');
 await expect(panel).toBeVisible();
 const box = await panel.boundingBox();
 expect(box!.x).toBeGreaterThanOrEqual(0);
 expect(box!.x + box!.width).toBeLessThanOrEqual(320);
 await expect(page.getByRole('button', { name: 'Mark all read' })).toBeVisible();
});
