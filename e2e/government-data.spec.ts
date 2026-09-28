import { test, expect } from '@playwright/test';

test('property directory replaces null, dead and unverified links with honest search fallbacks', async ({ page }) => {
  await page.route('**/api/property-appraisers', route => route.fulfill({ json: [
    { id: 99101, name: 'Null test office', countyId: 1, portalUrl: null, searchUrl: null, isActive: false, linkStatus: 'none', county: { id: 1, name: 'Fixture', state: 'Washington', stateCode: 'WA' } },
    { id: 99102, name: 'Dead test office', countyId: 1, portalUrl: 'https://dead.invalid/', searchUrl: 'https://dead.invalid/', isActive: true, linkStatus: 'dead', county: { id: 1, name: 'Fixture', state: 'Washington', stateCode: 'WA' } },
    { id: 99103, name: 'Verified test office', countyId: 1, portalUrl: 'https://records.invalid/', searchUrl: 'https://records.invalid/', isActive: true, linkStatus: 'live', county: { id: 1, name: 'Fixture', state: 'Washington', stateCode: 'WA' } },
  ] }));
  await page.goto('/property');
  await expect(page.getByTestId('link-appraiser-fallback-99101')).toHaveAttribute('href', /google.com\/search/);
  await expect(page.getByTestId('link-appraiser-fallback-99102')).toBeVisible();
  await expect(page.getByTestId('button-visit-appraiser-99102')).toHaveCount(0);
  await expect(page.getByTestId('button-visit-appraiser-99103')).toHaveAttribute('href', 'https://records.invalid/');
});

test('permit directory hides a known dead URL even when the URL remains stored', async ({ page }) => {
  await page.route('**/api/databases?*', route => route.fulfill({ json: { total: 1, databases: [
    { id: 99201, name: 'Fixture permit office', jurisdiction: 'Fixture, WA', jurisdictionType: 'city', countyId: 1, portalUrl: 'https://dead.invalid/', searchUrl: 'https://dead.invalid/', isActive: true, linkStatus: 'dead' },
  ] } }));
  await page.goto('/databases');
  await expect(page.getByTestId('link-search-fallback-99201')).toBeVisible();
  await expect(page.getByTestId('link-portal-url-99201')).toHaveCount(0);
  await expect(page.getByTestId('link-search-url-99201')).toHaveCount(0);
  await expect(page.getByTestId('button-scrape-99201')).toHaveCount(0);
});

test('real lane directory APIs and pages load', async ({ page, request }) => {
  for (const path of ['/api/counties', '/api/databases/counts', '/api/databases?filtered=true&stateCode=WA&limit=25', '/api/property-appraisers']) {
    const res = await request.get(path); expect(res.ok()).toBeTruthy();
    expect(await res.json()).toBeTruthy();
  }
  for (const path of ['/property', '/databases', '/search']) {
    await page.goto(path);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
    await expect(page.locator('h1').first()).toBeVisible();
  }
});

test('property lookup APIs suppress dead links while retaining the office @serial', async ({ request }) => {
  const { q } = await import('./db');
  const [original] = await q('select id, county_id, link_status, is_active from property_appraisers where portal_url is not null limit 1');
  expect(original).toBeTruthy();
  try {
    await q("update property_appraisers set link_status='dead', is_active=false where id=$1", [original.id]);
    const county = await request.get(`/api/property-appraisers/county/${original.county_id}`);
    expect(county.ok()).toBeTruthy();
    const office = (await county.json()).find((r: any) => r.id === original.id);
    expect(office.portalUrl).toBeNull(); expect(office.searchUrl).toBeNull();
    const lookup = await request.post('/api/property-lookup', { data: { countyId: original.county_id, address: 'Unmatched audit fixture' } });
    expect(lookup.ok()).toBeTruthy();
    const result = await lookup.json();
    expect(result.lookupLinks.find((r: any) => r.name === office.name).portalUrl).toBeNull();
  } finally {
    await q('update property_appraisers set link_status=$1, is_active=$2 where id=$3', [original.link_status, original.is_active, original.id]);
  }
});


test('manual scrape rejects a stored but unverified portal @serial', async ({ request }) => {
  const { q } = await import('./db');
  const [original] = await q('select id, link_status, is_active from permit_databases where portal_url is not null limit 1');
  try {
    await q("update permit_databases set link_status='dead', is_active=true where id=$1",[original.id]);
    const response=await request.post('/api/scrape',{data:{databaseId:original.id,searchTerm:'Audit fixture',searchType:'address'}});
    expect(response.status()).toBe(400);
    expect((await response.json()).message).toContain('verified');
  } finally {
    await q('update permit_databases set link_status=$1,is_active=$2 where id=$3',[original.link_status,original.is_active,original.id]);
  }
});

