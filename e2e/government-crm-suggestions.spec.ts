import {test,expect} from '@playwright/test';
import {q} from './db';

test('CRM permit suggestions cannot cross state boundaries for same-name cities @serial',async({request})=>{
 const me=await (await request.get('/api/crm/me')).json();
 const [customer]=await q('select id from crm_customers where org_id=$1 limit 1',[me.org.id]);
 expect(customer).toBeTruthy();
 const [oregon]=await q("select id from permit_databases where jurisdiction='Portland, OR' and link_status in ('live','verified') and is_active=true limit 1");
 expect(oregon,'The audited official Portland.gov permit page must be seeded for this regression').toBeTruthy();
 const [project]=await q("insert into crm_projects(org_id,customer_id,name,city,state) values($1,$2,'Government audit fixture','Portland','ME') returning id",[me.org.id,customer.id]);
 try{
  const res=await request.get(`/api/crm/projects/${project.id}/permits/suggest`);
  expect(res.ok()).toBeTruthy();const body=await res.json();
  expect(body.portals.some((p:any)=>p.id===oregon.id)).toBe(false);
  for(const portal of body.portals)expect(portal.jurisdiction).toMatch(/, ME$/);
  await q("update crm_projects set state='Maine' where id=$1",[project.id]);
  const full=await (await request.get(`/api/crm/projects/${project.id}/permits/suggest`)).json();
  expect(full.portals.map((p:any)=>p.id)).toEqual(body.portals.map((p:any)=>p.id));
  await q("update crm_projects set state=null where id=$1",[project.id]);
  const missing=await (await request.get(`/api/crm/projects/${project.id}/permits/suggest`)).json();
  expect(missing.portals).toEqual([]);expect(missing.message).toContain('state');
 }finally{await q('delete from crm_projects where id=$1',[project.id]);}
});

test('CRM includes an unconfirmed permit with its check date and UI notice @serial',async({request,page})=>{
 const me=await (await request.get('/api/crm/me')).json();
 const [customer]=await q('select id from crm_customers where org_id=$1 limit 1',[me.org.id]);
 const [portal]=await q("select p.id,p.link_status,p.is_active,p.last_verified_at from permit_databases p join counties c on c.id=p.county_id where p.jurisdiction='Portland, OR' and c.state_code='OR' and p.portal_url is not null limit 1");
 const [project]=await q("insert into crm_projects(org_id,customer_id,name,city,state) values($1,$2,'Government tier fixture','Portland','OR') returning id",[me.org.id,customer.id]);
 try{
  await q("update permit_databases set link_status='unconfirmed',is_active=true,last_verified_at='2026-09-28T12:00:00Z' where id=$1",[portal.id]);
  const result=await request.get(`/api/crm/projects/${project.id}/permits/suggest`);expect(result.ok()).toBeTruthy();
  const shown=(await result.json()).portals.find((p:any)=>p.id===portal.id);
  expect(shown.linkStatus).toBe('unconfirmed');expect(shown.lastVerifiedAt).toContain('2026-09-28');
  await page.goto(`/crm/projects/${project.id}?portal=1`);
  await page.getByRole('tab',{name:/permit/i}).click();
  await expect(page.getByText('Official site · not auto-verified · Last checked 2026-09-28')).toBeVisible();
 }finally{
  await q('update permit_databases set link_status=$1,is_active=$2,last_verified_at=$3 where id=$4',[portal.link_status,portal.is_active,portal.last_verified_at,portal.id]);
  await q('delete from crm_projects where id=$1',[project.id]);
 }
});
