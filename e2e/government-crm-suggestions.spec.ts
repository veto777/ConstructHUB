import {test,expect} from '@playwright/test';
import {q} from './db';

test('CRM permit suggestions cannot cross state boundaries for same-name cities @serial',async({request})=>{
 const me=await (await request.get('/api/crm/me')).json();
 const [customer]=await q('select id from crm_customers where org_id=$1 limit 1',[me.org.id]);
 expect(customer).toBeTruthy();
 const [oregon]=await q("select id from permit_databases where jurisdiction='Portland, OR' and link_status='live' and is_active=true limit 1");
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