test('permit API withholds legacy contacts without deleting their stored values',async({request})=>{
 const {q}=await import('./db');
 const [stored]=await q('select id,county_id,phone from permit_databases where phone is not null limit 1');
 expect(stored).toBeTruthy();
 const response=await request.get(`/api/databases/county/${stored.county_id}`);expect(response.ok()).toBeTruthy();
 const shown=(await response.json()).find((r:any)=>r.id===stored.id);
 expect(shown.phone).toBeNull();expect(shown.email).toBeNull();expect(shown.address).toBeNull();
 const [after]=await q('select phone from permit_databases where id=$1',[stored.id]);expect(after.phone).toBe(stored.phone);
});

test('unconfirmed source-listed office and permit links remain clickable and dated',async({page})=>{
 const common={id:99301,countyId:1,isActive:true,linkStatus:'unconfirmed',lastVerifiedAt:'2026-09-28T12:00:00Z',portalUrl:'https://source-listed.invalid/records',searchUrl:null};
 await page.route('**/api/property-appraisers',route=>route.fulfill({json:[{...common,name:'Source-listed assessment office',county:{id:1,name:'Fixture',state:'Washington',stateCode:'WA'}}]}));
 await page.goto('/property');
 await expect(page.getByTestId('button-visit-appraiser-99301')).toHaveAttribute('href',common.portalUrl);
 await expect(page.getByText('Official site · not auto-verified · Last checked 2026-09-28')).toBeVisible();
 await expect(page.getByTestId('link-appraiser-fallback-99301')).toHaveCount(0);
 await page.route('**/api/databases?*',route=>route.fulfill({json:{total:1,databases:[{...common,name:'Source-listed permit office',jurisdiction:'Fixture, WA',jurisdictionType:'city'}]}}));
 await page.goto('/databases');
 await expect(page.getByTestId('link-portal-url-99301')).toHaveAttribute('href',common.portalUrl);
 await expect(page.getByText('Official site · not auto-verified · Last checked 2026-09-28')).toBeVisible();
 await expect(page.getByTestId('link-search-fallback-99301')).toHaveCount(0);
});

test('unconfirmed link status and check date survive all property APIs @serial',async({request})=>{
 const {q}=await import('./db');
 const [original]=await q('select id,county_id,name,portal_url,link_status,is_active,last_verified_at from property_appraisers where portal_url is not null limit 1');
 try{
  await q("update property_appraisers set link_status='unconfirmed',is_active=true,last_verified_at='2026-09-28T12:00:00Z' where id=$1",[original.id]);
  for(const path of ['/api/property-appraisers',`/api/property-appraisers/county/${original.county_id}`]){
   const response=await request.get(path);expect(response.ok()).toBeTruthy();
   const row=(await response.json()).find((r:any)=>r.id===original.id);
   expect(row.portalUrl).toBe(original.portal_url);expect(row.linkStatus).toBe('unconfirmed');expect(row.lastVerifiedAt).toContain('2026-09-28');
  }
  const result=await request.post('/api/property-lookup',{data:{countyId:original.county_id,address:'No matching audit fixture'}});
  const row=(await result.json()).lookupLinks.find((r:any)=>r.name===original.name);
  expect(row.portalUrl).toBe(original.portal_url);expect(row.linkStatus).toBe('unconfirmed');expect(row.lastVerifiedAt).toContain('2026-09-28');
 }finally{await q('update property_appraisers set link_status=$1,is_active=$2,last_verified_at=$3 where id=$4',[original.link_status,original.is_active,original.last_verified_at,original.id]);}
});

test('seeded unconfirmed offices render real source links and check dates',async({request,page})=>{
 const offices=await (await request.get('/api/property-appraisers')).json();
 const office=offices.find((r:any)=>r.linkStatus==='unconfirmed'&&r.portalUrl&&r.lastVerifiedAt);
 test.skip(!office,'Run the round-2 data reconciliation before this real-data proof');
 await page.goto(`/property?countyId=${office.countyId}`);
 await expect(page.getByTestId(`button-visit-appraiser-${office.id}`)).toHaveAttribute('href',office.portalUrl);
 await expect(page.getByText(`Official site · not auto-verified · Last checked ${office.lastVerifiedAt.slice(0,10)}`).first()).toBeVisible();
});
