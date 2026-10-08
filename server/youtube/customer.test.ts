/**
 * Customers' own YouTube channels, end to end without Google: the real routes,
 * the real store against the LOCAL development database (fixture accounts,
 * removed afterwards), the real local-disk storage, and a mocked fetch for
 * every Google call. What is checked: only a signed-in account gets in; the
 * consent asks for upload + read-only and nothing else; the state is bound to
 * the session and works once; account A can never read, use or disconnect
 * account B's channel or videos; the daily caps; the certification is
 * required; and no response carries a token or a storage key.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.JOBCAM_STORAGE = "local";
process.env.YOUTUBE_CUSTOMER_WORKER_DISABLED = "true"; // the routes must not start a real pass; the tests run the worker's steps themselves

vi.mock("../growth-limits", () => ({ rateLimit: () => (_req: any, _res: any, next: any) => next() }));

import { pool } from "../db";
import {
  CUSTOMER_SCOPES, YT_ANALYTICS_SCOPE, YT_READONLY_SCOPE, YT_UPLOAD_SCOPE, UPLOAD_CHUNK_BYTES, completeConnect, consentUrl,
} from "./client";
import { ensureYoutubeCustomerSchema } from "./customer-schema";
import { CUSTOMER_YOUTUBE_CALLBACK_PATH, MAX_OPEN_FILES, publishInput, registerCustomerYoutubeRoutes, tagsLength } from "./customer-routes";
import { VIDEO_PART_BYTES, keyIsOwn, validateVideoFile, videoKey } from "./customer-media";
import { customerMessage, processingMessage, purgeCustomerYoutube, removeStoredFile, runCheck, runUpload } from "./customer-service";
import { claimNextUpload, customerStatus, dailyUsage, filesToDelete, getVideo, markFileDeleted } from "./customer-store";
import { objectSize } from "../jobcam/storage";

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
type Reply = { status?: number; json?: unknown; headers?: Record<string, string> };
let replies: Array<Reply | ((c: Call) => Reply)> = [];
const calls: Call[] = [];
const http = (async (url: any, init: any = {}) => {
  const call: Call = { url: String(url), method: init.method ?? "GET", headers: { ...(init.headers ?? {}) }, body: init.body };
  calls.push(call);
  const next = replies.shift();
  if (!next) throw new Error(`unexpected request: ${call.method} ${call.url}`);
  const r = typeof next === "function" ? next(call) : next;
  const status = r.status ?? 200, text = r.json === undefined ? "" : JSON.stringify(r.json);
  return { status, ok: status >= 200 && status < 300, headers: new Headers(r.headers ?? {}), json: async () => JSON.parse(text || "null"), text: async () => text } as unknown as Response;
}) as typeof fetch;

const USERS: Record<string, { id: number; email: string }> = {};
const sessions = new Map<string, any>();
const notices: Array<{ user: number; outcome: string; message?: string }> = [];
const worker = { http, retryDelayMs: 0, notify: async (v: any, outcome: "published" | "failed", message?: string) => { notices.push({ user: v.user_id, outcome, message }); } };
let server: Server, base = "", projectUsedBefore: number | null = null, day = "";
const saved: Record<string, string | undefined> = {};
const ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_CUSTOMER_DAILY_UPLOADS", "YOUTUBE_PROJECT_DAILY_UPLOADS", "YOUTUBE_CUSTOMER_MAX_BYTES"];
const ids = () => Object.values(USERS).map((u) => u.id);

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  for (const k of ENV) saved[k] = process.env[k];
  process.env.GOOGLE_CLIENT_ID = "client-id-fixture.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret-fixture";
  process.env.YOUTUBE_CUSTOMER_MAX_BYTES = String(20 * 1024 * 1024);
  await ensureYoutubeCustomerSchema();
  for (const name of ["a", "b", "c"]) {
    const email = `yt-cust-${name}-${randomUUID()}@example.invalid`;
    USERS[name] = { id: (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [email])).rows[0].id, email };
  }
  // The project-wide tally is one shared row per day: remember it and put it back.
  day = (await pool.query("SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date::text AS d")).rows[0].d;
  projectUsedBefore = (await pool.query("SELECT used FROM youtube_upload_daily WHERE day = $1::date AND user_id = 0", [day])).rows[0]?.used ?? null;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const sid = String(req.headers["x-test-session"] ?? "default");
    if (!sessions.has(sid)) sessions.set(sid, {});
    const s = sessions.get(sid);
    s.save = (cb: (e?: unknown) => void) => cb();
    req.session = s;
    req.user = USERS[String(req.headers["x-test-user"] ?? "")];
    next();
  });
  registerCustomerYoutubeRoutes(app, (req: any, res: any) => req.user ?? (res.status(401).json({ message: "Not authenticated" }), null), { http });
  server = app.listen(0, "127.0.0.1");
  await new Promise((ok) => server.once("listening", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await new Promise((ok) => server.close(ok));
  await pool.query("DELETE FROM youtube_customer_videos WHERE user_id = ANY($1::int[])", [ids()]);
  await pool.query("DELETE FROM youtube_customer_connections WHERE user_id = ANY($1::int[])", [ids()]);
  await pool.query("DELETE FROM youtube_upload_daily WHERE user_id = ANY($1::int[])", [ids()]);
  if (projectUsedBefore === null) await pool.query("DELETE FROM youtube_upload_daily WHERE day = $1::date AND user_id = 0", [day]);
  else await pool.query("UPDATE youtube_upload_daily SET used = $2 WHERE day = $1::date AND user_id = 0", [day, projectUsedBefore]);
  await pool.query("DELETE FROM account_activity WHERE user_id = ANY($1::int[])", [ids()]).catch(() => undefined);
  await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids()]);
  for (const id of ids()) fs.rmSync(path.join(process.cwd(), "tmp", "jobcam", "ytvideo", String(id)), { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  sessions.clear(); replies = []; calls.length = 0; notices.length = 0;
  process.env.YOUTUBE_CUSTOMER_DAILY_UPLOADS = "50";
  process.env.YOUTUBE_PROJECT_DAILY_UPLOADS = "100000";
  await pool.query("DELETE FROM youtube_customer_videos WHERE user_id = ANY($1::int[])", [ids()]);
  await pool.query("DELETE FROM youtube_customer_connections WHERE user_id = ANY($1::int[])", [ids()]);
  await pool.query("DELETE FROM youtube_upload_daily WHERE user_id = ANY($1::int[])", [ids()]);
});

const hdr = (user?: string, session = "s1", extra: Record<string, string> = {}) =>
  ({ ...(user ? { "x-test-user": user } : {}), "x-test-session": session, ...extra });
const get = (p: string, user?: string, session = "s1") => fetch(base + p, { redirect: "manual", headers: hdr(user, session) });
const send = (method: string, p: string, user?: string, body?: unknown, origin: string | null = base) =>
  fetch(base + p, {
    method, redirect: "manual",
    headers: hdr(user, "s1", { ...(origin ? { origin } : {}), ...(body !== undefined && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : { "content-type": "application/octet-stream" }) }),
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
const post = (p: string, user?: string, body: unknown = {}, origin: string | null = base) => send("POST", p, user, body, origin);

const tokensFor = (who: string) => ({ access_token: `access-secret-${who}`, refresh_token: `refresh-secret-${who}`, expires_in: 3600, scope: `${YT_UPLOAD_SCOPE} ${YT_READONLY_SCOPE}` });
const channelFor = (who: string) => ({ items: [{ id: `UC${who}-channel-000000000000`, snippet: { title: `${who.toUpperCase()} Roofing`, thumbnails: { default: { url: `https://yt3.ggpht.com/${who}=s88` } } } }] });

/** Connect `who`'s channel through the real connect + callback routes. */
async function connect(who: string, session = `s-${who}`) {
  const start = await get("/api/social/youtube/connect", who, session);
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  replies.push({ json: tokensFor(who) }, { json: channelFor(who) });
  const back = await get(`${CUSTOMER_YOUTUBE_CALLBACK_PATH}?state=${state}&code=code-${who}`, who, session);
  expect(back.headers.get("location")).toBe("/social-media?youtube=connected");
  calls.length = 0;
}

