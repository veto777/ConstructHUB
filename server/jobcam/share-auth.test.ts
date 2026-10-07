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
