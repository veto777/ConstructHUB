import { describe, it, expect } from 'vitest';
import { governmentLinksAvailable } from '../shared/government-links';
describe('government link visibility', () => {
  it('requires a verified, active link', () => {
    expect(governmentLinksAvailable({isActive: true, linkStatus: 'live'})).toBe(true);
    for (const linkStatus of ['dead', 'unverified', 'unchecked', 'none', null, undefined]) {
      expect(governmentLinksAvailable({isActive: true, linkStatus})).toBe(false);
    }
    expect(governmentLinksAvailable({isActive: false, linkStatus: 'live'})).toBe(false);
  });
});