/** Send a file of `bytes` random bytes through the proxy path; returns its id and sha-256. */
async function storeVideo(who: string, bytes = 6 * 1024 * 1024) {
  const data = randomBytes(bytes);
  const opened = await post("/api/social/youtube/videos", who, { fileName: "walkthrough.mp4", mime: "video/mp4", bytes });
  expect(opened.status).toBe(201);
  const { video, partSize, partsTotal } = await opened.json();
  for (let n = 1; n <= partsTotal; n++) {
    const part = data.subarray((n - 1) * partSize, Math.min(n * partSize, bytes));
    const put = await send("PUT", `/api/social/youtube/videos/${video.id}/parts/${n}`, who, Buffer.from(part));
    expect(put.status).toBe(200);
  }
  const done = await post(`/api/social/youtube/videos/${video.id}/complete`, who);
  expect(done.status).toBe(200);
  expect((await done.json()).video.state).toBe("ready");
  return { id: video.id as string, sha: createHash("sha256").update(data).digest("hex"), bytes };
}
const GOOD = { title: "Kitchen remodel walkthrough", description: "Before and after.", tags: ["remodel", "kitchen"], privacy: "unlisted", madeForKids: false, certify: true };
const publish = (who: string, id: string, body: unknown = GOOD) => post(`/api/social/youtube/videos/${id}/publish`, who, body);
/** What the worker's claim does, for one named row (the shared dev database may hold other queued rows). */
async function lease(who: string, id: string) {
  await pool.query("UPDATE youtube_customer_videos SET state = 'uploading', lease_until = now() + interval '15 minutes' WHERE id = $1 AND state = 'queued'", [id]);
  return (await getVideo(USERS[who].id, id))!;
}
/** Google's side of one resumable upload: the session, then one answer per 8 MiB chunk (308 until the last). */
const uploadReplies = (videoId: string, got: Buffer[], bytes = 1) => {
  const chunks = Math.max(1, Math.ceil(bytes / UPLOAD_CHUNK_BYTES));
  replies.push({ status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session-fixture" } });
  for (let i = 1; i <= chunks; i++) replies.push((c) => {
    got.push(Buffer.from(c.body));
    return i < chunks
      ? { status: 308, headers: { range: `bytes=0-${i * UPLOAD_CHUNK_BYTES - 1}` } }
      : { status: 200, json: { id: videoId, status: { privacyStatus: "private", uploadStatus: "uploaded" } } };
  });
};

const ROUTES: Array<[string, string]> = [
  ["GET", "/api/social/youtube/status"], ["GET", "/api/social/youtube/connect"], ["GET", `${CUSTOMER_YOUTUBE_CALLBACK_PATH}?state=x&code=y`],
  ["POST", "/api/social/youtube/disconnect"], ["GET", "/api/social/youtube/videos"], ["POST", "/api/social/youtube/videos"],
  ["GET", `/api/social/youtube/videos/${randomUUID()}/parts/1`], ["PUT", `/api/social/youtube/videos/${randomUUID()}/parts/1`],
  ["POST", `/api/social/youtube/videos/${randomUUID()}/parts/1`], ["POST", `/api/social/youtube/videos/${randomUUID()}/complete`],
  ["POST", `/api/social/youtube/videos/${randomUUID()}/publish`], ["DELETE", `/api/social/youtube/videos/${randomUUID()}`],
];

describe("who gets in", () => {
  it("answers 401 signed out on every route and calls nobody", async () => {
    for (const [method, p] of ROUTES) {
      const r = method === "GET" ? await get(p) : await send(method, p, undefined, method === "PUT" ? Buffer.alloc(4) : {});
      expect([method, p, r.status]).toEqual([method, p, 401]);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a state-changing request that does not come from our own pages", async () => {
    await connect("a");
    for (const [method, p] of ROUTES.filter(([m]) => m !== "GET")) {
      const r = await send(method, p, "a", method === "PUT" ? Buffer.alloc(4) : {}, null);
      expect([method, p, r.status]).toEqual([method, p, 403]);
      const cross = await send(method, p, "a", method === "PUT" ? Buffer.alloc(4) : {}, "https://evil.example");
      expect([method, p, cross.status]).toEqual([method, p, 403]);
    }
    expect((await customerStatus(USERS.a.id)).connected).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("connect", () => {
  it("sends the customer to Google asking for upload + read-only and nothing else, with this host's callback", async () => {
    const r = await get("/api/social/youtube/connect", "a");
    expect(r.status).toBe(302);
    const url = new URL(r.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(`${YT_UPLOAD_SCOPE} ${YT_READONLY_SCOPE}`);
    expect(url.searchParams.get("scope")).not.toContain("analytics");
    expect(url.searchParams.get("scope")).not.toContain("force-ssl");
    expect(url.searchParams.get("redirect_uri")).toBe(`${base}/api/social/youtube/callback`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("state")).toBe(sessions.get("s1").youtubeCustomerOAuth.state);
    expect(sessions.get("s1").youtubeCustomerOAuth.userId).toBe(USERS.a.id);
    const json = await (await get("/api/social/youtube/connect?format=json", "a")).json();
    expect(new URL(json.url).host).toBe("accounts.google.com");
  });

  it("keeps the company connection's consent unchanged (three scopes) and gives customers two", () => {
    expect([...CUSTOMER_SCOPES]).toEqual([YT_UPLOAD_SCOPE, YT_READONLY_SCOPE]);
    expect(new URL(consentUrl("s", "https://x.test/cb")).searchParams.get("scope")).toContain(YT_ANALYTICS_SCOPE);
    expect(new URL(consentUrl("s", "https://x.test/cb", CUSTOMER_SCOPES)).searchParams.get("scope")).toBe(`${YT_UPLOAD_SCOPE} ${YT_READONLY_SCOPE}`);
  });

  it("refuses a callback whose state is wrong, missing, another account's, or already used — and asks Google nothing", async () => {
    await get("/api/social/youtube/connect", "a", "s1");
    const state = sessions.get("s1").youtubeCustomerOAuth.state;
    // Wrong state.
    let r = await get(`${CUSTOMER_YOUTUBE_CALLBACK_PATH}?state=${"0".repeat(64)}&code=c`, "a", "s1");
    expect(r.headers.get("location")).toBe("/social-media?youtube=failed");
    // The pending state was consumed by that attempt: the right one no longer works either.
    r = await get(`${CUSTOMER_YOUTUBE_CALLBACK_PATH}?state=${state}&code=c`, "a", "s1");
    expect(r.headers.get("location")).toBe("/social-media?youtube=failed");
    // Account B in the browser session where A started.
    await get("/api/social/youtube/connect", "a", "s2");
    r = await get(`${CUSTOMER_YOUTUBE_CALLBACK_PATH}?state=${sessions.get("s2").youtubeCustomerOAuth.state}&code=c`, "b", "s2");
    expect(r.headers.get("location")).toBe("/social-media?youtube=failed");
    // No state at all.
    r = await get(`${CUSTOMER_YOUTUBE_CALLBACK_PATH}?code=c`, "a", "s3");
    expect(r.headers.get("location")).toBe("/social-media?youtube=failed");
    expect(calls).toHaveLength(0);
    for (const who of ["a", "b"]) expect((await customerStatus(USERS[who].id)).connected).toBe(false);
    expect((await customerStatus(USERS.a.id)).lastError?.code).toBe("state");
  });

  it("connects whichever channel the customer picked, shows it, stores the tokens encrypted and returns none", async () => {
    const start = await get("/api/social/youtube/connect?business=42", "a");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    replies.push({ json: tokensFor("a") }, { json: channelFor("a") });
    const back = await get(`${CUSTOMER_YOUTUBE_CALLBACK_PATH}?state=${state}&code=the-code`, "a");
    expect(back.headers.get("location")).toBe("/social-media?business=42&youtube=connected");
    expect(calls.map((c) => c.url.split("?")[0])).toEqual(["https://oauth2.googleapis.com/token", "https://www.googleapis.com/youtube/v3/channels"]);
    expect(calls[1].headers.Authorization).toBe("Bearer access-secret-a");
    const res = await get("/api/social/youtube/status", "a");
    const body = await res.json();
    expect(body).toMatchObject({ connected: true, needsReconnect: false, lastError: null, channel: { id: "UCa-channel-000000000000", title: "A Roofing", thumbnail: "https://yt3.ggpht.com/a=s88", url: "https://www.youtube.com/channel/UCa-channel-000000000000" } });
    expect(JSON.stringify(body)).not.toMatch(/secret|token/i);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const { rows: [row] } = await pool.query("SELECT refresh_token, access_token FROM youtube_customer_connections WHERE user_id = $1", [USERS.a.id]);
    expect(row.refresh_token).toMatch(/^v1:/);
    expect(row.access_token).toMatch(/^v1:/);
    expect(row.refresh_token + row.access_token).not.toContain("secret");
  });

  it("says why in plain words when Google is cancelled or the account has no channel, and stores no connection", async () => {
    await get("/api/social/youtube/connect", "a");
    let r = await get(`${CUSTOMER_YOUTUBE_CALLBACK_PATH}?state=${sessions.get("s1").youtubeCustomerOAuth.state}&error=access_denied`, "a");
    expect(r.headers.get("location")).toBe("/social-media?youtube=failed");
    expect((await customerStatus(USERS.a.id)).lastError?.message).toMatch(/cancelled/);
    await get("/api/social/youtube/connect", "a");
    replies.push({ json: tokensFor("a") }, { json: { items: [] } });
    r = await get(`${CUSTOMER_YOUTUBE_CALLBACK_PATH}?state=${sessions.get("s1").youtubeCustomerOAuth.state}&code=c`, "a");
    expect(r.headers.get("location")).toBe("/social-media?youtube=failed");
    const s = await customerStatus(USERS.a.id);
    expect(s.connected).toBe(false);
    expect(s.lastError).toMatchObject({ code: "no_channel" });
    expect(s.lastError!.message).toMatch(/no YouTube channel/);
  });

  it("completeConnect: the company flow still refuses another channel; the customer flow takes the one that was picked", async () => {
    const reply = () => { replies.push({ json: tokensFor("x") }, { json: channelFor("x") }); };
    reply();
    await expect(completeConnect({ code: "c", redirectUri: "https://x.test/cb" }, http)).rejects.toMatchObject({ code: "wrong_channel" });
    reply();
    await expect(completeConnect({ code: "c", redirectUri: "https://x.test/cb", anyChannel: true }, http)).resolves.toMatchObject({ channelId: "UCx-channel-000000000000", channelTitle: "X Roofing" });
  });
});

describe("one account never reaches another's channel or videos", () => {
  it("B sees no connection, cannot use A's video in any route, and B's disconnect leaves A untouched", async () => {
    await connect("a");
    const video = await storeVideo("a");
    expect((await (await get("/api/social/youtube/status", "b")).json())).toMatchObject({ connected: false, channel: null });
    expect((await (await get("/api/social/youtube/videos", "b")).json()).videos).toEqual([]);
    // Not connected: B cannot even open an upload.
    expect((await post("/api/social/youtube/videos", "b", { fileName: "x.mp4", mime: "video/mp4", bytes: 1024 })).status).toBe(409);

    await connect("b");
    const id = video.id;
    expect((await get(`/api/social/youtube/videos/${id}/parts/1`, "b")).status).toBe(404);
    expect((await send("PUT", `/api/social/youtube/videos/${id}/parts/1`, "b", Buffer.alloc(8))).status).toBe(404);
    expect((await post(`/api/social/youtube/videos/${id}/parts/1`, "b", { etag: "x" })).status).toBe(404);
    expect((await post(`/api/social/youtube/videos/${id}/complete`, "b")).status).toBe(404);
    expect((await publish("b", id)).status).toBe(404);
    expect((await send("DELETE", `/api/social/youtube/videos/${id}`, "b", {})).status).toBe(404);
    expect((await (await get("/api/social/youtube/videos", "b")).json()).videos).toEqual([]);
    expect((await getVideo(USERS.a.id, id))?.state).toBe("ready");
    expect(await getVideo(USERS.b.id, id)).toBeNull();
    expect((await dailyUsage(USERS.b.id)).usedByCustomer).toBe(0);

    // B disconnects: only B's token is revoked, only B's rows go.
    replies.push({ status: 200, json: {} });
    const out = await (await post("/api/social/youtube/disconnect", "b")).json();
    expect(out).toMatchObject({ disconnected: true, removed: true, revokedAtGoogle: true });
    expect(calls).toHaveLength(1);
    expect(String(calls[0].body)).toBe("token=refresh-secret-b");
    expect((await customerStatus(USERS.a.id))).toMatchObject({ connected: true, channelId: "UCa-channel-000000000000" });
    expect((await getVideo(USERS.a.id, id))?.state).toBe("ready");
    // C never connected: disconnect removes nothing and calls nobody.
    calls.length = 0;
    expect(await (await post("/api/social/youtube/disconnect", "c")).json()).toMatchObject({ removed: false, revokedAtGoogle: false });
    expect(calls).toHaveLength(0);
  });

  it("A's video is uploaded with A's sign-in and to A's channel only", async () => {
    await connect("a"); await connect("b");
    const video = await storeVideo("a", 9 * 1024 * 1024);
    expect((await publish("a", video.id)).status).toBe(202);
    const got: Buffer[] = [];
    uploadReplies("vidA1234567", got, video.bytes);
    await runUpload(await lease("a", video.id), worker);
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c.headers.Authorization).toBe("Bearer access-secret-a");
    // Sent in two ranges (8 MiB + 1 MiB), byte for byte what the customer stored.
    expect(got.map((b) => b.length)).toEqual([UPLOAD_CHUNK_BYTES, 9 * 1024 * 1024 - UPLOAD_CHUNK_BYTES]);
    expect(createHash("sha256").update(Buffer.concat(got)).digest("hex")).toBe(video.sha);
    expect(JSON.parse(calls[0].body)).toMatchObject({ snippet: { title: GOOD.title, tags: GOOD.tags }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false } });
    const row = (await getVideo(USERS.a.id, video.id))!;
    expect(row).toMatchObject({ state: "processing", youtube_video_id: "vidA1234567", actual_privacy: "private", channel_id: "UCa-channel-000000000000" });
    expect((await (await get("/api/social/youtube/videos", "b")).json()).videos).toEqual([]);
  });

  it("a channel swapped after the video was queued gets nothing", async () => {
    await connect("a");
    const video = await storeVideo("a");
    await publish("a", video.id);
    await pool.query("UPDATE youtube_customer_connections SET channel_id = 'UCother-channel-0000000000' WHERE user_id = $1", [USERS.a.id]);
    await runUpload(await lease("a", video.id), worker);
    expect(calls).toHaveLength(0);
    expect((await getVideo(USERS.a.id, video.id))).toMatchObject({ state: "failed", error_code: "channel_changed" });
    expect((await dailyUsage(USERS.a.id)).usedByCustomer).toBe(0); // never reached YouTube: not counted
  });
});

describe("sending a file", () => {
  it("accepts video files up to the cap and nothing else", async () => {
    await connect("a");
    const open = (body: unknown) => post("/api/social/youtube/videos", "a", body);
    expect((await open({ fileName: "a.exe", mime: "application/x-msdownload", bytes: 10 })).status).toBe(415);
    expect((await open({ fileName: "a.jpg", mime: "image/jpeg", bytes: 10 })).status).toBe(415);
    expect((await open({ fileName: "a.mp4", mime: "video/mp4", bytes: 21 * 1024 * 1024 })).status).toBe(413);
    expect((await open({ fileName: "a.mp4", mime: "video/mp4", bytes: 0 })).status).toBe(400);
    expect((await open({ fileName: "a.mp4", mime: "video/mp4" })).status).toBe(400);
    expect(validateVideoFile({ mime: "video/quicktime; codecs=x", bytes: VIDEO_PART_BYTES + 1 }, 1e9)).toMatchObject({ ok: true, ext: "mov", partsTotal: 2 });
  });

  it("keeps each stored file inside its own account's tree and refuses a part of the wrong size", async () => {
    await connect("a");
    const opened = await (await post("/api/social/youtube/videos", "a", { fileName: "../../etc/pass<wd>.mp4", mime: "video/mp4", bytes: 1000 })).json();
    expect(opened.video.fileName).toBe("passwd.mp4");
    expect(JSON.stringify(opened)).not.toMatch(/ytvideo|storage/);
    const row = (await getVideo(USERS.a.id, opened.video.id))!;
    expect(row.storage_key).toBe(`ytvideo/${USERS.a.id}/${row.id}/original.mp4`);
    expect(keyIsOwn(row)).toBe(true);
    expect(keyIsOwn({ ...row, user_id: USERS.b.id })).toBe(false);
    expect(keyIsOwn({ ...row, storage_key: `jobcam/${USERS.a.id}/${row.id}/original.mp4` })).toBe(false);
    expect(() => videoKey(1, "../x", "mp4")).toThrow();
    expect((await send("PUT", `/api/social/youtube/videos/${row.id}/parts/1`, "a", Buffer.alloc(999))).status).toBe(400);
    expect((await send("PUT", `/api/social/youtube/videos/${row.id}/parts/2`, "a", Buffer.alloc(1000))).status).toBe(400);
    // Not complete yet: it cannot be finished or published.
    expect((await post(`/api/social/youtube/videos/${row.id}/complete`, "a")).status).toBe(409);
    expect((await publish("a", row.id)).status).toBe(409);
  });

  it(`stops at ${MAX_OPEN_FILES} files waiting, and removing one frees the slot and deletes the file`, async () => {
    await connect("a");
    const ids: string[] = [];
    for (let i = 0; i < MAX_OPEN_FILES; i++) ids.push((await storeVideo("a", 2048)).id);
    expect((await post("/api/social/youtube/videos", "a", { fileName: "x.mp4", mime: "video/mp4", bytes: 2048 })).status).toBe(429);
    const key = (await getVideo(USERS.a.id, ids[0]))!.storage_key;
    expect(await objectSize(key)).toBe(2048);
    expect((await send("DELETE", `/api/social/youtube/videos/${ids[0]}`, "a", {})).status).toBe(200);
    expect(await objectSize(key)).toBeNull();
    expect((await post("/api/social/youtube/videos", "a", { fileName: "x.mp4", mime: "video/mp4", bytes: 2048 })).status).toBe(201);
  });
});

describe("publishing", () => {
  it("requires the certification, an explicit made-for-kids answer, and details YouTube accepts", async () => {
    await connect("a");
    const { id } = await storeVideo("a", 4096);
    const bad = async (patch: Record<string, unknown>, words: RegExp) => {
      const r = await publish("a", id, { ...GOOD, ...patch });
      expect([JSON.stringify(patch).slice(0, 60), r.status]).toEqual([JSON.stringify(patch).slice(0, 60), 400]);
      expect((await r.json()).message).toMatch(words);
    };
    await bad({ certify: false }, /Community Guidelines.*own the rights/);
    await bad({ certify: undefined }, /Community Guidelines/);
    await bad({ certify: "yes" }, /Community Guidelines/);
    await bad({ madeForKids: undefined }, /made for kids/);
    await bad({ madeForKids: "no" }, /made for kids/);
    await bad({ title: "" }, /title/);
    await bad({ title: "x".repeat(101) }, /100 characters/);
    await bad({ title: "a <b>" }, /< or >/);
    await bad({ description: "x".repeat(5001) }, /5,000 characters/);
    await bad({ privacy: "everyone" }, /public, unlisted or private/);
    await bad({ tags: Array(31).fill("t") }, /30 tags/);
    await bad({ tags: Array(10).fill("x".repeat(55)) }, /500 characters/);
    await bad({ extra: 1 }, /./);
    expect((await getVideo(USERS.a.id, id))!.state).toBe("ready");
    expect((await dailyUsage(USERS.a.id)).usedByCustomer).toBe(0);
    expect(tagsLength(["two words", "one"])).toBe(9 + 2 + 1 + 3);
    // Privacy defaults to private — the Social Media tool's default for a new destination.
    expect(publishInput.parse({ title: "t", madeForKids: true, certify: true })).toMatchObject({ privacy: "private", description: "", tags: [] });
  });

  it("queues once, records when it was certified and for which channel, and refuses a second click", async () => {
    await connect("a");
    const { id } = await storeVideo("a", 4096);
    const r = await publish("a", id);
    expect(r.status).toBe(202);
    const body = await r.json();
    expect(body.video).toMatchObject({ state: "queued", title: GOOD.title, privacy: "unlisted", madeForKids: false, channelTitle: "A Roofing", watchUrl: null });
    expect(JSON.stringify(body)).not.toMatch(/secret|token|ytvideo|storage/i);
    const row = (await getVideo(USERS.a.id, id))!;
    expect(row.certified_at).toBeInstanceOf(Date);
    expect(row.channel_id).toBe("UCa-channel-000000000000");
    expect((await publish("a", id)).status).toBe(409);
    expect((await dailyUsage(USERS.a.id)).usedByCustomer).toBe(1);
    // The worker's claim takes the oldest queued row (checked only when no other lane has rows queued in this shared database).
    const { rows: [others] } = await pool.query("SELECT count(*)::int AS n FROM youtube_customer_videos WHERE state = 'queued' AND user_id <> ALL($1::int[])", [ids()]);
    if (others.n === 0) {
      const claimed = await claimNextUpload();
      expect(claimed).toMatchObject({ id, state: "uploading" });
      expect(await claimNextUpload()).toBeNull();
      // Being sent right now: it cannot be removed from under the upload.
      expect((await send("DELETE", `/api/social/youtube/videos/${id}`, "a", {})).status).toBe(409);
    }
  });

  it("stops at the per-account daily cap and at the project-wide cap, and says to try tomorrow", async () => {
    await connect("a"); await connect("b");
    process.env.YOUTUBE_CUSTOMER_DAILY_UPLOADS = "2";
    const a = [await storeVideo("a", 2048), await storeVideo("a", 2048), await storeVideo("a", 2048)];
    expect((await publish("a", a[0].id)).status).toBe(202);
    expect((await publish("a", a[1].id)).status).toBe(202);
    const third = await publish("a", a[2].id);
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: "customer_cap", message: expect.stringMatching(/Daily limit reached: 2 videos per day.*tomorrow/) });
    expect((await getVideo(USERS.a.id, a[2].id))!.state).toBe("ready");
    expect((await (await get("/api/social/youtube/status", "a")).json()).limits).toMatchObject({ perDay: 2, usedToday: 2, sharedLimitReached: false });
    // A's cap is A's: B still has room…
    const b = [await storeVideo("b", 2048), await storeVideo("b", 2048)];
    expect((await publish("b", b[0].id)).status).toBe(202);
    // …until the whole project's allowance for today is used.
    const { usedByProject } = await dailyUsage(USERS.b.id);
    process.env.YOUTUBE_PROJECT_DAILY_UPLOADS = String(usedByProject);
    const shared = await publish("b", b[1].id);
    expect(shared.status).toBe(429);
    expect(await shared.json()).toMatchObject({ code: "project_cap", message: expect.stringMatching(/shared YouTube allowance.*tomorrow/) });
    expect((await dailyUsage(USERS.b.id))).toMatchObject({ usedByCustomer: 1, usedByProject });
    expect((await (await get("/api/social/youtube/status", "b")).json()).limits.sharedLimitReached).toBe(true);
    // Removing a queued video gives the slot back.
    expect((await send("DELETE", `/api/social/youtube/videos/${a[1].id}`, "a", {})).status).toBe(200);
    expect((await dailyUsage(USERS.a.id)).usedByCustomer).toBe(1);
  });

  it("needs a working connection", async () => {
    await connect("a");
    const { id } = await storeVideo("a", 2048);
    await pool.query("UPDATE youtube_customer_connections SET needs_reconnect = true WHERE user_id = $1", [USERS.a.id]);
    const r = await publish("a", id);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "needs_reconnect", message: expect.stringMatching(/Reconnect/) });
  });
});

describe("the upload job", () => {
  it("goes queued → uploading → processing → published with the watch link, then the stored file is deleted", async () => {
    await connect("a");
    const video = await storeVideo("a");
    await publish("a", video.id);
    const got: Buffer[] = [];
    uploadReplies("vidB1234567", got);
    await runUpload(await lease("a", video.id), worker);
    let listed = (await (await get("/api/social/youtube/videos", "a")).json()).videos[0];
    expect(listed).toMatchObject({ state: "processing", videoId: "vidB1234567", watchUrl: "https://www.youtube.com/watch?v=vidB1234567", privacy: "unlisted", actualPrivacy: "private", sentBytes: video.bytes });
    calls.length = 0;
    replies.push({ json: { items: [{ status: { uploadStatus: "uploaded", privacyStatus: "private" } }] } });
    await runCheck((await getVideo(USERS.a.id, video.id))!, worker);
    expect((await getVideo(USERS.a.id, video.id))!.state).toBe("processing");
    replies.push({ json: { items: [{ status: { uploadStatus: "processed", privacyStatus: "unlisted" } }] } });
    await runCheck((await getVideo(USERS.a.id, video.id))!, worker);
    expect(calls.every((c) => c.url.startsWith("https://www.googleapis.com/youtube/v3/videos?part=status&id=vidB1234567") && c.headers.Authorization === "Bearer access-secret-a")).toBe(true);
    listed = (await (await get("/api/social/youtube/videos", "a")).json()).videos[0];
    expect(listed).toMatchObject({ state: "published", actualPrivacy: "unlisted", error: null });
    expect(listed.publishedAt).toBeTruthy();
    expect(notices).toEqual([{ user: USERS.a.id, outcome: "published", message: undefined }]);
    // Housekeeping: YouTube has it, so our copy goes.
    const row = (await getVideo(USERS.a.id, video.id))!;
    expect((await filesToDelete(500)).some((v) => v.id === video.id)).toBe(true);
    await removeStoredFile(row); await markFileDeleted(row.id);
    expect(await objectSize(row.storage_key)).toBeNull();
    expect((await (await get("/api/social/youtube/videos", "a")).json()).videos[0]).toMatchObject({ state: "published", fileAvailable: false });
  });

  it("an expired sign-in fails the video in plain words, marks the connection for Reconnect and does not count the upload", async () => {
    await connect("a");
    const video = await storeVideo("a", 2048);
    await publish("a", video.id);
    await pool.query("UPDATE youtube_customer_connections SET expires_at = now() - interval '1 hour' WHERE user_id = $1", [USERS.a.id]);
    replies.push({ status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
    await runUpload(await lease("a", video.id), worker);
    const listed = (await (await get("/api/social/youtube/videos", "a")).json()).videos[0];
    expect(listed).toMatchObject({ state: "failed", errorCode: "needs_reconnect", fileAvailable: true });
    expect(listed.error).toMatch(/expired.*Reconnect/);
    expect(listed.error).not.toMatch(/invalid_grant|revoked\./);
    expect((await (await get("/api/social/youtube/status", "a")).json())).toMatchObject({ connected: true, needsReconnect: true });
    expect((await dailyUsage(USERS.a.id)).usedByCustomer).toBe(0);
    expect(notices[0]).toMatchObject({ outcome: "failed" });
    // After reconnecting, the same stored file can be sent again.
    await connect("a");
    expect((await publish("a", video.id)).status).toBe(202);
  });

  it("turns YouTube's refusals into sentences: quota, the channel's own upload limit, a rejected video", async () => {
    await connect("a");
    const refuse = async (status: number, reason: string) => {
      const video = await storeVideo("a", 2048);
      await publish("a", video.id);
      replies.push({ status, json: { error: { errors: [{ reason }], message: "raw google text that must not be shown" } } });
      await runUpload(await lease("a", video.id), worker);
      const row = (await getVideo(USERS.a.id, video.id))!;
      expect(row.state).toBe("failed");
      expect(row.error).not.toMatch(/raw google text/);
      await send("DELETE", `/api/social/youtube/videos/${video.id}`, "a", {});
      return row.error!;
    };
    expect(await refuse(403, "quotaExceeded")).toMatch(/daily upload allowance.*tomorrow/);
    expect(await refuse(400, "uploadLimitExceeded")).toMatch(/upload limit.*phone number.*youtube\.com\/verify/);
    expect(await refuse(403, "youtubeSignupRequired")).toMatch(/no YouTube channel/);
    expect(await refuse(400, "somethingNew")).toBe("YouTube did not accept the upload (somethingNew). Try again; if it keeps failing, upload the file in YouTube Studio to see YouTube's own message.");
    // YouTube counted those attempts (the request reached it), so they stay on today's tally.
    expect((await dailyUsage(USERS.a.id)).usedByCustomer).toBe(4);

    const video = await storeVideo("a", 2048);
    await publish("a", video.id);
    uploadReplies("vidC1234567", []);
    await runUpload(await lease("a", video.id), worker);
    replies.push({ json: { items: [{ status: { uploadStatus: "rejected", rejectionReason: "length" } }] } });
    await runCheck((await getVideo(USERS.a.id, video.id))!, worker);
    expect((await getVideo(USERS.a.id, video.id))).toMatchObject({ state: "failed", error_code: "rejected", error: expect.stringMatching(/15 minutes.*youtube\.com\/verify/) });
    expect(customerMessage("request", "<script>")).not.toContain("<");
    expect(processingMessage("failed", "codec")).toMatch(/could not process the file \(codec\)/);
  });
});

describe("disconnect", () => {
  it("revokes at Google and deletes the connection, every video record and every stored file of that account", async () => {
    await connect("a");
    const ready = await storeVideo("a", 2048);
    const half = await (await post("/api/social/youtube/videos", "a", { fileName: "half.mp4", mime: "video/mp4", bytes: 2048 })).json();
    const keys = [(await getVideo(USERS.a.id, ready.id))!.storage_key, (await getVideo(USERS.a.id, half.video.id))!.storage_key];
    replies.push({ status: 200, json: {} });
    const out = await (await post("/api/social/youtube/disconnect", "a")).json();
    expect(out).toEqual({ disconnected: true, removed: true, revokedAtGoogle: true, videosRemoved: 2 });
    expect(calls.map((c) => [c.url, String(c.body)])).toEqual([["https://oauth2.googleapis.com/revoke", "token=refresh-secret-a"]]);
    for (const table of ["youtube_customer_connections", "youtube_customer_videos"])
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [USERS.a.id])).rows[0].n).toBe(0);
    for (const k of keys) expect(await objectSize(k)).toBeNull();
    expect(await (await get("/api/social/youtube/status", "a")).json()).toMatchObject({ connected: false, channel: null, lastError: null });
  });

  it("still deletes everything when Google cannot be reached (account deletion uses the same routine)", async () => {
    await connect("a");
    await storeVideo("a", 2048);
    const out = await purgeCustomerYoutube(USERS.a.id, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(out).toEqual({ removed: true, revokedAtGoogle: false, videos: 1 });
    expect((await customerStatus(USERS.a.id)).connected).toBe(false);
  });
});
