import { test, expect } from '@playwright/test';
import { pool } from '../server/db';
import { encryptToken } from '../server/gbp/token-crypto';
import { runAdsWorker } from '../server/ads/worker';
import { STATE_QUERIES, emptyState, normalize, appliedDocument, type State } from '../server/ads/protections';
import type { AdsApi } from '../server/ads/client';
let seeded=false,domain:number;
const cid='4100000001',manager='9876543210';
const states=new Map<string,State>();
const links=new Map<string,string>();
function stateFor(id:string) {if(!states.has(id)){const s=emptyState();s.campaign=[normalize('campaign',{id:'10',resourceName:`customers/${id}/campaigns/10`,name:'Browser fixture search',status:'ENABLED',advertisingChannelType:'SEARCH',geoTargetTypeSetting:{positiveGeoTargetType:'PRESENCE_OR_INTEREST'}})];states.set(id,s);}return states.get(id)!;}
const api:AdsApi={search:async(id,q)=>{
  for(const [key,query]of Object.entries(STATE_QUERIES))if(q===query)return {results:stateFor(id)[key as keyof State].map(r=>({[key]:r}))};
  if(q.includes('FROM customer_client_link'))return {results:[...links].map(([id,status])=>({customerClientLink:{clientCustomer:`customers/${id}`,status,resourceName:`customers/${manager}/customerClientLinks/${id}~42`}}))};
  return {results:[]};
},mutate:async(id,operations,validateOnly)=>{
  if(validateOnly)return {};
  const result={mutateOperationResponses:operations.map((o:any,i:number)=>{const key=Object.keys(o)[0],op=o[key],type=key.replace(/Operation$/,'');return {[`${type}Result`]:{resourceName:op.update?.resourceName||op.remove||`customers/${id}/${({campaignCriterion:'campaignCriteria',customerNegativeCriterion:'customerNegativeCriteria',sharedSet:'sharedSets',sharedCriterion:'sharedCriteria',campaignSharedSet:'campaignSharedSets'} as any)[type]}/${100+i}`}};})};
  states.set(id,appliedDocument({before:stateFor(id),operations,inverseTemplates:[],summary:[],warnings:[]},result).after);return result;
},link:async(_manager,op,validate)=>{if(validate)return {};const id=op.create?.clientCustomer.split('/')[1]||op.update.resourceName.split('/')[3].split('~')[0];links.set(id,op.create?'PENDING':'CANCELED');return {result:{resourceName:`customers/${manager}/customerClientLinks/${id}~42`}};}};
const tick=()=>runAdsWorker({make:async()=>api,onlyUser:1});
test.beforeAll(async()=>{
  const u=new URL(process.env.DATABASE_URL!);if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(u.pathname)||!['localhost','127.0.0.1'].includes(u.hostname))throw new Error('Lane a3 only');process.env.EMAIL_FORCE_SINK='1';
  if((await pool.query('SELECT 1 FROM ads_grants WHERE user_id=1')).rowCount)throw new Error('Browser fixture requires a disconnected Ads user 1');
  await pool.query('INSERT INTO ads_grants(user_id,manager_id,refresh_token,verified) VALUES(1,$1,$2,true)',[manager,encryptToken('browser-fixture-not-a-real-token')]);
  seeded=true;
  domain=(await pool.query("INSERT INTO tracked_domains(user_id,domain,tracking_id) VALUES(1,'ads-browser.example.invalid',gen_random_uuid()) RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO blocked_ips(domain_id,ip_address) VALUES($1,'203.0.113.77')",[domain]);
  await pool.query("INSERT INTO ads_accounts(user_id,customer_id,name,status,lsa) SELECT 1,(4100000000+i)::text,'Browser agency fixture '||i,'ENABLED',(i%2=0) FROM generate_series(1,1000) i");
  await pool.query("INSERT INTO business_locations(user_id,business_name) SELECT 1,'Ads browser scale fixture '||i FROM generate_series(1,1000) i");
});
test.afterAll(async()=>{
  if(!seeded){await pool.end();return;}
  await pool.query("DELETE FROM ads_jobs WHERE user_id=1 AND (customer_id LIKE '4100%' OR kind='poll')");
  await pool.query("DELETE FROM ads_plans WHERE user_id=1 AND customer_id LIKE '4100%'");
  await pool.query("DELETE FROM ads_invitations WHERE user_id=1 AND customer_id LIKE '4100%'");
  await pool.query("DELETE FROM ads_accounts WHERE user_id=1 AND customer_id LIKE '4100%'");
  await pool.query("DELETE FROM ads_findings WHERE user_id=1 AND customer_id LIKE '4100%'");
  await pool.query("DELETE FROM ads_ip_age WHERE user_id=1 AND customer_id LIKE '4100%'");
  await pool.query('DELETE FROM ads_grants WHERE user_id=1');
  await pool.query('DELETE FROM blocked_ips WHERE domain_id=$1',[domain]);await pool.query('DELETE FROM tracked_domains WHERE id=$1',[domain]);
  await pool.query("DELETE FROM business_locations WHERE user_id=1 AND business_name LIKE 'Ads browser scale fixture %'");await pool.end();
});
async function post(page:any,name:string,path:string){const response=page.waitForResponse((r:any)=>r.url().endsWith('/api/ads'+path)&&r.request().method()==='POST');await page.getByRole('button',{name,exact:true}).click();expect((await response).status()).toBe(202);}
async function open(page:any){await page.goto('/ads-manager');const cookies=page.getByTestId('button-cookies-decline');if(await cookies.isVisible())await cookies.click();await expect(page.getByRole('heading',{name:'Agency Ads & LSA manager'})).toBeVisible();}
test('1000 client pagination, server search/filter and bulk queue',async({page})=>{
  await open(page);await expect(page.getByText('Page 1 · 1000 results')).toBeVisible();await expect(page.getByTestId('ads-row')).toHaveCount(25);
  await page.getByRole('button',{name:'Next',exact:true}).first().click();await expect(page.getByText('Page 2 · 1000 results')).toBeVisible();
  await page.getByLabel('LSA filter',{exact:true}).selectOption('true');await expect(page.getByText('Page 1 · 500 results')).toBeVisible();
  await page.getByLabel('Search accounts or records').fill('Browser agency fixture 1000');await expect(page.getByTestId('ads-row')).toHaveCount(1);
  await page.getByRole('button',{name:'Select this page'}).click();await post(page,'Queue health audit','/bulk');await expect(page.getByRole('status').filter({hasText:'Queued 1'})).toBeVisible();
  await tick();
  await page.getByRole('button',{name:'Health audit',exact:true}).click();await expect(page.getByText('No enabled conversion actions found')).toBeVisible();await expect(page.getByRole('link',{name:'Review in Google Ads'}).first()).toBeVisible();
});
test('real preview, confirmation and worker apply/reversal with mocked Google',async({page})=>{
  await open(page);await page.getByLabel('Search accounts or records').fill(cid);await expect(page.getByTestId('ads-row')).toHaveCount(1);await page.getByRole('button',{name:'Select this page'}).click();
  await post(page,'Queue protection previews','/bulk');await expect(page.getByRole('status').filter({hasText:'Queued 1'})).toBeVisible();await tick();
  await page.getByRole('button',{name:'Protection previews',exact:true}).click();await page.getByRole('button',{name:'Review preview',exact:true}).click();await expect(page.getByText('Browser fixture search: PRESENCE_OR_INTEREST → PRESENCE')).toBeVisible();await page.getByRole('button',{name:'Select this preview for bulk confirmation'}).click();
  await expect(page.getByRole('button',{name:'Confirm selected previews'})).toBeDisabled();await page.getByLabel('I reviewed the selected previews and authorize these Google Ads changes.').check();await post(page,'Confirm selected previews','/plans/confirm');await tick();await tick();
  await page.reload();await page.getByRole('button',{name:'Protection previews',exact:true}).click();await expect(page.getByTestId('ads-row').first()).toContainText('applied');await page.getByRole('button',{name:'Select this page'}).click();await post(page,'Preview reversal of selected applied changes','/plans/undo-preview');await tick();
  await page.getByLabel('Status filter').selectOption('preview');await expect(page.getByTestId('ads-row')).toHaveCount(1);await page.getByRole('button',{name:'Select this page'}).click();await page.getByLabel('I reviewed the selected previews and authorize these Google Ads changes.').check();await post(page,'Confirm selected previews','/plans/confirm');await tick();await tick();expect(stateFor(cid).campaign[0].geoTargetTypeSetting.positiveGeoTargetType).toBe('PRESENCE_OR_INTEREST');
});
test('bulk access invitation preview, local email sink, polling and cancellation',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Access invitations',exact:true}).click();await page.getByLabel('Client invitation list').fill('4100999999,client@example.invalid');await page.getByRole('button',{name:'Preview invitations'}).click();await expect(page.getByLabel('Invitation preview')).toContainText('Access and security');await post(page,'Confirm invitations and emails','/invitations');await tick();await tick();
  await page.reload();await page.getByRole('button',{name:'Access invitations',exact:true}).click();await expect(page.getByTestId('ads-row').first()).toContainText('Email: sent');
  await post(page,'Poll invitations','/sync');await tick();
  await page.getByRole('button',{name:'Select this page'}).click();page.once('dialog',d=>d.accept());await post(page,'Cancel selected pending invitations','/invitations/cancel');await tick();
  await page.reload();await page.getByRole('button',{name:'Access invitations',exact:true}).click();await expect(page.getByTestId('ads-row').first()).toContainText('cancelled');
});

