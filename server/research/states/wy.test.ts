import { describe, expect, it } from "vitest";
import { lookupAll } from "./wy";

describe("Wyoming licensing portal paging", () => {
  it("reads pages of 50 until a short page", async () => {
    const offsets: number[] = [];
    const r = await lookupAll(async (o) => { offsets.push(o); return Array.from({ length: o === 0 ? 50 : 3 }, (_, i) => ({ id: o + i })); });
    expect(offsets).toEqual([0, 50]);
    expect(r).toMatchObject({ more: false });
    expect(r.rows).toHaveLength(53);
  });
  it("says when it stopped before the end instead of returning a silent first page", async () => {
    const r = await lookupAll(async (o) => Array.from({ length: 50 }, (_, i) => ({ id: o + i })));
    expect(r.more).toBe(true);
    expect(r.rows).toHaveLength(300);
  });
  it("throws on an unexpected payload", async () => {
    await expect(lookupAll(async () => ({ error: "x" }))).rejects.toThrow(/unexpected payload/);
  });
});

describe("Wyoming holders (audit round 2, decision 2)", () => {
  it("a licensed business (service) is a business's license, an electrician (user) a person's", async () => {
    const { vi } = await import("vitest");
    const { pack } = await import("./wy");
    const { resetHostState } = await import("../http");
    resetHostState();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) return new Response("", { status: 404 });
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
      if (/PublicLookupService/.test(u)) return json([{ id: "s1", service_name: "Acme Electric Inc", primary_license_number: "C-1", city: "Casper" }]);
      if (/PublicLookupUser/.test(u)) return json([{ id: "u1", first_name: "Jane", last_name: "Doe", primary_license_number: "J-1" }]);
      return json([{ number: /services/.test(u) ? "C-1" : "J-1", status: "Active" }]);
    }));
    try {
      const s = pack.liveLicenses![0];
      expect((await s.search("Acme Electric Inc", "company"))[0].holder).toBe("business");
      expect((await s.search("Jane Doe", "person"))[0].holder).toBe("individual");
    } finally { vi.unstubAllGlobals(); resetHostState(); }
  });
});
