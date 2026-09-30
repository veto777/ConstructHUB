import { test, expect } from '@playwright/test';
import pg from 'pg';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let location: number;
test.beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !['localhost', '127.0.0.1'].includes(target.hostname))
        throw new Error('a local development DB is required');
    location = (await db.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name) VALUES(1,'Content browser fixture','accounts/browser','locations/browser') RETURNING id")).rows[0].id;
});
test.afterAll(async () => { await db.query('DELETE FROM business_locations WHERE id=$1', [location]); await db.end(); });
test('real API: compose a cadence batch, schedule, reload and cancel', async ({ page }) => {
    await page.goto('/gbp-content');
    const decline = page.getByTestId('button-cookies-decline');
    if (await decline.isVisible())
        await decline.click();
    await page.getByLabel('Location', { exact: true }).selectOption(String(location));
    await expect(page.getByText('Publishing worker is disabled.', { exact: false })).toBeVisible();
    await page.getByLabel('Post draft').fill('Fixture update one — browser test');
    await page.getByRole('button', { name: 'Add post to draft batch' }).click();
    await page.getByLabel('Post draft').fill('Fixture update two — browser test');
    await page.getByRole('button', { name: 'Add post to draft batch' }).click();
    await page.getByLabel('First publish').fill('2027-01-04T09:00');
    await page.getByLabel('Cadence').selectOption('week');
    await page.getByLabel('Items per period').fill('2');
    await page.getByRole('button', { name: 'Approve & queue post' }).click();
    await expect(page.getByText('Approved content added to the queue.')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(2);
    await page.reload();
    await page.getByLabel('Location', { exact: true }).selectOption(String(location));
    await expect(page.locator('article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(page.locator('article').first()).toContainText('Fixture update one');
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await expect(page.locator('article').first()).toContainText('cancelled');
    const jobs = (await db.query('SELECT * FROM gbp_content_jobs WHERE location_id=$1 ORDER BY due_at', [location])).rows;
    expect(jobs).toHaveLength(2);
    expect(new Date(jobs[1].due_at).getTime() - new Date(jobs[0].due_at).getTime()).toBe(302400000);
});
test('mocked AI and uploads: bulk captions stay editable; style and photo approval', async ({ page }) => {
    const photos: any[] = [];
    let jobs: any[] = [];
    let queued: any;
    await page.route(`**/api/gbp/content/${location}**`, async (route) => {
        const path = new URL(route.request().url()).pathname, body = route.request().method() !== 'GET' && !path.endsWith('/upload') ? route.request().postDataJSON() : {};
        if (path.endsWith('/upload')) {
            const p = { id: photos.length + 1, name: `Fixture ${photos.length + 1}.jpg`, url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
            photos.push(p);
            return route.fulfill({ json: p });
        }
        if (path.endsWith('/photos'))
            return route.fulfill({ json: photos });
        if (path.endsWith('/draft'))
            return route.fulfill({ json: { draft: true, drafts: photos.map(p => ({ photoId: p.id, text: `AI draft ${p.id}` })) } });
        if (path.endsWith('/learn'))
            return route.fulfill({ json: { draft: true, postCount: 52, summary: 'Fixture learned tone and CTA patterns' } });
        if (path.endsWith('/style'))
            return route.fulfill({ json: body });
        if (path.endsWith('/queue')) {
            queued = body;
            jobs = body.items.map((p: any, i: number) => ({ id: i + 1, kind: 'photo', payload: { description: p.summary }, due_at: '2027-01-01T12:00:00Z', status: 'queued' }));
            return route.fulfill({ json: jobs });
        }
        return route.fulfill({ json: { jobs, style: null, workerEnabled: false } });
    });
    await page.goto('/gbp-content');
    await page.getByLabel('Location', { exact: true }).selectOption(String(location));
    await page.getByLabel('Upload photos', { exact: true }).setInputFiles([{ name: 'one.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fixture') }, { name: 'two.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fixture') }]);
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Generate caption drafts' }).click();
    await expect(page.getByLabel('Caption for Fixture 1.jpg')).toHaveValue('AI draft 1');
    await page.getByLabel('Caption for Fixture 1.jpg').fill('Owner edited caption');
    await expect(page.locator('article')).toHaveCount(0);
    await page.getByRole('button', { name: 'Learn from past updates' }).click();
    await expect(page.getByLabel('Style guidance', { exact: true })).toHaveValue('Fixture learned tone and CTA patterns');
    await page.getByLabel('Style guidance', { exact: true }).fill('Owner edited guidance');
    await page.getByRole('button', { name: 'Save style guidance' }).click();
    await page.getByRole('button', { name: 'Approve & queue photos' }).click();
    await expect(page.locator('article')).toHaveCount(2);
    expect(queued.items[0].summary).toBe('Owner edited caption');
    expect(queued.items[1].summary).toBe('AI draft 2');
    await expect(page.getByText('Google strips EXIF on upload;', { exact: false })).toBeVisible();
});
test('AI update is a draft until edited and approved, and provider failures can be retried', async ({page}) => {
    let jobs:any[]=[];let approved:any;
    await page.route(`**/api/gbp/content/${location}**`,async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path.endsWith('/photos'))return route.fulfill({json:[]});
        if(path.endsWith('/draft'))return route.fulfill({json:{draft:true,drafts:[{text:'Fixture generated update'}]}});
        if(path.endsWith('/queue')){approved=route.request().postDataJSON();jobs=[{id:123,kind:'post',payload:{summary:approved.items[0].summary},due_at:'2027-01-01T12:00:00Z',status:'failed',error:'Google denied permission'}];return route.fulfill({json:jobs});}
        if(path.endsWith('/jobs/123')){jobs[0].status='queued';jobs[0].error=null;return route.fulfill({json:jobs[0]});}
        return route.fulfill({json:{jobs,style:null,workerEnabled:false}});
    });
    await page.goto('/gbp-content');await page.getByLabel('Location',{exact:true}).selectOption(String(location));
    await page.getByRole('button',{name:'Generate post draft'}).click();await expect(page.getByLabel('Post draft')).toHaveValue('Fixture generated update');await expect(page.locator('article')).toHaveCount(0);
    await page.getByLabel('Post draft').fill('Owner edited update');await page.getByRole('button',{name:'Approve & queue post'}).click();await expect(page.locator('article')).toContainText('Google denied permission');expect(approved.items[0].summary).toBe('Owner edited update');
    await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.locator('article')).toContainText('queued');
});

