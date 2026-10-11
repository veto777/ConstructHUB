import { describe, expect, it } from 'vitest';
import { minimalWriteExample, curlFor } from '../../../client/src/pages/developers';
import { socialPostInput, socialWriteOpenapi } from './social-write';
import { gbpPostInput, gbpReplyInput } from './gbp-write';
import { siteScanInput } from './sitescan-write';

describe('minimal API write examples', () => {
  const example = (name: string) => minimalWriteExample({ $ref: `#/components/schemas/${name}` }) as Record<string, any>;
  it('validates the minimal social input without optional media or scheduling', () => {
    const body = example('SocialPostInput');
    expect(socialPostInput.safeParse(body).success).toBe(true);
    expect(typeof body.businessId).toBe('number');
    expect(Object.keys(body).sort()).toEqual(['businessId', 'destinations', 'requestId', 'text']);
    expect(Object.keys(body.destinations[0]).sort()).toEqual(['accountId', 'platform']);
    const curl = curlFor({ method: 'post', path: '/social-posts', op: socialWriteOpenapi.paths['/'].post }, socialWriteOpenapi, 'https://example.com/api/v1', body);
    expect(curl).toContain(JSON.stringify(body, null, 2));
  });
  it('uses fresh idempotency keys for each new example', () => {
    for (const [name, key] of [['SocialPostInput', 'requestId'], ['GbpPostInput', 'requestKey']]) {
      expect(example(name)[key]).not.toBe(example(name)[key]);
    }
  });
  it('validates minimal GBP and Site Scan bodies', () => {
    expect(gbpPostInput.safeParse(example('GbpPostInput')).success).toBe(true);
    expect(siteScanInput.safeParse(example('SiteScanInput')).success).toBe(true);
    expect(gbpReplyInput.safeParse(example('GbpReplyInput')).success).toBe(true);
    expect(example('GbpReplyInput')).toEqual({ text: 'Thank you for sharing your feedback.' });
  });
});
