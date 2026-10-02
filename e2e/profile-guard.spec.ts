import {test,expect} from '@playwright/test';
const location={id:987,businessName:'Guard browser fixture',gbpAccountName:'accounts/fixture',gbpLocationName:'locations/fixture'};
async function common(page:any) {
  await page.route((u:URL)=>u.pathname==='/api/locations', (r:any)=>r.fulfill({json:[location]}));
  await page.route(`**/api/locations/${location.id}`, (r:any)=>r.fulfill({json:location}));
  await page.route('**/api/gbp/status', (r:any)=>r.fulfill({json:{connected:true,accounts:[{subject:'fixture',email:'fixture@example.invalid',connected:true}],locations:[]}}));
  await page.route('**/api/gbp/linkage', (r:any)=>r.fulfill({json:{accounts:[],errors:[],locations:[]}}));
  await page.route('**/api/gbp/guard/status', (r:any)=>r.fulfill({json:[{id:987,mode:'notify',pending:1}]}));
}
test('owner previews a snapshot, reauthenticates, changes guard mode, approves/rejects and reports',async({page})=>{
  await common(page);let verified=false,saved=false,mode='off',reported=false;
  const changes=[{id:11,field:'title',old_value:'Approved name',new_value:'Outside name',source:'Google update',status:'pending',detected_at:'2026-09-29T12:00:00Z'},
    {id:12,field:'websiteUri',old_value:'https://example.invalid',new_value:'https://other.invalid',source:'owner-edit-outside-ConstructHUB (inferred; actor unavailable)',status:'pending',detected_at:'2026-09-29T12:00:00Z'}];
  await page.route('**/api/auth/reauth',r=>{
    if(r.request().method()==='POST'){expect(r.request().postDataJSON().value).toBe('123456');verified=true;return r.fulfill({json:{ok:true}});}
    return r.fulfill({json:{method:'email'}});
  });
  await page.route('**/api/auth/reauth/email',r=>r.fulfill({json:{ok:true}}));
  await page.route('**/api/gbp/locations/987/guard**',r=>{
    const path=new URL(r.request().url()).pathname;
    if(path.endsWith('/preview'))return r.fulfill({json:{snapshot:{title:'Approved name',websiteUri:'https://example.invalid'},token:'fixture-preview'}});
    if(path.includes('/changes/')){const c=changes.find(c=>String(c.id)===path.split('/').at(-1))!;c.status=r.request().postDataJSON().action==='approve'?'approved':'reverted';return r.fulfill({json:{ok:true}});}
    if(r.request().method()==='PUT'){if(!verified)return r.fulfill({status:403,json:{reauth:true}});expect(verified).toBe(true);expect(r.request().postDataJSON().token).toBe('fixture-preview');saved=true;mode=r.request().postDataJSON().mode;return r.fulfill({json:{ok:true}});}
    return r.fulfill({json:{mode,watched:['title','websiteUri'],snapshot:saved?{title:'Approved name'}:null,changes:saved?changes:[]}});
  });
  await page.route('**/api/gbp/reports/changes/11',r=>{if(r.request().method()==='POST')reported=true;return r.fulfill({json:{text:'Business: Guard browser fixture\nApproved name → Outside name\nDetected: 2026-09-29',formUrl:'https://support.google.com/business/contact/business_redressal_form',listingUrl:'https://www.google.com/maps?cid=1',reportedAt:reported?'2026-09-29':null}})});
  await page.goto(`/locations?location=${location.id}`);await page.getByTestId('button-cookies-decline').click();await page.getByTestId('tab-guard').click();
  await page.getByLabel('Guard mode').selectOption('notify');await page.getByRole('button',{name:'Preview current Google values'}).click();await expect(page.getByText('Approved name',{exact:true})).toBeVisible();
  await expect(page.getByText('Google-only accounts need an authenticator or password configured in Settings.',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Approve snapshot and save settings'}).click();
  await expect(page.getByRole('dialog')).toContainText('Nothing is sent to anyone else');
  await page.getByRole('button',{name:'Email a verification code'}).click();
  await page.getByLabel('Verification',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'Verify and continue'}).click();await expect(page.getByText('Current mode: notify.',{exact:false})).toBeVisible();
  const first=page.locator('article').filter({hasText:'Outside name'});await first.getByRole('button',{name:'Approve',exact:true}).click();await expect(first).toContainText('approved');
  const second=page.locator('article').filter({hasText:'https://other.invalid'});await second.getByRole('button',{name:'Reject',exact:true}).click();await expect(second).toContainText('reverted');
  await first.getByRole('button',{name:'Report',exact:true}).click();await expect(page.getByText("Google receives this report only when you submit Google's form.",{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:"Open Google's official form"})).toHaveAttribute('href','https://support.google.com/business/contact/business_redressal_form');
  await page.getByRole('button',{name:'I submitted the form — mark reported'}).click();await expect(page.getByRole('button',{name:'Reported locally',exact:true})).toBeDisabled();expect(reported).toBe(true);
});
test('AI settings preserve low-rating approval, backfill requires preview and confirm, draft publishes and review report opens',async({page})=>{
  await common(page);let settings:any={mode:'off',scope:'future',tone:'Warm',signOff:'',maxLength:600,allowLowRatingAuto:false,starRules:{1:'',2:'',3:'',4:'',5:''}},confirmed=false,posted=false;
  await page.route('**/api/gbp/locations/987/ai-replies**',r=>{
    const path=new URL(r.request().url()).pathname;
    if(path.endsWith('/preview'))return r.fulfill({json:{token:'preview-token',reviews:[{id:7,reviewer_name:'Browser customer',rating:1,comment:'Review fixture',action:'draft for approval'}]}});
    if(path.endsWith('/confirm')){confirmed=true;return r.fulfill({json:{queued:1}});}
    if(r.request().method()==='PUT'){settings=r.request().postDataJSON();expect(settings.allowLowRatingAuto).toBe(false);return r.fulfill({json:{ok:true}});}
    return r.fulfill({json:{settings,drafts:confirmed&&!posted?[{id:7,reviewer_name:'Browser customer',rating:1,reply_draft:'Thank you for your feedback.',ai_status:'draft'}]:[]}});
  });
  await page.route('**/api/google-profile-reviews**',r=>{
    if(new URL(r.request().url()).pathname.endsWith('/reply')){expect(r.request().postDataJSON().action).toBe('publish');posted=true;return r.fulfill({json:{replyStatus:'posted'}});}
    return r.fulfill({json:{items:[{id:7,locationId:987,googleReviewId:'accounts/fixture/locations/fixture/reviews/7',reviewerName:'Browser customer',rating:1,comment:'Review fixture',reviewDate:'2026-09-29',replyComment:posted?'Thank you for your feedback.':null,replyStatus:posted?'posted':'draft'}],total:1,unanswered:posted?0:1,average:1,distribution:{1:1}}});
  });
  await page.route('**/api/gbp/reports/reviews/7',r=>r.fulfill({json:{text:'Review: Browser customer\nRating: 1\nReview fixture',formUrl:'https://support.google.com/business/workflow/9945796',reportedAt:null}}));
  await page.goto('/google-reviews');await page.getByTestId('button-cookies-decline').click();await page.getByTestId('tab-profile-reviews').click();await page.getByLabel('AI reply location').selectOption('987');await page.getByLabel('AI mode',{exact:true}).selectOption('auto');await page.getByLabel('Review scope').selectOption('existing');
  await page.getByRole('button',{name:'Save AI reply settings'}).click();await page.getByRole('button',{name:'Preview existing reviews'}).click();await expect(page.getByText(/Browser customer · 1 stars · Review fixture — draft for approval/)).toBeVisible();expect(confirmed).toBe(false);
  await page.getByRole('button',{name:'Confirm backfill'}).click();await expect(page.getByLabel('Draft for Browser customer')).toHaveValue('Thank you for your feedback.');await page.getByRole('button',{name:'Approve and publish to Google'}).click();await expect(page.getByText('Posted on Google:')).toBeVisible();
  await page.getByRole('button',{name:'Report review',exact:true}).click();await expect(page.getByRole('link',{name:"Open Google's official form"})).toHaveAttribute('href','https://support.google.com/business/workflow/9945796');
});

test('mobile Guard snapshot and history keep long URLs and report actions within the viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await common(page);
  const website='https://example.invalid/'+ 'long-path-segment'.repeat(30);
  await page.route('**/api/gbp/locations/987/guard',r=>r.fulfill({json:{mode:'notify',watched:['websiteUri'],snapshot:{websiteUri:website},changes:[{id:21,field:'websiteUri',old_value:website,new_value:website+'/changed',source:'Google update',status:'pending',detected_at:'2026-09-29T12:00:00Z'}]}}));
  await page.goto(`/locations?location=${location.id}`);
  await page.getByTestId('button-cookies-decline').click();
  await page.getByTestId('tab-guard').click();
  await page.getByText('Owner-approved snapshot',{exact:true}).click();
  const guard=page.getByRole('region',{name:'Profile Guard',exact:true});
  await expect(guard.getByRole('button',{name:'Report',exact:true})).toBeVisible();
  const overflow=await guard.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width+1);
  for(const name of ['Approve','Reject','Report']) {
    const box=await guard.getByRole('button',{name,exact:true}).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(390);
  }
});
