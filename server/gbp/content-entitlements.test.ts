import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const m = vi.hoisted(() => ({
    query: vi.fn(), connect: vi.fn(), release: vi.fn(), owned: vi.fn(), budget: vi.fn(),
    notify: vi.fn(), activity: vi.fn(), accounts: new Map<number, any>(), jobs: [] as any[],
    revokeAfterSelection: false,
}));
vi.mock('../db', () => ({ pool: { query: m.query, connect: m.connect }, db: {} }));
vi.mock('./service', () => ({ ownedLocation: m.owned, clientFor: vi.fn() }));
vi.mock('../growth-limits', () => ({ takeBudget: m.budget }));
vi.mock('../account-events', () => ({ notifyUser: m.notify, logActivity: m.activity }));
vi.mock('../ops/issues', () => ({ recordFailure: vi.fn() }));
import { enqueue, registerContentRoutes, runContentWorker } from './content';
import { LEGACY_PLAN_MAP } from '@shared/plans';

const loc = { gbp_account_name: 'accounts/test', gbp_location_name: 'locations/test', gbp_google_subject: 'subject', business_name: 'Fixture' };
const ai = vi.fn(async () => 'A finished draft about our work.');
const request = vi.fn(async () => ({ name: 'accounts/test/locations/test/localPosts/result', state: 'LIVE' }));
const pages = vi.fn(async () => [{ summary: 'Previous post' }]);
const make = () => ({ request, pages }) as any;
const body = { requestKey: '00000000-0000-4000-8000-000000000001', items: [{ kind: 'post', summary: 'Manual text' }], schedule: { start: '2026-01-01T12:00:00Z' } };
const account = (plan: string | null, status = 'active', extra = {}) => ({ email: 'owner@example.invalid', plan, status, stripe_subscription_id: 'sub_fixture', ...extra });
const job = (id: number, user = 1) => ({ id, user_id: user, location_id: 9, kind: 'post', status: 'queued', attempts: 0, due_at: '2026-01-01T12:00:00Z', schedule: {}, payload: { summary: 'Approved content' }, target: { account: loc.gbp_account_name, location: loc.gbp_location_name, subject: loc.gbp_google_subject } });

async function call(suffix: string, data?: unknown, method = data ? 'post' : 'get', user = 1) {
    const app = express();
    registerContentRoutes(app, (_req, res) => user ? { id: user } : (res.status(401).json({}), undefined), ai, make);
    const path = `/api/gbp/content/9${suffix}`;
    const layer = (app.router as any).stack.find((entry: any) => entry.route?.methods[method] && entry.match(path));
    const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(value: any) { this.body = value; return this; } };
    await layer.route.stack[0].handle({ params: layer.params, body: data }, res);
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
    m.accounts.clear(); m.accounts.set(1, account('pro')); m.jobs = []; m.revokeAfterSelection = false;
    m.owned.mockResolvedValue(loc); m.budget.mockResolvedValue(true);
    m.notify.mockResolvedValue(undefined); m.activity.mockResolvedValue(undefined);
    m.connect.mockResolvedValue({ query: m.query, release: m.release });
    m.query.mockImplementation(async (sql: string, args: any[] = []) => {
        // Exercise the real shared entitlement resolver, including legacy/status/grant rules.
        if (sql.includes('FROM users u')) {
            const ids = Array.isArray(args[0]) ? args[0] : [args[0]];
            return { rows: ids.flatMap((id: number) => m.accounts.has(id) ? [{ ...m.accounts.get(id), account_id: id }] : []) };
        }
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (sql.startsWith('SELECT DISTINCT user_id')) return { rows: [...new Set(m.jobs.map(j => j.user_id))].map(user_id => ({ user_id })) };
        if (sql.includes('ORDER BY due_at LIMIT 20')) {
            // Model SQL filtering before LIMIT: >20 paused jobs must not starve eligible owners.
            const rows = m.jobs.filter(j => j.status === 'queued' && (!sql.includes('user_id=ANY') || args[0].includes(j.user_id))).slice(0, 20);
            if (m.revokeAfterSelection) m.accounts.set(1, account('pro', 'canceled'));
            return { rows };
        }
        if (sql.includes("SET status='publishing'")) {
            const j = m.jobs.find(j => j.id === args[0]);
            if (!j || j.status !== 'queued') return { rows: [], rowCount: 0 };
            j.status = 'publishing'; j.attempts++;
            return { rows: [{ id: j.id }], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE gbp_content_jobs SET status=$2')) {
            const j = m.jobs.find(j => j.id === args[0]); j.status = args[1];
        }
        if (sql.includes('SET status=$4')) return { rows: [{ status: args[3] }], rowCount: 1 };
        if (sql.includes('FROM media_photos')) return { rows: [{ id: 3, r2_key: 'media/test.jpg' }] };
        if (sql.includes('ORDER BY due_at DESC')) return { rows: m.jobs };
        return { rows: [], rowCount: 0 };
    });
    vi.stubEnv('GBP_MEDIA_PUBLIC_BASE_URL', 'https://media.example.invalid');
});

