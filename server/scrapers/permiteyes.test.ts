import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import adapter, { permitEyesPublicUrl, parsePermitEyesLayout, parsePermitEyesResults, permitEyesRequest, permitEyesDate } from "./permiteyes";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import { getAdapter, supportsAlerts } from "./registry";
vi.mock("../storage", () => ({ storage: {} }));
import type { AdapterCtx } from "./types";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeFetch: vi.fn() }));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/permiteyes/${name}`, import.meta.url), "utf8");
const ctx: AdapterCtx = { databaseId: 8, databaseName: "Bellingham", jurisdiction: "Bellingham, MA", searchUrl: "https://permiteyes.us/bellingham/publicview.php", portalUrl: null, browser: async () => { throw new Error("No browser"); }, log: () => {}, politeness: { minDelayMs: 1 } };
const html = fixture("bellingham-public.html");
const layout = parsePermitEyesLayout(html, ctx.searchUrl);
const mock = vi.mocked(politeFetch);
const response = (body: string) => new Response(body);
beforeEach(() => mock.mockReset());

describe("PermitEyes public layout and recorded data", () => {
  it("derives PHP tenant pages and preserves a publicview path", () => {
    expect(permitEyesPublicUrl("https://permiteyes.us/ludlow/loginuser.php")).toBe("https://permiteyes.us/ludlow/publicview.php");
    expect(permitEyesPublicUrl(ctx.searchUrl)).toBe(ctx.searchUrl);
    for (const url of ["https://example.org/ludlow/loginuser.php", "https://permiteyes.us.evil.com/ludlow/loginuser.php", "https://permiteyes.net/maynard/building/loginpages.asp", "https://permiteyes.us/berkshire/leepublicview.php", "https://permiteyes.us:8080/test/login.php"]) expect(() => permitEyesPublicUrl(url)).toThrow();
  });
  it("reads three real column layouts instead of fixed indices", () => {
    expect(layout.address).toBe(6); expect(layout.permit).toBe(10);
    const ludlow = parsePermitEyesLayout(fixture("ludlow-public.html"), "https://permiteyes.us/ludlow/publicview.php");
    expect(ludlow.address).toBe(9); expect(ludlow.permit).toBe(12);
    const fairhaven = parsePermitEyesLayout(fixture("fairhaven-public.html"), "https://permiteyes.us/fairhaven/publicview.php");
    expect(fairhaven.address).toBe(5); expect(fairhaven.permit).toBe(8);
    expect(fairhaven.endpoint).toBe("https://permiteyes.us/fairhaven/ajax/getpublichome.php");
  });
  it("uses DataTables nested filter parameters", () => {
    const body = permitEyesRequest(layout, layout.address, "41 cross st", 100);
    expect(body.get("columns[6][search][value]")).toBe("41 cross st");
    expect(body.get("columns[10][search][value]")).toBe("");
    expect(body.get("start")).toBe("100");
  });
  it("maps real records, preserves original cells, and leaves contractors unknown", () => {
    const payload = JSON.parse(fixture("bellingham-ma-recent-2026-10-03-2.txt"));
    const parsed = parsePermitEyesResults(payload, layout, ctx, ctx.searchUrl);
    expect(parsed.records).toHaveLength(33);
    expect(parsed.records[0]).toMatchObject({ permitNumber: "E-26-0497", address: "41 cross st", issuedAt: "2026-10-08", applicantName: "benjamin mahar", contractorName: null, databaseId: 8 });
    expect(parsed.records[0].raw?.cells).toEqual(payload.data[0]);
    expect(parsed.records[0].sourceUrl).toContain("building/electricalview.php?application_id=");
  });
  it.each([["ludlow", 85, "W-26-0741"], ["fairhaven", 38, "E-26-0388"]] as const)("parses %s recent records", (town, count, number) => {
    const url = `https://permiteyes.us/${town}/publicview.php`;
    const l = parsePermitEyesLayout(fixture(`${town}-public.html`), url);
    const parsed = parsePermitEyesResults(JSON.parse(fixture(`${town}-ma-recent-2026-10-03-2.txt`)), l, ctx, url);
    expect(parsed.records).toHaveLength(count); expect(parsed.records[0].permitNumber).toBe(number);
  });
  it("rejects login pages and malformed responses", () => {
    expect(() => parsePermitEyesLayout(fixture("ludlow-login.html"), ctx.searchUrl)).toThrow(PortalBlockedError);
    expect(() => parsePermitEyesResults({ data: [] }, layout, ctx, ctx.searchUrl)).toThrow();
    expect(() => parsePermitEyesResults({ data: [[]], recordsFiltered: 1 }, layout, ctx, ctx.searchUrl)).toThrow();
  });
  it("normalizes dates without inventing missing dates", () => {
    expect(permitEyesDate("10/08/26")).toBe("2026-10-08");
    expect(permitEyesDate("02/30/26")).toBeNull(); expect(permitEyesDate("")).toBeNull();
  });
});

