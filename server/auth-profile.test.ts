/**
 * PATCH /api/auth/profile against the running dev server (dev auth bypass
 * signs requests in as user 1). Only rejected writes are exercised, so the
 * shared dev user's profile is never changed.
 */
import { describe, expect, it } from "vitest";

const base = process.env.CRM_TEST_BASE_URL || "http://127.0.0.1:8149";
const patch = (body: unknown) => fetch(`${base}/api/auth/profile`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("PATCH /api/auth/profile display name", () => {
  it.each([[""], ["   "], [null]])("rejects a blank display name (%j) and leaves the profile unchanged", async (displayName) => {
    const before = await (await fetch(`${base}/api/auth/me`)).json();
    expect(before?.id, "dev auth bypass user").toBeTruthy();
    const res = await patch({ displayName });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Display name is required");
    const after = await (await fetch(`${base}/api/auth/me`)).json();
    expect(after.displayName).toBe(before.displayName);
  });
});
