import { describe, expect, it } from "vitest";
import { classifyTokenRefreshFailure, verifyManagerRefreshToken } from "./lsa-manager";

// Kimi QA: "Connect Manager Account" saved any refresh token as an active
// connection. The connect route now saves only a token Google accepts.
describe("LSA manager refresh-token check", () => {
  it("names a rejected token, a rejected OAuth client and an unavailable Google distinctly", () => {
    expect(classifyTokenRefreshFailure(400, { error: "invalid_grant", error_description: "Bad Request" }))
      .toMatchObject({ ok: false, reason: "rejected" });
    expect(classifyTokenRefreshFailure(401, { error: "invalid_client" }))
      .toMatchObject({ ok: false, reason: "client_rejected" });
    expect(classifyTokenRefreshFailure(503, null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(classifyTokenRefreshFailure(400, { error: "invalid_request" }))
      .toMatchObject({ ok: false, reason: "rejected", message: expect.stringContaining("invalid_request") });
    for (const r of [classifyTokenRefreshFailure(400, { error: "invalid_grant" }), classifyTokenRefreshFailure(401, { error: "invalid_client" })]) {
      expect(r.message).toContain("Nothing was saved");
    }
  });

  it("refuses to verify (and so to save) without an OAuth client, before calling Google", async () => {
    const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => { called = true; throw new Error("no network in this test"); }) as typeof fetch;
    try {
      process.env.GOOGLE_CLIENT_ID = "";
      process.env.GOOGLE_CLIENT_SECRET = "";
      expect(await verifyManagerRefreshToken("K-token")).toMatchObject({ ok: false, reason: "not_configured" });
      expect(called).toBe(false);
      process.env.GOOGLE_CLIENT_ID = "K-client";
      process.env.GOOGLE_CLIENT_SECRET = "K-secret";
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;
      expect(await verifyManagerRefreshToken("K-token")).toMatchObject({ ok: false, reason: "rejected" });
      globalThis.fetch = (async () => new Response(JSON.stringify({ access_token: "K-access", expires_in: 3599 }), { status: 200 })) as typeof fetch;
      expect(await verifyManagerRefreshToken("K-token")).toMatchObject({ ok: true, accessToken: "K-access" });
    } finally {
      globalThis.fetch = realFetch;
      if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = saved.id;
      if (saved.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = saved.secret;
    }
  });
});
