/** Yelp Fusion client: auth header, mapping, URL cleaning, and error classification. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { yelpDeps, yelpConfigured, yelpSearch, yelpBusiness, yelpReviews, mapBusiness, mapReview, cleanUrl, YelpError } from "./client";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const realHttp = yelpDeps.http, realEnv = yelpDeps.env;
afterEach(() => { yelpDeps.http = realHttp; yelpDeps.env = realEnv; });
function fake(answer: (url: URL, init: any) => unknown) {
  const calls: { url: URL; init: any }[] = [];
  yelpDeps.env = () => ({ YELP_API_KEY: "yelp-key-0123456789abcdef" } as any);
  yelpDeps.http = (async (u: any, init: any) => { const url = new URL(String(u)); calls.push({ url, init }); const r = answer(url, init); return r instanceof Response ? r : ok(r); }) as any;
  return calls;
}

describe("Yelp client", () => {
  it("is configured only with a key", () => {
    expect(yelpConfigured({ YELP_API_KEY: "x".repeat(40) } as any)).toBe(true);
    expect(yelpConfigured({} as any)).toBe(false);
  });
  it("cleans Yelp's UTM/adjust junk off URLs", () => {
    expect(cleanUrl("https://www.yelp.com/biz/roofelite-lutz?adjust_creative=abc&utm_campaign=yelp_api_v3&utm_source=abc")).toBe("https://www.yelp.com/biz/roofelite-lutz");
    expect(cleanUrl("not a url")).toBeNull();
  });
  it("maps a business and a review to our shape", () => {
    expect(mapBusiness({ id: "biz1", name: "RoofElite", rating: 5, review_count: 6, url: "https://yelp.com/biz/x?utm_source=a", image_url: "https://i/x.jpg", display_phone: "(833) 553-5483", location: { display_address: ["1 Main St", "Lutz, FL 33549"] } }))
      .toEqual({ yelpId: "biz1", name: "RoofElite", rating: 5, reviewCount: 6, url: "https://yelp.com/biz/x", imageUrl: "https://i/x.jpg", phone: "(833) 553-5483", location: "1 Main St, Lutz, FL 33549" });
    expect(mapReview({ id: "r1", rating: 5, text: "Great", time_created: "2026-07-31 14:10:01", url: "https://yelp.com/biz/x?hrid=r1", user: { name: "Ray T.", image_url: "https://i/u.jpg" } }))
      .toEqual({ id: "r1", rating: 5, text: "Great", timeCreated: "2026-07-31T14:10:01Z", url: "https://yelp.com/biz/x", user: { name: "Ray T.", imageUrl: "https://i/u.jpg" } });
  });
  it("searches with the key as a Bearer header and the term + location", async () => {
    const calls = fake((u) => u.pathname.endsWith("/businesses/search") ? { businesses: [{ id: "biz1", name: "RoofElite", rating: 5, review_count: 6 }, { id: "", name: "junk" }] } : {});
    const res = await yelpSearch("roofing", "Lutz, FL");
    expect(res).toHaveLength(1);                                  // the id-less junk row is dropped
    expect(res[0]).toMatchObject({ yelpId: "biz1", name: "RoofElite", rating: 5 });
    expect(calls[0].init.headers.Authorization).toBe("Bearer yelp-key-0123456789abcdef");
    expect(calls[0].url.searchParams.get("term")).toBe("roofing");
    expect(calls[0].url.searchParams.get("location")).toBe("Lutz, FL");
    await expect(yelpSearch("x", "Lutz")).rejects.toThrow(/business name/);
    await expect(yelpSearch("roofing", "")).rejects.toThrow(/city, address or ZIP/);
  });
  it("reads one business and up to 3 newest reviews", async () => {
    const calls = fake((u) => u.pathname.endsWith("/reviews") ? { reviews: [{ id: "r1", rating: 5, text: "Great", time_created: "2026-07-31 14:10:01", user: { name: "Ray T." } }], total: 6 } : { id: "biz1", name: "RoofElite", rating: 5, review_count: 6 });
    expect(await yelpBusiness("biz1")).toMatchObject({ yelpId: "biz1", rating: 5 });
    const rev = await yelpReviews("biz1");
    expect(rev.total).toBe(6);
    expect(rev.reviews[0]).toMatchObject({ rating: 5, user: { name: "Ray T." } });
    expect(calls.find((c) => c.url.pathname.endsWith("/reviews"))!.url.searchParams.get("sort_by")).toBe("newest");
    await expect(yelpBusiness("bad id!")).rejects.toThrow(/Invalid Yelp business id/);
  });
  it("classifies Yelp errors: bad key, rate limit, not found", async () => {
    fake(() => ok({ error: { code: "TOKEN_MISSING", description: "token" } }, 401));
    await expect(yelpBusiness("biz1")).rejects.toMatchObject({ status: 401 });
    fake(() => ok({ error: { code: "ACCESS_LIMIT_REACHED", description: "limit" } }, 429));
    await expect(yelpBusiness("biz1")).rejects.toMatchObject({ status: 429 });
    fake(() => ok({ error: { code: "BUSINESS_NOT_FOUND", description: "nope" } }, 404));
    await expect(yelpBusiness("biz1")).rejects.toMatchObject({ status: 404 });
    yelpDeps.env = () => ({} as any);
    await expect(yelpBusiness("biz1")).rejects.toMatchObject({ status: 503 });
  });
});
