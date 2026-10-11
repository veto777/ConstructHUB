// Isolated browser regression: explicitly mocked APIs, never a real publish or DB write.
// Run with Vite on 8199: npx tsx e2e/r9-social.visual.ts
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { autoSchema, destinationSchema } from '../shared/social';
import { libraryMedia } from '../server/social/library-media';
const seed = fs.readFileSync('script/feature-shots/seed/20-reviews.sql', 'utf8');
const photos = libraryMedia([...seed.matchAll(/\(9200[1-4],1,[^\n]*?'(data:image\/jpeg;base64,[A-Za-z0-9+/=]+)'/g)].map((m, i) => ({ id: 92001+i, name: `Sample roof photo ${i+1}`, url: m[1] })));
const destination = destinationSchema.parse({ accountId: 'fb', platform: 'facebook', pageId: 'denver' });
const accounts = [{ id: 'fb', name: 'Summit Roofing Co.', platform: 'facebook', pages: [{ id: 'denver', name: 'Summit Roofing Co. (Denver)' }] }];
const settings = autoSchema.parse({ destinations: [destination] });
const old = Array.from({length:25}, (_,i) => ({ id: `old-${i}`, state:'draft', due_at:'2030-01-01T12:00:00Z', business_name:'Summit Roofing Co.', payload:{post:{content:{platform:'facebook',text:`Older draft ${i}`,mediaUrls:[]}}} }));
const browser = await chromium.launch({ headless:true });
try {
const page = await browser.newPage({ viewport: {width:1440,height:1000} });
const pageErrors: string[] = [];
page.on('pageerror', e => pageErrors.push(e.message));
let uploaded = false;
await page.route('https://upload.example.com/**', async route => { uploaded = !!route.request().postDataBuffer()?.length; await route.fulfill({status:200}); });
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (!path.startsWith('/api/')) return route.continue();
  let json: any = [];
  if(path === '/api/auth/me') json = { id:1, name:'Sam Rivera', businessName:'Summit Roofing Co.', email:'sam@example.test', emailVerified:true };
  else if(path === '/api/hub/presets') json={presets:[],primary:[],welcome:[],tier:'browse',chat:false,maxChars:1000};
  else if(path === '/api/notifications') json={notifications:[],unread:0};
  else if(path === '/api/entitlements') json={plan:'pro',modules:{socialPublishing:true}};
  else if(path === '/api/social/businesses') json={items:[{id:1,business_name:'Summit Roofing Co.'}],total:1};
  else if(path === '/api/social') json={connected:true,accounts,settings,defaults:[destination],posts:old,total:26,business:{business_name:'Summit Roofing Co.'}};
  else if(path === '/api/social/accounts') json={items:accounts};
  else if(path === '/api/social/media') json=photos;
  else if(path === '/api/social/uploads') json={presignedUrl:'https://upload.example.com/bytes',publicUrl:'https://upload.example.com/photo.jpg'};
  else if(path === '/api/social/posts') {
    const body=route.request().postDataJSON();
    json={posts:[{id:'accepted',state:body.draft?'draft':'queued',due_at:body.scheduledTime||new Date().toISOString(),business_name:'Summit Roofing Co.',payload:{post:{content:{platform:'facebook',text:body.text,mediaUrls:body.mediaUrls}}}}]};
  }
  else if(path === '/api/social/youtube/status') json={configured:false,connected:false,limits:{fileTypes:[]}};
  await route.fulfill({json});
});
await page.goto('http://127.0.0.1:8199/social-media?business=1');
await page.getByRole('button',{name:'Decline',exact:true}).click();
await page.getByLabel('Post text',{exact:true}).fill('x'.repeat(38));
await expect(page.getByText('facebook text tweak · 38 characters',{exact:true})).toBeVisible();
await expect(page.getByLabel('Summit Roofing Co. · facebook',{exact:true})).toHaveCount(1);
await expect(page.getByLabel('Map: Summit Roofing Co. · facebook',{exact:true})).toHaveCount(1);
await expect(page.getByLabel('Media Library',{exact:true}).locator('option')).toHaveCount(5);
await page.getByLabel('Media Library',{exact:true}).selectOption(photos[0].url);
await expect(page.getByLabel('Public media URLs',{exact:true})).toHaveValue('https://upload.example.com/photo.jpg');
expect(uploaded).toBe(true);
await page.screenshot({path:'/tmp/r9-compose-desktop.png',fullPage:true});
await page.getByLabel('Media Library',{exact:true}).scrollIntoViewIfNeeded();
await page.screenshot({path:'/tmp/r9-library-desktop.png'});
await page.getByRole('button',{name:'Auto mode',exact:true}).click();
await expect(page.getByText('Saved destinations:',{exact:false})).toContainText('Summit Roofing Co. (Denver) · Facebook');
await page.screenshot({path:'/tmp/r9-auto-desktop.png',fullPage:true});
await page.getByRole('button',{name:'Compose',exact:true}).click();
await page.setViewportSize({width:390,height:844});
await page.getByText('Map accounts and pages to this business',{exact:true}).click();
const mapping = page.getByLabel('Map: Summit Roofing Co. · facebook',{exact:true});
await page.keyboard.press("Tab");
await mapping.focus();
await expect(mapping).toBeFocused();
expect(await mapping.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
await page.screenshot({path:'/tmp/r9-mapping-phone.png'});
await page.getByText('Map accounts and pages to this business',{exact:true}).click();
await page.getByRole('button',{name:'Save draft',exact:true}).click();
await expect(page.getByTestId('list-social-posts').getByRole('textbox').first()).toHaveValue('x'.repeat(38));
expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
await page.getByTestId('list-social-posts').locator('article').first().scrollIntoViewIfNeeded();
await page.screenshot({path:'/tmp/r9-queue-phone.png'});
await page.getByRole('button',{name:'Compose',exact:true}).click();
await page.getByLabel('Post text',{exact:true}).fill('Scheduled newest post');
await page.getByLabel('Schedule time',{exact:true}).fill('2031-01-02T12:00');
await page.getByRole('button',{name:'Schedule post',exact:true}).click();
await expect(page.getByTestId('list-social-posts').getByText('Scheduled newest post',{exact:true})).toBeVisible();
await expect(page.getByTestId('list-social-posts').locator('article').first()).toContainText('Scheduled newest post');
expect(pageErrors).toEqual([]);
console.log('PASS: labels, 38-character counter, four actual seed photos, upload attachment, saved draft first on full page, scheduled post, phone width.');
} finally { await browser.close(); }
