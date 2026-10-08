/**
 * The YouTube library with a mocked fetch and an in-memory store: nothing here
 * reaches Google or the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_YOUTUBE_CHANNEL_ID, UPLOAD_CHUNK_BYTES, YT_ANALYTICS_SCOPE, YT_FORCE_SSL_SCOPE, YT_READONLY_SCOPE, YT_UPLOAD_SCOPE, YoutubeError,
  addToPlaylist, analyticsUrl, captionRequest, completeConnect, consentUrl, expectedChannelId, getChannelAnalytics, getYoutubeAccessToken,
  newPendingState, oauthErrorCode, requestedScopes, revokeToken, setThumbnail, stateMatches, uploadCaption, uploadSessionRequest, uploadVideo,
  PUBLISH_AT_MIN_LEAD_MS, getVideoStatus, normalizePublishAt, updateVideoSchedule, updateVideoSnippet,
  type Deps, type YoutubeGrant,
} from "./client";

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
type Reply = { status?: number; json?: unknown; headers?: Record<string, string> } | ((c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> });

/** A fetch that answers from a queue and records what it was asked. */
function mockFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const http = (async (url: any, init: any = {}) => {
    const call: Call = { url: String(url), method: init.method ?? "GET", headers: { ...(init.headers ?? {}) }, body: init.body };
    calls.push(call);
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request: ${call.method} ${call.url}`);
    const r = typeof next === "function" ? next(call) : next;
    return fakeResponse(r.status ?? 200, r.json, r.headers);
  }) as typeof fetch;
  return { http, calls };
}
/** Response cannot be built with status 308 in every runtime, so the mock hands back a minimal look-alike. */
function fakeResponse(status: number, json: unknown, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers);
  const text = json === undefined ? "" : JSON.stringify(json);
  return { status, ok: status >= 200 && status < 300, headers: h, json: async () => JSON.parse(text || "null"), text: async () => text } as unknown as Response;
}

function memoryStore(initial: Partial<YoutubeGrant> | null = {}) {
  const state = {
    grant: initial === null ? null : {
      channelId: DEFAULT_YOUTUBE_CHANNEL_ID, refreshToken: "refresh-fixture", accessToken: "access-fixture",
      expiresAt: new Date(NOW + 3_600_000), scopes: [YT_UPLOAD_SCOPE, YT_READONLY_SCOPE, YT_ANALYTICS_SCOPE], needsReconnect: false, ...initial,
    } as YoutubeGrant | null,
    saved: [] as any[],
    reconnectReasons: [] as string[],
  };
  const store = {
    load: async () => state.grant,
    saveAccess: async (t: any) => { state.saved.push(t); if (state.grant) Object.assign(state.grant, { accessToken: t.accessToken, expiresAt: t.expiresAt, refreshToken: t.refreshToken ?? state.grant.refreshToken }); },
    markNeedsReconnect: async (reason: string) => { state.reconnectReasons.push(reason); if (state.grant) state.grant.needsReconnect = true; },
  };
  return { store, state };
}

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const deps = (http: typeof fetch, store: Deps["store"]): Deps => ({ http, store, now: () => NOW, retryDelayMs: 0 });
const form = (c: Call) => Object.fromEntries(new URLSearchParams(String(c.body)));

let dir = "";
const saved: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_CHANNEL_ID", "YOUTUBE_EXTRA_SCOPES"]) saved[k] = process.env[k];
  process.env.GOOGLE_CLIENT_ID = "client-id-fixture.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret-fixture";
  delete process.env.YOUTUBE_CHANNEL_ID;
  delete process.env.YOUTUBE_EXTRA_SCOPES;
  dir = await mkdtemp(path.join(tmpdir(), "chub-youtube-"));
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(dir, { recursive: true, force: true });
});

describe("consent URL and scopes", () => {
  it("asks once for upload, read-back and analytics, offline, with the consent prompt and the state", () => {
    const url = new URL(consentUrl("state-fixture", "https://constructhub.us/api/admin/youtube/callback"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("client-id-fixture.apps.googleusercontent.com");
    expect(q.get("redirect_uri")).toBe("https://constructhub.us/api/admin/youtube/callback");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")!.split(" ")).toEqual([YT_UPLOAD_SCOPE, YT_READONLY_SCOPE, YT_ANALYTICS_SCOPE]);
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toContain("consent");
    expect(q.get("state")).toBe("state-fixture");
    expect(url.toString()).not.toContain("client-secret-fixture");
  });

  it("adds an opted-in scope from YOUTUBE_EXTRA_SCOPES and ignores anything that is not a Google scope", () => {
    process.env.YOUTUBE_EXTRA_SCOPES = `${YT_FORCE_SSL_SCOPE}, https://evil.example/scope ${YT_UPLOAD_SCOPE}`;
    try { expect(requestedScopes()).toEqual([YT_UPLOAD_SCOPE, YT_READONLY_SCOPE, YT_ANALYTICS_SCOPE, YT_FORCE_SSL_SCOPE]); }
    finally { delete process.env.YOUTUBE_EXTRA_SCOPES; }
  });

  it("expects the company channel unless YOUTUBE_CHANNEL_ID says otherwise", () => {
    expect(expectedChannelId()).toBe("UCRsxhhzhirrQCnqETChhyFw");
    process.env.YOUTUBE_CHANNEL_ID = " UCother ";
    try { expect(expectedChannelId()).toBe("UCother"); } finally { delete process.env.YOUTUBE_CHANNEL_ID; }
  });
});

