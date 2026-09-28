import { describe, it, expect, vi } from "vitest";
import { testAuthAdapter, testAuthEnabled } from "./test-auth";

describe("shared test auth adapter", () => {
  it("requires explicit dev opt-in and rejects it in production", () => {
    expect(testAuthEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(testAuthEnabled({ NODE_ENV: "production", DEV_AUTH_BYPASS_USER1: "true" })).toBe(false);
    expect(testAuthEnabled({ NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "true" })).toBe(true);
  });
  it("preserves real sessions and supplies the same identity to all handlers", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEV_AUTH_BYPASS_USER1", "true");
    try {
      const load = vi.fn(async () => ({ id: 1, email: "dev@example.invalid" }));
      const adapter = testAuthAdapter(load);
      const real = { user: { id: 2 } };
      await adapter(real as any, {} as any, vi.fn());
      expect(real.user.id).toBe(2); expect(load).not.toHaveBeenCalled();
      const req: any = {};
      await adapter(req, {} as any, vi.fn());
      expect(req.user.id).toBe(1); expect(req.session).toBeUndefined();
    } finally { vi.unstubAllEnvs(); }
  });
});
