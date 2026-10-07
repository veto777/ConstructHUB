import { describe, expect, it } from "vitest";
import {
  expiryFromPreset, hashSharePassword, newShareToken, shareAccess, shareLinkState, signShareSession, verifySharePassword, verifyShareSession,
} from "./share-auth";

const SECRET = "test-secret";
const base = { token: newShareToken(), revokedAt: null, expiresAt: null, passwordHash: null };

describe("jobcam share-link auth (pure)", () => {
  it("mints unguessable tokens", () => {
    const a = newShareToken(), b = newShareToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(30);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("revoked beats expired beats ok", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(shareLinkState(base, now)).toBe("ok");
    expect(shareLinkState({ ...base, expiresAt: "2026-10-08T00:00:00Z" }, now)).toBe("ok");
    expect(shareLinkState({ ...base, expiresAt: "2026-10-07T11:59:59Z" }, now)).toBe("expired");
    expect(shareLinkState({ ...base, expiresAt: "2026-10-07T11:59:59Z", revokedAt: "2026-10-01T00:00:00Z" }, now)).toBe("revoked");
  });

  it("hashes passwords with a per-link salt and verifies them", () => {
    const h1 = hashSharePassword("Sunny side up");
    const h2 = hashSharePassword("Sunny side up");
    expect(h1).not.toBe(h2);
    expect(verifySharePassword("Sunny side up", h1)).toBe(true);
    expect(verifySharePassword("sunny side up", h1)).toBe(false);
    expect(verifySharePassword("", h1)).toBe(false);
    expect(verifySharePassword("anything", null)).toBe(true);   // no password set
    expect(verifySharePassword("x", "garbage")).toBe(false);
  });

  it("binds the unlock cookie to one link under the app secret", () => {
    const sig = signShareSession(base.token, SECRET);
    expect(verifyShareSession(base.token, sig, SECRET)).toBe(true);
    expect(verifyShareSession(newShareToken(), sig, SECRET)).toBe(false);
    expect(verifyShareSession(base.token, sig, "other-secret")).toBe(false);
    expect(verifyShareSession(base.token, null, SECRET)).toBe(false);
  });

  it("decides access: state first, then the password gate", () => {
    const locked = { ...base, passwordHash: hashSharePassword("pw") };
    expect(shareAccess(base, null, SECRET)).toEqual({ allowed: true });
    expect(shareAccess(locked, null, SECRET)).toEqual({ allowed: false, reason: "locked" });
    expect(shareAccess(locked, signShareSession(locked.token, SECRET), SECRET)).toEqual({ allowed: true });
    expect(shareAccess({ ...locked, revokedAt: new Date() }, signShareSession(locked.token, SECRET), SECRET)).toEqual({ allowed: false, reason: "revoked" });
    expect(shareAccess({ ...base, expiresAt: new Date(Date.now() - 1000) }, null, SECRET)).toEqual({ allowed: false, reason: "expired" });
  });

  it("turns expiry presets into dates", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(expiryFromPreset("never", now)).toBeNull();
    expect(expiryFromPreset("7d", now)?.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(expiryFromPreset("30d", now)?.toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(expiryFromPreset("custom", now)).toBeNull();
  });
});

import { looksLikeShareToken, safeEqual, shareSecret } from "./share-auth";

describe("jobcam share-link auth — fail closed", () => {
  it("never accepts an unlock cookie when there is no signing secret", () => {
    const link = { ...base, passwordHash: hashSharePassword("pw-1234") };
    // An empty-key HMAC is computable by anyone — it must not open the link.
    const forged = require("crypto").createHmac("sha256", "").update(`jobcam-share:${link.token}`).digest("base64url");
    expect(verifyShareSession(link.token, forged, "")).toBe(false);
    expect(shareAccess(link, forged, "")).toEqual({ allowed: false, reason: "locked" });
    expect(() => signShareSession(link.token, "")).toThrow();
  });

  it("resolves the secret like the session layer: required in production", () => {
    expect(shareSecret({ SESSION_SECRET: "abc", NODE_ENV: "production" })).toBe("abc");
    expect(shareSecret({ NODE_ENV: "production" })).toBeNull();
    expect(shareSecret({ NODE_ENV: "development" })).toBeTruthy();
  });

  it("a cookie for one link does not open another", () => {
    const a = { ...base, token: newShareToken(), passwordHash: hashSharePassword("pw-1234") };
    const b = { ...base, token: newShareToken(), passwordHash: hashSharePassword("pw-1234") };
    expect(shareAccess(b, signShareSession(a.token, SECRET), SECRET)).toEqual({ allowed: false, reason: "locked" });
    expect(shareAccess(a, signShareSession(a.token, SECRET), SECRET)).toEqual({ allowed: true });
  });

  it("revocation and expiry beat a valid unlock cookie", () => {
    const link = { ...base, passwordHash: hashSharePassword("pw-1234") };
    const cookie = signShareSession(link.token, SECRET);
    expect(shareAccess({ ...link, revokedAt: new Date() }, cookie, SECRET)).toEqual({ allowed: false, reason: "revoked" });
    expect(shareAccess({ ...link, expiresAt: new Date(Date.now() - 1000) }, cookie, SECRET)).toEqual({ allowed: false, reason: "expired" });
  });

  it("only well-formed tokens reach the lookup, compared in constant time", () => {
    const t = newShareToken();
    expect(looksLikeShareToken(t)).toBe(true);
    for (const bad of ["", "short", `${t}x`, `${t.slice(0, 31)}%`, "../../../../etc/passwd-padding-1234", null, 42]) expect(looksLikeShareToken(bad)).toBe(false);
    expect(safeEqual(t, t)).toBe(true);
    expect(safeEqual(t, `${t.slice(0, 31)}A`.replace(t, `${t.slice(0, 31)}B`))).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(t, null)).toBe(false);
  });
});