test('linked profile without a public Place ID can import and surfaces partial sync warnings', async ({ page }) => {
    const fixture = { id: 99881, businessName: 'Profile audit fixture', gbpLocationName: 'locations/fixture', gbpAccountName: 'accounts/fixture', placeId: null };
    await page.route('**/api/locations', route => route.fulfill({ json: [fixture] }));
    await page.route('**/api/gbp/linkage', route => route.fulfill({ json: { accounts: [], locations: [], errors: [] } }));
    await page.route('**/api/locations/99881/import-google', route => route.fulfill({ json: { ...fixture, syncWarnings: ['Social profiles: Google denied permission.'] } }));
    await page.goto('/locations');
    await page.getByText('Profile audit fixture', { exact: true }).click();
    await page.getByTestId('tab-info').click();
    await page.getByTestId('button-import-google').click();
    await expect(page.getByText('Google data partially imported', { exact: true })).toBeVisible();
    await expect(page.getByText('Social profiles: Google denied permission.', { exact: true })).toBeVisible();
});

test('Link & sync reports a partial Google failure instead of claiming every field synced', async ({ page }) => {
    const fixture = { id: 99882, businessName: 'Link audit fixture', placeId: 'fixture-place' };
    await page.route('**/api/locations', route => route.fulfill({ json: [fixture] }));
    await page.route('**/api/gbp/linkage', route => route.fulfill({ json: { accounts: [], errors: [], locations: [{ id: fixture.id, state: 'available', listing: { accountResource: 'accounts/fixture', gbpName: 'locations/fixture', grantSubject: 'fixture' } }] } }));
    await page.route('**/api/gbp/import', route => route.fulfill({ json: { imported: 1, synced: { [fixture.id]: { profile: { warnings: ['Social profiles unavailable'] }, reviews: { kind: 'permission', message: 'Google denied reviews access' } } } } }));
    await page.goto('/locations');
    await page.getByTestId('button-link-gbp-99882').click();
    await expect(page.getByText('Some Google data could not sync: Social profiles unavailable; Google denied reviews access', { exact: true })).toBeVisible();
});

