import {test,expect} from '@playwright/test';
import {q} from './db';
let client:number,member:number;const prefix='Agency browser fixture';
test.beforeAll(async()=>{
  if(!/^constructhub_dev(?:_[a-z0-9]+)?$/.test(process.env.E2E_DB||''))throw Error('Lane a1 only');
  client=(await q("INSERT INTO agency_clients(user_id,name,contact_email) VALUES(1,$1,'browser@example.invalid') RETURNING id",[prefix]))[0].id;
  member=(await q("INSERT INTO users(email) VALUES('agency-browser-'||gen_random_uuid()||'@example.invalid') RETURNING id"))[0].id;
  await q("INSERT INTO business_locations(user_id,agency_client_id,business_name,address) SELECT 1,$1,$2||' '||lpad(n::text,4,'0'),'Browser test address '||n FROM generate_series(1,1000) n",[client,prefix]);
});
test.afterAll(async()=>{
  await q('DELETE FROM business_locations WHERE agency_client_id=$1',[client]);
  await q("DELETE FROM agency_clients WHERE user_id=1 AND (id=$1 OR name='Browser client edited' OR name='Browser client created')",[client]);
  await q('DELETE FROM users WHERE id=$1',[member]);
});
test('1,000 locations: server search, pagination, select all matching, queued bulk action, CSV and drill-down',async({page})=>{
  await page.goto('/agency');await expect(page.getByRole('heading',{name:'Agency workspace'})).toBeVisible();
  await page.getByLabel('Global location search').fill(prefix);
  await expect(page.getByText('1–50 of 1000',{exact:true})).toBeVisible();
  await expect(page.locator('[data-testid^="agency-location-"]')).toHaveCount(50);
  await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.getByText('51–100 of 1000',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Select all matching (1000)'}).click();
  await page.getByLabel('Bulk action').selectOption('assign');await page.getByLabel('Assign to client').selectOption(String(client));
  await page.getByRole('button',{name:'Queue selected action'}).click();await expect(page.getByRole('status').filter({hasText:'1000 location actions queued'})).toBeVisible();
  expect((await q("SELECT count(*)::int n FROM agency_jobs j JOIN business_locations l ON l.id=j.location_id WHERE l.agency_client_id=$1 AND j.action='assign'",[client]))[0].n).toBe(1000);
  const csv=await page.request.get(`/api/agency/export?clientId=${client}`);expect(csv.status()).toBe(200);expect((await csv.text()).split('\r\n')).toHaveLength(1002);
  await page.getByLabel('Global location search').fill(prefix+' 0999');await expect(page.locator('[data-testid^="agency-location-"]')).toHaveCount(1);
  await page.getByRole('button',{name:prefix+' 0999',exact:true}).click();await expect(page.getByTestId('text-detail-name')).toHaveText(prefix+' 0999');
});
test('client metadata and scoped team membership are editable in the browser',async({page})=>{
  await page.goto('/agency');await page.getByRole('button',{name:'Clients',exact:true}).click();
  await page.getByLabel('Client name').fill('Browser client created');await page.getByLabel('Contact email').fill('new-client@example.invalid');await page.getByLabel('Client folder').fill('West');await page.getByLabel('Client tags').fill('roofing, active');await page.getByLabel('Client notes').fill('Browser fixture notes');await page.getByRole('button',{name:'Create client',exact:true}).click();
  await expect(page.getByRole('button',{name:'Edit Browser client created'})).toBeVisible();await page.getByRole('button',{name:'Edit Browser client created'}).click();await page.getByLabel('Client name').fill('Browser client edited');await page.getByRole('button',{name:'Save client',exact:true}).click();await expect(page.getByRole('button',{name:'Edit Browser client edited'})).toBeVisible();
  await page.getByRole('button',{name:'Team',exact:true}).click();const email=(await q('SELECT email FROM users WHERE id=$1',[member]))[0].email;
  await page.getByLabel('Member email').fill(email);await page.getByLabel('Member role').selectOption('viewer');await page.getByLabel('Member client IDs').fill(String(client));await page.getByRole('button',{name:'Save member',exact:true}).click();await expect(page.getByText(email+' · viewer · '+client,{exact:false})).toBeVisible();
  expect((await q('SELECT role,all_clients FROM agency_members WHERE user_id=1 AND member_id=$1',[member]))[0]).toEqual({role:'viewer',all_clients:false});
});
test('client onboarding queues instructions to the connected agency email and opens a capability link without OAuth',async({page})=>{
  await q("INSERT INTO gbp_grants(user_id,google_subject,email,scopes,expires_at) VALUES(1,'agency-browser-fixture','manager@example.invalid',ARRAY['https://www.googleapis.com/auth/business.manage'],now()+interval '1 hour') ON CONFLICT DO NOTHING");
  try{
    await page.goto('/agency');await page.getByRole('button',{name:'Onboarding',exact:true}).click();
    await page.getByLabel('Onboarding client').selectOption(String(client));await page.getByLabel('Agency Google account').selectOption('agency-browser-fixture');
    await page.getByLabel('Onboarding business name').fill('Onboarding browser fixture');await page.getByLabel('Onboarding Place ID').fill('browser-fixture-place');
    await page.getByRole('button',{name:'Email manager instructions'}).click();await expect(page.getByText('Email queued · browser@example.invalid → manager@example.invalid')).toBeVisible();
    const link=await page.getByLabel('Copyable onboarding link').first().inputValue();const target=new URL(link);
    const r=await page.request.get(target.pathname);expect(r.status()).toBe(200);expect(await r.text()).toContain('manager@example.invalid');expect(await r.text()).toContain('Choose Manager');
    expect((await q("SELECT status,opened_at FROM agency_onboarding WHERE user_id=1 AND subject='agency-browser-fixture'"))[0]).toMatchObject({status:'opened',opened_at:expect.any(Date)});
  }finally{await q("DELETE FROM agency_onboarding WHERE user_id=1 AND subject='agency-browser-fixture'");await q("DELETE FROM gbp_grants WHERE user_id=1 AND google_subject='agency-browser-fixture'");}
});
