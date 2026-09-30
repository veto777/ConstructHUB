import { test, expect } from '@playwright/test';
import pg from 'pg';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let location: number;
test.beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (target.pathname !== '/constructhub_dev_a3' || !['localhost', '127.0.0.1'].includes(target.hostname))
        throw new Error('a3 DB required');
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
