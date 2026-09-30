import {test,expect} from '@playwright/test';
import pg from 'pg';
import bcrypt from 'bcryptjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
let user:number,location:number,email:string;
const password='Guard-audit-fixture-password';
test.beforeAll(async()=>{
  const url=new URL(process.env.DATABASE_URL!);
  if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(url.pathname)||!['localhost','127.0.0.1'].includes(url.hostname))throw Error('a2 only');
  email=`guard-auth-${Date.now()}@example.invalid`;
  user=(await pool.query('INSERT INTO users(email,password_hash,email_verified) VALUES($1,$2,true) RETURNING id',[email,await bcrypt.hash(password,4)])).rows[0].id;
  location=(await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name) VALUES($1,'Guard auth fixture','accounts/authfixture','locations/authfixture') RETURNING id",[user])).rows[0].id;
  await pool.query('INSERT INTO gbp_guard(user_id,location_id,snapshot,watched) VALUES($1,$2,$3,$4)',[user,location,JSON.stringify({title:'Guard auth fixture'}),['title']]);
});
test.afterAll(async()=>{
  await pool.query("DELETE FROM session WHERE sess->'passport'->>'user'=$1",[String(user)]);
  await pool.query('DELETE FROM business_locations WHERE user_id=$1',[user]);
  await pool.query('DELETE FROM users WHERE id=$1',[user]);
  await pool.end();
});
test('real Guard settings require shared step-up and retry the saved mode with bypass disabled',async({page,request})=>{
  expect((await request.get(`/api/gbp/locations/${location}/guard`)).status()).toBe(401);
  await page.goto('/auth');
  await page.getByTestId('input-login-email').fill(email);
  await page.getByTestId('input-login-password').fill(password);
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/login')),page.getByTestId('button-login').click()]);
  await pool.query("UPDATE session SET sess=(sess::jsonb-'recentAuth'-'profileGuardAuth')::json WHERE sess->'passport'->>'user'=$1",[String(user)]);
  await page.goto(`/locations?location=${location}`);
  await page.getByTestId('button-cookies-decline').click();
  await page.getByTestId('tab-guard').click();
  await page.getByLabel('Guard mode').selectOption('notify');
  await page.getByRole('button',{name:'Save guard settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Verify your identity',exact:true})).toBeVisible();
  expect((await pool.query('SELECT mode FROM gbp_guard WHERE location_id=$1',[location])).rows[0].mode).toBe('off');
  await page.getByLabel('Verification',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Verify and continue'}).click();
  await expect(page.getByText('Current mode: notify.',{exact:false})).toBeVisible();
  expect((await pool.query('SELECT mode FROM gbp_guard WHERE location_id=$1',[location])).rows[0].mode).toBe('notify');
});
