import { describe, expect, it } from "vitest";
const base = process.env.CRM_TEST_BASE_URL || "http://127.0.0.1:8149";
describe("Google OAuth request binding", () => {
  it.each(["", "?gbp=1"])("uses session state and rejects an unbound callback %s", async suffix => {
    const start = await fetch(`${base}/api/auth/google${suffix}`, { redirect: "manual" });
    expect(start.status).toBe(302);
    const url = new URL(start.headers.get("location")!);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("state")).toBeTruthy();
    if (suffix) expect(url.searchParams.get("scope")).toContain("business.manage");
    const cookie = start.headers.get("set-cookie")!.split(";")[0];
    // Invalid state is checked before attempting any Google token exchange.
    const callback = await fetch(`${base}/api/auth/google/callback?code=local-fixture&state=wrong`, {
      redirect: "manual", headers: { cookie },
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/auth?error=google-failed");
  });
});