test('mobile composer and profile fields fit a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto('/gbp-content');
    await page.getByLabel('Location', { exact: true }).selectOption(String(location));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const fixture = { id: 99883, businessName: 'Mobile audit fixture', gbpLocationName: 'locations/fixture', description: 'Profile description', services: ['Roof repair'], socialProfiles: {facebook:'https://facebook.com/fixture'}, businessPhotoCount: 12, customerPhotoCount: 4 };
    await page.route('**/api/locations', route => route.fulfill({ json: [fixture] }));
    await page.goto('/locations');
    await page.getByText('Mobile audit fixture', { exact: true }).click();
    for (const tab of ['info', 'services', 'social', 'photos']) {
        await page.getByTestId(`tab-${tab}`).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tab).toBe(true);
    }
});

test('partial upload exposes saved photos immediately and allows retrying the remaining file', async ({ page }) => {
    const photos: any[] = [];
    let uploads = 0;
    await page.route(`**/api/gbp/content/${location}**`, route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/upload')) {
            uploads++;
            if (uploads === 2) return route.fulfill({ status: 400, json: {message:'Fixture upload failure'} });
            const photo = {id:uploads,name:`Saved ${uploads}.jpg`,url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'};
            photos.push(photo); return route.fulfill({json:photo});
        }
        return route.fulfill({json:path.endsWith('/photos')?photos:{jobs:[],style:null,workerEnabled:false}});
    });
    await page.goto('/gbp-content');
    await page.getByLabel('Location', {exact:true}).selectOption(String(location));
    const files = ['one.jpg','two.jpg'].map(name => ({name,mimeType:'image/jpeg',buffer:Buffer.from('fixture')}));
    await page.getByLabel('Upload photos', {exact:true}).setInputFiles(files);
    await expect(page.getByText('Fixture upload failure',{exact:true})).toBeVisible();
    await expect(page.getByLabel('Caption for Saved 1.jpg')).toBeVisible();
    await expect(page.getByText('1 of 2 photos uploaded.',{exact:false})).toBeVisible();
    await page.getByLabel('Upload photos', {exact:true}).setInputFiles([files[1]]);
    await expect(page.getByLabel('Caption for Saved 3.jpg')).toBeVisible();
    await expect(page.getByText('2 selected',{exact:true})).toBeVisible();
});

