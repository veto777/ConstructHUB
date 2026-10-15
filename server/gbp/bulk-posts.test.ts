import { describe, expect, it } from 'vitest';
import { planTimes, zonedInstant, dropboxZipUrl } from './bulk-posts';

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
});
