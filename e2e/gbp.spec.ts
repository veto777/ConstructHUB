import {test,expect} from '@playwright/test';
test('real disconnected API and connection controls never expose credentials',async({page,request})=>{
  const response=await request.get('/api/gbp/status');expect(response.status()).toBe(200);const status=await response.json();expect(status.connected).toBe(false);expect(JSON.stringify(status)).not.toMatch(/access_token|refresh_token/);
  await page.goto('/locations');await expect(page.getByText('Google Business Profile not connected.',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'Connect Google Business Profile'})).toHaveAttribute('href','/api/gbp/connect');await expect(page.getByText('Seed Demo Data')).toHaveCount(0);
});
test('connection, sync errors, draft versus confirmed reply and deletion',async({page})=>{
  let connected=false, posted=false, draft='',lastError='';let syncs=0;
  await page.route('**/api/gbp/status',r=>r.fulfill({json:{connected,reconnectRequired:false,email:connected?'fixture@example.invalid':null,locations:[{id:987,name:'Fixture business',kind:'reviews',last_success:syncs?'2026-09-28T12:00:00Z':null,last_error:lastError}]}}));
  await page.route((u:URL)=>u.pathname==='/api/locations',r=>r.fulfill({json:[{id:987,businessName:'Fixture business',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture'}]}));await page.route('**/api/locations/987',r=>r.fulfill({json:{id:987,businessName:'Fixture business',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture'}}));
  await page.route('**/api/google-profile-reviews**',async r=>{
    const url=new URL(r.request().url());
    if(url.pathname.endsWith('/reply')){
      if(r.request().method()==='DELETE'){posted=false;return r.fulfill({json:{replyStatus:'draft'}})}
      const body=r.request().postDataJSON();draft=body.replyComment;
      if(body.action==='publish'){posted=true;draft='';}
      return r.fulfill({json:{replyStatus:posted?'posted':'draft'}});
    }
    return r.fulfill({json:{items:[{id:456,locationId:987,googleReviewId:'accounts/fixture/locations/fixture/reviews/review1',reviewerName:'Fixture Customer',rating:5,comment:'Fixture review',reviewDate:'2026-09-01T00:00:00Z',replyComment:posted?'Thank you':null,replyStatus:posted?'posted':'draft',replyDraft:draft}],total:1,unanswered:posted?0:1,average:5,distribution:{5:1}}});
  });
  await page.route('**/api/gbp/locations/987/sync',r=>{syncs++;lastError=syncs===1?'Enable Google My Business API in Google Cloud':'';return r.fulfill({json:lastError?{reviews:{kind:'disabled',message:lastError}}:{reviews:{count:1}}})});
  await page.goto('/google-reviews');await page.getByTestId('button-cookies-decline').click();await page.getByRole('tab',{name:/Profile Reviews/i}).click();
  await expect(page.getByText('Never synced',{exact:false})).toBeVisible();
  await page.getByTestId('button-reply-456').click();await page.getByTestId('input-reply-456').fill('Thank you');await page.getByRole('button',{name:'Save draft in ConstructHUB'}).click();await expect(page.getByText('Draft saved in ConstructHUB: Thank you')).toBeVisible();await expect(page.getByText('Posted on Google:')).toHaveCount(0);
  connected=true;await page.reload();await page.getByRole('tab',{name:/Profile Reviews/i}).click();await expect(page.getByTestId('gbp-account').filter({hasText:'fixture@example.invalid'})).toContainText('Connected');
  await page.getByRole('button',{name:'Sync now'}).click();await expect(page.getByText('Enable Google My Business API in Google Cloud',{exact:false}).first()).toBeVisible();
  await page.getByTestId('button-reply-456').click();await page.getByRole('button',{name:'Publish reply to Google'}).click();await expect(page.getByText('Posted on Google:')).toBeVisible();await page.getByTestId('button-delete-reply-456').click();await expect(page.getByText('Posted on Google:')).toHaveCount(0);
});
test('performance renders unavailable separately from zero',async({page})=>{
  await page.route((u:URL)=>u.pathname==='/api/locations',r=>r.fulfill({json:[{id:987,businessName:'Fixture business',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture'}]}));await page.route('**/api/locations/987',r=>r.fulfill({json:{id:987,businessName:'Fixture business',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture'}}));
  await page.route('**/api/gbp/locations/987/performance*',r=>r.fulfill({json:{available:true,source:'Google',metrics:['CALL_CLICKS','WEBSITE_CLICKS'],rows:[{date:'2026-09-25',metric:'CALL_CLICKS',value:'0',last_day:'2026-09-25'}],pendingAfter:'2026-09-28'}}));
  await page.goto('/locations?location=987');await expect(page.getByTestId('row-performance-total')).toContainText('Total');await expect(page.getByRole('cell',{name:'0',exact:true}).first()).toBeVisible();await expect(page.getByRole('cell',{name:'—',exact:true}).first()).toBeVisible();
});

test('photo counts show a dash until a Google sync has actually reported them (audit 2026-10-04)',async({page})=>{
  const loc={id:987,businessName:'Fixture business',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture',businessPhotoCount:0,customerPhotoCount:0};
  await page.route((u:URL)=>u.pathname==='/api/locations',r=>r.fulfill({json:[loc]}));
  await page.route('**/api/locations/987',r=>r.fulfill({json:loc}));
  await page.route('**/api/gbp/locations/987/media*',r=>r.fulfill({json:{total:0,syncedAt:null,items:[]}}));
  await page.route('**/api/gbp/status*',r=>r.fulfill({json:{connected:false,reconnectRequired:false,email:null,scopes:[],expiresAt:null,accounts:[],locations:[{id:987,name:'Fixture business',account_email:null,kind:'profile',last_success:null,last_attempt:null,last_error:null}]}}));
  await page.goto('/locations?location=987&tab=photos');
  await expect(page.getByTestId('text-business-photo-count')).toHaveText('—');
  await expect(page.getByTestId('text-customer-photo-count')).toHaveText('—');
  await expect(page.getByText('Link to Google Business Profile to see photo counts')).toHaveCount(0);
});
test('photo counts show the stored number once a sync has succeeded (audit 2026-10-04)',async({page})=>{
  const loc={id:987,businessName:'Fixture business',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture',businessPhotoCount:7,customerPhotoCount:2};
  await page.route((u:URL)=>u.pathname==='/api/locations',r=>r.fulfill({json:[loc]}));
  await page.route('**/api/locations/987',r=>r.fulfill({json:loc}));
  await page.route('**/api/gbp/locations/987/media*',r=>r.fulfill({json:{total:7,syncedAt:'2026-10-01T12:00:00Z',items:[]}}));
  await page.route('**/api/gbp/status*',r=>r.fulfill({json:{connected:true,reconnectRequired:false,email:'fixture@example.invalid',scopes:[],expiresAt:null,accounts:[],locations:[{id:987,name:'Fixture business',account_email:'fixture@example.invalid',kind:'profile',last_success:'2026-10-01T12:00:00Z',last_attempt:'2026-10-01T12:00:00Z',last_error:null}]}}));
  await page.goto('/locations?location=987&tab=photos');
  await expect(page.getByTestId('text-business-photo-count')).toHaveText('7');
  await expect(page.getByTestId('text-customer-photo-count')).toHaveText('2');
});
test('photos empty state includes the connect step before Sync now (audit 2026-10-04)',async({page})=>{
  const loc={id:987,businessName:'Fixture business',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture',businessPhotoCount:0,customerPhotoCount:0};
  await page.route((u:URL)=>u.pathname==='/api/locations',r=>r.fulfill({json:[loc]}));
  await page.route('**/api/locations/987',r=>r.fulfill({json:loc}));
  await page.route('**/api/gbp/locations/987/media*',r=>r.fulfill({json:{total:0,syncedAt:null,items:[]}}));
  await page.route('**/api/gbp/status*',r=>r.fulfill({json:{connected:false,reconnectRequired:false,email:null,scopes:[],expiresAt:null,accounts:[],locations:[{id:987,name:'Fixture business',account_email:null,kind:'profile',last_success:null,last_attempt:null,last_error:null}]}}));
  await page.goto('/locations?location=987&tab=photos');
  await expect(page.getByText('connect your Google account if prompted',{exact:false})).toBeVisible();
});
test('insights empty state does not tell a linked owner to link again (audit 2026-10-04)',async({page})=>{
  const loc={id:987,businessName:'Fixture business',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture'};
  await page.route((u:URL)=>u.pathname==='/api/locations',r=>r.fulfill({json:[loc]}));
  await page.route('**/api/locations/987',r=>r.fulfill({json:loc}));
  await page.route('**/api/gbp/locations/987/performance*',r=>r.fulfill({json:{available:false,metrics:[],rows:[],firstDate:null,lastDate:null,pendingAfter:'2026-10-01'}}));
  await page.goto('/locations?location=987&tab=insights');
  await expect(page.getByText('No performance data yet.',{exact:false})).toBeVisible();
  await expect(page.getByText('Link this location to Google',{exact:false})).toHaveCount(0);
});
test('insights empty state still points an unlinked owner at linking (audit 2026-10-04)',async({page})=>{
  const loc={id:987,businessName:'Fixture business'};
  await page.route((u:URL)=>u.pathname==='/api/locations',r=>r.fulfill({json:[loc]}));
  await page.route('**/api/locations/987',r=>r.fulfill({json:loc}));
  await page.route('**/api/gbp/locations/987/performance*',r=>r.fulfill({json:{available:false,metrics:[],rows:[],firstDate:null,lastDate:null,pendingAfter:'2026-10-01'}}));
  await page.goto('/locations?location=987&tab=insights');
  await expect(page.getByText('Performance unavailable. Link this location to Google and sync to retrieve real metrics.')).toBeVisible();
});