const denied = [
    ['Solo', account('starter')], ['Team', account('team')], ['canceled', account('pro', 'canceled')],
    ['past due', account('agency', 'past_due')], ['no platform plan', account(null)],
    ['expired grant', account('pro', 'trialing', { stripe_subscription_id: null, current_period_end: '2020-01-01' })],
] as const;
afterEach(() => vi.unstubAllEnvs());
describe('GBP content entitlement boundaries', () => {
    it.each(denied)('blocks AI, scheduling and retries for %s before side effects', async (_label, sub) => {
        m.accounts.set(1, sub);
        for (const [path, data, method] of [
            ['/draft', { kind: 'post' }, 'post'], ['/draft', { kind: 'photo', photoIds: [3] }, 'post'],
            ['/learn', {}, 'post'], ['/queue', body, 'post'], ['/jobs/1', { action: 'retry', checkedGoogle: true }, 'patch'],
        ] as const) {
            const res = await call(path, data, method);
            expect(res.statusCode).toBe(402);
            expect(res.body).toMatchObject({ code: 'plan_required', requiredPlan: 'pro' });
        }
        await expect(enqueue(1, 9, body)).rejects.toMatchObject({ status: 402 });
        expect(ai).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); expect(pages).not.toHaveBeenCalled();
        expect(m.connect).not.toHaveBeenCalled();
        expect(m.query.mock.calls.some(([sql]) => /INSERT INTO gbp_content_jobs|UPDATE gbp_content_jobs/.test(sql))).toBe(false);
        expect(m.budget.mock.calls.some(([key]) => key.startsWith('gbp-content-ai:'))).toBe(false);
    });

    it.each(['pro', 'growth', 'agency', 'business', 'premium', 'gold', 'platinum'])('allows AI and scheduling for active %s without changing billing', async plan => {
        const sub = account(plan, 'active', { founding_prices: { pro: 1234 }, addons: { extra_location: 2 }, agency_locations: 200 });
        m.accounts.set(1, sub);
        expect((await call('/draft', { kind: 'post' })).body.drafts).toHaveLength(1);
        expect((await call('/draft', { kind: 'photo', photoIds: [3] })).body.drafts[0].photoId).toBe(3);
        expect((await call('/learn', {})).statusCode).toBe(200);
        expect((await call('/queue', body)).statusCode).toBe(200);
        expect((await call('/jobs/1', { action: 'retry' }, 'patch')).statusCode).toBe(200);
        expect(m.query.mock.calls.some(([sql]) => /INSERT INTO gbp_content_jobs/.test(sql))).toBe(true);
        expect(m.accounts.get(1)).toEqual(sub);
        expect(m.query.mock.calls.some(([sql]) => /(?:UPDATE|INSERT INTO) subscriptions/.test(sql))).toBe(false);
    });

    it.each(denied)('keeps reads, style editing and cancellation available for %s', async (_label, sub) => {
        m.accounts.set(1, sub);
        expect((await call('')).statusCode).toBe(200);
        expect((await call('/photos')).statusCode).toBe(200);
        expect((await call('/refresh', {})).statusCode).toBe(200);
        expect((await call('/style', { summary: 'Edited guidance' }, 'patch')).statusCode).toBe(200);
        expect((await call('/jobs/1', { action: 'cancel' }, 'patch')).body.status).toBe('cancelled');
    });

    it('still requires authentication and location ownership', async () => {
        expect((await call('/draft', { kind: 'post' }, 'post', 0)).statusCode).toBe(401);
        const { GoogleError } = await import('./client');
        m.owned.mockRejectedValue(new GoogleError('invalid', 'Location not found', 404));
        expect((await call('/draft', { kind: 'post' })).statusCode).toBe(404);
        expect(ai).not.toHaveBeenCalled();
    });
});

