import { describe, expect, it } from 'vitest';
import { planTimes, zonedInstant, dropboxZipUrl, readCapped } from './bulk-posts';

describe('bulk posts planning', () => {
  it('puts a wall-clock time on a calendar day in the zone, DST included', () => {
    expect(zonedInstant('2026-07-04', 9, 30, 'America/New_York').toISOString()).toBe('2026-07-04T13:30:00.000Z');
    expect(zonedInstant('2026-12-04', 9, 30, 'America/New_York').toISOString()).toBe('2026-12-04T14:30:00.000Z');
  });
  it('one instant per photo, every N days, allowed weekdays only, inside the window at a random minute', () => {
    const seq = [0.1, 0.9, 0.5, 0.25];
    let n = 0;
    const times = planTimes(4, { everyDays: 1, startOn: '2027-01-04', timezone: 'UTC', openHour: 9, closeHour: 17, weekdays: [1, 2, 3, 4, 5] }, () => seq[n++ % seq.length]);
    expect(times.map((t) => t.toISOString())).toEqual(['2027-01-04T09:48:00.000Z', '2027-01-05T16:12:00.000Z', '2027-01-06T13:00:00.000Z', '2027-01-07T11:00:00.000Z']);
    // Weekends are skipped, and every 3 days counts from each posting day.
    const t3 = planTimes(3, { everyDays: 3, startOn: '2027-01-08', timezone: 'UTC', openHour: 9, closeHour: 10, weekdays: [1, 2, 3, 4, 5] }, () => 0);
    expect(t3.map((t) => t.toISOString().slice(0, 10))).toEqual(['2027-01-08', '2027-01-11', '2027-01-14']);
    expect(() => planTimes(1, { everyDays: 1, startOn: '2027-01-04', timezone: 'UTC', openHour: 17, closeHour: 9, weekdays: [1] })).toThrow(/window/);
    expect(() => planTimes(1, { everyDays: 1, startOn: '2027-01-04', timezone: 'Mars/Olympus', openHour: 9, closeHour: 17, weekdays: [1] })).toThrow(/timezone/);
  });
  it('a start day already past its window posts the first one shortly, never in the past', () => {
    const [first] = planTimes(1, { everyDays: 1, startOn: '2020-01-01', timezone: 'UTC', openHour: 9, closeHour: 17, weekdays: [0, 1, 2, 3, 4, 5, 6] }, () => 0);
    expect(first.getTime()).toBeGreaterThan(Date.now());
    expect(first.getTime()).toBeLessThan(Date.now() + 60 * 60000);
  });
  it('accepts only dropbox.com links and asks for the download', () => {
    expect(dropboxZipUrl('https://www.dropbox.com/scl/fo/abc/h?rlkey=x&dl=0')).toBe('https://www.dropbox.com/scl/fo/abc/h?rlkey=x&dl=1');
    expect(() => dropboxZipUrl('https://evil.example/scl/fo/abc')).toThrow(/dropbox.com/);
    expect(() => dropboxZipUrl('not a link')).toThrow(/Dropbox/);
  });

  it('reads a download only up to its cap (audit M11)', async () => {
    expect((await readCapped(new Response('abcdef'), 10, 'too big')).toString()).toBe('abcdef');
    await expect(readCapped(new Response('abcdef'), 5, 'too big')).rejects.toThrow('too big');
    // Declared length over the cap: refused before a byte is read.
    await expect(readCapped(new Response('x', { headers: { 'content-length': '999999999' } }), 10, 'too big')).rejects.toThrow('too big');
    // No declared length: the stream is counted and dropped once it passes the cap.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } });
    await expect(readCapped(new Response(endless), 4096, 'too big')).rejects.toMatchObject({ kind: 'invalid' });
    expect(pulled).toBeLessThan(20);
  });
  it('a bulk run can upload as many photos as a run accepts (audit H5)', async () => {
    const { uploadBudget, UPLOAD_MAX_INDEX } = await import('./content-upload');
    const { createInput } = await import('./bulk-posts');
    const run = { name: 'x', source: 'library', startOn: '2027-01-04', timezone: 'America/New_York' };
    expect(createInput.safeParse({ ...run, photoIds: Array.from({ length: UPLOAD_MAX_INDEX + 1 }, (_, i) => i + 1) }).success).toBe(true);
    expect(createInput.safeParse({ ...run, photoIds: Array.from({ length: UPLOAD_MAX_INDEX + 2 }, (_, i) => i + 1) }).success).toBe(false);
    expect(uploadBudget(7, true)).toEqual({ key: 'gbp-bulk-upload:7', limit: UPLOAD_MAX_INDEX + 1 });
    expect(uploadBudget(7, false)).toEqual({ key: 'gbp-content-upload:7', limit: 100 });
  });
});
