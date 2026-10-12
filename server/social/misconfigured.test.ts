/**
 * Social Media when the server is not set up for it (no encryption key for connected accounts): the
 * error carries the stable code `social_misconfigured`, so the page can say "not set up" instead of
 * the generic "briefly unavailable" a bare 503 turns into (reviewers, 2026-10-11). Pure — no database.
 */
import { afterEach, describe, expect, it } from "vitest";
import { encryptKey, SocialError, socialErrorBody, socialMisconfigured, SOCIAL_MISCONFIGURED } from "./client";

describe("social_misconfigured", () => {
  const saved = process.env.SOCIAL_ENCRYPTION_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.SOCIAL_ENCRYPTION_KEY;
    else process.env.SOCIAL_ENCRYPTION_KEY = saved;
  });

  it("names a missing or malformed encryption key with the stable code, as a 503 the page can read", () => {
    for (const key of [undefined, "", "not-hex", "abcd", "zz".repeat(32)]) {
      if (key === undefined) delete process.env.SOCIAL_ENCRYPTION_KEY;
      else process.env.SOCIAL_ENCRYPTION_KEY = key;
      let caught: unknown;
      try {
        encryptKey("native:chu1b0", 1);
      } catch (e) {
        caught = e;
      }
      expect(caught, JSON.stringify(key)).toBeInstanceOf(SocialError);
      const e = caught as SocialError;
      expect(e.status).toBe(503);
      expect(e.code).toBe(SOCIAL_MISCONFIGURED);
      expect(SOCIAL_MISCONFIGURED).toBe("social_misconfigured");
      // The body the route sends: message plus code, and a message for people, not an env var name.
      expect(socialErrorBody(e)).toEqual({ message: e.message, code: "social_misconfigured" });
      expect(e.message).toMatch(/not set up/i);
      expect(e.message).not.toMatch(/SOCIAL_ENCRYPTION_KEY/);
    }
  });

  it("encrypts once a 64-hex key is set; ordinary errors carry no code", () => {
    process.env.SOCIAL_ENCRYPTION_KEY = "ab".repeat(32);
    expect(encryptKey("native:chu1b0", 1).split(".")).toHaveLength(3);
    expect(socialErrorBody(new SocialError("Choose a future schedule time"))).toEqual({ message: "Choose a future schedule time" });
    expect(socialErrorBody(new SocialError("Try again shortly", 429))).not.toHaveProperty("code");
    const ai = socialMisconfigured("Social Media post writing is not set up on this server yet.");
    expect([ai.status, ai.code]).toEqual([503, "social_misconfigured"]);
  });
});
