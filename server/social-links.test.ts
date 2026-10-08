import { describe, expect, it } from "vitest";
import { SOCIAL_LINKS, SOCIAL_URLS, YOUTUBE_CHANNEL_URL } from "@shared/social-links";
import { organizationJsonLd } from "@shared/seo";
import { welcomeEmail } from "./account/billing-email-templates";

describe("official social links", () => {
  it("has no empty field", () => {
    expect(SOCIAL_LINKS.length).toBeGreaterThan(0);
    for (const link of SOCIAL_LINKS) {
      for (const field of ["key", "name", "url", "handle", "label"] as const) {
        expect(link[field].trim(), `${link.key}.${field}`).not.toBe("");
        expect(link[field], `${link.key}.${field}`).toBe(link[field].trim());
      }
      expect(link.hosts.length, link.key).toBeGreaterThan(0);
    }
  });

  it("every URL is https, on its platform's host, with a real path and nothing extra", () => {
    const platformHost: Record<string, string> = {
      youtube: "www.youtube.com", instagram: "www.instagram.com", tiktok: "www.tiktok.com", linkedin: "www.linkedin.com",
    };
    for (const link of SOCIAL_LINKS) {
      const u = new URL(link.url);
      expect(u.protocol, link.key).toBe("https:");
      expect(u.hostname, link.key).toBe(platformHost[link.key]);
      expect(link.hosts, link.key).toContain(u.hostname);
      expect(u.pathname.length, `${link.key} names an account, not the platform's home page`).toBeGreaterThan(2);
      expect(u.username + u.password + u.search + u.hash, link.key).toBe("");
      expect(u.port, link.key).toBe("");
    }
  });

  it("lists each platform and URL once, with an accessible label naming it", () => {
    expect(new Set(SOCIAL_LINKS.map((l) => l.key)).size).toBe(SOCIAL_LINKS.length);
    expect(new Set(SOCIAL_URLS).size).toBe(SOCIAL_LINKS.length);
    for (const link of SOCIAL_LINKS) expect(link.label).toBe(`ConstructHUB on ${link.name}`);
  });

  it("the YouTube channel is the checked handle", () => {
    expect(YOUTUBE_CHANNEL_URL).toBe("https://www.youtube.com/@ConstructHUB-t3v");
  });

  it("the Organization JSON-LD lists exactly these accounts as sameAs", () => {
    expect(organizationJsonLd().sameAs).toEqual([...SOCIAL_URLS]);
  });

  it("the welcome email links every account, in HTML and plain text", () => {
    const mail = welcomeEmail({ displayName: "Pat", email: "pat@example.invalid", baseUrl: "https://constructhub.us" });
    for (const link of SOCIAL_LINKS) {
      expect(mail.html, link.key).toContain(`href="${link.url}"`);
      expect(mail.text, link.key).toContain(`${link.name}: ${link.url}`);
    }
  });
});