describe("PermitEyes offline adapter", () => {
  it("registers every supported PermitEyes label", () => {
    for (const label of [adapter.platform, ...adapter.aliases!]) expect(getAdapter(label.toUpperCase())).toBe(adapter);
    expect(supportsAlerts("PermitEyes")).toBe(true);
  });
  it("returns an empty array for recorded genuine no results", async () => {
    mock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(fixture("bellingham-empty.json")));
    expect(await adapter.search(ctx, { type: "permit", value: "ConstructHUB-no-such-permit-20261010" })).toEqual([]);
  });
  it("searches by permit using recorded HTTP responses", async () => {
    mock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(fixture("bellingham-ma-search-permit-2.txt")));
    const records = await adapter.search(ctx, { type: "permit", value: "E-26-0497" });
    expect(records).toHaveLength(1); expect(records[0].permitNumber).toBe("E-26-0497");
    expect(mock.mock.calls[1][1]?.body?.toString()).toContain("E-26-0497");
    expect(mock.mock.calls[0][2]?.minDelayMs).toBe(1000);
  });
  it("fails on unsupported search types, blocked responses, and unexpected HTML", async () => {
    mock.mockResolvedValueOnce(response(html));
    await expect(adapter.search(ctx, { type: "company", value: "test" })).rejects.toThrow("does not support");
    mock.mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl, 429));
    await expect(adapter.search(ctx, { type: "address", value: "test" })).rejects.toBeInstanceOf(PortalBlockedError);
    mock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(fixture("ludlow-login.html")));
    await expect(adapter.search(ctx, { type: "address", value: "test" })).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it("retrieves all 195 real permits across two pages", async () => {
    mock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(fixture("bellingham-ma-recent-2026-09-12-2.txt"))).mockResolvedValueOnce(response(fixture("bellingham-ma-recent-2026-09-12-3.txt")));
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T17:00:00Z"));
    try {
      const records = await adapter.listRecent(ctx, "2026-09-12");
      expect(records).toHaveLength(195);
      expect(new Set(records.map(r => r.permitNumber)).size).toBe(195);
      expect((mock.mock.calls[2][1]?.body as URLSearchParams).get("start")).toBe("100");
    } finally { vi.useRealTimers(); }
  });
  it("advances start offsets and rejects repeated pages", async () => {
    const page = fixture("bellingham-main.json"); // real 20-row page with 1525 filtered results
    mock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(page)).mockResolvedValueOnce(response(page));
    await expect(adapter.search(ctx, { type: "address", value: "Main" })).rejects.toThrow("repeated");
    expect((mock.mock.calls[2][1]?.body as URLSearchParams).get("start")).toBe("20");
  });
  it("lists only the requested issue dates", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T17:00:00Z"));
    try {
      mock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(fixture("bellingham-ma-recent-2026-10-03-2.txt")));
      expect(await adapter.listRecent(ctx, "2026-10-03")).toHaveLength(33);
      expect((mock.mock.calls[1][1]?.body as URLSearchParams).get("columns[5][search][value]")).toBe("2026-10-03 | 2026-10-10");
      mock.mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(fixture("bellingham-ma-recent-2026-10-03-2.txt")));
      await expect(adapter.listRecent(ctx, "2026-10-09")).rejects.toThrow("did not honor");
    } finally { vi.useRealTimers(); }
  });
});
