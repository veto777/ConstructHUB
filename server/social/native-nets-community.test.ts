/** ConstructHUB Direct — Reddit, Mastodon and Tumblr (server/social/native-nets.ts): switches, sign-in, publish and
 * delete against fake networks. Pure: no database. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mastodonDns, mastodonHost, mastodonAuthorizeUrl, mastodonExchange, mastodonRegisterApp, netAuthUrl, netConfigured, netDeps, netExchange, netPublish, netRefresh, redditDelete, redditSubreddits, tumblrBlogs, tumblrDelete } from "./native-nets";
import { postPayload } from "../../shared/social";

vi.mock("../ops/issues", () => ({ recordFailure: vi.fn(async () => {}) }));
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ENV = {
  SOCIAL_REDDIT_CLIENT_ID: "rd-client-id", SOCIAL_REDDIT_CLIENT_SECRET: "rd-secret-0123456789",
  SOCIAL_TUMBLR_CLIENT_ID: "tb-client-id", SOCIAL_TUMBLR_CLIENT_SECRET: "tb-secret-0123456789",
  SOCIAL_MASTODON: "on",
} as any;
const realHttp = netDeps.http, realCheck = mastodonDns.check;
afterEach(() => { netDeps.http = realHttp; netDeps.env = () => process.env; mastodonDns.check = realCheck; });
function fake(answer: (url: URL, body: any, init: any) => unknown) {
  const calls: { url: URL; body: any; init: any }[] = [];
  netDeps.env = () => ENV;
  mastodonDns.check = async () => {};
  netDeps.http = (async (u: any, init: any) => {
    const url = new URL(String(u));
    const raw = init?.body;
    const body = raw instanceof URLSearchParams ? Object.fromEntries(raw) : typeof raw === "string" ? JSON.parse(raw) : undefined;
    calls.push({ url, body, init });
    const r = answer(url, body, init);
    return r instanceof Response ? r : ok(r);
  }) as any;
  return calls;
}

describe("switches", () => {
  it("each network shows only when its keys (or Mastodon's switch) are set", () => {
    expect(["reddit", "tumblr", "mastodon"].map((n) => netConfigured(n as any, ENV))).toEqual([true, true, true]);
    expect(["reddit", "tumblr", "mastodon"].map((n) => netConfigured(n as any, {} as any))).toEqual([false, false, false]);
  });
});

describe("Reddit", () => {
  it("asks for a permanent grant with posting rights", () => {
    netDeps.env = () => ENV;
    const u = new URL(netAuthUrl("reddit", "st"));
    expect(u.host).toBe("www.reddit.com");
    expect(u.searchParams.get("duration")).toBe("permanent");
    expect(u.searchParams.get("scope")).toBe("identity mysubreddits submit");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/api\/social\/native\/reddit\/callback$/);
  });
  it("signs in, refuses a grant without submit, and refreshes", async () => {
    const calls = fake((u) => u.pathname === "/api/v1/access_token" ? { access_token: "a1", refresh_token: "r1", expires_in: 3600, scope: "identity mysubreddits submit" } : { id: "abc", name: "roofer", icon_img: "https://i.redd.it/x.png?s=1" });
    expect(await netExchange("reddit", "code")).toMatchObject({ externalId: "abc", name: "u/roofer", picture: "https://i.redd.it/x.png", token: "a1", refresh: "r1" });
    expect(calls[0].init.headers.Authorization).toMatch(/^Basic /);
    expect(calls[0].init.headers["User-Agent"]).toMatch(/constructhub/);
    fake(() => ({ access_token: "a1", scope: "identity" }));
    await expect(netExchange("reddit", "code")).rejects.toThrow(/didn't allow posting/);
    fake(() => ({ access_token: "a2", expires_in: 3600 }));
    expect(await netRefresh("reddit", "a1", "r1")).toMatchObject({ token: "a2", refresh: "r1" });
    await expect(netRefresh("reddit", "a1", null)).rejects.toMatchObject({ reconnect: true });
  });
  it("lists the profile and postable subreddits", async () => {
    fake((u) => u.pathname === "/api/v1/me" ? { name: "roofer" } : { data: { children: [{ data: { display_name: "HomeImprovement" } }, { data: { display_name: "NoPosts", submission_type: "none" } }, { data: { display_name: "Q", quarantine: true } }] } });
    expect(await redditSubreddits("a1")).toEqual([{ id: "u_roofer", name: "u/roofer (your profile)" }, { id: "HomeImprovement", name: "r/HomeImprovement" }]);
  });
  it("posts a text post with a title, reports Reddit's refusal, and deletes", async () => {
    const calls = fake(() => ({ json: { errors: [], data: { name: "t3_xyz", url: "https://www.reddit.com/r/x/comments/xyz/" } } }));
    expect(await netPublish("reddit", "abc", "a1", "Body", [], { subreddit: "r/HomeImprovement", title: "New roof" }))
      .toEqual({ stage: "published", external: "t3_xyz", url: "https://www.reddit.com/r/x/comments/xyz/" });
    expect(calls[0].body).toMatchObject({ sr: "HomeImprovement", title: "New roof", kind: "self", text: "Body", api_type: "json" });
    await expect(netPublish("reddit", "abc", "a1", "Body", [], { subreddit: "x" })).rejects.toThrow(/needs a title/);
    await expect(netPublish("reddit", "abc", "a1", "Body", [], { title: "t" })).rejects.toThrow(/Choose a subreddit/);
    await expect(netPublish("reddit", "abc", "a1", "Body", ["https://x.us/a.jpg"], { subreddit: "x", title: "t" })).rejects.toThrow(/image posts/);
    fake(() => ({ json: { errors: [["SUBREDDIT_NOTALLOWED", "you aren't allowed to post there"]] } }));
    await expect(netPublish("reddit", "abc", "a1", "Body", [], { subreddit: "x", title: "t" })).rejects.toThrow(/aren't allowed to post there/);
    const del = fake(() => ({}));
    await redditDelete("a1", "t3_xyz");
    expect(del[0].body).toMatchObject({ id: "t3_xyz" });
    await expect(redditDelete("a1", "../x")).rejects.toThrow(/isn't a Reddit post/);
  });
});

describe("Mastodon", () => {
  it("reads a server from what people type, and refuses addresses that aren't a server", () => {
    expect(mastodonHost("https://Mastodon.Social/@me")).toBe("mastodon.social");
    expect(mastodonHost("@me@fosstodon.org")).toBe("fosstodon.org");
    for (const bad of ["localhost", "127.0.0.1", "10.0.0.5", "", "http://"]) expect(() => mastodonHost(bad)).toThrow(/Enter your Mastodon server/);
  });
  it("refuses a server that resolves to an internal address", async () => {
    netDeps.env = () => ENV;
    mastodonDns.check = realCheck;
    await expect(mastodonRegisterApp("localhost.localdomain.invalid")).rejects.toThrow(/didn't answer/);
  });
  it("is not a sign-in page flow", () => {
    expect(() => netAuthUrl("mastodon", "st")).toThrow(/Mastodon form/);
  });
  it("registers on the customer's server, signs in, posts with media, and deletes", async () => {
    const calls = fake((u) => {
      if (u.pathname === "/api/v1/apps") return { client_id: "cid", client_secret: "csec" };
      if (u.pathname === "/oauth/token") return { access_token: "tok" };
      if (u.pathname === "/api/v1/accounts/verify_credentials") return { id: "9", username: "alpine", avatar: "https://m.s/a.png" };
      if (u.pathname === "/api/v2/media") return { id: "med1" };
      if (u.pathname === "/api/v1/statuses") return { id: "111", url: "https://mastodon.social/@alpine/111" };
      return {};
    });
    expect(await mastodonRegisterApp("mastodon.social")).toEqual({ clientId: "cid", clientSecret: "csec" });
    expect(calls[0].body).toMatchObject({ client_name: "ConstructHUB", scopes: "read write" });
    const auth = new URL(mastodonAuthorizeUrl("mastodon.social", "cid", "st"));
    expect(auth.host).toBe("mastodon.social");
    expect(auth.searchParams.get("redirect_uri")).toMatch(/\/api\/social\/native\/mastodon\/callback$/);
    expect(await mastodonExchange("mastodon.social", "cid", "csec", "code")).toMatchObject({ externalId: "9", name: "@alpine@mastodon.social", token: "tok", expiresAt: null });
    expect(await netRefresh("mastodon", "tok", null)).toEqual({ token: "tok", expiresAt: null, refresh: null });
    const textOnly = await netPublish("mastodon", "9", "tok", "Hello", [], { mastodonInstance: "mastodon.social" });
    expect(textOnly).toEqual({ stage: "published", external: "111", url: "https://mastodon.social/@alpine/111" });
    const post = calls.find((c) => c.url.pathname === "/api/v1/statuses")!;
    expect(post.body).toMatchObject({ status: "Hello" });
    expect(post.init.headers["Idempotency-Key"]).toMatch(/^[0-9a-f]{64}$/);
    await expect(netPublish("mastodon", "9", "tok", "Hello", Array(5).fill("https://x.us/a.jpg"), { mastodonInstance: "mastodon.social" })).rejects.toThrow(/four images/);
    await expect(netPublish("mastodon", "9", "tok", "Hello", [], {})).rejects.toMatchObject({ reconnect: true });
  });
});

describe("Tumblr", () => {
  it("asks for posting and a refresh token", () => {
    netDeps.env = () => ENV;
    const u = new URL(netAuthUrl("tumblr", "st"));
    expect(u.host).toBe("www.tumblr.com");
    expect(u.searchParams.get("scope")).toBe("basic write offline_access");
  });
  it("signs in as the primary blog, lists blogs, posts NPF and deletes", async () => {
    const calls = fake((u) => {
      if (u.pathname === "/v2/oauth2/token") return { access_token: "t1", refresh_token: "r1", expires_in: 2520 };
      if (u.pathname === "/v2/user/info") return { meta: { status: 200 }, response: { user: { name: "owner", blogs: [{ name: "side", title: "Side" }, { name: "alpine", title: "Alpine", primary: true, avatar: [{ url: "https://a/x.png" }] }] } } };
      if (u.pathname.endsWith("/posts")) return { meta: { status: 201 }, response: { id_string: "777" } };
      return { meta: { status: 200 }, response: {} };
    });
    expect(await netExchange("tumblr", "code")).toMatchObject({ externalId: "owner", name: "@alpine", picture: "https://a/x.png", refresh: "r1" });
    expect(calls[0].body).toMatchObject({ client_id: "tb-client-id", grant_type: "authorization_code" });
    expect(await tumblrBlogs("t1")).toEqual([{ id: "side", name: "Side (@side)" }, { id: "alpine", name: "Alpine (@alpine)" }]);
    expect(await netPublish("tumblr", "owner", "t1", "New siding", ["https://x.us/a.jpg"], { blog: "alpine" }))
      .toEqual({ stage: "published", external: "alpine:777", url: "https://alpine.tumblr.com/post/777" });
    const post = calls.find((c) => c.url.pathname.endsWith("/posts"))!;
    expect(post.body).toEqual({ content: [{ type: "text", text: "New siding" }, { type: "image", media: [{ url: "https://x.us/a.jpg" }] }], state: "published" });
    await expect(netPublish("tumblr", "owner", "t1", "x", [], {})).rejects.toThrow(/Choose a Tumblr blog/);
    await tumblrDelete("t1", "alpine:777");
    expect(calls.at(-1)!.url.pathname).toBe("/v2/blog/alpine/post/delete");
    await expect(tumblrDelete("t1", "alpine:abc")).rejects.toThrow(/isn't a Tumblr post/);
  });
});

describe("composer payloads", () => {
  const d = (x: Record<string, unknown>) => ({ accountId: "acct_1", ...x }) as any;
  it("Reddit needs a subreddit and a title; Tumblr needs a blog", () => {
    expect(() => postPayload(d({ platform: "reddit", title: "T" }), "Hello", [])).toThrow(/subreddit/);
    expect(() => postPayload(d({ platform: "reddit", boardId: "HomeImprovement" }), "Hello", [])).toThrow(/title/);
    expect(() => postPayload(d({ platform: "tumblr" }), "Hello", [])).toThrow(/blog/);
    expect(JSON.stringify(postPayload(d({ platform: "reddit", boardId: "HomeImprovement", title: "T" }), "Hello", []))).toMatch(/"subreddit":"HomeImprovement"/);
    expect(JSON.stringify(postPayload(d({ platform: "tumblr", boardId: "alpine" }), "Hello", []))).toMatch(/"blog":"alpine"/);
  });
});
