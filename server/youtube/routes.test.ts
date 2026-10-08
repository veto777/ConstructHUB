/**
 * The four admin routes over real HTTP against a throwaway Express app: the
 * admin gate, the store and fetch are fakes, so nothing reaches Google or the
 * database. What is checked: only an admin gets in, the state is bound to the
 * session and works once, a wrong channel stores nothing, and no response
 * carries a token.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const mem = vi.hoisted(() => ({ saved: [] as any[], errors: [] as any[], deleted: 0, refresh: null as string | null }));

vi.mock("../crm/admin", () => ({
  requirePlatformAdmin: async (req: any, res: any, getUser: any) => {
    const user = getUser(req, res);
    if (!user) return null;
    if (!user.admin) { res.status(403).json({ message: "Platform admin access required" }); return null; }
    return user;
  },
}));
vi.mock("./store", () => ({
  youtubeStatus: async () => ({
    connected: mem.saved.length > 0, needsReconnect: false, channelId: mem.saved.at(-1)?.channelId ?? null, channelTitle: mem.saved.at(-1)?.channelTitle ?? null,
    scopes: mem.saved.at(-1)?.scopes ?? [], connectedAt: null, connectedBy: null, lastError: mem.errors.at(-1) ?? null,
  }),
  saveYoutubeConnection: async (c: any, by: any) => { mem.saved.push({ ...c, by }); mem.refresh = c.refreshToken; },
  recordYoutubeError: async (code: string, message: string) => { mem.errors.push({ code, message, at: null }); },
  youtubeRefreshTokenForRevoke: async () => mem.refresh,
  deleteYoutubeConnection: async () => { const had = mem.saved.length > 0; mem.saved.length = 0; mem.refresh = null; mem.deleted++; return had; },
}));

import { registerYoutubeRoutes } from "./routes";
import { DEFAULT_YOUTUBE_CHANNEL_ID, YT_READONLY_SCOPE, YT_UPLOAD_SCOPE } from "./client";

const USERS: Record<string, any> = {
  admin: { id: 1, email: "owner@example.test", admin: true },
  other: { id: 2, email: "admin2@example.test", admin: true },
  customer: { id: 3, email: "customer@example.test", admin: false },
};
const sessions = new Map<string, any>();
let googleReplies: Array<{ status?: number; json: unknown }> = [];
const googleCalls: string[] = [];
const http = (async (url: any) => {
  googleCalls.push(String(url));
  const r = googleReplies.shift();
  if (!r) throw new Error(`unexpected request ${url}`);
  return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
}) as typeof fetch;

let server: Server, base = "";
const saved: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_CHANNEL_ID", "YOUTUBE_EXTRA_SCOPES", "NODE_ENV"]) saved[k] = process.env[k];
  process.env.GOOGLE_CLIENT_ID = "client-id-fixture.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret-fixture";
  delete process.env.YOUTUBE_CHANNEL_ID;
  delete process.env.YOUTUBE_EXTRA_SCOPES;
  const app = express();
  app.use(express.json());
  // x-test-user picks who is signed in; x-test-session picks the browser session.
  app.use((req: any, _res, next) => {
    const sid = String(req.headers["x-test-session"] ?? "default");
    if (!sessions.has(sid)) sessions.set(sid, {});
    const s = sessions.get(sid);
    s.save = (cb: (e?: unknown) => void) => cb();
    req.session = s;
    req.user = USERS[String(req.headers["x-test-user"] ?? "")];
    next();
  });
  registerYoutubeRoutes(app, (req: any, res: any) => req.user ?? (res.status(401).json({ message: "Not authenticated" }), null), { http });
  server = app.listen(0, "127.0.0.1");
  await new Promise((ok) => server.once("listening", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await new Promise((ok) => server.close(ok));
});
beforeEach(() => { mem.saved.length = 0; mem.errors.length = 0; mem.deleted = 0; mem.refresh = null; sessions.clear(); googleReplies = []; googleCalls.length = 0; });

const get = (path: string, user?: string, session = "s1") =>
  fetch(base + path, { redirect: "manual", headers: { ...(user ? { "x-test-user": user } : {}), "x-test-session": session } });
const post = (path: string, user?: string, origin: string | null = base) =>
  fetch(base + path, { method: "POST", redirect: "manual", headers: { ...(user ? { "x-test-user": user } : {}), ...(origin ? { origin } : {}) } });

const ROUTES: Array<["GET" | "POST", string]> = [
  ["GET", "/api/admin/youtube/status"], ["GET", "/api/admin/youtube/connect"],
  ["GET", "/api/admin/youtube/callback?state=x&code=y"], ["POST", "/api/admin/youtube/disconnect"],
];
const tokens = { access_token: "access-secret-fixture", refresh_token: "refresh-secret-fixture", expires_in: 3600, scope: `${YT_UPLOAD_SCOPE} ${YT_READONLY_SCOPE}` };

async function startConnect(user = "admin", session = "s1") {
  const r = await get("/api/admin/youtube/connect", user, session);
  expect(r.status).toBe(302);
  return new URL(r.headers.get("location")!);
}

describe("who gets in", () => {
  it("answers 401 signed out and 403 to a signed-in account that is not a platform admin, on all four routes", async () => {
    for (const [method, path] of ROUTES) {
      const out = method === "GET" ? await get(path) : await post(path);
      expect([method, path, out.status]).toEqual([method, path, 401]);
      const customer = method === "GET" ? await get(path, "customer") : await post(path, "customer");
      expect([method, path, customer.status]).toEqual([method, path, 403]);
    }
    expect(mem.errors).toHaveLength(0);
    expect(mem.deleted).toBe(0);
    expect(googleCalls).toHaveLength(0);
  });
});

describe("connect", () => {
  it("redirects an admin to Google with the callback on this host and a state kept in the session", async () => {
    const url = await startConnect();
    expect(url.host).toBe("accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${base}/api/admin/youtube/callback`);
    expect(url.searchParams.get("state")).toBe(sessions.get("s1").youtubeOAuth.state);
    expect(sessions.get("s1").youtubeOAuth.userId).toBe(1);
  });

  it("shows the same redirect URI on the status the page renders, and nothing secret", async () => {
    const body = await (await get("/api/admin/youtube/status", "admin")).json();
    expect(body.redirectUri).toBe(`${base}/api/admin/youtube/callback`);
    expect(body.connected).toBe(false);
    expect(body.expectedChannelId).toBe(DEFAULT_YOUTUBE_CHANNEL_ID);
    expect(JSON.stringify(body)).not.toMatch(/secret|token/i);
  });
});

describe("callback", () => {
  it("refuses a wrong state, another browser session and another admin, and never calls Google", async () => {
    const state = (await startConnect()).searchParams.get("state")!;
    for (const [path, user, session] of [
      [`/api/admin/youtube/callback?state=${"0".repeat(64)}&code=c`, "admin", "s1"],
    ] as const) {
      const r = await get(path, user, session);
      expect(r.headers.get("location")).toBe("/admin/youtube?result=failed");
    }
    // The wrong guess consumed the pending state: the right one no longer works.
    expect((await get(`/api/admin/youtube/callback?state=${state}&code=c`, "admin", "s1")).headers.get("location")).toBe("/admin/youtube?result=failed");
    const s2 = (await startConnect("admin", "s2")).searchParams.get("state")!;
    expect((await get(`/api/admin/youtube/callback?state=${s2}&code=c`, "admin", "other-browser")).headers.get("location")).toBe("/admin/youtube?result=failed");
    const s3 = (await startConnect("admin", "s3")).searchParams.get("state")!;
    expect((await get(`/api/admin/youtube/callback?state=${s3}&code=c`, "other", "s3")).headers.get("location")).toBe("/admin/youtube?result=failed");
    expect(googleCalls).toHaveLength(0);
    expect(mem.saved).toHaveLength(0);
    expect(mem.errors.every((e) => e.code === "state")).toBe(true);
  });

  it("saves the connection for the expected channel, once", async () => {
    const state = (await startConnect()).searchParams.get("state")!;
    googleReplies = [{ json: tokens }, { json: { items: [{ id: DEFAULT_YOUTUBE_CHANNEL_ID, snippet: { title: "Construct HUB" } }] } }];
    const r = await get(`/api/admin/youtube/callback?state=${state}&code=good`, "admin");
    expect(r.headers.get("location")).toBe("/admin/youtube?result=connected");
    expect(mem.saved).toHaveLength(1);
    expect(mem.saved[0]).toMatchObject({ channelId: DEFAULT_YOUTUBE_CHANNEL_ID, channelTitle: "Construct HUB", scopes: [YT_UPLOAD_SCOPE, YT_READONLY_SCOPE], by: { id: 1, email: "owner@example.test" } });
    // The same state again: refused.
    expect((await get(`/api/admin/youtube/callback?state=${state}&code=good`, "admin")).headers.get("location")).toBe("/admin/youtube?result=failed");
    expect(mem.saved).toHaveLength(1);
    const status = await (await get("/api/admin/youtube/status", "admin")).text();
    expect(status).not.toContain("access-secret-fixture");
    expect(status).not.toContain("refresh-secret-fixture");
  });

  it("stores nothing when a different channel was picked, and keeps a message naming it", async () => {
    const state = (await startConnect()).searchParams.get("state")!;
    googleReplies = [{ json: tokens }, { json: { items: [{ id: "UCsomeoneElse", snippet: { title: "Personal Vlogs" } }] } }];
    const r = await get(`/api/admin/youtube/callback?state=${state}&code=good`, "admin");
    expect(r.headers.get("location")).toBe("/admin/youtube?result=failed");
    expect(mem.saved).toHaveLength(0);
    expect(mem.errors).toHaveLength(1);
    expect(mem.errors[0].code).toBe("wrong_channel");
    expect(mem.errors[0].message).toContain(`"Personal Vlogs" (UCsomeoneElse)`);
    expect(mem.errors[0].message).not.toMatch(/secret-fixture/);
  });

  it("records a cancelled consent without calling Google", async () => {
    const state = (await startConnect()).searchParams.get("state")!;
    await get(`/api/admin/youtube/callback?state=${state}&error=access_denied`, "admin");
    expect(mem.errors.at(-1).code).toBe("denied");
    expect(googleCalls).toHaveLength(0);
  });
});

describe("disconnect", () => {
  it("needs a same-site Origin, revokes at Google and deletes what is stored", async () => {
    mem.saved.push({ channelId: DEFAULT_YOUTUBE_CHANNEL_ID }); mem.refresh = "refresh-secret-fixture";
    expect((await post("/api/admin/youtube/disconnect", "admin", null)).status).toBe(403);
    expect((await post("/api/admin/youtube/disconnect", "admin", "https://evil.example")).status).toBe(403);
    expect(mem.deleted).toBe(0);
    googleReplies = [{ json: {} }];
    const r = await post("/api/admin/youtube/disconnect", "admin");
    expect(await r.json()).toEqual({ disconnected: true, removed: true, revokedAtGoogle: true });
    expect(googleCalls).toEqual(["https://oauth2.googleapis.com/revoke"]);
    expect(mem.saved).toHaveLength(0);
  });

  it("still deletes the stored connection when Google cannot be reached", async () => {
    mem.saved.push({ channelId: DEFAULT_YOUTUBE_CHANNEL_ID }); mem.refresh = "refresh-secret-fixture";
    googleReplies = []; // the fake fetch throws
    expect(await (await post("/api/admin/youtube/disconnect", "admin")).json()).toEqual({ disconnected: true, removed: true, revokedAtGoogle: false });
    expect(mem.saved).toHaveLength(0);
  });
});
