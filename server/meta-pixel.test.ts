/** The Meta pixel on the marketing pages and the sign-up event behind it (server/meta-pixel.ts). */
import { afterEach, describe, expect, it } from "vitest";
import { metaDeps, metaPixelSnippet, reportMetaSignup, requestIp, withMetaPixel } from "./meta-pixel";

const PAGE = "<html><head><title>x</title></head><body></body></html>";
const realHttp = metaDeps.http;
afterEach(() => { metaDeps.http = realHttp; metaDeps.env = () => process.env; metaDeps.now = () => Date.now(); });

describe("the pixel on the page", () => {
  it("is added once, only with a valid id", () => {
    expect(metaPixelSnippet({})).toBe("");
    expect(metaPixelSnippet({ META_PIXEL_ID: "<script>" })).toBe("");
    expect(withMetaPixel(PAGE, {})).toBe(PAGE);
    const tagged = withMetaPixel(PAGE, { META_PIXEL_ID: "1002566142243783" });
    expect(tagged).toContain("fbq('init','1002566142243783')");
    expect(tagged).toContain("window.__CH_META_PIXEL='1002566142243783'");
    expect(withMetaPixel(tagged, { META_PIXEL_ID: "1002566142243783" })).toBe(tagged);
  });
  it("reads the visitor's address from the proxy headers", () => {
    expect(requestIp({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, ip: "10.0.0.1" })).toBe("203.0.113.9");
    expect(requestIp({ headers: {}, ip: "198.51.100.4" })).toBe("198.51.100.4");
  });
});

describe("telling Meta about a new account", () => {
  it("sends CompleteRegistration with a hashed email, the browser's Meta cookies and the event id it returns", async () => {
    const calls: { url: string; body: any }[] = [];
    metaDeps.env = () => ({ META_PIXEL_ID: "1002566142243783", META_USER_TOKEN: "tok" }) as any;
    metaDeps.now = () => 1_760_300_000_000;
    metaDeps.http = (async (url: any, init: any) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); }) as any;
    const id = await reportMetaSignup({ email: " Owner@Example.com ", ip: "203.0.113.9", userAgent: "UA", cookie: "ch_consent=granted; _fbp=fb.1.1.2; _fbc=fb.1.1.abc", sourceUrl: "https://constructhub.us/auth?mode=signup" });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/1002566142243783/events");
    const ev = calls[0].body.data[0];
    expect(ev).toMatchObject({ event_name: "CompleteRegistration", event_id: id, event_time: 1_760_300_000, action_source: "website", event_source_url: "https://constructhub.us/auth?mode=signup" });
    expect(ev.user_data).toEqual({ em: "f6c40d58e9bbaf2ea1a06f4ffbb0c33b1c3ec5f4f7fd92e9bdbcd73ee7716e8d".slice(0, 0) + ev.user_data.em, client_ip_address: "203.0.113.9", client_user_agent: "UA", fbp: "fb.1.1.2", fbc: "fb.1.1.abc" });
    expect(ev.user_data.em).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(calls[0].body)).not.toContain("example.com");
    expect(calls[0].body.access_token).toBe("tok");
  });
  it("does nothing without a pixel, and a refusal never throws", async () => {
    metaDeps.env = () => ({}) as any;
    expect(await reportMetaSignup({ email: "a@b.c" })).toBeNull();
    metaDeps.env = () => ({ META_PIXEL_ID: "1002566142243783", META_USER_TOKEN: "tok" }) as any;
    metaDeps.http = (async () => new Response("no", { status: 400 })) as any;
    expect(await reportMetaSignup({ email: "a@b.c", eventId: "fixed" })).toBe("fixed");
    metaDeps.http = (async () => { throw new Error("down"); }) as any;
    expect(await reportMetaSignup({ email: "a@b.c", eventId: "fixed" })).toBe("fixed");
  });
});