describe("state verification", () => {
  const pending = newPendingState(7, "https://constructhub.us/api/admin/youtube/callback", NOW);
  it("makes a long random state that lasts ten minutes", () => {
    expect(pending.state).toMatch(/^[0-9a-f]{64}$/);
    expect(newPendingState(7, "x", NOW).state).not.toBe(pending.state);
    expect(pending.expires).toBe(NOW + 600_000);
  });
  it("accepts only the same state, for the same admin, before it expires", () => {
    expect(stateMatches(pending, 7, pending.state, NOW + 1000)).toBe(true);
    expect(stateMatches(pending, 8, pending.state, NOW + 1000)).toBe(false);
    expect(stateMatches(pending, 7, pending.state, NOW + 600_001)).toBe(false);
    expect(stateMatches(pending, 7, `${pending.state.slice(0, -1)}${pending.state.endsWith("0") ? "1" : "0"}`, NOW)).toBe(false);
    expect(stateMatches(pending, 7, "", NOW)).toBe(false);
    expect(stateMatches(pending, 7, undefined, NOW)).toBe(false);
    expect(stateMatches(pending, 7, [pending.state], NOW)).toBe(false);
    expect(stateMatches(undefined, 7, pending.state, NOW)).toBe(false);
  });
});

describe("completing the connection", () => {
  const tokens = { access_token: "access-new", refresh_token: "refresh-new", expires_in: 3599, scope: `${YT_UPLOAD_SCOPE} ${YT_READONLY_SCOPE} ${YT_ANALYTICS_SCOPE}` };
  const channel = (id: string, title: string) => ({ id, snippet: { title } });
  const input = { code: "code-fixture", redirectUri: "https://constructhub.us/api/admin/youtube/callback" };

  it("exchanges the code, reads the channel back and returns the grant for the expected channel", async () => {
    const { http, calls } = mockFetch([{ json: tokens }, { json: { items: [channel("UCpersonal", "Personal"), channel(DEFAULT_YOUTUBE_CHANNEL_ID, "Construct HUB")] } }]);
    const done = await completeConnect(input, http, () => NOW);
    expect(done).toEqual({
      channelId: DEFAULT_YOUTUBE_CHANNEL_ID, channelTitle: "Construct HUB", refreshToken: "refresh-new", accessToken: "access-new",
      expiresAt: new Date(NOW + 3_599_000), scopes: [YT_UPLOAD_SCOPE, YT_READONLY_SCOPE, YT_ANALYTICS_SCOPE],
    });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].method).toBe("POST");
    expect(form(calls[0])).toEqual({
      client_id: "client-id-fixture.apps.googleusercontent.com", client_secret: "client-secret-fixture", code: "code-fixture",
      redirect_uri: input.redirectUri, grant_type: "authorization_code",
    });
    expect(calls[1].url).toBe("https://www.googleapis.com/youtube/v3/channels?part=id%2Csnippet&mine=true&maxResults=50");
    expect(calls[1].headers.Authorization).toBe("Bearer access-new");
  });

  it("refuses a different channel, names the one that was picked, and returns no tokens", async () => {
    const { http } = mockFetch([{ json: tokens }, { json: { items: [channel("UCpersonal123", "Joe's Personal Channel")] } }]);
    const err = await completeConnect(input, http).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(YoutubeError);
    expect(err.code).toBe("wrong_channel");
    expect(err.message).toContain(`"Joe's Personal Channel" (UCpersonal123)`);
    expect(err.message).toContain(DEFAULT_YOUTUBE_CHANNEL_ID);
    expect(err.message).toContain("Nothing was connected");
    expect(JSON.stringify({ m: err.message, x: err.extra })).not.toMatch(/access-new|refresh-new/);
  });

  it("refuses an account with no channel", async () => {
    const { http } = mockFetch([{ json: tokens }, { json: { items: [] } }]);
    await expect(completeConnect(input, http)).rejects.toMatchObject({ code: "no_channel" });
  });

  it("connects without the analytics scope and records what was granted", async () => {
    const { http } = mockFetch([{ json: { ...tokens, scope: `${YT_READONLY_SCOPE} ${YT_UPLOAD_SCOPE}` } }, { json: { items: [channel(DEFAULT_YOUTUBE_CHANNEL_ID, "Construct HUB")] } }]);
    expect((await completeConnect(input, http)).scopes).toEqual([YT_READONLY_SCOPE, YT_UPLOAD_SCOPE]);
  });

  it("requires the upload scope and a refresh token", async () => {
    const a = mockFetch([{ json: { ...tokens, scope: YT_READONLY_SCOPE } }]);
    await expect(completeConnect(input, a.http)).rejects.toMatchObject({ code: "scope" });
    expect(a.calls).toHaveLength(1); // never asked for the channel
    const b = mockFetch([{ json: { ...tokens, refresh_token: undefined } }]);
    await expect(completeConnect(input, b.http)).rejects.toMatchObject({ code: "no_refresh_token" });
  });

  it("says so when the channel cannot be read back because readonly was not granted", async () => {
    const { http } = mockFetch([{ json: { ...tokens, scope: YT_UPLOAD_SCOPE } }, { status: 403, json: { error: { message: "insufficient" } } }]);
    await expect(completeConnect(input, http)).rejects.toMatchObject({ code: "scope" });
  });

  it("maps Google's redirect-URI and scope refusals, without echoing Google's text", async () => {
    const { http } = mockFetch([{ status: 400, json: { error: "redirect_uri_mismatch", error_description: "secret-detail access-new" } }]);
    const err = await completeConnect(input, http).then(() => null, (e) => e);
    expect(err.code).toBe("redirect_uri");
    expect(err.message).not.toContain("secret-detail");
    expect(oauthErrorCode("invalid_scope")).toBe("scope");
    expect(oauthErrorCode("access_denied")).toBe("denied");
    expect(oauthErrorCode("anything_else")).toBe("exchange");
  });
});

