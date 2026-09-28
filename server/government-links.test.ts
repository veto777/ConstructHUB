import { describe, it, expect } from 'vitest';
import { governmentLinksAvailable, governmentLinksForDisplay } from '../shared/government-links';
describe('government link visibility', () => {
  it('requires a verified, active link', () => {
    expect(governmentLinksAvailable({isActive: true, linkStatus: 'live'})).toBe(true);
    for (const linkStatus of ['dead', 'unverified', 'unchecked', 'none', null, undefined]) {
      expect(governmentLinksAvailable({isActive: true, linkStatus})).toBe(false);
    }
    expect(governmentLinksAvailable({isActive: false, linkStatus: 'live'})).toBe(false);
  });
});

it('property lookup API keeps office and phone but suppresses unverified URLs', () => {
  const office = { name: 'Fixture office', phone: null, isActive: true, linkStatus: 'dead', portalUrl: 'https://dead.invalid', searchUrl: 'https://dead.invalid' };
  expect(governmentLinksForDisplay(office)).toEqual({ ...office, portalUrl: null, searchUrl: null });
  expect(office.portalUrl).toBe('https://dead.invalid');
});
