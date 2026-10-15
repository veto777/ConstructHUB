import { describe, expect, it } from 'vitest';
import { cleanSocialLink } from '@shared/social-profile-links';
import { resolveSocialLinks } from './social-profile-links';

describe('social profile links', () => {
  it('keeps a clean profile link, drops tracking and the hash, and forces https', () => {
    expect(cleanSocialLink('instagram', ' http://www.instagram.com/constructhubapp/?igsh=abc#x ')).toEqual({ url: 'https://www.instagram.com/constructhubapp/', short: false, error: null });
    expect(cleanSocialLink('twitter', 'x.com/Constructhubapp')).toEqual({ url: 'https://x.com/Constructhubapp', short: false, error: null });
    expect(cleanSocialLink('facebook', '')).toEqual({ url: '', short: false, error: null });
  });
  it('names the problem: two links pasted together, the wrong platform, no profile', () => {
    expect(cleanSocialLink('facebook', 'https://www.fhttps://www.facebook.com/1221acebook.com/1221').error).toMatch(/Two links are pasted together in Facebook/);
    expect(cleanSocialLink('pinterest', 'https://www.tiktok.com/@construct.hub').error).toMatch(/isn't a Pinterest link/);
    expect(cleanSocialLink('youtube', 'https://youtube.com/').error).toMatch(/needs your profile/);
    expect(cleanSocialLink('linkedin', 'notalinkatall').error).toMatch(/isn't a LinkedIn link/);
  });
  it('accepts a short link and expands it through the platform\'s own redirects only', async () => {
    expect(cleanSocialLink('pinterest', 'https://pin.it/6rZPbXNib')).toEqual({ url: 'https://pin.it/6rZPbXNib', short: true, error: null });
    const hops: Record<string, string> = {
      'https://pin.it/6rZPbXNib': 'https://api.pinterest.com/url_shortener/6rZPbXNib/redirect/',
      'https://api.pinterest.com/url_shortener/6rZPbXNib/redirect/': 'https://www.pinterest.com/chub0125/?invite_code=71a4&sender=113',
    };
    const fetchImpl = async (url: string) => ({ status: hops[url] ? 302 : 200, headers: { get: () => hops[url] ?? null } });
    expect(await resolveSocialLinks({ pinterest: 'https://pin.it/6rZPbXNib', tiktok: 'https://www.tiktok.com/@construct.hub', twitter: '' }, fetchImpl as any))
      .toEqual({ links: { pinterest: 'https://www.pinterest.com/chub0125/', tiktok: 'https://www.tiktok.com/@construct.hub', twitter: '' } });
    // A redirect that leaves the platform is refused, never followed.
    const evil = async (url: string) => ({ status: 302, headers: { get: () => (url.includes('pin.it') ? 'https://169.254.169.254/latest/' : null) } });
    expect((await resolveSocialLinks({ pinterest: 'https://pin.it/x' }, evil as any)).error).toMatch(/Could not expand the short Pinterest link/);
    expect((await resolveSocialLinks({ facebook: 'https://x.com/nope' })).error).toMatch(/isn't a Facebook link/);
  });
});