test('100-file boundary uploads sequentially and refuses 101 before any request', async ({ page }) => {
    let uploads = 0;
    const photos: any[] = [];
    await page.route(`**/api/gbp/content/${location}**`, async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/upload')) {
            uploads++;
            const photo = {id:uploads,name:`Boundary fixture ${uploads}.jpg`,url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'};
            photos.push(photo);
            return route.fulfill({json:photo});
        }
        return route.fulfill({json:path.endsWith('/photos')?photos:{jobs:[],style:null,workerEnabled:false}});
    });
    await page.goto('/gbp-content');
    await page.getByLabel('Location', {exact:true}).selectOption(String(location));
    const files = Array.from({length:101}, (_,i)=>({name:`fixture-${i}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from('fixture')}));
    await page.getByLabel('Upload photos', {exact:true}).setInputFiles(files);
    await expect(page.getByRole('alert')).toContainText('Choose at most 100 photos');
    expect(uploads).toBe(0);
    await page.getByLabel('Upload photos', {exact:true}).setInputFiles(files.slice(0,100));
    await expect(page.getByText('100 selected',{exact:true})).toBeVisible();
    await expect(page.getByText('100 photos uploaded. Review captions before publishing.',{exact:true})).toBeVisible();
    expect(uploads).toBe(100);
});

test('profile Photos tab points to the shipped publisher and shows unknown counts for an unlinked location', async ({ page }) => {
    // Photo counts come only from a Business Profile sync; unlinked, the stored 0 (or an old capped Places 10) is not a count.
    await page.route('**/api/locations/99884', route => route.fulfill({json:{id:99884,businessName:'Photos audit fixture',gbpLocationName:null,businessPhotoCount:10,customerPhotoCount:0}}));
    await page.goto('/locations?location=99884&tab=photos');
    await expect(page.getByTestId('text-business-photo-count')).toHaveText('—');
    await expect(page.getByTestId('text-customer-photo-count')).toHaveText('—');
    await expect(page.getByText('Link to Google Business Profile to see photo counts').first()).toBeVisible();
    await expect(page.getByText('we do not currently support photo uploads',{exact:false})).toHaveCount(0);
    await page.getByTestId('button-posts-photos').click();
    await expect(page).toHaveURL(/\/gbp-content$/);
});

test('unlinked Places import remains available and renders weekday text without array indexes', async ({ page }) => {
    const fixture = {id:99885,businessName:'Unlinked audit fixture',placeId:'fixture-place',gbpLocationName:null,hours:['Monday: 8:00 AM – 5:00 PM','Tuesday: Closed']};
    let imported = false;
    await page.route('**/api/locations', route=>route.fulfill({json:[fixture]}));
    await page.route('**/api/locations/99885/import-google', route=>{imported=true;return route.fulfill({json:fixture});});
    await page.goto('/locations');
    await page.getByText('Unlinked audit fixture',{exact:true}).click();
    await page.getByTestId('tab-info').click();
    await expect(page.getByTestId('info-hours')).toHaveText('Monday: 8:00 AM – 5:00 PM, Tuesday: Closed');
    await page.getByTestId('button-import-google').click();
    await expect(page.getByText('Google data imported',{exact:true})).toBeVisible();
    expect(imported).toBe(true);
});

test.describe('route-mocked location states', () => {
    const LINKED = { id: 99701, businessName: 'Content linked fixture', gbpLocationName: 'locations/fixture', gbpAccountName: 'accounts/fixture' };
    const UNLINKED = { id: 99702, businessName: 'Content unlinked fixture', gbpLocationName: null };
    test.beforeEach(async ({ page }) => {
        await page.route(/\/api\/locations(\?|$)/, route => route.fulfill({ json: [LINKED, UNLINKED] }));
        await page.route(/\/api\/gbp\/status/, route => route.fulfill({ json: { connected: false, accounts: [], locations: [] } }));
        await page.route(/\/api\/gbp\/linkage/, route => route.fulfill({ json: { accounts: [], locations: [], errors: [] } }));
        await page.route(/\/api\/gbp\/content\/99701/, route => {
            const path = new URL(route.request().url()).pathname;
            return route.fulfill({ json: path.endsWith('/photos') ? [] : { jobs: [], style: null, workerEnabled: false } });
        });
    });
    test('an unlinked location offers the Locations link instead of the editor', async ({ page }) => {
        await page.goto(`/gbp-content?location=${UNLINKED.id}`);
        await expect(page.getByTestId('gbp-content-location-unavailable')).toContainText("Content unlinked fixture isn't linked to Google Business Profile.");
        await expect(page.getByRole('link', { name: 'Link it in Locations' })).toHaveAttribute('href', `/locations?location=${UNLINKED.id}`);
        await expect(page.getByRole('button', { name: 'Generate post draft' })).toHaveCount(0);
    });
    test('an unknown location says so', async ({ page }) => {
        await page.goto('/gbp-content?location=999999');
        await expect(page.getByTestId('gbp-content-location-unavailable')).toContainText('Location not found.');
        await expect(page.getByRole('link', { name: 'Link it in Locations' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Generate post draft' })).toHaveCount(0);
    });
    test('items per period 0 is refused before queueing', async ({ page }) => {
        await page.goto(`/gbp-content?location=${LINKED.id}`);
        await page.getByLabel('Post draft').fill('Fixture update');
        await page.getByLabel('Items per period').fill('0');
        await expect(page.locator('#items-per-period-error')).toHaveText('Items per period must be a whole number from 1 to 100.');
        await expect(page.getByRole('button', { name: 'Approve & queue post' })).toBeDisabled();
        await page.getByLabel('Items per period').fill('3');
        await expect(page.locator('#items-per-period-error')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Approve & queue post' })).toBeEnabled();
    });
    test('Queue and Calendar toggles report which view is on', async ({ page }) => {
        await page.goto(`/gbp-content?location=${LINKED.id}`);
        const queue = page.getByRole('button', { name: 'Queue', exact: true });
        const calendar = page.getByRole('button', { name: 'Calendar', exact: true });
        await expect(queue).toHaveAttribute('aria-pressed', 'true');
        await expect(calendar).toHaveAttribute('aria-pressed', 'false');
        await calendar.click();
        await expect(queue).toHaveAttribute('aria-pressed', 'false');
        await expect(calendar).toHaveAttribute('aria-pressed', 'true');
    });
});