describe("access token", () => {
  it("returns the stored token while it is fresh, without calling Google", async () => {
    const { http, calls } = mockFetch([]);
    expect(await getYoutubeAccessToken(deps(http, memoryStore().store))).toBe("access-fixture");
    expect(calls).toHaveLength(0);
  });

  it("refreshes an expired token and saves the new one", async () => {
    const m = memoryStore({ expiresAt: new Date(NOW + 30_000) });
    const { http, calls } = mockFetch([{ json: { access_token: "access-2", expires_in: 3600 } }]);
    expect(await getYoutubeAccessToken(deps(http, m.store))).toBe("access-2");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(form(calls[0])).toEqual({
      client_id: "client-id-fixture.apps.googleusercontent.com", client_secret: "client-secret-fixture",
      refresh_token: "refresh-fixture", grant_type: "refresh_token",
    });
    expect(m.state.saved).toEqual([{ accessToken: "access-2", expiresAt: new Date(NOW + 3_600_000), refreshToken: null }]);
  });

  it("marks the connection as needing a reconnect on invalid_grant, and then stops asking Google", async () => {
    const m = memoryStore({ accessToken: null, expiresAt: null });
    const first = mockFetch([{ status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }]);
    await expect(getYoutubeAccessToken(deps(first.http, m.store))).rejects.toMatchObject({ code: "needs_reconnect", status: 401 });
    expect(m.state.reconnectReasons).toHaveLength(1);
    expect(m.state.saved).toHaveLength(0);
    const second = mockFetch([]);
    await expect(getYoutubeAccessToken(deps(second.http, m.store))).rejects.toMatchObject({ code: "needs_reconnect" });
    expect(second.calls).toHaveLength(0);
  });

  it("does not mark a reconnect for a passing failure", async () => {
    const m = memoryStore({ accessToken: null, expiresAt: null });
    const { http } = mockFetch([{ status: 503, json: { error: "backend_error" } }]);
    await expect(getYoutubeAccessToken(deps(http, m.store))).rejects.toMatchObject({ code: "request" });
    expect(m.state.reconnectReasons).toHaveLength(0);
  });

  it("says not connected when there is no connection", async () => {
    await expect(getYoutubeAccessToken(deps(mockFetch([]).http, memoryStore(null).store))).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("uploading a video", () => {
  it("builds the session request: private by default, not made for kids", () => {
    const r = uploadSessionRequest({ filePath: "x.mp4", title: " How to search permits ", description: "Walkthrough", tags: ["permits", "tutorial"], defaultLanguage: "en" }, 1234);
    expect(r.url).toBe("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus");
    expect(r.headers).toEqual({ "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": "1234", "X-Upload-Content-Type": "video/*" });
    expect(r.body).toEqual({
      snippet: { title: "How to search permits", description: "Walkthrough", categoryId: "28", tags: ["permits", "tutorial"], defaultLanguage: "en", defaultAudioLanguage: "en" },
      status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
    });
    expect(uploadSessionRequest({ filePath: "x", title: "t", privacyStatus: "unlisted", categoryId: "27" }, 1).body).toEqual({
      snippet: { title: "t", description: "", categoryId: "27" }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    });
    expect(() => uploadSessionRequest({ filePath: "x", title: "" }, 1)).toThrow(/title/);
    expect(() => uploadSessionRequest({ filePath: "x", title: "a<b" }, 1)).toThrow(/title/);
  });

  it("opens a session, sends the file in chunks with Content-Range, and returns the video id", async () => {
    const size = UPLOAD_CHUNK_BYTES + 1000;
    const file = path.join(dir, "video.mp4");
    await writeFile(file, Buffer.alloc(size, 7));
    const session = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session-fixture";
    const { http, calls } = mockFetch([
      { status: 200, headers: { location: session } },
      { status: 308, headers: { range: `bytes=0-${UPLOAD_CHUNK_BYTES - 1}` } },
      { status: 200, json: { id: "vid_12345", status: { privacyStatus: "private", uploadStatus: "uploaded" } } },
    ]);
    const out = await uploadVideo({ filePath: file, title: "Database Directory" }, deps(http, memoryStore().store));
    expect(out).toEqual({ videoId: "vid_12345", privacyStatus: "private", uploadStatus: "uploaded" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "PUT"]);
    expect(calls[0].headers.Authorization).toBe("Bearer access-fixture");
    expect(calls[0].headers["X-Upload-Content-Length"]).toBe(String(size));
    expect(JSON.parse(calls[0].body).status).toEqual({ privacyStatus: "private", selfDeclaredMadeForKids: false });
    expect(calls[1].url).toBe(session);
    expect(calls[1].headers["Content-Range"]).toBe(`bytes 0-${UPLOAD_CHUNK_BYTES - 1}/${size}`);
    expect(calls[1].body.length).toBe(UPLOAD_CHUNK_BYTES);
    expect(calls[2].headers["Content-Range"]).toBe(`bytes ${UPLOAD_CHUNK_BYTES}-${size - 1}/${size}`);
    expect(calls[2].body.length).toBe(1000);
  });

  it("asks how much arrived after a server error and resumes from there", async () => {
    const file = path.join(dir, "small.mp4");
    await writeFile(file, Buffer.alloc(5000, 1));
    const { http, calls } = mockFetch([
      { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=s2" } },
      { status: 503, json: {} },
      { status: 308, headers: { range: "bytes=0-1999" } },
      { status: 201, json: { id: "vid_67890", status: { privacyStatus: "private" } } },
    ]);
    const out = await uploadVideo({ filePath: file, title: "Resumed" }, deps(http, memoryStore().store));
    expect(out.videoId).toBe("vid_67890");
    expect(calls[2].headers["Content-Range"]).toBe("bytes */5000");
    expect(calls[3].headers["Content-Range"]).toBe("bytes 2000-4999/5000");
  });

  it("reports the daily limit plainly and refuses a session on another host", async () => {
    const file = path.join(dir, "small.mp4");
    const quota = mockFetch([{ status: 403, json: { error: { errors: [{ reason: "quotaExceeded" }] } } }]);
    await expect(uploadVideo({ filePath: file, title: "x" }, deps(quota.http, memoryStore().store))).rejects.toMatchObject({ code: "quota", status: 429 });
    const odd = mockFetch([{ status: 200, headers: { location: "https://elsewhere.example/upload" } }]);
    await expect(uploadVideo({ filePath: file, title: "x" }, deps(odd.http, memoryStore().store))).rejects.toMatchObject({ code: "upload" });
    expect(odd.calls).toHaveLength(1);
  });
});

describe("scheduled publishing", () => {
  const manage = () => memoryStore({ scopes: [YT_UPLOAD_SCOPE, YT_READONLY_SCOPE, YT_FORCE_SSL_SCOPE] });

  it("sends a scheduled upload as private with publishAt in UTC, whatever privacy was asked for", () => {
    const r = uploadSessionRequest({ filePath: "x", title: "t", privacyStatus: "public", publishAt: "2026-10-09T09:00:00-04:00" }, 1, NOW);
    expect(r.body.status).toEqual({ privacyStatus: "private", publishAt: "2026-10-09T13:00:00Z", selfDeclaredMadeForKids: false });
    expect(uploadSessionRequest({ filePath: "x", title: "t", privacyStatus: "public" }, 1, NOW).body.status).toEqual({ privacyStatus: "public", selfDeclaredMadeForKids: false });
  });

  it("refuses a publish time that is in the past, under 15 minutes ahead, or not a time", () => {
    const at = (ms: number) => new Date(NOW + ms).toISOString();
    expect(PUBLISH_AT_MIN_LEAD_MS).toBe(900_000);
    expect(() => normalizePublishAt(at(-1000), NOW)).toThrow(/in the past/);
    expect(() => normalizePublishAt(at(14 * 60_000), NOW)).toThrow(/15 minutes/);
    expect(normalizePublishAt(at(15 * 60_000), NOW)).toBe("2026-10-07T12:15:00Z");
    expect(normalizePublishAt("2026-11-01T06:00:00-05:00", NOW)).toBe("2026-11-01T11:00:00Z");
    for (const bad of ["tomorrow", "2026-10-09", "2026-10-09T09:00:00", "", "2026-13-40T09:00:00Z"]) expect(() => normalizePublishAt(bad, NOW), bad).toThrow(YoutubeError);
    expect(() => uploadSessionRequest({ filePath: "x", title: "t", publishAt: at(60_000) }, 1, NOW)).toThrow(/15 minutes/);
  });

  it("uploads with the schedule and returns the publishAt YouTube confirmed, opening no session for a bad time", async () => {
    const file = path.join(dir, "sched.mp4");
    await writeFile(file, Buffer.alloc(3000, 2));
    const { http, calls } = mockFetch([
      { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=s3" } },
      { status: 200, json: { id: "vid_sched1", status: { privacyStatus: "private", uploadStatus: "uploaded", publishAt: "2026-10-09T13:00:00Z" } } },
    ]);
    const out = await uploadVideo({ filePath: file, title: "Scheduled", publishAt: "2026-10-09T13:00:00.000Z", categoryId: "26" }, deps(http, memoryStore().store));
    expect(out).toEqual({ videoId: "vid_sched1", privacyStatus: "private", uploadStatus: "uploaded", publishAt: "2026-10-09T13:00:00Z" });
    expect(JSON.parse(calls[0].body)).toEqual({
      snippet: { title: "Scheduled", description: "", categoryId: "26" },
      status: { privacyStatus: "private", publishAt: "2026-10-09T13:00:00Z", selfDeclaredMadeForKids: false },
    });
    const none = mockFetch([]);
    await expect(uploadVideo({ filePath: file, title: "Late", publishAt: new Date(NOW - 60_000).toISOString() }, deps(none.http, memoryStore().store))).rejects.toMatchObject({ code: "request", status: 400 });
    expect(none.calls).toHaveLength(0);
  });

  it("reads a video's status alone by default, and status + snippet + processing when asked", async () => {
    const basic = mockFetch([{ json: { items: [{ status: { uploadStatus: "processed", privacyStatus: "public" } }] } }]);
    expect(await getVideoStatus("vid_12345", deps(basic.http, memoryStore().store))).toEqual({ uploadStatus: "processed", privacyStatus: "public", rejectionReason: null, failureReason: null });
    expect(basic.calls[0].url).toBe("https://www.googleapis.com/youtube/v3/videos?part=status&id=vid_12345");

    const full = mockFetch([{ json: { items: [{
      status: { uploadStatus: "processed", privacyStatus: "private", publishAt: "2026-10-09T13:00:00Z" },
      snippet: { title: "How to search", channelId: DEFAULT_YOUTUBE_CHANNEL_ID, publishedAt: "2026-10-07T12:00:01Z", thumbnails: { default: {}, medium: {}, high: {} } },
      processingDetails: { processingStatus: "succeeded" },
    }] } }, { json: { items: [] } }]);
    const d = deps(full.http, memoryStore().store); // youtube.readonly is enough: no manage scope in this store
    expect(await getVideoStatus("vid_12345", d, { full: true })).toEqual({
      uploadStatus: "processed", privacyStatus: "private", rejectionReason: null, failureReason: null,
      publishAt: "2026-10-09T13:00:00.000Z", publishedAt: "2026-10-07T12:00:01.000Z", title: "How to search", channelId: DEFAULT_YOUTUBE_CHANNEL_ID,
      processingStatus: "succeeded", thumbnailSizes: ["default", "medium", "high"],
    });
    expect(full.calls[0].url).toBe("https://www.googleapis.com/youtube/v3/videos?part=status%2Csnippet%2CprocessingDetails&id=vid_12345");
    expect(full.calls[0].method).toBe("GET");
    expect(await getVideoStatus("vid_12345", d, { full: true })).toBeNull();
  });

  it("moves a private video's publish time, sending back the status fields it must not reset", async () => {
    const { http, calls } = mockFetch([
      { json: { items: [{ status: { privacyStatus: "private", publishAt: "2026-10-09T13:00:00Z", embeddable: true, license: "youtube", publicStatsViewable: true, selfDeclaredMadeForKids: false, uploadStatus: "processed", madeForKids: false } }] } },
      { json: { id: "vid_12345", status: { privacyStatus: "private", publishAt: "2026-10-10T16:00:00Z" } } },
    ]);
    const out = await updateVideoSchedule("vid_12345", "2026-10-10T12:00:00-04:00", deps(http, manage().store));
    expect(out).toEqual({ videoId: "vid_12345", publishAt: "2026-10-10T16:00:00Z", privacyStatus: "private" });
    expect(calls[0].url).toBe("https://www.googleapis.com/youtube/v3/videos?part=status&id=vid_12345");
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].url).toBe("https://www.googleapis.com/youtube/v3/videos?part=status");
    expect(JSON.parse(calls[1].body)).toEqual({
      id: "vid_12345",
      status: { privacyStatus: "private", publishAt: "2026-10-10T16:00:00Z", embeddable: true, license: "youtube", publicStatsViewable: true, selfDeclaredMadeForKids: false },
    });
  });

  it("refuses to reschedule without the manage scope, a published video, a missing video, or a past time — before any write", async () => {
    const none = mockFetch([]);
    await expect(updateVideoSchedule("vid_12345", "2026-10-10T16:00:00Z", deps(none.http, memoryStore().store))).rejects.toMatchObject({ code: "missing_scope" });
    await expect(updateVideoSchedule("vid_12345", new Date(NOW + 60_000).toISOString(), deps(none.http, manage().store))).rejects.toThrow(/15 minutes/);
    expect(none.calls).toHaveLength(0);
    const pub = mockFetch([{ json: { items: [{ status: { privacyStatus: "public" } }] } }]);
    await expect(updateVideoSchedule("vid_12345", "2026-10-10T16:00:00Z", deps(pub.http, manage().store))).rejects.toMatchObject({ status: 409 });
    expect(pub.calls).toHaveLength(1);
    const gone = mockFetch([{ json: { items: [] } }]);
    await expect(updateVideoSchedule("vid_12345", "2026-10-10T16:00:00Z", deps(gone.http, manage().store))).rejects.toMatchObject({ status: 404 });
    expect(gone.calls).toHaveLength(1);
  });
});

describe("rewriting a video's title, description and tags", () => {
  const manage = () => memoryStore({ scopes: [YT_UPLOAD_SCOPE, YT_READONLY_SCOPE, YT_FORCE_SSL_SCOPE] });
  it("reads the snippet first and sends the category and languages back with the new text", async () => {
    const { http, calls } = mockFetch([
      { json: { items: [{ snippet: { title: "Old", description: "old text", categoryId: "28", defaultLanguage: "en", defaultAudioLanguage: "en", tags: ["old"], channelId: "UCx", thumbnails: {} } }] } },
      { json: { id: "vid_12345", snippet: { title: "New title", description: "New text", tags: ["one", "two words"] } } },
    ]);
    const out = await updateVideoSnippet("vid_12345", { title: " New title ", description: "New text", tags: ["one", "two words"] }, deps(http, manage().store));
    expect(out).toEqual({ videoId: "vid_12345", title: "New title", descriptionLength: 8, tags: 2 });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=vid_12345" });
    expect(calls[1]).toMatchObject({ method: "PUT", url: "https://www.googleapis.com/youtube/v3/videos?part=snippet" });
    expect(JSON.parse(calls[1].body)).toEqual({
      id: "vid_12345",
      snippet: { title: "New title", description: "New text", categoryId: "28", tags: ["one", "two words"], defaultLanguage: "en", defaultAudioLanguage: "en" },
    });
  });

  it("refuses — before any write — without the manage scope, over YouTube's limits, with angle brackets, or for a video YouTube does not list", async () => {
    const none = mockFetch([]);
    const ok = { title: "T", description: "D" };
    await expect(updateVideoSnippet("vid_12345", ok, deps(none.http, memoryStore().store))).rejects.toMatchObject({ code: "missing_scope" });
    await expect(updateVideoSnippet("vid_12345", { ...ok, description: "x".repeat(5001) }, deps(none.http, manage().store))).rejects.toThrow(/5,000/);
    await expect(updateVideoSnippet("vid_12345", { ...ok, description: "é".repeat(2501) }, deps(none.http, manage().store))).rejects.toThrow(/5,000/); // 5,002 bytes
    await expect(updateVideoSnippet("vid_12345", { ...ok, description: "a <b> c" }, deps(none.http, manage().store))).rejects.toThrow(/without/);
    await expect(updateVideoSnippet("vid_12345", { ...ok, title: "x".repeat(101) }, deps(none.http, manage().store))).rejects.toThrow(/100/);
    await expect(updateVideoSnippet("vid_12345", { ...ok, tags: Array.from({ length: 60 }, (_, i) => `tag number ${i}`) }, deps(none.http, manage().store))).rejects.toThrow(/500/);
    expect(none.calls).toHaveLength(0);
    const gone = mockFetch([{ json: { items: [] } }]);
    await expect(updateVideoSnippet("vid_12345", ok, deps(gone.http, manage().store))).rejects.toMatchObject({ status: 404 });
    expect(gone.calls).toHaveLength(1);
  });
});

describe("thumbnail, captions, playlists", () => {
  it("sets a thumbnail with the image bytes", async () => {
    const jpg = path.join(dir, "thumb.jpg");
    await writeFile(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const { http, calls } = mockFetch([{ json: { items: [] } }]);
    await setThumbnail("vid_12345", jpg, deps(http, memoryStore().store));
    expect(calls[0].url).toBe("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=vid_12345&uploadType=media");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Content-Type"]).toBe("image/jpeg");
    expect(calls[0].body.length).toBe(4);
    await expect(setThumbnail("bad id!", jpg, deps(http, memoryStore().store))).rejects.toMatchObject({ code: "request" });
  });

  it("builds the caption upload as multipart/related: metadata then the SRT", () => {
    const r = captionRequest("vid_12345", "en", Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nHello\n"), "BOUNDARY");
    expect(r.url).toBe("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet");
    expect(r.headers["Content-Type"]).toBe("multipart/related; boundary=BOUNDARY");
    const text = r.body.toString();
    expect(text).toContain('{"snippet":{"videoId":"vid_12345","language":"en","name":"","isDraft":false}}');
    expect(text.indexOf("application/json")).toBeLessThan(text.indexOf("Hello"));
    expect(text.endsWith("\r\n--BOUNDARY--\r\n")).toBe(true);
  });

  it("refuses captions and playlists before calling Google when the connection lacks the manage scope", async () => {
    const srt = path.join(dir, "a.srt");
    await writeFile(srt, "1\n00:00:00,000 --> 00:00:01,000\nHi\n");
    const { http, calls } = mockFetch([]);
    const d = deps(http, memoryStore().store);
    await expect(uploadCaption("vid_12345", srt, "en", d)).rejects.toMatchObject({ code: "missing_scope", status: 403 });
    await expect(addToPlaylist("vid_12345", "Tutorials", d)).rejects.toMatchObject({ code: "missing_scope" });
    expect(calls).toHaveLength(0);
  });

  it("uploads a caption when the scope is there", async () => {
    const srt = path.join(dir, "a.srt");
    const { http, calls } = mockFetch([{ json: { id: "cap_1" } }]);
    const out = await uploadCaption("vid_12345", srt, "en", deps(http, memoryStore({ scopes: [YT_UPLOAD_SCOPE, YT_FORCE_SSL_SCOPE] }).store));
    expect(out).toEqual({ captionId: "cap_1" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Content-Type"]).toMatch(/^multipart\/related; boundary=chub_/);
  });

  it("adds to an existing playlist found by title, on a later page", async () => {
    const { http, calls } = mockFetch([
      { json: { items: [{ id: "PL_other", snippet: { title: "Other" } }], nextPageToken: "p2" } },
      { json: { items: [{ id: "PL_tut", snippet: { title: "ConstructHUB Tutorials" } }] } },
      { json: { id: "item_1" } },
    ]);
    const out = await addToPlaylist("vid_12345", "constructhub tutorials", deps(http, memoryStore({ scopes: [YT_UPLOAD_SCOPE, YT_FORCE_SSL_SCOPE] }).store));
    expect(out).toEqual({ playlistId: "PL_tut", created: false });
    expect(calls[1].url).toContain("pageToken=p2");
    expect(calls[2].url).toBe("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet");
    expect(JSON.parse(calls[2].body)).toEqual({ snippet: { playlistId: "PL_tut", resourceId: { kind: "youtube#video", videoId: "vid_12345" } } });
  });

  it("creates the playlist (private) when there is none with that title", async () => {
    const { http, calls } = mockFetch([{ json: { items: [] } }, { json: { id: "PL_new" } }, { json: { id: "item_2" } }]);
    const out = await addToPlaylist("vid_12345", "Tutorials", deps(http, memoryStore({ scopes: [YT_FORCE_SSL_SCOPE] }).store));
    expect(out).toEqual({ playlistId: "PL_new", created: true });
    expect(calls[1].url).toBe("https://www.googleapis.com/youtube/v3/playlists?part=snippet%2Cstatus");
    expect(JSON.parse(calls[1].body)).toEqual({ snippet: { title: "Tutorials" }, status: { privacyStatus: "private" } });
  });
});

describe("channel analytics", () => {
  it("builds the report request", () => {
    const url = new URL(analyticsUrl("2026-09-01", "2026-09-30"));
    expect(url.origin + url.pathname).toBe("https://youtubeanalytics.googleapis.com/v2/reports");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ids: "channel==MINE", startDate: "2026-09-01", endDate: "2026-09-30",
      metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained", dimensions: "video", sort: "-views", maxResults: "50",
    });
    expect(() => analyticsUrl("2026-09-30", "2026-09-01")).toThrow();
    expect(() => analyticsUrl("09/01/2026", "2026-09-30")).toThrow();
  });

  it("maps Google's rows by column name and invents none", async () => {
    const { http, calls } = mockFetch([{ json: {
      columnHeaders: [{ name: "video" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }, { name: "subscribersGained" }],
      rows: [["vid_a", 120, 300, 150, 4], ["vid_b", 8, 12, 90, 0]],
    } }]);
    const rows = await getChannelAnalytics({ startDate: "2026-09-01", endDate: "2026-09-30" }, deps(http, memoryStore().store));
    expect(rows).toEqual([
      { video: "vid_a", views: 120, estimatedMinutesWatched: 300, averageViewDuration: 150, subscribersGained: 4 },
      { video: "vid_b", views: 8, estimatedMinutesWatched: 12, averageViewDuration: 90, subscribersGained: 0 },
    ]);
    expect(calls[0].headers.Authorization).toBe("Bearer access-fixture");
    const empty = mockFetch([{ json: { columnHeaders: [{ name: "video" }, { name: "views" }] } }]);
    expect(await getChannelAnalytics({ startDate: "2026-09-01", endDate: "2026-09-30" }, deps(empty.http, memoryStore().store))).toEqual([]);
  });

  it("refuses without the analytics scope, before calling Google", async () => {
    const { http, calls } = mockFetch([]);
    await expect(getChannelAnalytics({ startDate: "2026-09-01", endDate: "2026-09-30" }, deps(http, memoryStore({ scopes: [YT_UPLOAD_SCOPE] }).store)))
      .rejects.toMatchObject({ code: "missing_scope" });
    expect(calls).toHaveLength(0);
  });
});

describe("revoking", () => {
  it("posts the token to Google's revoke endpoint and treats an already-dead token as done", async () => {
    const ok = mockFetch([{ status: 200, json: {} }]);
    expect(await revokeToken("refresh-fixture", ok.http)).toBe(true);
    expect(ok.calls[0].url).toBe("https://oauth2.googleapis.com/revoke");
    expect(form(ok.calls[0])).toEqual({ token: "refresh-fixture" });
    expect(await revokeToken("x", mockFetch([{ status: 400, json: { error: "invalid_token" } }]).http)).toBe(true);
    expect(await revokeToken("x", mockFetch([{ status: 500, json: {} }]).http)).toBe(false);
  });
});
