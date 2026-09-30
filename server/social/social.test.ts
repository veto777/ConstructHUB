import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { pool } from "../db";
import { ensureGrowthSchema } from "../growth-schema";
import { ensureSocialSchema } from "./schema";
import { ensureAccountEventsSchema } from "../account-events";
import {
  BlotatoClient,
  encryptKey,
  decryptKey,
  reserveRequest,
} from "./client";
import {
  connect,
  disconnect,
  discoverPages,
  createPosts,
  changePost,
  saveSettings,
  workerUser,
  userLock,
  generateDue,
} from "./service";
import {
  autoSchema,
  postPayload,
  destinationSchema,
  inBlackout,
  publicMediaUrl,
} from "../../shared/social";
import { syncGbpSources } from "./gbp-sources";
import { registerSocialRoutes } from "./routes";
vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({})) }));
let userId: number, otherId: number;
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
let submitMode = "ok",
  pollStatus = "published";
const http = vi.fn(async (url: any, options: any) => {
  const path = new URL(url).pathname;
  if (path.endsWith("/subaccounts"))
    return response({ items: [{ id: "page-one", name: "Fixture page" }] });
  if (path.endsWith("/accounts"))
    return response({
      items: [
        { id: "fixture-twitter", platform: "twitter", fullname: "Fixture X" },
        {
          id: "fixture-facebook",
          platform: "facebook",
          fullname: "Fixture Facebook",
        },
      ],
    });
  if (path === "/v2/posts" && options.method === "POST") {
    if (submitMode === "timeout") throw new Error("SECRET must not be exposed");
    if (submitMode === "reject")
      return response({ errorMessage: "SECRET" }, 400);
    return response({ postSubmissionId: "fixture-submission" });
  }
  if (path.includes("/posts/"))
    return response({
      status: pollStatus,
      publicUrl: "https://example.com/fixture-post",
      errorMessage: "SECRET",
    });
  throw new Error(`Unexpected mocked endpoint ${path}`);
});
const make = (key: string) => new BlotatoClient(key, http, async () => {});
const destination = destinationSchema.parse({
  accountId: "fixture-twitter",
  platform: "twitter",
});
const request = (extra: any = {}) => ({
  requestId: crypto.randomUUID(),
  text: "Fixture contractor update",
  destinations: [destination],
  ...extra,
});
const rows = async () =>
  (
    await pool.query(
      "SELECT * FROM social_posts WHERE user_id=$1 ORDER BY created_at",
      [userId],
    )
  ).rows;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)
  )
    throw new Error("a4 local database required");
  process.env.SOCIAL_ENCRYPTION_KEY = "ab".repeat(32);
  await ensureGrowthSchema();
  await ensureSocialSchema();
  await ensureSocialSchema();
  await ensureAccountEventsSchema();
  const { rows } = await pool.query(
    "INSERT INTO users(email) VALUES('social-test-'||gen_random_uuid()||'@example.invalid'),('social-test-'||gen_random_uuid()||'@example.invalid') RETURNING id",
  );
  [userId, otherId] = rows.map((r) => r.id);
});
afterAll(async () => {
  await pool.query("DELETE FROM business_locations WHERE user_id=$1", [userId]);
  await pool.query("DELETE FROM users WHERE id=ANY($1)", [[userId, otherId]]);
  await pool.query("DELETE FROM growth_budgets WHERE key=$1", [
    `social-ai:${userId}`,
  ]);
  await pool.query("DELETE FROM social_rate WHERE key_hash LIKE 'fixture-%'");
  await pool.end();
});
describe("social validation and HTTP boundary", () => {
  it("authenticates encryption to the owner and detects tampering", () => {
    const box = encryptKey("secret-key", userId);
    expect(box).not.toContain("secret-key");
    expect(decryptKey(box, userId)).toBe("secret-key");
    expect(() => decryptKey(box, otherId)).toThrow();
    expect(() => decryptKey(box.slice(0, -4) + "AAAA", userId)).toThrow();
  });
  it("validates platform limits and target requirements", () => {
    expect(() => postPayload(destination, "x".repeat(281), [])).toThrow("280");
    expect(() =>
      postPayload({ ...destination, platform: "facebook" }, "x", []),
    ).toThrow("Page");
    expect(() =>
      postPayload({ ...destination, platform: "instagram" }, "x", []),
    ).toThrow("media");
    expect(() =>
      postPayload({ ...destination, platform: "youtube" }, "x", [
        "https://example.com/video.mp4",
      ]),
    ).toThrow("title");
    const payload = postPayload(
      { ...destination, platform: "tiktok" },
      "x",
      ["https://example.com/photo.jpg"],
      true,
    );
    expect(payload.post.target).toMatchObject({
      privacyLevel: "SELF_ONLY",
      isAiGenerated: true,
    });
  });
  it("rejects private URL literals and overnight blackout handles timezone", () => {
    for (const url of [
      "http://example.com/a",
      "https://127.0.0.1/a",
      "https://192.168.0.1/a",
      "https://user:pass@example.com/a",
      "https://[::1]/a",
      "https://0.0.0.0/a",
      "https://100.100.100.200/a",
      "https://2130706433/a",
      "https://0x7f000001/a",
      "https://printer.localhost/a",
      "https://printer.home.arpa/a",
      "https://example.com:8443/a",
    ])
      expect(publicMediaUrl.safeParse(url).success).toBe(false);
    const s = autoSchema.parse({ timezone: "America/New_York" });
    expect(inBlackout(s, new Date("2026-09-29T03:00:00Z"))).toBe(true);
    expect(inBlackout(s, new Date("2026-09-29T16:00:00Z"))).toBe(false);
    expect(inBlackout({ ...s, blackoutStart: 8, blackoutEnd: 8 })).toBe(false);
  });
  it("persists pacing across clients and restarts", async () => {
    await reserveRequest("fixture-rate");
    await expect(reserveRequest("fixture-rate")).rejects.toMatchObject({
      status: 429,
    });
    const {
      rows: [r],
    } = await pool.query(
      "SELECT next_at>now() busy FROM social_rate WHERE key_hash=$1",
      ["fixture-rate"],
    );
    expect(r.busy).toBe(true);
  });
  it("never retries a POST and never exposes provider bodies", async () => {
    const failed = vi.fn(async () => {
      throw new Error("secret-key");
    });
    await expect(
      new BlotatoClient("secret-key", failed, async () => {}).request(
        "/posts",
        {},
      ),
    ).rejects.not.toThrow("secret-key");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(
      http.mock.calls.every((c) =>
        String(c[0]).startsWith("https://backend.blotato.com/v2/"),
      ),
    ).toBe(true);
  });
});
describe("real Postgres, mocked Blotato publishing", () => {
  it("verifies a key, encrypts it, logs connection, and keeps owner data private", async () => {
    await connect(userId, "fixture-secret-key", null, make);
    const {
      rows: [c],
    } = await pool.query("SELECT * FROM social_connections WHERE user_id=$1", [
      userId,
    ]);
    expect(c.key_enc).not.toContain("fixture-secret-key");
    expect(decryptKey(c.key_enc, userId)).toBe("fixture-secret-key");
    expect(
      (
        await pool.query(
          "SELECT * FROM account_activity WHERE user_id=$1 AND kind='social.connected'",
          [userId],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(createPosts(otherId, request())).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      createPosts(
        userId,
        request({ destinations: [{ ...destination, accountId: "forged" }] }),
      ),
    ).rejects.toThrow("not connected");
  });
  it("verifies subaccounts before selecting a Facebook Page", async () => {
    const d = {
      ...destination,
      accountId: "fixture-facebook",
      platform: "facebook",
      pageId: "page-one",
    };
    await expect(
      createPosts(userId, request({ destinations: [d] })),
    ).rejects.toThrow("verified Page");
    expect(await discoverPages(userId, "fixture-facebook", make)).toMatchObject(
      { items: [{ id: "page-one" }] },
    );
    const p = await createPosts(
      userId,
      request({ destinations: [d], draft: true }),
    );
    expect(p[0].payload.post.target).toMatchObject({ pageId: "page-one" });
    await changePost(userId, p[0].id, "cancel");
  });
  it("queues once for a repeated request and publishes only after polling", async () => {
    const input = request();
    const [p] = await createPosts(userId, input);
    const [again] = await createPosts(userId, input);
    expect(again.id).toBe(p.id);
    http.mockClear();
    await workerUser(userId, make);
    expect((await rows()).find((r) => r.id === p.id).state).toBe("submitted");
    expect(http.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
      1,
    );
    await workerUser(userId, make);
    expect(http.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
      1,
    );
    await pool.query("UPDATE social_posts SET due_at=now() WHERE id=$1", [
      p.id,
    ]);
    await workerUser(userId, make);
    expect((await rows()).find((r) => r.id === p.id).state).toBe("published");
    await workerUser(userId, make);
    expect(
      (
        await pool.query(
          "SELECT * FROM user_notifications WHERE user_id=$1 AND kind='social.post_published'",
          [userId],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects changed retries and duplicate destinations without changing queued content", async () => {
    const input = request({ draft: true });
    const [p] = await createPosts(userId, input);
    for (const change of [{ text: "Changed" }, { draft: false }, { mediaUrls: ["https://example.com/new.jpg"] }, { destinations: [] }]) {
      await expect(createPosts(userId, { ...input, ...change })).rejects.toThrow();
    }
    await changePost(userId, p.id, "approve", "Approved edit");
    expect((await createPosts(userId, input))[0].payload.post.content.text).toBe("Approved edit");
    await expect(createPosts(userId, request({ destinations: [destination, destination] }))).rejects.toThrow("once");
    await changePost(userId, p.id, "cancel");
  });
  it("keeps scheduled posts and drafts local until due or approved; rejects other owner actions", async () => {
    const [p] = await createPosts(userId, request({ draft: true }));
    http.mockClear();
    await workerUser(userId, make);
    expect(http).not.toHaveBeenCalled();
    await expect(changePost(otherId, p.id, "approve")).rejects.toMatchObject({
      status: 404,
    });
    await changePost(userId, p.id, "approve", "Edited fixture");
    await workerUser(userId, make);
    expect(
      http.mock.calls.find((c) => c[1]?.method === "POST")?.[1].body,
    ).toContain("Edited fixture");
    const [future] = await createPosts(
      userId,
      request({ scheduledTime: new Date(Date.now() + 86400000).toISOString() }),
    );
    http.mockClear();
    await workerUser(userId, make);
    expect(http).not.toHaveBeenCalled();
    await changePost(userId, future.id, "cancel");
  });
  it("holds uncertain submissions across ticks and recovers an interrupted submission without duplicate POST", async () => {
    submitMode = "timeout";
    const [p] = await createPosts(userId, request());
    await workerUser(userId, make);
    expect((await rows()).find((r) => r.id === p.id)).toMatchObject({
      state: "uncertain",
    });
    submitMode = "ok";
    http.mockClear();
    await workerUser(userId, make);
    expect(http).not.toHaveBeenCalled();
    await pool.query("UPDATE social_posts SET state='submitting' WHERE id=$1", [
      p.id,
    ]);
    await workerUser(userId, make);
    expect((await rows()).find((r) => r.id === p.id).state).toBe("uncertain");
    expect(http).not.toHaveBeenCalled();
  });
  it("reports definitive failures through the existing notification system", async () => {
    submitMode = "reject";
    const [p] = await createPosts(userId, request());
    await workerUser(userId, make);
    expect((await rows()).find((r) => r.id === p.id)).toMatchObject({
      state: "failed",
      error: "Blotato rejected the request",
    });
    expect(JSON.stringify(await rows())).not.toContain("SECRET");
    expect(
      (
        await pool.query(
          "SELECT * FROM user_notifications WHERE user_id=$1 AND kind='social.post_failed'",
          [userId],
        )
      ).rows.length,
    ).toBeGreaterThan(0);
    submitMode = "ok";
  });
  it("serializes concurrent owner mutations", async () => {
    await userLock(userId, async () => {
      await expect(userLock(userId, async () => null)).rejects.toMatchObject({
        status: 409,
      });
    });
  });
  it("generates labelled approval drafts from real profile context and enforces durable daily AI budget", async () => {
    await pool.query(
      "INSERT INTO business_locations(user_id,business_name,description) VALUES($1,'Social fixture business','Fixture siding contractor')",
      [userId],
    );
    await saveSettings(
      userId,
      autoSchema.parse({
        enabled: true,
        destinations: [destination],
        blackoutStart: 0,
        blackoutEnd: 0,
        aiDailyBudget: 1,
      }),
    );
    const generate = vi.fn(async (_context: unknown) => "AI fixture draft");
    const drafts = await userLock(userId, (c) =>
      generateDue(c, userId, generate),
    );
    expect(drafts?.[0]).toMatchObject({ ai_generated: true, state: "draft" });
    expect(generate.mock.calls[0][0]).toMatchObject({
      business: { business_name: "Social fixture business" },
    });
    await expect(
      userLock(userId, (c) => generateDue(c, userId, generate, true)),
    ).rejects.toThrow("budget");
    expect(generate).toHaveBeenCalledTimes(1);
    await workerUser(userId, make, generate);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("only automatic mode queues generated posts, disabling holds pending automatic posts", async () => {
    await pool.query("DELETE FROM growth_budgets WHERE key=$1", [
      `social-ai:${userId}`,
    ]);
    await saveSettings(
      userId,
      autoSchema.parse({
        enabled: true,
        mode: "automatic",
        destinations: [destination],
        blackoutStart: 0,
        blackoutEnd: 0,
      }),
    );
    await pool.query(
      "UPDATE social_settings SET next_at=now() WHERE user_id=$1",
      [userId],
    );
    const posts = await userLock(userId, (c) =>
      generateDue(c, userId, async () => "Explicit automatic fixture"),
    );
    expect(posts?.[0].state).toBe("queued");
    await saveSettings(
      userId,
      autoSchema.parse({ enabled: false, destinations: [destination] }),
    );
    expect((await rows()).find((r) => r.id === posts?.[0].id).state).toBe(
      "draft",
    );
  });
  it("rechecks automatic publishing permission after a simulated restart between settings writes", async () => {
    const [p] = await createPosts(userId, request());
    await pool.query(
      "UPDATE social_posts SET auto_generated=true WHERE id=$1",
      [p.id],
    );
    http.mockClear();
    await workerUser(userId, make);
    expect((await rows()).find((r) => r.id === p.id).state).toBe("draft");
    expect(http.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
      0,
    );
    await changePost(userId, p.id, "approve");
    await pool.query(
      "UPDATE social_settings SET settings=jsonb_set(jsonb_set(settings,'{blackoutStart}','0'),'{blackoutEnd}','0') WHERE user_id=$1",
      [userId],
    );
    await workerUser(userId, make);
    expect((await rows()).find((r) => r.id === p.id).state).toBe("submitted");
  });
  it("imports only recent live standard GBP updates, scoped to linked owner accounts, and reconciles idempotently", async () => {
    await pool.query(
      "INSERT INTO gbp_grants(user_id,google_subject,email,scopes) VALUES($1,'social-google','fixture@example.invalid',ARRAY['https://www.googleapis.com/auth/business.manage'])",
      [userId],
    );
    await pool.query(
      "UPDATE business_locations SET gbp_google_subject='social-google',gbp_account_name='accounts/socialfixture',gbp_location_name='locations/socialfixture' WHERE user_id=$1",
      [userId],
    );
    const good = {
      name: "accounts/socialfixture/locations/socialfixture/localPosts/one",
      state: "LIVE",
      topicType: "STANDARD",
      summary: "Published fixture update",
      createTime: new Date().toISOString(),
      media: [{ googleUrl: "https://example.com/source.jpg" }],
    };
    const pages = vi.fn(async () => [
      good,
      { ...good, name: good.name + "-draft", state: "PROCESSING" },
      { ...good, name: good.name + "-offer", topicType: "OFFER" },
      { ...good, name: good.name + "-old", createTime: "2020-01-01T00:00:00Z" },
    ]);
    const google: any = () => ({ pages });
    expect(await syncGbpSources(userId, google)).toEqual({ imported: 1 });
    expect(await syncGbpSources(userId, google)).toEqual({ imported: 1 });
    expect(
      (
        await pool.query(
          "SELECT * FROM social_sources WHERE user_id=$1 AND external_key IS NOT NULL",
          [userId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(pages).toHaveBeenCalledWith(
      "reviews",
      "/v4/accounts/socialfixture/locations/socialfixture/localPosts",
      "localPosts",
    );
    await expect(syncGbpSources(otherId, google)).rejects.toMatchObject({
      status: 409,
    });
    pages.mockResolvedValueOnce([]);
    await syncGbpSources(userId, google);
    expect(
      (
        await pool.query(
          "SELECT * FROM social_sources WHERE user_id=$1 AND external_key IS NOT NULL",
          [userId],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("rotates sources within each content category instead of repeating the same offer", async () => {
    await pool.query("DELETE FROM growth_budgets WHERE key=$1", [`social-ai:${userId}`]);
    await pool.query("INSERT INTO social_sources(user_id,kind,text,created_at) VALUES($1,'offers','Fixture offer A',now()),($1,'offers','Fixture offer B',now()-interval '1 second')", [userId]);
    await saveSettings(userId, autoSchema.parse({ destinations: [destination], mix: ["offers", "tips"], aiDailyBudget: 5 }));
    await pool.query("UPDATE social_settings SET sequence=0 WHERE user_id=$1", [userId]);
    const generate = vi.fn(async (_context: any) => "Fixture rotation draft");
    for (let i = 0; i < 3; i++) await userLock(userId, (c) => generateDue(c, userId, generate, true));
    expect(generate.mock.calls.map(([context]) => context.source)).toEqual([
      "Fixture offer A", "General non-project-specific maintenance tip; no claims about completed work.", "Fixture offer B",
    ]);
  });
  it("does not spend AI budget on a destination missing required fields", async () => {
    await pool.query("DELETE FROM growth_budgets WHERE key=$1", [`social-ai:${userId}`]);
    await saveSettings(userId, autoSchema.parse({ destinations: [{ ...destination, accountId: "fixture-facebook", platform: "facebook" }] }));
    const generate = vi.fn(async () => "Never called");
    await expect(userLock(userId, (c) => generateDue(c, userId, generate, true))).rejects.toMatchObject({ status: 400, message: "Facebook requires a Page" });
    expect(generate).not.toHaveBeenCalled();
    expect((await pool.query("SELECT * FROM growth_budgets WHERE key=$1", [`social-ai:${userId}`])).rows).toHaveLength(0);
  });
  it("disconnect cancels unsent work, disables generation, deletes the encrypted key, and logs activity", async () => {
    await disconnect(userId, null);
    expect(
      (
        await pool.query("SELECT * FROM social_connections WHERE user_id=$1", [
          userId,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (await rows()).some((p) => ["draft", "queued"].includes(p.state)),
    ).toBe(false);
    expect(
      (
        await pool.query(
          "SELECT settings FROM social_settings WHERE user_id=$1",
          [userId],
        )
      ).rows[0].settings.enabled,
    ).toBe(false);
  });
});
describe("route authentication, owner scope and key redaction", () => {
  it("requires auth on every registered route", async () => {
    const routes: any[] = [];
    const app: any = {};
    for (const method of ["get", "post", "put", "delete"])
      app[method] = (path: string, ...handlers: any[]) =>
        routes.push({ path, handlers });
    registerSocialRoutes(
      app,
      (_req, res) => {
        res.status(401).json({ message: "Not authenticated" });
        return null;
      },
      make,
    );
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      const next = vi.fn(),
        res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await r.handlers[0]({}, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });
  it("returns no key and no other owner posts from the dashboard", async () => {
    const routes = new Map<string, any>();
    const app: any = {};
    for (const method of ["get", "post", "put", "delete"])
      app[method] = (path: string, ...handlers: any[]) =>
        routes.set(`${method} ${path}`, handlers.at(-1));
    registerSocialRoutes(app, () => ({ id: otherId }), make);
    const res: any = {
      setHeader: vi.fn(),
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    await routes.get("get /api/social")({ user: { id: otherId } }, res);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      connected: false,
      accounts: [],
      posts: [],
    });
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(
      /key_enc|apiKey|fixture-secret-key/,
    );
  });
});