test('editable negatives, account placements, schedules and mapped Click Guard IPs all require previews',async({page})=>{
  await open(page);
  await page.getByLabel('Client domain mappings').fill(`${cid},${domain}`);
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/ads/domain-mappings')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save domain mappings'}).click();expect((await saved).status()).toBe(200);
  for(const kind of ['negative','placement','schedule','ip']) {
    await page.getByRole('button',{name:'Client accounts',exact:true}).click();await page.getByLabel('Search accounts or records').fill(cid);await expect(page.getByTestId('ads-row')).toHaveCount(1);await page.getByRole('button',{name:'Select this page'}).click();
    await page.getByLabel('Protection',{exact:true}).selectOption(kind);
    if(kind==='negative')await page.getByLabel('Negative keywords').fill('careers\njobs');
    if(kind==='placement')await page.getByLabel('Excluded placements').fill('example.invalid');
    await post(page,'Queue protection previews','/bulk');await tick();
    await page.getByRole('button',{name:'Protection previews',exact:true}).click();await page.getByLabel('Status filter').selectOption('preview');await expect(page.getByTestId('ads-row')).toHaveCount(1);
    await page.getByRole('button',{name:'Review preview',exact:true}).click();await expect(page.getByRole('dialog')).toContainText(kind==='ip'?'203.0.113.77':kind==='placement'?'example.invalid':kind==='negative'?'careers':'MONDAY');await page.getByRole('button',{name:'Select this preview for bulk confirmation'}).click();
    await page.getByLabel('I reviewed the selected previews and authorize these Google Ads changes.').check();await post(page,'Confirm selected previews','/plans/confirm');await tick();await tick();
    const latest=(await pool.query('SELECT status FROM ads_plans WHERE user_id=1 AND customer_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1',[cid,kind])).rows[0];expect(latest.status).toBe('applied');
  }
});
