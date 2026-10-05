import { describe, expect, it } from 'vitest';
import { syncIncomplete } from './jobs';

// Issue desk #422: an unverified listing's performance stats are never available, so the queued sync
// must not fail (and retry five times) on it; any other failed part still fails the job.
describe('syncIncomplete', () => {
  const ok = { profile: { warnings: [] }, reviews: { count: 3 } };
  it('passes a fully synced location', () => {
    expect(syncIncomplete({ ...ok, performance: { count: 10, available: true } })).toBe(false);
  });
  it('passes when only performance is withheld for an unverified listing', () => {
    expect(syncIncomplete({ ...ok, performance: { kind: 'permission', message: 'unverified', needsAuth: false, unverified: true } })).toBe(false);
  });
  it('fails on a performance permission error for a verified listing', () => {
    expect(syncIncomplete({ ...ok, performance: { kind: 'permission', message: 'denied', needsAuth: false } })).toBe(true);
  });
  it('fails when another part errored', () => {
    expect(syncIncomplete({ ...ok, reviews: { kind: 'transient', message: 'down', needsAuth: false },
      performance: { kind: 'permission', message: 'unverified', needsAuth: false, unverified: true } })).toBe(true);
  });
});