describe('GBP worker entitlement filtering', () => {
    it.each([
        ['live trial', account('pro', 'trialing', { stripe_subscription_id: null, current_period_end: '2099-01-01' })],
        ['legacy open-ended grant', account('platinum', 'active', { stripe_subscription_id: null, current_period_end: null })],
        ['platform admin', account(null, 'canceled', { email: 'support@constructhub.us' })],
    ])('preserves %s access for both generation and publishing', async (_label, sub) => {
        m.accounts.set(1, sub); m.jobs = [job(1)];
        expect((await call('/draft', { kind: 'post' })).statusCode).toBe(200);
        await runContentWorker(make);
        expect(m.jobs[0].status).toBe('published');
    });

    it.each(denied)('leaves %s jobs untouched, then resumes after subscribing', async (_label, sub) => {
        m.accounts.set(1, sub); m.jobs = [job(1)];
        const original = structuredClone(m.jobs[0]);
        await runContentWorker(make);
        expect(m.jobs[0]).toEqual(original); expect(request).not.toHaveBeenCalled(); expect(m.budget).not.toHaveBeenCalled();
        m.accounts.set(1, account('pro'));
        await runContentWorker(make);
        expect(m.jobs[0]).toMatchObject({ status: 'published', attempts: 1 }); expect(request).toHaveBeenCalledTimes(1);
        expect(m.release).toHaveBeenCalledTimes(2);
    });

    it('filters paused owners before the batch limit', async () => {
        m.accounts.set(1, account('team')); m.accounts.set(2, account('pro'));
        m.jobs = [...Array.from({ length: 25 }, (_, i) => job(i + 1)), job(26, 2)];
        await runContentWorker(make);
        expect(m.jobs.slice(0, 25).every(j => j.status === 'queued' && j.attempts === 0)).toBe(true);
        expect(m.jobs[25].status).toBe('published'); expect(request).toHaveBeenCalledTimes(1);
        expect(m.query).toHaveBeenCalledWith(expect.stringMatching(/user_id=ANY\(\$1::int\[\]\).*LIMIT 20/), [[2]]);
    });

    it('rechecks access after selecting jobs and before claiming or spending budget', async () => {
        m.jobs = [job(1)]; m.revokeAfterSelection = true;
        await runContentWorker(make);
        expect(m.jobs[0]).toMatchObject({ status: 'queued', attempts: 0 });
        expect(request).not.toHaveBeenCalled(); expect(m.budget).not.toHaveBeenCalled();
    });

    it.each(Object.entries(LEGACY_PLAN_MAP))('uses shared legacy mapping for %s', async (legacy, mapped) => {
        m.accounts.set(1, account(legacy)); m.jobs = [job(1)];
        await runContentWorker(make);
        expect(m.jobs[0].status).toBe(mapped === 'starter' ? 'queued' : 'published');
    });
});
